from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import secrets
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage
from urllib.parse import quote

from .config import Settings
from .storage import (
    PendingEmail,
    claim_due_email,
    mark_email_failed,
    mark_email_sent,
    purge_expired_feedback,
    save_screenshot_tokens,
)


LOGGER = logging.getLogger("flow_shuttle_feedback.mailer")


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_screenshot_token(
    settings: Settings,
    screenshot_id: str,
    expires_at: int,
) -> tuple[str, str]:
    payload = json.dumps(
        {
            "id": screenshot_id,
            "exp": expires_at,
            "nonce": secrets.token_urlsafe(18),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded_payload = _b64url_encode(payload)
    signature = hmac.new(
        settings.token_secret,
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    token = f"{encoded_payload}.{_b64url_encode(signature)}"
    return token, hashlib.sha256(token.encode("ascii")).hexdigest()


def verify_screenshot_token(
    settings: Settings,
    screenshot_id: str,
    token: str,
    stored_hash: str | None,
    stored_expires_at: int | None,
) -> bool:
    if not token or not stored_hash or not stored_expires_at:
        return False
    if int(time.time()) > stored_expires_at:
        return False
    if not hmac.compare_digest(
        hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest(),
        stored_hash,
    ):
        return False
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(
            settings.token_secret,
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_b64url_decode(encoded_signature), expected_signature):
            return False
        payload = json.loads(_b64url_decode(encoded_payload))
        return (
            payload.get("id") == screenshot_id
            and payload.get("exp") == stored_expires_at
            and isinstance(payload.get("nonce"), str)
        )
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, TypeError):
        return False


def _build_message(
    settings: Settings,
    pending: PendingEmail,
    screenshot_links: list[str],
) -> EmailMessage:
    created_at = time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(pending.created_at))
    contact = pending.contact_email or "未填写"
    plain_lines = [
        "收到一条新的流梭用户反馈。",
        "",
        f"反馈编号：{pending.feedback_id}",
        f"提交时间：{created_at}",
        f"联系邮箱：{contact}",
        "",
        "反馈内容：",
        pending.message,
    ]
    if screenshot_links:
        plain_lines.extend(["", "私密截图（链接会自动过期）："])
        plain_lines.extend(
            f"- 截图 {index + 1}：{link}"
            for index, link in enumerate(screenshot_links)
        )

    escaped_message = html.escape(pending.message).replace("\n", "<br>")
    escaped_contact = html.escape(contact)
    links_html = ""
    if screenshot_links:
        items = "".join(
            f'<li><a href="{html.escape(link, quote=True)}">查看截图 {index + 1}</a></li>'
            for index, link in enumerate(screenshot_links)
        )
        links_html = f"<h3>私密截图</h3><p>链接会自动过期，请勿转发。</p><ul>{items}</ul>"

    message = EmailMessage()
    message["Subject"] = f"[流梭反馈] 新反馈 {pending.feedback_id}"
    message["From"] = settings.smtp_sender
    message["To"] = settings.recipient
    message.set_content("\n".join(plain_lines))
    message.add_alternative(
        """
        <html lang="zh-CN"><body>
          <h2>收到一条新的流梭用户反馈</h2>
          <dl>
            <dt>反馈编号</dt><dd>{request_id}</dd>
            <dt>提交时间</dt><dd>{created_at}</dd>
            <dt>联系邮箱</dt><dd>{contact}</dd>
          </dl>
          <h3>反馈内容</h3>
          <p>{feedback}</p>
          {links}
        </body></html>
        """.format(
            request_id=html.escape(pending.feedback_id),
            created_at=html.escape(created_at),
            contact=escaped_contact,
            feedback=escaped_message,
            links=links_html,
        ),
        subtype="html",
    )
    return message


def _send_smtp(settings: Settings, message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.smtp_security == "ssl":
        with smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=20,
            context=context,
        ) as smtp:
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


def process_one_email(settings: Settings) -> bool:
    if not settings.email_ready:
        return False
    pending = claim_due_email(settings)
    if pending is None:
        return False

    try:
        expires_at = int(time.time()) + settings.token_ttl_seconds
        token_rows: list[tuple[str, str, int]] = []
        links: list[str] = []
        for screenshot in pending.screenshots:
            token, token_hash = create_screenshot_token(settings, screenshot.id, expires_at)
            token_rows.append((screenshot.id, token_hash, expires_at))
            links.append(
                f"{settings.public_base_url}{settings.public_path}/screenshots/"
                f"{quote(screenshot.id, safe='')}?token={quote(token, safe='')}"
            )
        if token_rows:
            save_screenshot_tokens(settings, pending.feedback_id, token_rows)
        _send_smtp(settings, _build_message(settings, pending, links))
        mark_email_sent(settings, pending.feedback_id)
        LOGGER.info("feedback_email_sent request_id=%s", pending.feedback_id)
    except (OSError, smtplib.SMTPException, ValueError):
        mark_email_failed(
            settings,
            pending.feedback_id,
            pending.attempt,
            "smtp_delivery_failed",
        )
        LOGGER.warning("feedback_email_retry_scheduled request_id=%s", pending.feedback_id)
    except Exception:
        mark_email_failed(
            settings,
            pending.feedback_id,
            pending.attempt,
            "unexpected_delivery_failure",
        )
        LOGGER.error("feedback_email_worker_failed request_id=%s", pending.feedback_id)
    return True


class OutboxWorker:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._wake = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name="flow-feedback-outbox",
            daemon=True,
        )

    def start(self) -> None:
        self._thread.start()

    def notify(self) -> None:
        self._wake.set()

    def _run(self) -> None:
        next_retention_check = 0.0
        while True:
            now = time.monotonic()
            if now >= next_retention_check:
                try:
                    deleted = purge_expired_feedback(self._settings)
                    if deleted:
                        LOGGER.info("feedback_retention_deleted count=%s", deleted)
                except Exception:
                    LOGGER.error("feedback_retention_cleanup_failed")
                next_retention_check = now + self._settings.retention_check_seconds
            processed = process_one_email(self._settings)
            if processed:
                continue
            retention_wait = max(0.0, next_retention_check - time.monotonic())
            self._wake.wait(min(self._settings.outbox_poll_seconds, retention_wait))
            self._wake.clear()
