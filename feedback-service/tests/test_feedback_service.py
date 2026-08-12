from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
import random
from contextlib import closing
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from werkzeug.datastructures import MultiDict

from flow_shuttle_feedback.app import create_app
from flow_shuttle_feedback.config import Settings
from flow_shuttle_feedback.mailer import create_screenshot_token, process_one_email
from flow_shuttle_feedback.storage import purge_expired_feedback, save_screenshot_tokens
from deploy.inject_nginx_include import INCLUDE, inject_location_include
from deploy.initialize_environment import PLACEHOLDER, initialize_environment


def image_bytes(format_name: str = "PNG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 3), color=(34, 139, 94)).save(output, format=format_name)
    return output.getvalue()


def large_png_bytes() -> bytes:
    random_bytes = random.Random(20260812).randbytes(400 * 300 * 3)
    output = BytesIO()
    Image.frombytes("RGB", (400, 300), random_bytes).save(output, format="PNG")
    return output.getvalue()


class FeedbackServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name).resolve()
        self.settings = Settings(
            data_dir=data_dir,
            database_path=data_dir / "feedback.sqlite3",
            screenshot_dir=data_dir / "screenshots",
            public_base_url="https://feedback.example.test",
            public_path="/api/flow-shuttle/feedback",
            token_secret=b"test-token-secret-that-is-at-least-32-characters",
            token_ttl_seconds=3600,
            smtp_enabled=False,
            smtp_host="",
            smtp_port=465,
            smtp_security="ssl",
            smtp_username="",
            smtp_password="",
            smtp_sender="",
            recipient="",
            outbox_poll_seconds=1,
            max_email_attempts=3,
            retention_days=180,
            retention_check_seconds=24 * 60 * 60,
            rate_limit_requests=20,
            rate_limit_failures=10,
            rate_limit_window_seconds=600,
            testing=True,
        )
        self.app = create_app(self.settings)
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _post(self, data, content_type: str = "multipart/form-data"):
        return self.client.post(
            self.settings.public_path,
            data=data,
            content_type=content_type,
            headers={"X-Real-IP": "203.0.113.18"},
        )

    def _database_rows(self, table: str):
        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            return connection.execute(f"SELECT * FROM {table}").fetchall()

    def test_accepts_feedback_and_five_valid_screenshots_durably(self) -> None:
        screenshots = [
            (BytesIO(image_bytes()), f"capture-{index}.png", "image/png")
            for index in range(5)
        ]
        response = self._post(
            {
                "message": "  The list interaction is much clearer now.  ",
                "email": "person@example.test",
                "screenshots": screenshots,
            }
        )

        self.assertEqual(response.status_code, 202)
        self.assertRegex(response.json["requestId"], r"^[0-9a-f-]{36}$")
        feedback_rows = self._database_rows("feedback_requests")
        screenshot_rows = self._database_rows("feedback_screenshots")
        outbox_rows = self._database_rows("email_outbox")
        self.assertEqual(len(feedback_rows), 1)
        self.assertEqual(feedback_rows[0][1], "The list interaction is much clearer now.")
        self.assertEqual(len(screenshot_rows), 5)
        self.assertEqual(len(list(self.settings.screenshot_dir.iterdir())), 5)
        self.assertEqual(outbox_rows[0][1], "pending")

        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            feedback_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(feedback_requests)")
            }
        self.assertNotIn("ip", feedback_columns)
        self.assertNotIn("user_agent", feedback_columns)

    def test_accepts_valid_screenshot_above_multipart_memory_threshold(self) -> None:
        screenshot = large_png_bytes()
        self.assertGreater(len(screenshot), 64 * 1024)
        self.assertLess(len(screenshot), 5 * 1024 * 1024)
        response = self._post(
            {
                "message": "A normal screenshot must reach the application validator.",
                "screenshots": (BytesIO(screenshot), "capture.png", "image/png"),
            }
        )
        self.assertEqual(response.status_code, 202)

    def test_retention_removes_only_feedback_older_than_180_days(self) -> None:
        old_response = self._post(
            {
                "message": "old feedback",
                "screenshots": (BytesIO(image_bytes()), "old.png", "image/png"),
            }
        )
        fresh_response = self._post({"message": "fresh feedback"})
        self.assertEqual(old_response.status_code, 202)
        self.assertEqual(fresh_response.status_code, 202)
        now = int(time.time())
        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            connection.execute(
                "UPDATE feedback_requests SET created_at = ? WHERE id = ?",
                (now - 181 * 24 * 60 * 60, old_response.json["requestId"]),
            )
            connection.commit()

        self.assertEqual(purge_expired_feedback(self.settings, now=now), 1)
        feedback_rows = self._database_rows("feedback_requests")
        self.assertEqual([row[0] for row in feedback_rows], [fresh_response.json["requestId"]])
        self.assertEqual(self._database_rows("feedback_screenshots"), [])
        self.assertEqual(self._database_rows("email_outbox")[0][0], fresh_response.json["requestId"])
        self.assertEqual(list(self.settings.screenshot_dir.iterdir()), [])

    def test_rejects_unknown_repeated_and_invalid_fields(self) -> None:
        cases = [
            {"message": "hello", "unexpected": "local context"},
            MultiDict([("message", "first"), ("message", "second")]),
            {
                "message": "hello",
                "screenshots": (BytesIO(b"not an image"), "fake.png", "image/png"),
            },
            {
                "message": "hello",
                "screenshots": (BytesIO(image_bytes()), "capture.jpg", "image/png"),
            },
        ]
        for payload in cases:
            with self.subTest(payload_type=type(payload).__name__):
                response = self._post(payload)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json, {"error": "validation"})
        self.assertEqual(self._database_rows("feedback_requests"), [])

        response = self.client.post(
            f"{self.settings.public_path}?localPath=hidden",
            data={"message": "hello"},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_six_screenshots_and_oversized_message(self) -> None:
        six_files = [
            (BytesIO(image_bytes()), f"capture-{index}.png", "image/png")
            for index in range(6)
        ]
        response = self._post({"message": "hello", "screenshots": six_files})
        self.assertEqual(response.status_code, 400)
        response = self._post({"message": "界" * 2001})
        self.assertEqual(response.status_code, 400)

    def test_rate_limits_repeated_failures_without_persisting_ip(self) -> None:
        limited_settings = replace(
            self.settings,
            rate_limit_requests=10,
            rate_limit_failures=2,
        )
        app = create_app(limited_settings)
        client = app.test_client()
        for _ in range(2):
            response = client.post(
                limited_settings.public_path,
                data={"message": ""},
                content_type="multipart/form-data",
                headers={"X-Real-IP": "198.51.100.42"},
            )
            self.assertEqual(response.status_code, 400)
        response = client.post(
            limited_settings.public_path,
            data={"message": "valid after repeated failures"},
            content_type="multipart/form-data",
            headers={"X-Real-IP": "198.51.100.42"},
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json, {"error": "rate_limited"})

    def test_private_screenshot_requires_matching_unexpired_token(self) -> None:
        response = self._post(
            {
                "message": "screenshot token test",
                "screenshots": (BytesIO(image_bytes()), "capture.png", "image/png"),
            }
        )
        feedback_id = response.json["requestId"]
        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            screenshot_id = connection.execute(
                "SELECT id FROM feedback_screenshots WHERE feedback_id = ?",
                (feedback_id,),
            ).fetchone()[0]

        expires_at = int(time.time()) + 300
        token, token_hash = create_screenshot_token(
            self.settings,
            screenshot_id,
            expires_at,
        )
        save_screenshot_tokens(
            self.settings,
            feedback_id,
            [(screenshot_id, token_hash, expires_at)],
        )
        path = f"{self.settings.public_path}/screenshots/{screenshot_id}"
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get(path, query_string={"token": "wrong"}).status_code, 404)
        valid_response = self.client.get(path, query_string={"token": token})
        try:
            self.assertEqual(valid_response.status_code, 200)
            self.assertEqual(valid_response.mimetype, "image/png")
            self.assertEqual(valid_response.headers["Cache-Control"], "no-store")
        finally:
            valid_response.close()

    def test_mailer_escapes_html_and_marks_outbox_sent(self) -> None:
        mail_settings = replace(
            self.settings,
            smtp_enabled=True,
            smtp_host="smtp.example.test",
            smtp_username="sender@example.test",
            smtp_password="server-only-password",
            smtp_sender="sender@example.test",
            recipient="recipient@example.test",
        )
        app = create_app(mail_settings)
        client = app.test_client()
        response = client.post(
            mail_settings.public_path,
            data={
                "message": "<script>alert('no')</script> & useful feedback",
                "email": "person@example.test",
                "screenshots": (
                    BytesIO(image_bytes()),
                    "capture.png",
                    "image/png",
                ),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 202)

        with patch("flow_shuttle_feedback.mailer._send_smtp") as send_smtp:
            self.assertTrue(process_one_email(mail_settings))
        sent_message = send_smtp.call_args.args[1]
        html_body = sent_message.get_body(preferencelist=("html",)).get_content()
        self.assertTrue(str(sent_message["Subject"]).startswith("[流梭反馈] 新反馈"))
        self.assertIn("收到一条新的流梭用户反馈", html_body)
        self.assertIn("私密截图", html_body)
        self.assertNotIn("<script>alert", html_body)
        self.assertIn("&lt;script&gt;alert", html_body)
        self.assertNotIn("server-only-password", sent_message.as_string())
        self.assertIn("/screenshots/", html_body)
        self.assertEqual(self._database_rows("email_outbox")[0][1], "sent")

    def test_nginx_include_injection_is_narrow_and_idempotent(self) -> None:
        source = "server {\n    error_page 404 /404.html;\n    location / {}\n}\n"
        injected = inject_location_include(source)
        self.assertIn(INCLUDE, injected)
        self.assertEqual(inject_location_include(injected), injected)
        with self.assertRaises(ValueError):
            inject_location_include("server {\n    location / {}\n}\n")

    def test_environment_initialization_generates_secret_and_preserves_existing_file(self) -> None:
        template = Path(self.temp_dir.name) / "environment.example"
        destination = Path(self.temp_dir.name) / "environment"
        template.write_text(f"TOKEN={PLACEHOLDER}\nSMTP_ENABLED=false\n", encoding="utf-8")
        self.assertTrue(initialize_environment(template, destination))
        content = destination.read_text(encoding="utf-8")
        self.assertNotIn(PLACEHOLDER, content)
        self.assertIn("SMTP_ENABLED=false", content)
        self.assertFalse(initialize_environment(template, destination))
        self.assertEqual(destination.read_text(encoding="utf-8"), content)


if __name__ == "__main__":
    unittest.main()
