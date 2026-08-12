from __future__ import annotations

import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("screenshot_dir", type=Path)
    args = parser.parse_args()
    with closing(sqlite3.connect(args.database)) as connection:
        feedback_count = connection.execute(
            "SELECT COUNT(*) FROM feedback_requests"
        ).fetchone()[0]
        screenshot_count = connection.execute(
            "SELECT COUNT(*) FROM feedback_screenshots"
        ).fetchone()[0]
        outbox = connection.execute(
            "SELECT status, attempts FROM email_outbox ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(feedback_requests)")
        }
    screenshot_files = [path for path in args.screenshot_dir.iterdir() if path.is_file()]
    private_modes = sorted({oct(os.stat(path).st_mode & 0o777) for path in screenshot_files})
    print(f"feedback_count={feedback_count}")
    print(f"screenshot_count={screenshot_count}")
    print(f"latest_outbox_status={outbox[0] if outbox else 'none'}")
    print(f"latest_outbox_attempts={outbox[1] if outbox else 0}")
    print(f"screenshot_file_count={len(screenshot_files)}")
    print(f"screenshot_file_modes={','.join(private_modes) if private_modes else 'none'}")
    print(f"stores_ip={'ip' in columns or 'source_ip' in columns}")
    print(f"stores_user_agent={'user_agent' in columns}")


if __name__ == "__main__":
    main()
