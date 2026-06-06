import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


RECOVERY_TITLE = "# 历史记录恢复"
RECOVERY_INTROS = {
    "以下内容从历史每日记录中恢复，用于作为该工作项当前内容的初始稿。",
    "以下内容从历史追加式进展记录中恢复，用于作为该工作项当前内容的初始稿。",
}
REMOVED_SECTION_LABELS = {"下一步计划：", "阻碍 / 需要帮助："}


def has_text(value):
    return isinstance(value, str) and value.strip() != ""


def now_timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def is_recovery_scaffold_line(line):
    stripped = line.strip()
    return (
        stripped == RECOVERY_TITLE
        or stripped in RECOVERY_INTROS
        or stripped.startswith("## ")
    )


def has_remaining_body(lines):
    return any(line.strip() and not is_recovery_scaffold_line(line) for line in lines)


def remove_plan_and_blocker_sections(content):
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cleaned = []
    skipping = False
    changed = False

    for line in lines:
        stripped = line.strip()
        if stripped in REMOVED_SECTION_LABELS:
            skipping = True
            changed = True
            continue
        if skipping:
            if stripped.startswith("## "):
                skipping = False
            else:
                changed = True
                continue
        cleaned.append(line)

    while cleaned and not cleaned[-1].strip():
        cleaned.pop()

    if not has_remaining_body(cleaned):
        next_content = ""
    else:
        next_content = "\n".join(cleaned).rstrip() + "\n"

    return next_content, changed or next_content != content


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database_path")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-path")
    args = parser.parse_args()

    if args.apply:
        if not args.backup_path:
            raise SystemExit("--backup-path is required with --apply")
        backup_path = Path(args.backup_path)
        if not backup_path.exists() or backup_path.stat().st_size == 0:
            raise SystemExit(f"Backup file is missing or empty: {backup_path}")

    connection = sqlite3.connect(args.database_path)
    connection.row_factory = sqlite3.Row
    candidates = [
        dict(row)
        for row in connection.execute(
            """
            SELECT
              win.id AS note_id,
              win.work_item_id,
              win.content_markdown,
              p.name AS project_name,
              wi.title AS work_item_title
            FROM work_item_notes win
            JOIN work_items wi ON wi.id = win.work_item_id
            JOIN projects p ON p.id = wi.project_id
            WHERE win.content_markdown LIKE '%下一步计划：%'
               OR win.content_markdown LIKE '%阻碍 / 需要帮助：%'
            ORDER BY p.name ASC, wi.title ASC
            """
        ).fetchall()
    ]

    changed_items = []
    for row in candidates:
        next_content, changed = remove_plan_and_blocker_sections(row["content_markdown"] or "")
        if changed:
            changed_items.append({**row, "next_content": next_content})

    if args.apply and changed_items:
        timestamp = now_timestamp()
        with connection:
            for item in changed_items:
                connection.execute(
                    """
                    UPDATE work_item_notes
                    SET content_markdown = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (item["next_content"], timestamp, item["note_id"]),
                )

    output = {
        "databasePath": str(args.database_path),
        "mode": "apply" if args.apply else "dry-run",
        "candidateCount": len(candidates),
        "changedCount": len(changed_items),
        "items": [
            {
                "projectName": item["project_name"],
                "workItemTitle": item["work_item_title"],
                "workItemId": item["work_item_id"],
                "contentLengthBefore": len(item["content_markdown"] or ""),
                "contentLengthAfter": len(item["next_content"] or ""),
            }
            for item in changed_items
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
