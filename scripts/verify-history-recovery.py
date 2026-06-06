import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def connect(path):
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def scalar(connection, sql, params=()):
    return connection.execute(sql, params).fetchone()[0]


def digest_table_text(connection, table, id_column, text_column):
    digest = hashlib.sha256()
    for row in connection.execute(
        f"SELECT {id_column}, {text_column} FROM {table} ORDER BY {id_column}"
    ):
        digest.update(str(row[0]).encode("utf-8"))
        digest.update(b"\0")
        digest.update((row[1] or "").encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def main():
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: verify-history-recovery.py <current-db> <backup-db> <sample-work-item-id>"
        )

    current_path = Path(sys.argv[1])
    backup_path = Path(sys.argv[2])
    sample_work_item_id = sys.argv[3]
    current = connect(current_path)
    backup = connect(backup_path)

    row_counts_equal = {}
    for table in ["daily_work_item_entries", "progress_entries", "daily_journals", "period_reports"]:
        row_counts_equal[table] = scalar(current, f"SELECT COUNT(*) FROM {table}") == scalar(
            backup, f"SELECT COUNT(*) FROM {table}"
        )

    report_markdown_digests_equal = {
        "daily_journals": digest_table_text(current, "daily_journals", "id", "report_markdown")
        == digest_table_text(backup, "daily_journals", "id", "report_markdown"),
        "period_reports": digest_table_text(current, "period_reports", "id", "report_markdown")
        == digest_table_text(backup, "period_reports", "id", "report_markdown"),
    }

    result = {
        "currentPath": str(current_path),
        "backupPath": str(backup_path),
        "sampleWorkItemId": sample_work_item_id,
        "sampleNoteLength": scalar(
            current,
            "SELECT LENGTH(content_markdown) FROM work_item_notes WHERE work_item_id = ?",
            (sample_work_item_id,),
        ),
        "sampleTodayProgressLengthOn20260604": scalar(
            current,
            """
            SELECT COALESCE(SUM(LENGTH(COALESCE(today_progress, ''))), 0)
            FROM daily_work_item_entries
            WHERE work_item_id = ? AND journal_date = '2026-06-04'
            """,
            (sample_work_item_id,),
        ),
        "todayDailyEntryCountCurrent": scalar(
            current, "SELECT COUNT(*) FROM daily_work_item_entries WHERE journal_date = '2026-06-04'"
        ),
        "todayDailyEntryCountBackup": scalar(
            backup, "SELECT COUNT(*) FROM daily_work_item_entries WHERE journal_date = '2026-06-04'"
        ),
        "rowCountsEqual": row_counts_equal,
        "reportMarkdownDigestsEqual": report_markdown_digests_equal,
        "workItemNoteSearchHitsForSampleContent": scalar(
            current,
            "SELECT COUNT(*) FROM work_item_notes WHERE content_markdown LIKE '%财务中央厨房%'",
        ),
        "dailyEntrySearchHitsForSampleContentOn20260604": scalar(
            current,
            """
            SELECT COUNT(*)
            FROM daily_work_item_entries
            WHERE journal_date = '2026-06-04'
              AND today_progress LIKE '%财务中央厨房%'
            """,
        ),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
