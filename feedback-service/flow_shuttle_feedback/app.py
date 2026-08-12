from __future__ import annotations

import ipaddress
import logging
import threading
import time
import warnings
from collections import defaultdict, deque
from io import BytesIO
from pathlib import Path
from typing import Iterable

from flask import Flask, Response, jsonify, request, send_file
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from .config import Settings
from .mailer import OutboxWorker, verify_screenshot_token
from .storage import (
    ScreenshotInput,
    get_screenshot,
    initialize_storage,
    storage_health,
    store_feedback,
)


LOGGER = logging.getLogger("flow_shuttle_feedback.app")
MAX_MESSAGE_CHARACTERS = 2_000
MAX_EMAIL_CHARACTERS = 254
MAX_SCREENSHOT_COUNT = 5
MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
MAX_REQUEST_BYTES = 27 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
ALLOWED_MIME_TYPES = {
    "image/png": ("PNG", {".png"}),
    "image/jpeg": ("JPEG", {".jpg", ".jpeg"}),
    "image/webp": ("WEBP", {".webp"}),
}


class RequestValidationError(Exception):
    pass


class SlidingWindowRateLimiter:
    def __init__(self, settings: Settings) -> None:
        self._window = settings.rate_limit_window_seconds
        self._request_limit = settings.rate_limit_requests
        self._failure_limit = settings.rate_limit_failures
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, client_key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            requests = self._trim(self._requests[client_key], now)
            failures = self._trim(self._failures[client_key], now)
            if len(requests) >= self._request_limit or len(failures) >= self._failure_limit:
                return False
            requests.append(now)
            return True

    def record_failure(self, client_key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._trim(self._failures[client_key], now).append(now)

    def _trim(self, values: deque[float], now: float) -> deque[float]:
        cutoff = now - self._window
        while values and values[0] <= cutoff:
            values.popleft()
        return values


def _client_key() -> str:
    remote = request.remote_addr or "unknown"
    try:
        remote_ip = ipaddress.ip_address(remote)
    except ValueError:
        return "unknown"
    if remote_ip.is_loopback:
        forwarded = request.headers.get("X-Real-IP", "").strip()
        try:
            return str(ipaddress.ip_address(forwarded)) if forwarded else str(remote_ip)
        except ValueError:
            return str(remote_ip)
    return str(remote_ip)


def _validate_message(values: list[str]) -> str:
    if len(values) != 1:
        raise RequestValidationError
    message = values[0].strip()
    if not message or len(message) > MAX_MESSAGE_CHARACTERS:
        raise RequestValidationError
    return message


def _validate_email(values: list[str]) -> str | None:
    if len(values) > 1:
        raise RequestValidationError
    if not values:
        return None
    email = values[0].strip()
    if not email:
        return None
    if len(email) > MAX_EMAIL_CHARACTERS or email.count("@") != 1:
        raise RequestValidationError
    local, domain = email.rsplit("@", 1)
    if not local or not domain or "." not in domain or any(character.isspace() for character in email):
        raise RequestValidationError
    return email


def _read_limited(stream, limit: int) -> bytes:
    data = stream.read(limit + 1)
    if not data or len(data) > limit:
        raise RequestValidationError
    return data


def _validate_image(upload) -> ScreenshotInput:
    mime_type = (upload.mimetype or "").lower()
    expected = ALLOWED_MIME_TYPES.get(mime_type)
    if expected is None:
        raise RequestValidationError
    expected_format, allowed_extensions = expected
    extension = Path(upload.filename or "").suffix.lower()
    if extension not in allowed_extensions:
        raise RequestValidationError
    data = _read_limited(upload.stream, MAX_SCREENSHOT_BYTES)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                actual_format = image.format
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise RequestValidationError
                image.verify()
            with Image.open(BytesIO(data)) as decoded:
                decoded.load()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombWarning):
        raise RequestValidationError from None
    if actual_format != expected_format:
        raise RequestValidationError
    return ScreenshotInput(mime_type=mime_type, extension=extension, data=data)


def _validate_request_payload() -> tuple[str, str | None, list[ScreenshotInput]]:
    if not request.content_type or not request.content_type.lower().startswith("multipart/form-data;"):
        raise RequestValidationError
    try:
        form_keys = set(request.form.keys())
        file_keys = set(request.files.keys())
    except BadRequest:
        raise RequestValidationError from None
    if not form_keys.issubset({"message", "email"}) or not file_keys.issubset({"screenshots"}):
        raise RequestValidationError
    message = _validate_message(request.form.getlist("message"))
    email = _validate_email(request.form.getlist("email"))
    uploads = request.files.getlist("screenshots")
    if len(uploads) > MAX_SCREENSHOT_COUNT:
        raise RequestValidationError
    return message, email, [_validate_image(upload) for upload in uploads]


def _error_response(code: str, status: int) -> tuple[Response, int]:
    return jsonify({"error": code}), status


def create_app(settings: Settings | None = None) -> Flask:
    resolved_settings = settings or Settings.from_env()
    initialize_storage(resolved_settings)
    app = Flask(__name__)
    app.config.update(
        MAX_CONTENT_LENGTH=MAX_REQUEST_BYTES,
        # Let valid screenshots reach the per-file 5 MiB validator. The total
        # multipart body remains bounded by MAX_CONTENT_LENGTH above.
        MAX_FORM_MEMORY_SIZE=MAX_REQUEST_BYTES,
        MAX_FORM_PARTS=8,
        TESTING=resolved_settings.testing,
    )
    app.extensions["flow_feedback_settings"] = resolved_settings
    limiter = SlidingWindowRateLimiter(resolved_settings)
    worker = OutboxWorker(resolved_settings)
    app.extensions["flow_feedback_worker"] = worker
    if not resolved_settings.testing:
        worker.start()

    @app.after_request
    def secure_response(response: Response) -> Response:
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def request_too_large(_error: RequestEntityTooLarge):
        return _error_response("request_too_large", 413)

    @app.errorhandler(404)
    def not_found(_error):
        return _error_response("not_found", 404)

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return _error_response("method_not_allowed", 405)

    @app.errorhandler(500)
    def internal_error(_error):
        return _error_response("server_error", 500)

    @app.get("/health")
    def health():
        if not storage_health(resolved_settings):
            return jsonify({"status": "unhealthy", "emailReady": resolved_settings.email_ready}), 503
        return jsonify({"status": "ok", "emailReady": resolved_settings.email_ready})

    @app.post(resolved_settings.public_path)
    def submit_feedback():
        client_key = _client_key()
        if not limiter.allow(client_key):
            return _error_response("rate_limited", 429)
        if request.args:
            limiter.record_failure(client_key)
            return _error_response("validation", 400)
        try:
            message, email, screenshots = _validate_request_payload()
        except RequestValidationError:
            limiter.record_failure(client_key)
            return _error_response("validation", 400)
        try:
            feedback_id = store_feedback(
                resolved_settings,
                message,
                email,
                screenshots,
            )
        except Exception:
            LOGGER.error("feedback_storage_failed")
            return _error_response("server_error", 500)
        worker.notify()
        LOGGER.info(
            "feedback_accepted request_id=%s screenshot_count=%s",
            feedback_id,
            len(screenshots),
        )
        return jsonify({"requestId": feedback_id}), 202

    @app.get(f"{resolved_settings.public_path}/screenshots/<screenshot_id>")
    def view_screenshot(screenshot_id: str):
        if len(screenshot_id) > 64:
            return _error_response("not_found", 404)
        screenshot = get_screenshot(resolved_settings, screenshot_id)
        token = request.args.get("token", "")
        if screenshot is None or not verify_screenshot_token(
            resolved_settings,
            screenshot_id,
            token,
            screenshot.token_hash,
            screenshot.token_expires_at,
        ):
            return _error_response("not_found", 404)
        stored_path = resolved_settings.screenshot_dir / screenshot.stored_name
        if not stored_path.is_file() or stored_path.parent != resolved_settings.screenshot_dir:
            return _error_response("not_found", 404)
        response = send_file(
            stored_path,
            mimetype=screenshot.mime_type,
            as_attachment=False,
            conditional=False,
            etag=False,
            max_age=0,
        )
        response.headers["Content-Disposition"] = "inline"
        return response

    return app
