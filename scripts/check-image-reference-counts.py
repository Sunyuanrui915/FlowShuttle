import json
import sqlite3
import sys


def main():
    connection = sqlite3.connect(sys.argv[1])
    checks = [
        ("work_item_notes", "content_markdown"),
        ("daily_work_item_entries", "today_progress"),
        ("daily_journals", "report_markdown"),
        ("period_reports", "report_markdown"),
    ]
    counts = {}
    for table, column in checks:
        counts[f"{table}.{column}.dataImage"] = connection.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE '%data:image/%'"
        ).fetchone()[0]
        counts[f"{table}.{column}.attachment"] = connection.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE '%attachment://%'"
        ).fetchone()[0]
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
