import json
import sqlite3
import sys
from pathlib import Path


def has_text(value):
    return isinstance(value, str) and value.strip() != ""


def populated_fields(row, fields):
    return [field for field in fields if has_text(row.get(field))]


def preview(value, limit=120):
    if not has_text(value):
        return ""
    text = value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
    return text[:limit] + ("..." if len(text) > limit else "")


def table_exists(connection, name):
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def find_recovery_source(connection, work_item_id):
    if table_exists(connection, "work_item_note_snapshots"):
        row = connection.execute(
            """
            SELECT snapshot_date AS date_key, content_markdown
            FROM work_item_note_snapshots
            WHERE work_item_id = ?
              AND content_markdown IS NOT NULL
              AND TRIM(content_markdown) <> ''
            ORDER BY snapshot_date DESC, updated_at DESC
            LIMIT 1
            """,
            (work_item_id,),
        ).fetchone()
        if row:
            return {
                "source": "work_item_note_snapshots",
                "recordCount": 1,
                "latestDate": row["date_key"],
                "contentLength": len(row["content_markdown"] or ""),
                "preview": preview(row["content_markdown"]),
            }

    if table_exists(connection, "daily_work_item_entries"):
        daily_rows = [
            dict(row)
            for row in connection.execute(
                """
                SELECT journal_date, today_progress, next_step, blocker, updated_at
                FROM daily_work_item_entries
                WHERE work_item_id = ?
                  AND (
                    (today_progress IS NOT NULL AND TRIM(today_progress) <> '')
                    OR (next_step IS NOT NULL AND TRIM(next_step) <> '')
                    OR (blocker IS NOT NULL AND TRIM(blocker) <> '')
                  )
                ORDER BY journal_date ASC, updated_at ASC
                """,
                (work_item_id,),
            ).fetchall()
        ]
        if daily_rows:
            latest = daily_rows[-1]
            populated = sorted(
                {
                    field
                    for row in daily_rows
                    for field in populated_fields(row, ["today_progress", "next_step", "blocker"])
                }
            )
            return {
                "source": "daily_work_item_entries",
                "recordCount": len(daily_rows),
                "latestDate": latest["journal_date"],
                "populatedFields": populated,
                "contentLength": sum(
                    len(row.get("today_progress") or "")
                    + len(row.get("next_step") or "")
                    + len(row.get("blocker") or "")
                    for row in daily_rows
                ),
                "preview": preview(latest.get("today_progress") or latest.get("next_step") or latest.get("blocker")),
            }

    if table_exists(connection, "progress_entries"):
        legacy_rows = [
            dict(row)
            for row in connection.execute(
                """
                SELECT entry_date, content, next_step, blocker, created_at
                FROM progress_entries
                WHERE work_item_id = ?
                  AND (
                    (content IS NOT NULL AND TRIM(content) <> '')
                    OR (next_step IS NOT NULL AND TRIM(next_step) <> '')
                    OR (blocker IS NOT NULL AND TRIM(blocker) <> '')
                  )
                ORDER BY entry_date ASC, created_at ASC
                """,
                (work_item_id,),
            ).fetchall()
        ]
        if legacy_rows:
            latest = legacy_rows[-1]
            populated = sorted(
                {
                    field
                    for row in legacy_rows
                    for field in populated_fields(row, ["content", "next_step", "blocker"])
                }
            )
            return {
                "source": "progress_entries",
                "recordCount": len(legacy_rows),
                "latestDate": latest["entry_date"],
                "populatedFields": populated,
                "contentLength": sum(
                    len(row.get("content") or "")
                    + len(row.get("next_step") or "")
                    + len(row.get("blocker") or "")
                    for row in legacy_rows
                ),
                "preview": preview(latest.get("content") or latest.get("next_step") or latest.get("blocker")),
            }

    return None


def diagnose_all(db_path):
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    items = [
        dict(row)
        for row in connection.execute(
            """
            SELECT
              wi.id,
              wi.title,
              wi.status,
              p.id AS project_id,
              p.name AS project_name,
              win.content_markdown AS note_content,
              win.updated_at AS note_updated_at
            FROM work_items wi
            JOIN projects p ON p.id = wi.project_id
            LEFT JOIN work_item_notes win ON win.work_item_id = wi.id
            WHERE wi.status <> 'archived'
            ORDER BY p.name ASC, wi.title ASC
            """
        ).fetchall()
    ]

    candidates = []
    non_empty_notes = 0
    empty_notes = 0
    for item in items:
        if has_text(item.get("note_content")):
            non_empty_notes += 1
            continue
        empty_notes += 1
        source = find_recovery_source(connection, item["id"])
        if source:
            candidates.append(
                {
                    "projectId": item["project_id"],
                    "projectName": item["project_name"],
                    "workItemId": item["id"],
                    "workItemTitle": item["title"],
                    "workItemStatus": item["status"],
                    "noteUpdatedAt": item["note_updated_at"],
                    **source,
                }
            )

    result = {
        "databasePath": str(db_path),
        "workItemCount": len(items),
        "nonEmptyNoteCount": non_empty_notes,
        "emptyNoteCount": empty_notes,
        "recoverableCandidateCount": len(candidates),
        "candidates": candidates,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    if len(sys.argv) == 3 and sys.argv[2] == "--all":
        diagnose_all(Path(sys.argv[1]))
        return

    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: diagnose-history-recovery.py <database-path> <project-name> <work-item-title>\n"
            "   or: diagnose-history-recovery.py <database-path> --all"
        )

    db_path = Path(sys.argv[1])
    project_name = sys.argv[2]
    work_item_title = sys.argv[3]

    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row

    def rows(sql, params=()):
        return [dict(row) for row in connection.execute(sql, params).fetchall()]

    def one(sql, params=()):
        row = connection.execute(sql, params).fetchone()
        return dict(row) if row else None

    projects = rows("SELECT * FROM projects WHERE name = ?", (project_name,))
    if not projects:
        projects = rows("SELECT * FROM projects WHERE name LIKE ?", (f"%{project_name}%",))

    work_items = rows(
        """
        SELECT wi.*, p.name AS project_name
        FROM work_items wi
        JOIN projects p ON p.id = wi.project_id
        WHERE wi.title = ? AND p.name = ?
        """,
        (work_item_title, project_name),
    )
    if not work_items:
        work_items = rows(
            """
            SELECT wi.*, p.name AS project_name
            FROM work_items wi
            JOIN projects p ON p.id = wi.project_id
            WHERE wi.title LIKE ?
            ORDER BY p.name ASC, wi.updated_at DESC
            """,
            (f"%{work_item_title}%",),
        )

    result = {
        "databasePath": str(db_path),
        "projectName": project_name,
        "workItemTitle": work_item_title,
        "projectsFound": [
            {
                "id": project["id"],
                "name": project["name"],
                "status": project["status"],
                "updated_at": project["updated_at"],
            }
            for project in projects
        ],
        "workItemsFound": [
            {
                "id": item["id"],
                "project_id": item["project_id"],
                "project_name": item["project_name"],
                "title": item["title"],
                "status": item["status"],
                "updated_at": item["updated_at"],
            }
            for item in work_items
        ],
        "diagnostics": None,
    }

    if not work_items:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    item = work_items[0]
    work_item_id = item["id"]
    diagnostics = {
        "workItemId": work_item_id,
        "projectId": item["project_id"],
        "tables": {},
    }

    if table_exists(connection, "work_item_notes"):
        note = one("SELECT * FROM work_item_notes WHERE work_item_id = ?", (work_item_id,))
        diagnostics["tables"]["work_item_notes"] = {
            "recordCount": 1 if note else 0,
            "latestDate": note["updated_at"] if note else None,
            "populatedFields": populated_fields(note or {}, ["content_markdown"]) if note else [],
            "contentLength": len(note["content_markdown"] or "") if note else 0,
            "isContentEmpty": not has_text(note["content_markdown"]) if note else True,
            "preview": preview(note["content_markdown"]) if note else "",
        }

    if table_exists(connection, "work_item_note_snapshots"):
        snapshots = rows(
            """
            SELECT *
            FROM work_item_note_snapshots
            WHERE work_item_id = ?
            ORDER BY snapshot_date DESC, updated_at DESC
            """,
            (work_item_id,),
        )
        nonempty = [row for row in snapshots if has_text(row.get("content_markdown"))]
        diagnostics["tables"]["work_item_note_snapshots"] = {
            "recordCount": len(snapshots),
            "nonEmptyCount": len(nonempty),
            "latestDate": snapshots[0]["snapshot_date"] if snapshots else None,
            "latestNonEmptyDate": nonempty[0]["snapshot_date"] if nonempty else None,
            "populatedFields": sorted(
                {field for row in nonempty for field in populated_fields(row, ["content_markdown"])}
            ),
            "latestNonEmptyLength": len(nonempty[0]["content_markdown"]) if nonempty else 0,
            "preview": preview(nonempty[0]["content_markdown"]) if nonempty else "",
        }

    if table_exists(connection, "daily_work_item_entries"):
        daily_entries = rows(
            """
            SELECT *
            FROM daily_work_item_entries
            WHERE work_item_id = ?
            ORDER BY journal_date ASC, updated_at ASC
            """,
            (work_item_id,),
        )
        nonempty = [
            row
            for row in daily_entries
            if populated_fields(row, ["today_progress", "next_step", "blocker"])
        ]
        diagnostics["tables"]["daily_work_item_entries"] = {
            "recordCount": len(daily_entries),
            "nonEmptyCount": len(nonempty),
            "latestDate": daily_entries[-1]["journal_date"] if daily_entries else None,
            "latestNonEmptyDate": nonempty[-1]["journal_date"] if nonempty else None,
            "populatedFields": sorted(
                {
                    field
                    for row in nonempty
                    for field in populated_fields(row, ["today_progress", "next_step", "blocker"])
                }
            ),
            "records": [
                {
                    "id": row["id"],
                    "journal_date": row["journal_date"],
                    "updated_at": row["updated_at"],
                    "populatedFields": populated_fields(
                        row, ["today_progress", "next_step", "blocker"]
                    ),
                    "todayProgressLength": len(row["today_progress"] or ""),
                    "nextStepLength": len(row["next_step"] or ""),
                    "blockerLength": len(row["blocker"] or ""),
                    "preview": preview(row["today_progress"] or row["next_step"] or row["blocker"]),
                }
                for row in nonempty
            ],
        }

    if table_exists(connection, "progress_entries"):
        legacy_entries = rows(
            """
            SELECT *
            FROM progress_entries
            WHERE work_item_id = ?
            ORDER BY entry_date ASC, created_at ASC
            """,
            (work_item_id,),
        )
        nonempty = [
            row
            for row in legacy_entries
            if populated_fields(row, ["content", "next_step", "blocker"])
        ]
        diagnostics["tables"]["progress_entries"] = {
            "recordCount": len(legacy_entries),
            "nonEmptyCount": len(nonempty),
            "latestDate": legacy_entries[-1]["entry_date"] if legacy_entries else None,
            "latestNonEmptyDate": nonempty[-1]["entry_date"] if nonempty else None,
            "populatedFields": sorted(
                {
                    field
                    for row in nonempty
                    for field in populated_fields(row, ["content", "next_step", "blocker"])
                }
            ),
            "records": [
                {
                    "id": row["id"],
                    "entry_date": row["entry_date"],
                    "created_at": row["created_at"],
                    "populatedFields": populated_fields(row, ["content", "next_step", "blocker"]),
                    "contentLength": len(row["content"] or ""),
                    "nextStepLength": len(row["next_step"] or ""),
                    "blockerLength": len(row["blocker"] or ""),
                    "preview": preview(row["content"] or row["next_step"] or row["blocker"]),
                }
                for row in nonempty
            ],
        }

    if table_exists(connection, "daily_journals"):
        journal_matches = rows(
            """
            SELECT id, journal_date, updated_at, LENGTH(report_markdown) AS length
            FROM daily_journals
            WHERE report_markdown LIKE ? OR report_markdown LIKE ?
            ORDER BY journal_date DESC
            """,
            (f"%{work_item_title}%", f"%{project_name}%"),
        )
        diagnostics["tables"]["daily_journals"] = {
            "recordCount": len(journal_matches),
            "latestDate": journal_matches[0]["journal_date"] if journal_matches else None,
            "populatedFields": ["report_markdown"] if journal_matches else [],
        }

    if table_exists(connection, "period_reports"):
        period_matches = rows(
            """
            SELECT id, report_type, period_start, period_end, updated_at, LENGTH(report_markdown) AS length
            FROM period_reports
            WHERE report_markdown LIKE ? OR report_markdown LIKE ?
            ORDER BY updated_at DESC
            """,
            (f"%{work_item_title}%", f"%{project_name}%"),
        )
        diagnostics["tables"]["period_reports"] = {
            "recordCount": len(period_matches),
            "latestDate": period_matches[0]["updated_at"] if period_matches else None,
            "populatedFields": ["report_markdown"] if period_matches else [],
        }

    has_note = not diagnostics["tables"].get("work_item_notes", {}).get("isContentEmpty", True)
    has_snapshot = diagnostics["tables"].get("work_item_note_snapshots", {}).get("nonEmptyCount", 0) > 0
    has_daily = diagnostics["tables"].get("daily_work_item_entries", {}).get("nonEmptyCount", 0) > 0
    has_legacy = diagnostics["tables"].get("progress_entries", {}).get("nonEmptyCount", 0) > 0
    diagnostics["recoverable"] = (not has_note) and (has_snapshot or has_daily or has_legacy)
    diagnostics["likelyCause"] = (
        "empty_work_item_note_created_by_migration"
        if (not has_note and (has_daily or has_legacy))
        else None
    )
    result["diagnostics"] = diagnostics

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
