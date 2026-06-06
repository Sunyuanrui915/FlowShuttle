import argparse
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def has_text(value):
    return isinstance(value, str) and value.strip() != ""


def normalize_line_endings(value):
    return value.replace("\r\n", "\n").replace("\r", "\n")


def build_daily_content(rows):
    lines = [
        "# 历史记录恢复",
        "",
        "以下内容从历史每日记录中恢复，用于作为该工作项当前内容的初始稿。",
        "",
    ]
    for row in rows:
        lines.extend([f"## {row['journal_date']}", ""])
        if has_text(row["today_progress"]):
            lines.append(normalize_line_endings(row["today_progress"]))
        if lines[-1] != "":
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_legacy_content(rows):
    lines = [
        "# 历史记录恢复",
        "",
        "以下内容从历史追加式进展记录中恢复，用于作为该工作项当前内容的初始稿。",
        "",
    ]
    for row in rows:
        lines.extend([f"## {row['entry_date']}", ""])
        if has_text(row["content"]):
            lines.append(normalize_line_endings(row["content"]))
        if lines[-1] != "":
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def preview(value, limit=120):
    text = normalize_line_endings(value).replace("\n", "\\n")
    return text[:limit] + ("..." if len(text) > limit else "")


def now_timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def recovery_for_work_item(connection, work_item_id):
    snapshot = connection.execute(
        """
        SELECT snapshot_date, content_markdown
        FROM work_item_note_snapshots
        WHERE work_item_id = ?
          AND content_markdown IS NOT NULL
          AND TRIM(content_markdown) <> ''
        ORDER BY snapshot_date DESC, updated_at DESC
        LIMIT 1
        """,
        (work_item_id,),
    ).fetchone()
    if snapshot:
        content = snapshot["content_markdown"]
        return {
            "source": "work_item_note_snapshots",
            "recordCount": 1,
            "latestDate": snapshot["snapshot_date"],
            "content": content,
        }

    daily_rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT journal_date, today_progress, next_step, blocker, updated_at
            FROM daily_work_item_entries
            WHERE work_item_id = ?
              AND today_progress IS NOT NULL
              AND TRIM(today_progress) <> ''
            ORDER BY journal_date ASC, updated_at ASC
            """,
            (work_item_id,),
        ).fetchall()
    ]
    if daily_rows:
        return {
            "source": "daily_work_item_entries",
            "recordCount": len(daily_rows),
            "latestDate": daily_rows[-1]["journal_date"],
            "content": build_daily_content(daily_rows),
        }

    legacy_rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT entry_date, content, next_step, blocker, created_at
            FROM progress_entries
            WHERE work_item_id = ?
              AND content IS NOT NULL
              AND TRIM(content) <> ''
            ORDER BY entry_date ASC, created_at ASC
            """,
            (work_item_id,),
        ).fetchall()
    ]
    if legacy_rows:
        return {
            "source": "progress_entries",
            "recordCount": len(legacy_rows),
            "latestDate": legacy_rows[-1]["entry_date"],
            "content": build_legacy_content(legacy_rows),
        }

    return None


def load_candidates(connection):
    work_items = [
        dict(row)
        for row in connection.execute(
            """
            SELECT
              wi.id,
              wi.title,
              wi.status,
              p.id AS project_id,
              p.name AS project_name,
              win.id AS note_id,
              win.content_markdown AS note_content,
              win.created_at AS note_created_at
            FROM work_items wi
            JOIN projects p ON p.id = wi.project_id
            LEFT JOIN work_item_notes win ON win.work_item_id = wi.id
            WHERE wi.status <> 'archived'
            ORDER BY p.name ASC, wi.title ASC
            """
        ).fetchall()
    ]

    candidates = []
    for item in work_items:
        if has_text(item["note_content"]):
            continue
        recovery = recovery_for_work_item(connection, item["id"])
        if not recovery:
            continue
        candidates.append(
            {
                **item,
                "source": recovery["source"],
                "recordCount": recovery["recordCount"],
                "latestDate": recovery["latestDate"],
                "contentLength": len(recovery["content"]),
                "preview": preview(recovery["content"]),
                "content": recovery["content"],
            }
        )
    return candidates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database_path")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-path")
    args = parser.parse_args()

    database_path = Path(args.database_path)
    if args.apply:
        if not args.backup_path:
            raise SystemExit("--backup-path is required with --apply")
        backup_path = Path(args.backup_path)
        if not backup_path.exists() or backup_path.stat().st_size == 0:
            raise SystemExit(f"Backup file is missing or empty: {backup_path}")

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    candidates = load_candidates(connection)

    restored = []
    if args.apply and candidates:
        timestamp = now_timestamp()
        with connection:
            for candidate in candidates:
                note_id = candidate["note_id"] or str(uuid.uuid4())
                if candidate["note_id"]:
                    connection.execute(
                        """
                        UPDATE work_item_notes
                        SET content_markdown = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND (content_markdown IS NULL OR TRIM(content_markdown) = '')
                        """,
                        (candidate["content"], timestamp, note_id),
                    )
                else:
                    connection.execute(
                        """
                        INSERT INTO work_item_notes
                          (id, work_item_id, content_markdown, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (note_id, candidate["id"], candidate["content"], timestamp, timestamp),
                    )
                restored.append(candidate)

    output = {
        "databasePath": str(database_path),
        "mode": "apply" if args.apply else "dry-run",
        "candidateCount": len(candidates),
        "restoredCount": len(restored),
        "items": [
            {
                "projectName": item["project_name"],
                "workItemTitle": item["title"],
                "workItemId": item["id"],
                "source": item["source"],
                "recordCount": item["recordCount"],
                "latestDate": item["latestDate"],
                "contentLength": item["contentLength"],
                "preview": item["preview"],
            }
            for item in (restored if args.apply else candidates)
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
