from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit


def _positive_int(value: str | None, default: int, name: str) -> int:
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if parsed <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return parsed


def _boolean(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError("boolean environment value must be true or false")


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_path: Path
    screenshot_dir: Path
    public_base_url: str
    public_path: str
    token_secret: bytes
    token_ttl_seconds: int
    smtp_enabled: bool
    smtp_host: str
    smtp_port: int
    smtp_security: str
    smtp_username: str
    smtp_password: str
    smtp_sender: str
    recipient: str
    outbox_poll_seconds: int
    max_email_attempts: int
    retention_days: int
    retention_check_seconds: int
    rate_limit_requests: int
    rate_limit_failures: int
    rate_limit_window_seconds: int
    testing: bool = False

    @property
    def email_ready(self) -> bool:
        if not self.smtp_enabled:
            return False
        return bool(
            self.smtp_host
            and self.smtp_port
            and self.smtp_sender
            and self.recipient
            and (not self.smtp_username or self.smtp_password)
        )

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if environ is None else environ
        data_dir = Path(env.get("FLOW_FEEDBACK_DATA_DIR", "/var/lib/flow-shuttle-feedback"))
        data_dir = data_dir.expanduser().resolve()
        public_base_url = env.get(
            "FLOW_FEEDBACK_PUBLIC_BASE_URL",
            "https://www.sunyuanrui.com",
        ).strip().rstrip("/")
        parsed_base = urlsplit(public_base_url)
        if (
            parsed_base.scheme != "https"
            or not parsed_base.hostname
            or parsed_base.username
            or parsed_base.password
            or parsed_base.query
            or parsed_base.fragment
            or parsed_base.path not in {"", "/"}
        ):
            raise ValueError("FLOW_FEEDBACK_PUBLIC_BASE_URL must be an HTTPS origin")

        public_path = env.get(
            "FLOW_FEEDBACK_PUBLIC_PATH",
            "/api/flow-shuttle/feedback",
        ).strip().rstrip("/")
        if not public_path.startswith("/") or "?" in public_path or "#" in public_path:
            raise ValueError("FLOW_FEEDBACK_PUBLIC_PATH must be an absolute URL path")

        testing = _boolean(env.get("FLOW_FEEDBACK_TESTING"), False)
        token_secret_text = env.get("FLOW_FEEDBACK_TOKEN_SECRET", "")
        if len(token_secret_text) < 32 and not testing:
            raise ValueError("FLOW_FEEDBACK_TOKEN_SECRET must contain at least 32 characters")
        if testing and not token_secret_text:
            token_secret_text = "test-token-secret-that-is-at-least-32-characters"

        smtp_enabled = _boolean(env.get("FLOW_FEEDBACK_SMTP_ENABLED"), False)
        smtp_security = env.get("FLOW_FEEDBACK_SMTP_SECURITY", "ssl").strip().lower()
        if smtp_security not in {"ssl", "starttls"}:
            raise ValueError("FLOW_FEEDBACK_SMTP_SECURITY must be ssl or starttls")

        settings = cls(
            data_dir=data_dir,
            database_path=data_dir / "feedback.sqlite3",
            screenshot_dir=data_dir / "screenshots",
            public_base_url=public_base_url,
            public_path=public_path,
            token_secret=token_secret_text.encode("utf-8"),
            token_ttl_seconds=_positive_int(
                env.get("FLOW_FEEDBACK_TOKEN_TTL_SECONDS"),
                7 * 24 * 60 * 60,
                "FLOW_FEEDBACK_TOKEN_TTL_SECONDS",
            ),
            smtp_enabled=smtp_enabled,
            smtp_host=env.get("FLOW_FEEDBACK_SMTP_HOST", "").strip(),
            smtp_port=_positive_int(
                env.get("FLOW_FEEDBACK_SMTP_PORT"),
                465,
                "FLOW_FEEDBACK_SMTP_PORT",
            ),
            smtp_security=smtp_security,
            smtp_username=env.get("FLOW_FEEDBACK_SMTP_USERNAME", "").strip(),
            smtp_password=env.get("FLOW_FEEDBACK_SMTP_PASSWORD", ""),
            smtp_sender=env.get("FLOW_FEEDBACK_SMTP_FROM", "").strip(),
            recipient=env.get("FLOW_FEEDBACK_RECIPIENT", "").strip(),
            outbox_poll_seconds=_positive_int(
                env.get("FLOW_FEEDBACK_OUTBOX_POLL_SECONDS"),
                15,
                "FLOW_FEEDBACK_OUTBOX_POLL_SECONDS",
            ),
            max_email_attempts=_positive_int(
                env.get("FLOW_FEEDBACK_MAX_EMAIL_ATTEMPTS"),
                8,
                "FLOW_FEEDBACK_MAX_EMAIL_ATTEMPTS",
            ),
            retention_days=_positive_int(
                env.get("FLOW_FEEDBACK_RETENTION_DAYS"),
                180,
                "FLOW_FEEDBACK_RETENTION_DAYS",
            ),
            retention_check_seconds=_positive_int(
                env.get("FLOW_FEEDBACK_RETENTION_CHECK_SECONDS"),
                24 * 60 * 60,
                "FLOW_FEEDBACK_RETENTION_CHECK_SECONDS",
            ),
            rate_limit_requests=_positive_int(
                env.get("FLOW_FEEDBACK_RATE_LIMIT_REQUESTS"),
                6,
                "FLOW_FEEDBACK_RATE_LIMIT_REQUESTS",
            ),
            rate_limit_failures=_positive_int(
                env.get("FLOW_FEEDBACK_RATE_LIMIT_FAILURES"),
                4,
                "FLOW_FEEDBACK_RATE_LIMIT_FAILURES",
            ),
            rate_limit_window_seconds=_positive_int(
                env.get("FLOW_FEEDBACK_RATE_LIMIT_WINDOW_SECONDS"),
                600,
                "FLOW_FEEDBACK_RATE_LIMIT_WINDOW_SECONDS",
            ),
            testing=testing,
        )
        if settings.smtp_enabled and not settings.email_ready:
            raise ValueError("SMTP is enabled but required mail settings are incomplete")
        return settings
