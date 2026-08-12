from __future__ import annotations

import os
import sqlite3
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .config import Settings


@dataclass(frozen=True)
class ScreenshotInput:
    mime_type: str
    extension: str
    data: bytes


@dataclass(frozen=True)
class StoredScreenshot:
    id: str
    stored_name: str
    mime_type: str
    size_bytes: int
    token_hash: str | None = None
    token_expires_at: int | None = None


@dataclass(frozen=True)
class PendingEmail:
    feedback_id: str
    message: str
    contact_email: str | None
    created_at: int
    attempt: int
    screenshots: tuple[StoredScreenshot, ...]


def _connect(settings: Settings) -> sqlite3.Connection:
    connection = sqlite3.connect(settings.database_path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def initialize_storage(settings: Settings) -> None:
    settings.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    settings.screenshot_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(settings.data_dir, 0o700)
        os.chmod(settings.screenshot_dir, 0o700)
    except OSError:
        pass
    with closing(_connect(settings)) as connection:
        with connection:
            connection.executescript(
                """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;

            CREATE TABLE IF NOT EXISTS feedback_requests (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                contact_email TEXT,
                created_at INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('accepted', 'notified'))
            );

            CREATE TABLE IF NOT EXISTS feedback_screenshots (
                id TEXT PRIMARY KEY,
                feedback_id TEXT NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
                stored_name TEXT NOT NULL UNIQUE,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
                token_hash TEXT,
                token_expires_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS email_outbox (
                feedback_id TEXT PRIMARY KEY REFERENCES feedback_requests(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'failed')),
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL,
                last_error_code TEXT,
                sent_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_email_outbox_due
                ON email_outbox(status, next_attempt_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_screenshots_feedback
                ON feedback_screenshots(feedback_id);
            CREATE INDEX IF NOT EXISTS idx_feedback_requests_created_at
                ON feedback_requests(created_at);
                """
            )
            connection.execute(
                "UPDATE email_outbox SET status = 'retry' WHERE status = 'sending'"
            )
    try:
        os.chmod(settings.database_path, 0o600)
    except OSError:
        pass


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def purge_expired_feedback(
    settings: Settings,
    *,
    now: int | None = None,
    batch_size: int = 100,
) -> int:
    cutoff = (int(time.time()) if now is None else now) - settings.retention_days * 24 * 60 * 60
    with closing(_connect(settings)) as connection:
        feedback_rows = connection.execute(
            """
            SELECT id
            FROM feedback_requests
            WHERE created_at < ?
            ORDER BY created_at, id
            LIMIT ?
            """,
            (cutoff, batch_size),
        ).fetchall()
        feedback_ids = [row["id"] for row in feedback_rows]
        if not feedback_ids:
            return 0
        placeholders = ",".join("?" for _ in feedback_ids)
        screenshot_rows = connection.execute(
            f"""
            SELECT feedback_id, stored_name
            FROM feedback_screenshots
            WHERE feedback_id IN ({placeholders})
            ORDER BY feedback_id, created_at, id
            """,
            feedback_ids,
        ).fetchall()

    screenshots_by_feedback: dict[str, list[str]] = {
        feedback_id: [] for feedback_id in feedback_ids
    }
    for row in screenshot_rows:
        screenshots_by_feedback[row["feedback_id"]].append(row["stored_name"])

    deletable_feedback_ids: list[str] = []
    removed_screenshot = False
    for feedback_id in feedback_ids:
        try:
            for stored_name in screenshots_by_feedback[feedback_id]:
                screenshot_path = settings.screenshot_dir / stored_name
                existed = screenshot_path.exists()
                screenshot_path.unlink(missing_ok=True)
                removed_screenshot = removed_screenshot or existed
        except OSError:
            continue
        deletable_feedback_ids.append(feedback_id)

    if removed_screenshot:
        _fsync_directory(settings.screenshot_dir)
    if not deletable_feedback_ids:
        return 0

    placeholders = ",".join("?" for _ in deletable_feedback_ids)
    with closing(_connect(settings)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            deleted = connection.execute(
                f"""
                DELETE FROM feedback_requests
                WHERE created_at < ? AND id IN ({placeholders})
                """,
                [cutoff, *deletable_feedback_ids],
            )
    return deleted.rowcount


def store_feedback(
    settings: Settings,
    message: str,
    contact_email: str | None,
    screenshots: Iterable[ScreenshotInput],
) -> str:
    feedback_id = str(uuid.uuid4())
    created_at = int(time.time())
    stored: list[StoredScreenshot] = []
    created_paths: list[Path] = []

    try:
        for screenshot in screenshots:
            screenshot_id = str(uuid.uuid4())
            stored_name = f"{uuid.uuid4().hex}{screenshot.extension}"
            stored_path = settings.screenshot_dir / stored_name
            with stored_path.open("xb") as file_handle:
                file_handle.write(screenshot.data)
                file_handle.flush()
                os.fsync(file_handle.fileno())
            try:
                os.chmod(stored_path, 0o600)
            except OSError:
                pass
            created_paths.append(stored_path)
            stored.append(
                StoredScreenshot(
                    id=screenshot_id,
                    stored_name=stored_name,
                    mime_type=screenshot.mime_type,
                    size_bytes=len(screenshot.data),
                )
            )

        if created_paths:
            _fsync_directory(settings.screenshot_dir)

        with closing(_connect(settings)) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                INSERT INTO feedback_requests(id, message, contact_email, created_at, status)
                VALUES (?, ?, ?, ?, 'accepted')
                    """,
                    (feedback_id, message, contact_email, created_at),
                )
                connection.executemany(
                    """
                INSERT INTO feedback_screenshots(
                    id, feedback_id, stored_name, mime_type, size_bytes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            screenshot.id,
                            feedback_id,
                            screenshot.stored_name,
                            screenshot.mime_type,
                            screenshot.size_bytes,
                            created_at,
                        )
                        for screenshot in stored
                    ],
                )
                connection.execute(
                    """
                INSERT INTO email_outbox(feedback_id, status, attempts, next_attempt_at)
                VALUES (?, 'pending', 0, ?)
                    """,
                    (feedback_id, created_at),
                )
        return feedback_id
    except Exception:
        for created_path in created_paths:
            try:
                created_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def claim_due_email(settings: Settings) -> PendingEmail | None:
    now = int(time.time())
    with closing(_connect(settings)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
            SELECT
                outbox.feedback_id,
                outbox.attempts,
                feedback.message,
                feedback.contact_email,
                feedback.created_at
            FROM email_outbox AS outbox
            JOIN feedback_requests AS feedback ON feedback.id = outbox.feedback_id
            WHERE outbox.status IN ('pending', 'retry')
                AND outbox.next_attempt_at <= ?
                AND outbox.attempts < ?
            ORDER BY outbox.next_attempt_at, feedback.created_at
            LIMIT 1
                """,
                (now, settings.max_email_attempts),
            ).fetchone()
            if row is None:
                return None
            updated = connection.execute(
                """
            UPDATE email_outbox
            SET status = 'sending', attempts = attempts + 1, last_error_code = NULL
            WHERE feedback_id = ? AND status IN ('pending', 'retry')
                """,
                (row["feedback_id"],),
            )
            if updated.rowcount != 1:
                return None
            screenshot_rows = connection.execute(
                """
            SELECT id, stored_name, mime_type, size_bytes, token_hash, token_expires_at
            FROM feedback_screenshots
            WHERE feedback_id = ?
            ORDER BY created_at, id
                """,
                (row["feedback_id"],),
            ).fetchall()
            return PendingEmail(
                feedback_id=row["feedback_id"],
                message=row["message"],
                contact_email=row["contact_email"],
                created_at=row["created_at"],
                attempt=row["attempts"] + 1,
                screenshots=tuple(
                    StoredScreenshot(
                        id=screenshot["id"],
                        stored_name=screenshot["stored_name"],
                        mime_type=screenshot["mime_type"],
                        size_bytes=screenshot["size_bytes"],
                        token_hash=screenshot["token_hash"],
                        token_expires_at=screenshot["token_expires_at"],
                    )
                    for screenshot in screenshot_rows
                ),
            )


def save_screenshot_tokens(
    settings: Settings,
    feedback_id: str,
    tokens: Iterable[tuple[str, str, int]],
) -> None:
    with closing(_connect(settings)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.executemany(
                """
            UPDATE feedback_screenshots
            SET token_hash = ?, token_expires_at = ?
            WHERE id = ? AND feedback_id = ?
                """,
                [
                    (token_hash, expires_at, screenshot_id, feedback_id)
                    for screenshot_id, token_hash, expires_at in tokens
                ],
            )


def mark_email_sent(settings: Settings, feedback_id: str) -> None:
    now = int(time.time())
    with closing(_connect(settings)) as connection:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
            UPDATE email_outbox
            SET status = 'sent', sent_at = ?, next_attempt_at = ?, last_error_code = NULL
            WHERE feedback_id = ?
                """,
                (now, now, feedback_id),
            )
            connection.execute(
                "UPDATE feedback_requests SET status = 'notified' WHERE id = ?",
                (feedback_id,),
            )


def mark_email_failed(
    settings: Settings,
    feedback_id: str,
    attempt: int,
    error_code: str,
) -> None:
    now = int(time.time())
    terminal = attempt >= settings.max_email_attempts
    retry_delay = min(6 * 60 * 60, 30 * (2 ** max(0, attempt - 1)))
    with closing(_connect(settings)) as connection:
        with connection:
            connection.execute(
                """
            UPDATE email_outbox
            SET status = ?, next_attempt_at = ?, last_error_code = ?
            WHERE feedback_id = ?
                """,
                (
                    "failed" if terminal else "retry",
                    now if terminal else now + retry_delay,
                    error_code,
                    feedback_id,
                ),
            )


def get_screenshot(settings: Settings, screenshot_id: str) -> StoredScreenshot | None:
    with closing(_connect(settings)) as connection:
        row = connection.execute(
            """
            SELECT id, stored_name, mime_type, size_bytes, token_hash, token_expires_at
            FROM feedback_screenshots
            WHERE id = ?
            """,
            (screenshot_id,),
        ).fetchone()
    if row is None:
        return None
    return StoredScreenshot(
        id=row["id"],
        stored_name=row["stored_name"],
        mime_type=row["mime_type"],
        size_bytes=row["size_bytes"],
        token_hash=row["token_hash"],
        token_expires_at=row["token_expires_at"],
    )


def storage_health(settings: Settings) -> bool:
    try:
        with closing(_connect(settings)) as connection:
            return connection.execute("SELECT 1").fetchone()[0] == 1
    except sqlite3.Error:
        return False
