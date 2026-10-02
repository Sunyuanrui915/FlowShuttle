import importlib.util
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("image_cleanup", Path(__file__).resolve().parents[2] / "scripts" / "clean-inline-data-images.py")
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class MaintenanceBackupTestCase(unittest.TestCase):
    def test_predictable_existing_hardlink_is_not_overwritten_and_backups_are_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "source.sqlite"
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("CREATE TABLE control(value TEXT)")
                connection.execute("INSERT INTO control VALUES ('complete backup')")
                connection.commit()
            backups = root / "backups"
            backups.mkdir()
            sentinel = root / "outside.txt"
            sentinel.write_bytes(b"must remain")
            predictable = backups / "flow-shuttle.before-data-image-cleanup-fixed.sqlite"
            os.link(sentinel, predictable)
            with patch.object(cleanup, "datetime") as clock:
                clock.now.return_value.strftime.return_value = "fixed"
                first = cleanup.create_backup(database, backups)
                second = cleanup.create_backup(database, backups)
            self.assertNotEqual(first, predictable)
            self.assertNotEqual(first, second)
            self.assertEqual(sentinel.read_bytes(), b"must remain")
            self.assertEqual(first.read_bytes(), database.read_bytes())
            with closing(sqlite3.connect(first)) as restored:
                self.assertEqual(restored.execute("SELECT value FROM control").fetchone()[0], "complete backup")

    def test_backup_failure_prevents_cleanup_database_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "source.sqlite"
            original = "before ![image](data:image/png;base64,YQ==) after"
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("CREATE TABLE control(value TEXT)")
                connection.execute("INSERT INTO control VALUES (?)", (original,))
                connection.commit()
            with patch("sys.argv", ["cleanup", str(database), "--apply"]), patch.object(cleanup, "create_backup", side_effect=OSError("isolated backup failure")):
                with self.assertRaises(OSError):
                    cleanup.main()
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT value FROM control").fetchone()[0], original)
