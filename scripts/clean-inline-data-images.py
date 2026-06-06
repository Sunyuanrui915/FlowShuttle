import argparse
import json
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


INLINE_MARKDOWN_IMAGE_RE = re.compile(
    r"!\[[^\]]*]\s*\(\s*data:image/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+\s*\)",
    re.IGNORECASE,
)
INLINE_HTML_IMAGE_RE = re.compile(
    r"<img\b[^>]*\bsrc=[\"']data:image/[^\"']+[\"'][^>]*>",
    re.IGNORECASE,
)
BARE_DATA_IMAGE_RE = re.compile(
    r"\(?data:image/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+\)?",
    re.IGNORECASE,
)


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def text_columns(connection):
    tables = [
        row["name"]
        for row in connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        )
    ]
    for table in tables:
        for column in connection.execute(f"PRAGMA table_info({quote_identifier(table)})"):
            column_type = (column["type"] or "").upper()
            if "TEXT" in column_type or column_type == "":
                yield table, column["name"]


def cleanup_whitespace(value):
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip() if not value.endswith("\n") else cleaned.strip() + "\n"


def clean_inline_data_images(value):
    if not isinstance(value, str) or "data:image/" not in value.lower():
        return value, 0

    count = 0

    def replace(match):
        nonlocal count
        count += 1
        return ""

    cleaned = INLINE_MARKDOWN_IMAGE_RE.sub(replace, value)
    cleaned = INLINE_HTML_IMAGE_RE.sub(replace, cleaned)
    cleaned = BARE_DATA_IMAGE_RE.sub(replace, cleaned)
    if count == 0:
        return value, 0
    return cleanup_whitespace(cleaned), count


def create_backup(database_path, backup_dir):
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"work-progress-journal.before-data-image-cleanup-{stamp}.sqlite"
    shutil.copy2(database_path, backup_path)
    if backup_path.stat().st_size != database_path.stat().st_size:
        raise RuntimeError("Backup size mismatch; cleanup aborted.")
    return backup_path


def scan(connection):
    changes = []
    for table, column in text_columns(connection):
        table_sql = quote_identifier(table)
        column_sql = quote_identifier(column)
        rows = connection.execute(
            f"""
            SELECT rowid AS rowid, {column_sql} AS value
            FROM {table_sql}
            WHERE {column_sql} LIKE '%data:image/%'
            """
        ).fetchall()
        for row in rows:
            original = row["value"]
            cleaned, removed_count = clean_inline_data_images(original)
            if removed_count > 0 and cleaned != original:
                changes.append(
                    {
                        "table": table,
                        "column": column,
                        "rowid": row["rowid"],
                        "removedCount": removed_count,
                        "lengthBefore": len(original or ""),
                        "lengthAfter": len(cleaned or ""),
                        "cleaned": cleaned,
                    }
                )
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database_path")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir")
    args = parser.parse_args()

    database_path = Path(args.database_path)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    changes = scan(connection)
    backup_path = None

    if args.apply and changes:
        backup_dir = Path(args.backup_dir) if args.backup_dir else database_path.parent / "backups"
        backup_path = create_backup(database_path, backup_dir)
        with connection:
            for change in changes:
                connection.execute(
                    f"""
                    UPDATE {quote_identifier(change["table"])}
                    SET {quote_identifier(change["column"])} = ?
                    WHERE rowid = ?
                    """,
                    (change["cleaned"], change["rowid"]),
                )

    summary = {}
    for change in changes:
        key = f"{change['table']}.{change['column']}"
        bucket = summary.setdefault(key, {"rows": 0, "removedCount": 0, "lengthRemoved": 0})
        bucket["rows"] += 1
        bucket["removedCount"] += change["removedCount"]
        bucket["lengthRemoved"] += change["lengthBefore"] - change["lengthAfter"]

    output = {
        "databasePath": str(database_path),
        "mode": "apply" if args.apply else "dry-run",
        "backupPath": str(backup_path) if backup_path else None,
        "changedRows": len(changes),
        "summary": summary,
        "items": [
            {
                "table": change["table"],
                "column": change["column"],
                "rowid": change["rowid"],
                "removedCount": change["removedCount"],
                "lengthBefore": change["lengthBefore"],
                "lengthAfter": change["lengthAfter"],
            }
            for change in changes[:50]
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
