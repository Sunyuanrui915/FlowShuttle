from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
import random
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from werkzeug.datastructures import MultiDict

from flow_shuttle_feedback.app import SlidingWindowRateLimiter, create_app
from flow_shuttle_feedback.config import Settings
from flow_shuttle_feedback.mailer import OutboxWorker, create_screenshot_token, process_one_email
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

    def test_shared_hourly_budget_survives_new_clients_and_restart(self) -> None:
        settings = replace(self.settings, max_feedback_per_hour=2)
        app = create_app(settings)
        for index in range(3):
            response = app.test_client().post(
                settings.public_path, data={"message": "budget control"},
                content_type="multipart/form-data", headers={"X-Real-IP": f"203.0.113.{index + 1}"},
            )
            self.assertEqual(response.status_code, 202 if index < 2 else 429)
        restarted = create_app(settings)
        response = restarted.test_client().post(settings.public_path, data={"message": "after restart"}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(len(self._database_rows("feedback_requests")), 2)
        self.assertEqual(len(self._database_rows("email_outbox")), 2)

    def test_daily_and_pending_budgets_reject_before_persistence(self) -> None:
        self.assertEqual(self._post({"message": "existing"}).status_code, 202)
        for limits in ({"max_feedback_per_day": 1}, {"max_pending_emails": 1}):
            with self.subTest(limits=limits):
                app = create_app(replace(self.settings, **limits))
                response = app.test_client().post(
                    self.settings.public_path,
                    data={"message": "rejected", "screenshots": (BytesIO(image_bytes()), "new.png", "image/png")},
                    content_type="multipart/form-data",
                )
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.json, {"error": "rate_limited"})
                self.assertEqual(list(self.settings.screenshot_dir.iterdir()), [])
        self.assertEqual(len(self._database_rows("feedback_requests")), 1)

    def test_retained_cap_counts_old_notified_records_without_deleting_them(self) -> None:
        response = self._post({"message": "must remain"})
        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            connection.execute("UPDATE feedback_requests SET created_at = ?, status = 'notified'", (int(time.time()) - 181 * 86400,))
            connection.execute("UPDATE email_outbox SET status = 'sent'")
            connection.commit()
        app = create_app(replace(self.settings, max_retained_feedback=1))
        rejected = app.test_client().post(self.settings.public_path, data={"message": "new"}, content_type="multipart/form-data")
        self.assertEqual(rejected.status_code, 503)
        self.assertEqual(self._database_rows("feedback_requests")[0][0], response.json["requestId"])

    def test_storage_budget_counts_orphans_and_preserves_normal_screenshots(self) -> None:
        orphan = self.settings.screenshot_dir / "orphan.png"
        orphan.write_bytes(b"x" * (2 * 1024 * 1024))
        app = create_app(replace(self.settings, max_storage_bytes=1024 * 1024))
        def post():
            return app.test_client().post(
                self.settings.public_path,
                data={"message": "image control", "screenshots": (BytesIO(image_bytes()), "normal.png", "image/png")},
                content_type="multipart/form-data",
            )
        self.assertEqual(post().status_code, 503)
        self.assertEqual(self._database_rows("feedback_requests"), [])
        self.assertEqual(list(self.settings.screenshot_dir.iterdir()), [orphan])
        orphan.unlink()
        self.assertEqual(post().status_code, 202)
        self.assertEqual(len(self._database_rows("feedback_screenshots")), 1)

    def test_free_space_floor_and_partial_write_failure_leave_no_accepted_rows(self) -> None:
        usage = type("Usage", (), {"free": self.settings.min_free_disk_bytes})()
        with patch("flow_shuttle_feedback.storage.shutil.disk_usage", return_value=usage):
            self.assertEqual(self._post({"message": "text only"}).status_code, 503)
        with patch("flow_shuttle_feedback.storage.os.fsync", side_effect=OSError("isolated disk failure")):
            response = self._post({"message": "file failure", "screenshots": (BytesIO(image_bytes()), "image.png", "image/png")})
            self.assertEqual(response.status_code, 500)
        self.assertEqual(self._database_rows("feedback_requests"), [])
        self.assertEqual(self._database_rows("email_outbox"), [])
        self.assertEqual(list(self.settings.screenshot_dir.iterdir()), [])
        self.assertEqual(self._post({"message": "normal retry"}).status_code, 202)

    def test_concurrent_clients_cannot_overrun_one_shared_slot(self) -> None:
        settings = replace(self.settings, max_feedback_per_hour=1)
        app = create_app(settings)
        def submit(index):
            return app.test_client().post(
                settings.public_path, data={"message": "concurrent control"}, content_type="multipart/form-data",
                headers={"X-Real-IP": f"198.51.100.{index + 1}"},
            ).status_code
        with ThreadPoolExecutor(max_workers=4) as executor:
            statuses = list(executor.map(submit, range(4)))
        self.assertEqual(sorted(statuses), [202, 429, 429, 429])
        self.assertEqual(len(self._database_rows("feedback_requests")), 1)

    def test_delivery_budget_holds_existing_queue_and_resumes_after_window(self) -> None:
        for index in range(2):
            self.assertEqual(self._post({"message": f"existing queue {index}"}).status_code, 202)
        settings = replace(
            self.settings, smtp_enabled=True, smtp_host="smtp.example.test", smtp_sender="sender@example.test",
            recipient="recipient@example.test", max_feedback_per_hour=1,
        )
        with patch("flow_shuttle_feedback.mailer._send_smtp") as send:
            self.assertTrue(process_one_email(settings))
            self.assertFalse(process_one_email(settings))
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(settings.database_path)) as connection:
                connection.execute("UPDATE email_delivery_budget SET attempted_at = ?", (int(time.time()) - 3601,))
                connection.commit()
            self.assertTrue(process_one_email(settings))
        self.assertEqual([row[1] for row in self._database_rows("email_outbox")], ["sent", "sent"])

    def test_limiter_capacity_preserves_active_limits_and_expires_idle_clients(self) -> None:
        limiter = SlidingWindowRateLimiter(replace(self.settings, max_tracked_clients=3, rate_limit_requests=1, rate_limit_window_seconds=10))
        with patch("flow_shuttle_feedback.app.time.monotonic", return_value=100):
            for index in range(3):
                self.assertTrue(limiter.allow(f"client-{index}"))
            for index in range(3, 1000):
                self.assertFalse(limiter.allow(f"client-{index}"))
                limiter.record_failure(f"client-{index}")
            self.assertFalse(limiter.allow("client-0"))
            self.assertEqual(len(limiter._requests), 3)
            self.assertEqual(len(limiter._failures), 3)
        with patch("flow_shuttle_feedback.app.time.monotonic", return_value=111):
            self.assertTrue(limiter.allow("fresh"))
            self.assertEqual(len(limiter._requests), 1)

    def test_smtp_failure_preserves_feedback_and_bounded_retries(self) -> None:
        self.assertEqual(self._post({"message": "durable during SMTP failure"}).status_code, 202)
        settings = replace(self.settings, smtp_enabled=True, smtp_host="smtp.example.test", smtp_sender="sender@example.test", recipient="recipient@example.test", max_email_attempts=2)
        with patch("flow_shuttle_feedback.mailer._send_smtp", side_effect=OSError("isolated SMTP failure")):
            self.assertTrue(process_one_email(settings))
            self.assertFalse(process_one_email(settings))
            self.assertEqual(self._database_rows("email_outbox")[0][1], "retry")
            with closing(sqlite3.connect(settings.database_path)) as connection:
                connection.execute("UPDATE email_outbox SET next_attempt_at = 0")
                connection.commit()
            self.assertTrue(process_one_email(settings))
            self.assertFalse(process_one_email(settings))
        self.assertEqual(self._database_rows("email_outbox")[0][1:3], ("failed", 2))
        self.assertEqual(len(self._database_rows("feedback_requests")), 1)

    def test_retention_worker_drains_more_than_one_batch_without_touching_fresh_records(self) -> None:
        fresh = self._post({"message": "fresh control"}).json["requestId"]
        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            connection.executemany("INSERT INTO feedback_requests VALUES (?, 'expired', NULL, ?, 'accepted')",
                [(f"expired-{index}", int(time.time()) - 181 * 86400) for index in range(201)])
            connection.commit()
        worker = OutboxWorker(self.settings)
        with patch.object(worker._wake, "wait", side_effect=RuntimeError("stop isolated worker")):
            with self.assertRaisesRegex(RuntimeError, "stop isolated"):
                worker._run()
        self.assertEqual([row[0] for row in self._database_rows("feedback_requests")], [fresh])

    def test_storage_scan_tolerates_a_screenshot_removed_by_retention(self) -> None:
        disappearing = self.settings.screenshot_dir / "expired.png"
        disappearing.write_bytes(b"expired control")
        original_scandir = os.scandir
        class Entry:
            def __init__(self, entry):
                self.entry = entry
            def is_file(self, *, follow_symlinks):
                result = self.entry.is_file(follow_symlinks=follow_symlinks)
                if Path(self.entry.path) == disappearing:
                    disappearing.unlink()
                return result
            def stat(self, *, follow_symlinks):
                # Unix DirEntry.stat observes live state; Windows may cache it.
                return Path(self.entry.path).stat(follow_symlinks=follow_symlinks)
        class Scan:
            def __init__(self, path):
                self.entries = original_scandir(path)
            def __enter__(self):
                return (Entry(entry) for entry in self.entries)
            def __exit__(self, *_args):
                self.entries.close()
        with patch("flow_shuttle_feedback.storage.os.scandir", side_effect=Scan):
            self.assertEqual(self._post({"message": "normal while cleanup runs"}).status_code, 202)

    def test_delivery_budget_survives_retention_restart_and_failed_attempts(self) -> None:
        self.assertEqual(self._post({"message": "old queued feedback"}).status_code, 202)
        settings = replace(self.settings, smtp_enabled=True, smtp_host="smtp.example.test", smtp_sender="sender@example.test", recipient="recipient@example.test", max_feedback_per_day=1)
        with patch("flow_shuttle_feedback.mailer._send_smtp", side_effect=OSError("isolated SMTP failure")):
            self.assertTrue(process_one_email(settings))
        with closing(sqlite3.connect(settings.database_path)) as connection:
            connection.execute("UPDATE feedback_requests SET created_at = ?", (int(time.time()) - 181 * 86400,))
            connection.commit()
        self.assertEqual(purge_expired_feedback(settings), 1)
        self.assertEqual(len(self._database_rows("email_delivery_budget")), 1)
        self.assertEqual(self._post({"message": "fresh feedback"}).status_code, 202)
        create_app(settings)
        with patch("flow_shuttle_feedback.mailer._send_smtp") as send:
            self.assertFalse(process_one_email(settings))
            send.assert_not_called()

    def test_upgrade_seeds_recent_successful_delivery_budget(self) -> None:
        self.assertEqual(self._post({"message": "already sent"}).status_code, 202)
        with closing(sqlite3.connect(self.settings.database_path)) as connection:
            connection.execute("DROP TABLE email_delivery_budget")
            connection.execute("UPDATE email_outbox SET status = 'sent', sent_at = ?", (int(time.time()),))
            connection.commit()
        create_app(self.settings)
        self.assertEqual(len(self._database_rows("email_delivery_budget")), 1)


if __name__ == "__main__":
    unittest.main()
