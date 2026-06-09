import { app } from "electron";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { copyFile, cp, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getLocalDateKey, getTimestamp } from "./date";
import { countTextMetricCharacters } from "../shared/textMetrics";
import {
  buildSettingsInfo,
  ensureDirectoryWritable,
  getDatabaseFileName,
  getDatabasePathForDirectory,
  isInsideDirectory,
  pathsEqual,
  resolveDataDirectory,
  setDataDirectory
} from "./settings";
import type {
  CreateProgressInput,
  CreateProjectInput,
  CreateWorkItemInput,
  DailyJournal,
  DailyJournalView,
  DailyReportListItem,
  DailyEntryAttachment,
  DailyWorkItemEntry,
  DailyWorkItemStatus,
  SaveDailyWorkItemResult,
  ExportMarkdownInput,
  HeatmapDay,
  HeatmapMonth,
  MigrationResult,
  MarkdownPayload,
  PrepareCopyResult,
  PeriodReportListItem,
  PeriodReportType,
  ProgressEntry,
  Project,
  ProjectDeleteSummary,
  ProjectDetail,
  ProjectListItem,
  ProjectMemo,
  ProjectWorkItem,
  SaveDailyEntryAttachmentInput,
  SaveDailyEntryAttachmentResult,
  SaveWorkItemNoteAttachmentInput,
  SaveWorkItemNoteAttachmentResult,
  SaveMemoAttachmentInput,
  SaveMemoAttachmentResult,
  SaveProjectMemoInput,
  RestoreWorkItemHistoryResult,
  SettingsInfo,
  SearchResult,
  TimelineEntry,
  TodayOverview,
  UpdateProjectInput,
  UpsertDailyWorkItemEntryInput,
  WorkItem,
  WorkItemNote,
  WorkItemHistoryRecovery,
  WorkItemHistoryRecoveryPreview,
  WorkItemNoteSnapshot,
  WorkItemDeleteSummary,
  WorkItemWithLatest
} from "../shared/types";

type SqliteDatabase = Database.Database;

const migrations = [
  {
    version: 1,
    name: "initial_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );

        CREATE TABLE IF NOT EXISTS work_items (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          archived_at TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS progress_entries (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          work_item_id TEXT,
          entry_date TEXT NOT NULL,
          content TEXT NOT NULL,
          next_step TEXT,
          blocker TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_items_project_status
          ON work_items(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_progress_entries_entry_date
          ON progress_entries(entry_date);
        CREATE INDEX IF NOT EXISTS idx_progress_entries_project_created
          ON progress_entries(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_progress_entries_work_item_created
          ON progress_entries(work_item_id, created_at);
      `);
    }
  },
  {
    version: 2,
    name: "daily_journal_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS daily_journals (
          id TEXT PRIMARY KEY,
          journal_date TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'draft',
          report_markdown TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS daily_work_item_entries (
          id TEXT PRIMARY KEY,
          journal_date TEXT NOT NULL,
          project_id TEXT NOT NULL,
          work_item_id TEXT NOT NULL,
          today_progress TEXT,
          next_step TEXT,
          blocker TEXT,
          status_for_today TEXT NOT NULL DEFAULT 'in_progress',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(journal_date, work_item_id),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_daily_entries_date
          ON daily_work_item_entries(journal_date);
        CREATE INDEX IF NOT EXISTS idx_daily_entries_project_date
          ON daily_work_item_entries(project_id, journal_date);
        CREATE INDEX IF NOT EXISTS idx_daily_entries_work_item_date
          ON daily_work_item_entries(work_item_id, journal_date);
      `);

      const legacyGroups = database
        .prepare(
          `
          SELECT
            pe.entry_date AS journal_date,
            wi.project_id AS project_id,
            pe.work_item_id AS work_item_id,
            GROUP_CONCAT(NULLIF(TRIM(pe.content), ''), char(10)) AS today_progress,
            GROUP_CONCAT(NULLIF(TRIM(pe.next_step), ''), char(10)) AS next_step,
            GROUP_CONCAT(NULLIF(TRIM(pe.blocker), ''), char(10)) AS blocker,
            MIN(pe.created_at) AS created_at,
            MAX(pe.updated_at) AS updated_at
          FROM progress_entries pe
          JOIN work_items wi ON wi.id = pe.work_item_id
          WHERE pe.work_item_id IS NOT NULL
          GROUP BY pe.entry_date, pe.work_item_id
          `
        )
        .all() as Array<{
        journal_date: string;
        project_id: string;
        work_item_id: string;
        today_progress: string | null;
        next_step: string | null;
        blocker: string | null;
        created_at: string;
        updated_at: string;
      }>;

      const insertJournal = database.prepare(
        `
        INSERT INTO daily_journals
          (id, journal_date, status, report_markdown, created_at, updated_at, closed_at)
        VALUES
          (?, ?, 'draft', NULL, ?, ?, NULL)
        ON CONFLICT(journal_date) DO NOTHING
        `
      );
      const insertEntry = database.prepare(
        `
        INSERT INTO daily_work_item_entries
          (id, journal_date, project_id, work_item_id, today_progress, next_step, blocker, status_for_today, created_at, updated_at)
        VALUES
          (@id, @journal_date, @project_id, @work_item_id, @today_progress, @next_step, @blocker, 'in_progress', @created_at, @updated_at)
        ON CONFLICT(journal_date, work_item_id) DO UPDATE SET
          today_progress = COALESCE(daily_work_item_entries.today_progress, excluded.today_progress),
          next_step = COALESCE(daily_work_item_entries.next_step, excluded.next_step),
          blocker = COALESCE(daily_work_item_entries.blocker, excluded.blocker),
          updated_at = MAX(daily_work_item_entries.updated_at, excluded.updated_at)
        `
      );

      for (const group of legacyGroups) {
        insertJournal.run(randomUUID(), group.journal_date, group.created_at, group.updated_at);
        insertEntry.run({ ...group, id: randomUUID() });
      }
    }
  },
  {
    version: 3,
    name: "period_reports_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS period_reports (
          id TEXT PRIMARY KEY,
          report_type TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          title TEXT NOT NULL,
          report_markdown TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(report_type, period_start, period_end)
        );

        CREATE INDEX IF NOT EXISTS idx_period_reports_type_period
          ON period_reports(report_type, period_start, period_end);
      `);
    }
  },
  {
    version: 4,
    name: "ai_report_refinements_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS ai_report_refinements (
          id TEXT PRIMARY KEY,
          period_report_id TEXT NOT NULL,
          report_type TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          refinement_mode TEXT NOT NULL DEFAULT 'standard',
          refined_markdown TEXT NOT NULL,
          source_markdown_hash TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(period_report_id, refinement_mode),
          FOREIGN KEY (period_report_id) REFERENCES period_reports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_report_refinements_report
          ON ai_report_refinements(period_report_id, refinement_mode);
        CREATE INDEX IF NOT EXISTS idx_ai_report_refinements_period
          ON ai_report_refinements(report_type, period_start, period_end);
      `);
    }
  },
  {
    version: 5,
    name: "project_memos_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS project_memos (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL UNIQUE,
          content_markdown TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memo_attachments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          memo_id TEXT,
          file_name TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (memo_id) REFERENCES project_memos(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_memo_attachments_project
          ON memo_attachments(project_id, created_at);
      `);
    }
  },
  {
    version: 6,
    name: "daily_entry_attachments_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS daily_entry_attachments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          work_item_id TEXT NOT NULL,
          journal_date TEXT NOT NULL,
          file_name TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_daily_entry_attachments_work_item
          ON daily_entry_attachments(work_item_id, journal_date);
        CREATE INDEX IF NOT EXISTS idx_daily_entry_attachments_project
          ON daily_entry_attachments(project_id, journal_date);
      `);
    }
  },
  {
    version: 7,
    name: "work_item_notes_schema",
    up(database: SqliteDatabase) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS work_item_notes (
          id TEXT PRIMARY KEY,
          work_item_id TEXT NOT NULL UNIQUE,
          content_markdown TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS work_item_note_snapshots (
          id TEXT PRIMARY KEY,
          work_item_id TEXT NOT NULL,
          snapshot_date TEXT NOT NULL,
          content_markdown TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(work_item_id, snapshot_date),
          FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_work_item_note_snapshots_work_item_date
          ON work_item_note_snapshots(work_item_id, snapshot_date);
      `);

      const now = getTimestamp();
      const missingNotes = database
        .prepare(
          `
          SELECT wi.id
          FROM work_items wi
          LEFT JOIN work_item_notes win ON win.work_item_id = wi.id
          WHERE win.id IS NULL
          `
        )
        .all() as Array<{ id: string }>;
      const insertNote = database.prepare(
        `
        INSERT INTO work_item_notes
          (id, work_item_id, content_markdown, created_at, updated_at)
        VALUES
          (@id, @work_item_id, '', @created_at, @updated_at)
        `
      );
      for (const item of missingNotes) {
        insertNote.run({
          id: randomUUID(),
          work_item_id: item.id,
          created_at: now,
          updated_at: now
        });
      }
    }
  }
];

let db: SqliteDatabase | null = null;

function database(): SqliteDatabase {
  if (!db) {
    const dbPath = getCurrentDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    runMigrations(db);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function reopenDatabase(): void {
  closeDatabase();
  database();
}

export function checkpointDatabase(): void {
  database();
  if (db) {
    db.pragma("wal_checkpoint(TRUNCATE)");
  }
}

export function getCurrentDatabasePath(): string {
  const resolved = resolveDataDirectory();
  return getDatabasePathForDirectory(resolved.dataDirectory);
}

export function getCurrentDataDirectory(): string {
  return resolveDataDirectory().dataDirectory;
}

function attachmentsDirectory(dataDirectory = getCurrentDataDirectory()): string {
  return resolve(dataDirectory, "attachments");
}

function projectMemoAttachmentsDirectory(projectId: string, dataDirectory = getCurrentDataDirectory()): string {
  return resolve(attachmentsDirectory(dataDirectory), "project-memos", projectId);
}

function dailyEntryAttachmentsDirectory(journalDate: string, workItemId: string, dataDirectory = getCurrentDataDirectory()): string {
  return resolve(attachmentsDirectory(dataDirectory), "daily-entries", journalDate, workItemId);
}

function workItemNoteAttachmentsDirectory(workItemId: string, dataDirectory = getCurrentDataDirectory()): string {
  return resolve(attachmentsDirectory(dataDirectory), "work-item-notes", workItemId);
}

async function copyAttachmentsDirectory(sourceDataDirectory: string, targetDataDirectory: string): Promise<boolean> {
  const source = attachmentsDirectory(sourceDataDirectory);
  const target = attachmentsDirectory(targetDataDirectory);
  if (!existsSync(source)) {
    return false;
  }
  if (existsSync(target)) {
    throw new Error("目标目录已存在 attachments 文件夹，无法确认是否安全合并。请选择空目录或先手动整理。");
  }
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return true;
}

function assertInside(baseDirectory: string, targetPath: string): void {
  const base = resolve(baseDirectory);
  const target = resolve(targetPath);
  if (target !== base && !target.startsWith(`${base}\\`) && !target.startsWith(`${base}/`)) {
    throw new Error("Invalid attachment path.");
  }
}

export function resolveAttachmentUrlToFilePath(urlString: string): string {
  const url = new URL(urlString);
  if (url.protocol !== "attachment:") {
    throw new Error("Invalid attachment URL.");
  }
  const relative = `${url.hostname}${decodeURIComponent(url.pathname)}`.replace(/^\/+/, "");
  if (!relative || relative.includes("..") || relative.includes("\\") || relative.startsWith("/")) {
    throw new Error("Invalid attachment path.");
  }
  const root = attachmentsDirectory();
  const filePath = resolve(root, relative);
  assertInside(root, filePath);
  return filePath;
}

export function getDatabaseSize(): number {
  const dbPath = getCurrentDatabasePath();
  return existsSync(dbPath) ? statSync(dbPath).size : 0;
}

export function getSettingsInfo(): SettingsInfo {
  return buildSettingsInfo(getCurrentDatabasePath(), getDatabaseSize());
}

export function prepareDataDirectoryForCopy(): PrepareCopyResult {
  checkpointDatabase();
  return {
    dataDirectory: getCurrentDataDirectory(),
    databasePath: getCurrentDatabasePath(),
    settings: getSettingsInfo()
  };
}

function runMigrations(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = database
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => (row as { version: number }).version);
  const appliedVersions = new Set(applied);

  const applyMigration = database.transaction((migration: (typeof migrations)[number]) => {
    migration.up(database);
    database
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      )
      .run(migration.version, migration.name, getTimestamp());
  });

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(migration);
    }
  }
}

function cleanOptional(value?: string): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function requireText(value: string, fieldName: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${fieldName} is required.`);
  }
  return cleaned;
}

function getProject(id: string): Project {
  const row = database().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) {
    throw new Error("Project not found.");
  }
  return row as Project;
}

function getWorkItem(id: string): WorkItem {
  const row = database().prepare("SELECT * FROM work_items WHERE id = ?").get(id);
  if (!row) {
    throw new Error("Work item not found.");
  }
  return row as WorkItem;
}

function getItemsWithLatest(projectId: string, status: "active" | "done"): WorkItemWithLatest[] {
  return database()
    .prepare(
      `
      SELECT
        wi.*,
        (
          SELECT latest.content
          FROM (
            SELECT dwe.today_progress AS content, dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.content AS content, pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          WHERE latest.content IS NOT NULL AND TRIM(latest.content) <> ''
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_content,
        (
          SELECT latest.next_step
          FROM (
            SELECT dwe.next_step AS next_step, dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.next_step AS next_step, pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          WHERE latest.next_step IS NOT NULL AND TRIM(latest.next_step) <> ''
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_next_step,
        (
          SELECT latest.blocker
          FROM (
            SELECT dwe.blocker AS blocker, dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.blocker AS blocker, pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          WHERE latest.blocker IS NOT NULL AND TRIM(latest.blocker) <> ''
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_blocker,
        (
          SELECT latest.updated_at
          FROM (
            SELECT dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_created_at
      FROM work_items wi
      WHERE wi.project_id = ? AND wi.status = ?
      ORDER BY wi.updated_at DESC
      `
    )
    .all(projectId, status) as WorkItemWithLatest[];
}

export function listActiveProjects(): ProjectListItem[] {
  return database()
    .prepare(
      `
      SELECT p.*, COUNT(wi.id) AS active_item_count
      FROM projects p
      LEFT JOIN work_items wi
        ON wi.project_id = p.id AND wi.status = 'active'
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      `
    )
    .all() as ProjectListItem[];
}

export function createProject(input: CreateProjectInput): Project {
  const now = getTimestamp();
  const project: Project = {
    id: randomUUID(),
    name: requireText(input.name, "Project name"),
    description: cleanOptional(input.description),
    status: "active",
    created_at: now,
    updated_at: now,
    archived_at: null
  };

  database()
    .prepare(
      `
      INSERT INTO projects
        (id, name, description, status, created_at, updated_at, archived_at)
      VALUES
        (@id, @name, @description, @status, @created_at, @updated_at, @archived_at)
      `
    )
    .run(project);

  return project;
}

export function updateProject(input: UpdateProjectInput): Project {
  const now = getTimestamp();
  database()
    .prepare(
      `
      UPDATE projects
      SET name = ?, description = ?, updated_at = ?
      WHERE id = ?
      `
    )
    .run(requireText(input.name, "Project name"), cleanOptional(input.description), now, input.id);
  return getProject(input.id);
}

export function archiveProject(id: string): Project {
  const now = getTimestamp();
  database()
    .prepare(
      `
      UPDATE projects
      SET status = 'archived', archived_at = ?, updated_at = ?
      WHERE id = ?
      `
    )
    .run(now, now, id);
  return getProject(id);
}

export function getProjectDeleteSummary(id: string): ProjectDeleteSummary {
  getProject(id);
  const connection = database();
  const workItemCount = connection
    .prepare("SELECT COUNT(*) AS count FROM work_items WHERE project_id = ?")
    .get(id) as { count: number };
  const dailyEntryCount = connection
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM daily_work_item_entries
      WHERE project_id = ?
         OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
      `
    )
    .get(id, id) as { count: number };
  const legacyProgressCount = connection
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM progress_entries
      WHERE project_id = ?
         OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
      `
    )
    .get(id, id) as { count: number };
  const memoAttachmentCount = connection
    .prepare("SELECT COUNT(*) AS count FROM memo_attachments WHERE project_id = ?")
    .get(id) as { count: number };

  return {
    workItemCount: Number(workItemCount.count),
    dailyEntryCount: Number(dailyEntryCount.count),
    legacyProgressCount: Number(legacyProgressCount.count),
    memoAttachmentCount: Number(memoAttachmentCount.count)
  };
}

export function getOrCreateProjectMemo(projectId: string): ProjectMemo {
  getProject(projectId);
  const existing = database()
    .prepare("SELECT * FROM project_memos WHERE project_id = ?")
    .get(projectId) as ProjectMemo | undefined;
  if (existing) {
    return existing;
  }
  const now = getTimestamp();
  const memo: ProjectMemo = {
    id: randomUUID(),
    project_id: projectId,
    content_markdown: "",
    created_at: now,
    updated_at: now
  };
  database()
    .prepare(
      `
      INSERT INTO project_memos
        (id, project_id, content_markdown, created_at, updated_at)
      VALUES
        (@id, @project_id, @content_markdown, @created_at, @updated_at)
      `
    )
    .run(memo);
  return memo;
}

export function saveProjectMemo(input: SaveProjectMemoInput): ProjectMemo {
  const project = getProject(input.projectId);
  const now = getTimestamp();
  const memo = getOrCreateProjectMemo(project.id);
  database()
    .prepare(
      `
      UPDATE project_memos
      SET content_markdown = ?,
          updated_at = ?
      WHERE id = ?
      `
    )
    .run(input.contentMarkdown, now, memo.id);
  database().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, project.id);
  return getOrCreateProjectMemo(project.id);
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  throw new Error("Unsupported image type.");
}

export async function saveProjectMemoAttachment(input: SaveMemoAttachmentInput): Promise<SaveMemoAttachmentResult> {
  const project = getProject(input.projectId);
  const memo = getOrCreateProjectMemo(project.id);
  const extension = extensionForMimeType(input.mimeType);
  const id = randomUUID();
  const fileName = `${id}.${extension}`;
  const relativePath = `attachments/project-memos/${project.id}/${fileName}`;
  const targetDirectory = projectMemoAttachmentsDirectory(project.id);
  const targetPath = resolve(getCurrentDataDirectory(), relativePath);
  assertInside(attachmentsDirectory(), targetPath);
  const buffer = Buffer.from(input.data);
  if (buffer.length === 0) {
    throw new Error("Empty memo image.");
  }

  mkdirSync(targetDirectory, { recursive: true });
  await writeFile(targetPath, buffer, { flag: "wx" });

  const now = getTimestamp();
  const attachment = {
    id,
    project_id: project.id,
    memo_id: memo.id,
    file_name: fileName,
    relative_path: relativePath,
    mime_type: input.mimeType,
    size_bytes: buffer.length,
    created_at: now
  };
  database()
    .prepare(
      `
      INSERT INTO memo_attachments
        (id, project_id, memo_id, file_name, relative_path, mime_type, size_bytes, created_at)
      VALUES
        (@id, @project_id, @memo_id, @file_name, @relative_path, @mime_type, @size_bytes, @created_at)
      `
    )
    .run(attachment);

  return {
    attachment,
    markdownUrl: `attachment://project-memos/${project.id}/${fileName}`
  };
}

export async function saveDailyWorkItemAttachment(
  input: SaveDailyEntryAttachmentInput
): Promise<SaveDailyEntryAttachmentResult> {
  const workItem = getWorkItem(input.workItemId);
  if (workItem.project_id !== input.projectId) {
    throw new Error("Work item does not belong to the selected project.");
  }
  getProject(input.projectId);
  const extension = extensionForMimeType(input.mimeType);
  const id = randomUUID();
  const fileName = `${id}.${extension}`;
  const relativePath = `attachments/daily-entries/${input.journalDate}/${workItem.id}/${fileName}`;
  const targetDirectory = dailyEntryAttachmentsDirectory(input.journalDate, workItem.id);
  const targetPath = resolve(getCurrentDataDirectory(), relativePath);
  assertInside(attachmentsDirectory(), targetPath);
  const buffer = Buffer.from(input.data);
  if (buffer.length === 0) {
    throw new Error("Empty daily entry image.");
  }

  mkdirSync(targetDirectory, { recursive: true });
  await writeFile(targetPath, buffer, { flag: "wx" });

  const now = getTimestamp();
  const attachment: DailyEntryAttachment = {
    id,
    project_id: input.projectId,
    work_item_id: workItem.id,
    journal_date: input.journalDate,
    file_name: fileName,
    relative_path: relativePath,
    mime_type: input.mimeType,
    size_bytes: buffer.length,
    created_at: now
  };
  database()
    .prepare(
      `
      INSERT INTO daily_entry_attachments
        (id, project_id, work_item_id, journal_date, file_name, relative_path, mime_type, size_bytes, created_at)
      VALUES
        (@id, @project_id, @work_item_id, @journal_date, @file_name, @relative_path, @mime_type, @size_bytes, @created_at)
      `
    )
    .run(attachment);

  return {
    attachment,
    markdownUrl: `attachment://daily-entries/${input.journalDate}/${workItem.id}/${fileName}`
  };
}

export async function saveWorkItemNoteAttachment(
  input: SaveWorkItemNoteAttachmentInput
): Promise<SaveWorkItemNoteAttachmentResult> {
  const workItem = getWorkItem(input.workItemId);
  if (workItem.project_id !== input.projectId) {
    throw new Error("Work item does not belong to the selected project.");
  }
  getProject(input.projectId);
  getOrCreateWorkItemNote(workItem.id);
  const extension = extensionForMimeType(input.mimeType);
  const id = randomUUID();
  const fileName = `${id}.${extension}`;
  const relativePath = `attachments/work-item-notes/${workItem.id}/${fileName}`;
  const targetDirectory = workItemNoteAttachmentsDirectory(workItem.id);
  const targetPath = resolve(getCurrentDataDirectory(), relativePath);
  assertInside(attachmentsDirectory(), targetPath);
  const buffer = Buffer.from(input.data);
  if (buffer.length === 0) {
    throw new Error("Empty work item note image.");
  }

  mkdirSync(targetDirectory, { recursive: true });
  await writeFile(targetPath, buffer, { flag: "wx" });

  const attachment = {
    id,
    project_id: input.projectId,
    work_item_id: workItem.id,
    file_name: fileName,
    relative_path: relativePath,
    mime_type: input.mimeType,
    size_bytes: buffer.length,
    created_at: getTimestamp()
  };

  return {
    attachment,
    markdownUrl: `attachment://work-item-notes/${workItem.id}/${fileName}`
  };
}

export function deleteProject(id: string): void {
  getProject(id);
  const attachmentDirectory = projectMemoAttachmentsDirectory(id);
  const dailyAttachmentDirectories = (
    database()
      .prepare("SELECT DISTINCT journal_date, work_item_id FROM daily_entry_attachments WHERE project_id = ?")
      .all(id) as Array<{ journal_date: string; work_item_id: string }>
  ).map((row) => dailyEntryAttachmentsDirectory(row.journal_date, row.work_item_id));
  const workItemNoteAttachmentDirectories = (
    database()
      .prepare("SELECT id FROM work_items WHERE project_id = ?")
      .all(id) as Array<{ id: string }>
  ).map((row) => workItemNoteAttachmentsDirectory(row.id));
  const transaction = database().transaction(() => {
    database()
      .prepare(
        `
        DELETE FROM daily_work_item_entries
        WHERE project_id = ?
           OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
        `
      )
      .run(id, id);
    database()
      .prepare(
        `
        DELETE FROM progress_entries
        WHERE project_id = ?
           OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
        `
      )
      .run(id, id);
    database()
      .prepare(
        `
        DELETE FROM work_item_note_snapshots
        WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
        `
      )
      .run(id);
    database()
      .prepare(
        `
        DELETE FROM work_item_notes
        WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
        `
      )
      .run(id);
    database().prepare("DELETE FROM work_items WHERE project_id = ?").run(id);
    database().prepare("DELETE FROM daily_entry_attachments WHERE project_id = ?").run(id);
    database().prepare("DELETE FROM memo_attachments WHERE project_id = ?").run(id);
    database().prepare("DELETE FROM project_memos WHERE project_id = ?").run(id);
    database().prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  transaction();
  if (existsSync(attachmentDirectory)) {
    try {
      rmSync(attachmentDirectory, { recursive: true, force: true });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Project memo attachments deletion failed.");
    }
  }
  for (const directory of dailyAttachmentDirectories) {
    if (existsSync(directory)) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Daily entry attachments deletion failed.");
      }
    }
  }
  for (const directory of workItemNoteAttachmentDirectories) {
    if (existsSync(directory)) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Work item note attachments deletion failed.");
      }
    }
  }
}

export function createWorkItem(input: CreateWorkItemInput): WorkItem {
  const project = getProject(input.projectId);
  if (project.status !== "active") {
    throw new Error("Archived projects cannot receive new work items.");
  }

  const now = getTimestamp();
  const item: WorkItem = {
    id: randomUUID(),
    project_id: input.projectId,
    title: requireText(input.title, "Work item title"),
    description: cleanOptional(input.description),
    status: "active",
    created_at: now,
    updated_at: now,
    completed_at: null,
    archived_at: null
  };
  const note: WorkItemNote = {
    id: randomUUID(),
    work_item_id: item.id,
    content_markdown: "",
    created_at: now,
    updated_at: now
  };

  const transaction = database().transaction(() => {
    database()
      .prepare(
        `
        INSERT INTO work_items
          (id, project_id, title, description, status, created_at, updated_at, completed_at, archived_at)
        VALUES
          (@id, @project_id, @title, @description, @status, @created_at, @updated_at, @completed_at, @archived_at)
        `
      )
      .run(item);
    database()
      .prepare(
        `
        INSERT INTO work_item_notes
          (id, work_item_id, content_markdown, created_at, updated_at)
        VALUES
          (@id, @work_item_id, @content_markdown, @created_at, @updated_at)
        ON CONFLICT(work_item_id) DO NOTHING
        `
      )
      .run(note);
    database()
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(now, input.projectId);
  });
  transaction();

  return item;
}

export function completeWorkItem(id: string): WorkItem {
  const item = getWorkItem(id);
  const now = getTimestamp();
  database()
    .prepare(
      `
      UPDATE work_items
      SET status = 'done', completed_at = ?, updated_at = ?
      WHERE id = ?
      `
    )
    .run(now, now, id);
  database()
    .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
    .run(now, item.project_id);
  return getWorkItem(id);
}

export function getWorkItemDeleteSummary(id: string): WorkItemDeleteSummary {
  getWorkItem(id);
  const connection = database();
  const dailyEntryCount = connection
    .prepare("SELECT COUNT(*) AS count FROM daily_work_item_entries WHERE work_item_id = ?")
    .get(id) as { count: number };
  const legacyProgressCount = connection
    .prepare("SELECT COUNT(*) AS count FROM progress_entries WHERE work_item_id = ?")
    .get(id) as { count: number };
  return {
    dailyEntryCount: Number(dailyEntryCount.count),
    legacyProgressCount: Number(legacyProgressCount.count)
  };
}

export function deleteWorkItem(id: string): void {
  const item = getWorkItem(id);
  const now = getTimestamp();
  const noteAttachmentDirectory = workItemNoteAttachmentsDirectory(id);
  const dailyAttachmentDirectories = (
    database()
      .prepare("SELECT DISTINCT journal_date, work_item_id FROM daily_entry_attachments WHERE work_item_id = ?")
      .all(id) as Array<{ journal_date: string; work_item_id: string }>
  ).map((row) => dailyEntryAttachmentsDirectory(row.journal_date, row.work_item_id));
  const transaction = database().transaction(() => {
    database().prepare("DELETE FROM daily_work_item_entries WHERE work_item_id = ?").run(id);
    database().prepare("DELETE FROM progress_entries WHERE work_item_id = ?").run(id);
    database().prepare("DELETE FROM work_item_note_snapshots WHERE work_item_id = ?").run(id);
    database().prepare("DELETE FROM work_item_notes WHERE work_item_id = ?").run(id);
    database().prepare("DELETE FROM daily_entry_attachments WHERE work_item_id = ?").run(id);
    database().prepare("DELETE FROM work_items WHERE id = ?").run(id);
    database().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, item.project_id);
  });
  transaction();
  for (const directory of dailyAttachmentDirectories) {
    if (existsSync(directory)) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Daily entry attachments deletion failed.");
      }
    }
  }
  if (existsSync(noteAttachmentDirectory)) {
    try {
      rmSync(noteAttachmentDirectory, { recursive: true, force: true });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Work item note attachments deletion failed.");
    }
  }
}

export function createProgress(input: CreateProgressInput): ProgressEntry {
  const workItem = getWorkItem(input.workItemId);
  if (workItem.project_id !== input.projectId) {
    throw new Error("Work item does not belong to the selected project.");
  }

  const now = getTimestamp();
  const content = input.content.trim();
  const nextStep = cleanOptional(input.nextStep);
  const blocker = cleanOptional(input.blocker);
  if (!content && !nextStep && !blocker) {
    throw new Error("请至少填写今日进展、下一步计划或阻碍中的一项。");
  }
  const entry: ProgressEntry = {
    id: randomUUID(),
    project_id: input.projectId,
    work_item_id: input.workItemId,
    entry_date: getLocalDateKey(),
    content,
    next_step: nextStep,
    blocker,
    created_at: now,
    updated_at: now
  };

  const transaction = database().transaction(() => {
    database()
      .prepare(
        `
        INSERT INTO progress_entries
          (id, project_id, work_item_id, entry_date, content, next_step, blocker, created_at, updated_at)
        VALUES
          (@id, @project_id, @work_item_id, @entry_date, @content, @next_step, @blocker, @created_at, @updated_at)
        `
      )
      .run(entry);
    database()
      .prepare("UPDATE work_items SET updated_at = ? WHERE id = ?")
      .run(now, input.workItemId);
    database()
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(now, input.projectId);
  });
  transaction();

  return entry;
}

export function listTodayProgress(): TimelineEntry[] {
  const today = getLocalDateKey();
  return database()
    .prepare(
      `
      SELECT
        pe.id,
        'legacy' AS source,
        pe.project_id,
        pe.work_item_id,
        pe.entry_date,
        pe.content,
        pe.content AS today_progress,
        pe.next_step,
        pe.blocker,
        NULL AS status_for_today,
        pe.created_at,
        pe.updated_at,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM progress_entries pe
      JOIN projects p ON p.id = pe.project_id
      LEFT JOIN work_items wi ON wi.id = pe.work_item_id
      WHERE pe.entry_date = ?
      ORDER BY pe.created_at DESC
      `
    )
    .all(today) as TimelineEntry[];
}

export function getTodayOverview(): TodayOverview {
  const today = getLocalDateKey();
  const connection = database();

  const stats = {
    activeProjects: Number(
      (connection.prepare("SELECT COUNT(*) AS count FROM projects WHERE status = 'active'").get() as {
        count: number;
      }).count
    ),
    activeWorkItems: Number(
      (
        connection
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM work_items wi
            JOIN projects p ON p.id = wi.project_id
            WHERE wi.status = 'active' AND p.status = 'active'
            `
          )
          .get() as { count: number }
      ).count
    ),
    todayEntries: Number(
      (
        connection
          .prepare("SELECT COUNT(*) AS count FROM progress_entries WHERE entry_date = ?")
          .get(today) as { count: number }
      ).count
    )
  };

  const projectRows = connection
    .prepare(
      `
      SELECT p.*
      FROM projects p
      WHERE p.status = 'active'
      ORDER BY p.updated_at DESC
      `
    )
    .all() as Project[];

  const groups = projectRows
    .map((project) => {
      const items = getItemsWithLatest(project.id, "active");
      return {
        project,
        activeCount: items.length,
        items
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    today,
    stats,
    groups,
    projects: projectRows
  };
}

function getOrCreateDailyJournal(journalDate: string): DailyJournal {
  const connection = database();
  const existing = connection
    .prepare("SELECT * FROM daily_journals WHERE journal_date = ?")
    .get(journalDate) as DailyJournal | undefined;
  if (existing) {
    return existing;
  }

  const now = getTimestamp();
  const journal: DailyJournal = {
    id: randomUUID(),
    journal_date: journalDate,
    status: "draft",
    report_markdown: null,
    created_at: now,
    updated_at: now,
    closed_at: null
  };
  connection
    .prepare(
      `
      INSERT INTO daily_journals
        (id, journal_date, status, report_markdown, created_at, updated_at, closed_at)
      VALUES
        (@id, @journal_date, @status, @report_markdown, @created_at, @updated_at, @closed_at)
      `
    )
    .run(journal);
  return journal;
}

export function getPreviousWorkDate(journalDate: string): string | null {
  const row = database()
    .prepare(
      `
      SELECT MAX(journal_date) AS journal_date
      FROM daily_work_item_entries
      WHERE journal_date < ?
      `
    )
    .get(journalDate) as { journal_date: string | null };
  return row.journal_date;
}

function getDailyEntry(journalDate: string, workItemId: string): DailyWorkItemEntry | null {
  return (
    (database()
      .prepare(
        `
        SELECT *
        FROM daily_work_item_entries
        WHERE journal_date = ? AND work_item_id = ?
        `
      )
      .get(journalDate, workItemId) as DailyWorkItemEntry | undefined) ?? null
  );
}

function getLatestDailyEntryBefore(journalDate: string, workItemId: string): DailyWorkItemEntry | null {
  return (
    (database()
      .prepare(
        `
        SELECT *
        FROM daily_work_item_entries
        WHERE work_item_id = ?
          AND journal_date < ?
        ORDER BY journal_date DESC, updated_at DESC
        LIMIT 1
        `
      )
      .get(workItemId, journalDate) as DailyWorkItemEntry | undefined) ?? null
  );
}

function getOrCreateWorkItemNote(workItemId: string): WorkItemNote {
  getWorkItem(workItemId);
  const existing = database()
    .prepare("SELECT * FROM work_item_notes WHERE work_item_id = ?")
    .get(workItemId) as WorkItemNote | undefined;
  if (existing) {
    return existing;
  }

  const now = getTimestamp();
  const note: WorkItemNote = {
    id: randomUUID(),
    work_item_id: workItemId,
    content_markdown: "",
    created_at: now,
    updated_at: now
  };
  database()
    .prepare(
      `
      INSERT INTO work_item_notes
        (id, work_item_id, content_markdown, created_at, updated_at)
      VALUES
        (@id, @work_item_id, @content_markdown, @created_at, @updated_at)
      ON CONFLICT(work_item_id) DO NOTHING
      `
    )
    .run(note);
  return (
    (database()
      .prepare("SELECT * FROM work_item_notes WHERE work_item_id = ?")
      .get(workItemId) as WorkItemNote | undefined) ?? note
  );
}

function getLatestWorkItemNoteSnapshotBefore(workItemId: string, journalDate: string): WorkItemNoteSnapshot | null {
  return (
    (database()
      .prepare(
        `
        SELECT *
        FROM work_item_note_snapshots
        WHERE work_item_id = ?
          AND snapshot_date < ?
        ORDER BY snapshot_date DESC
        LIMIT 1
        `
      )
      .get(workItemId, journalDate) as WorkItemNoteSnapshot | undefined) ?? null
  );
}

function upsertWorkItemNoteSnapshot(workItemId: string, snapshotDate: string, contentMarkdown: string | null): void {
  const now = getTimestamp();
  const existing = database()
    .prepare("SELECT * FROM work_item_note_snapshots WHERE work_item_id = ? AND snapshot_date = ?")
    .get(workItemId, snapshotDate) as WorkItemNoteSnapshot | undefined;
  const snapshot: WorkItemNoteSnapshot = {
    id: existing?.id ?? randomUUID(),
    work_item_id: workItemId,
    snapshot_date: snapshotDate,
    content_markdown: contentMarkdown ?? "",
    created_at: existing?.created_at ?? now,
    updated_at: now
  };
  database()
    .prepare(
      `
      INSERT INTO work_item_note_snapshots
        (id, work_item_id, snapshot_date, content_markdown, created_at, updated_at)
      VALUES
        (@id, @work_item_id, @snapshot_date, @content_markdown, @created_at, @updated_at)
      ON CONFLICT(work_item_id, snapshot_date) DO UPDATE SET
        content_markdown = excluded.content_markdown,
        updated_at = excluded.updated_at
      `
    )
    .run(snapshot);
}

function normalizeDailyStatus(value: DailyWorkItemStatus | undefined): DailyWorkItemStatus {
  if (value === "done_today" || value === "paused") {
    return value;
  }
  return "in_progress";
}

function cleanDailyText(value?: string): string | null {
  if (value === undefined) {
    return null;
  }
  return value.trim() ? value : null;
}

function hasMarkdownContent(value?: string | null): boolean {
  return Boolean(value?.trim());
}

function normalizeMarkdownLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function recoveryPreview(content: string): string {
  const normalized = normalizeMarkdownLineEndings(content).replace(/\n/g, "\\n");
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function buildDailyEntriesRecoveryContent(
  rows: Array<Pick<DailyWorkItemEntry, "journal_date" | "today_progress">>
): string {
  const lines = [
    "# 历史记录恢复",
    "",
    "以下内容从历史每日记录中恢复，用于作为该工作项当前内容的初始稿。",
    ""
  ];

  for (const row of rows) {
    lines.push(`## ${row.journal_date}`, "");
    if (hasMarkdownContent(row.today_progress)) {
      lines.push(normalizeMarkdownLineEndings(row.today_progress ?? ""));
    }
    if (lines[lines.length - 1] !== "") {
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function buildLegacyEntriesRecoveryContent(
  rows: Array<Pick<ProgressEntry, "entry_date" | "content">>
): string {
  const lines = [
    "# 历史记录恢复",
    "",
    "以下内容从历史追加式进展记录中恢复，用于作为该工作项当前内容的初始稿。",
    ""
  ];

  for (const row of rows) {
    lines.push(`## ${row.entry_date}`, "");
    if (hasMarkdownContent(row.content)) {
      lines.push(normalizeMarkdownLineEndings(row.content ?? ""));
    }
    if (lines[lines.length - 1] !== "") {
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function toRecoveryPreview(recovery: WorkItemHistoryRecovery): WorkItemHistoryRecoveryPreview {
  const { contentMarkdown: _contentMarkdown, ...preview } = recovery;
  return preview;
}

function buildWorkItemHistoryRecovery(workItemId: string): WorkItemHistoryRecovery | null {
  getWorkItem(workItemId);
  const connection = database();

  const snapshot = connection
    .prepare(
      `
      SELECT *
      FROM work_item_note_snapshots
      WHERE work_item_id = ?
        AND content_markdown IS NOT NULL
        AND TRIM(content_markdown) <> ''
      ORDER BY snapshot_date DESC, updated_at DESC
      LIMIT 1
      `
    )
    .get(workItemId) as WorkItemNoteSnapshot | undefined;
  if (snapshot) {
    const contentMarkdown = snapshot.content_markdown ?? "";
    return {
      source: "work_item_note_snapshots",
      recordCount: 1,
      latestDate: snapshot.snapshot_date,
      populatedFields: ["content_markdown"],
      contentLength: contentMarkdown.length,
      preview: recoveryPreview(contentMarkdown),
      contentMarkdown
    };
  }

  const dailyRows = connection
    .prepare(
      `
      SELECT *
      FROM daily_work_item_entries
      WHERE work_item_id = ?
        AND today_progress IS NOT NULL
        AND TRIM(today_progress) <> ''
      ORDER BY journal_date ASC, updated_at ASC
      `
    )
    .all(workItemId) as DailyWorkItemEntry[];
  if (dailyRows.length > 0) {
    const contentMarkdown = buildDailyEntriesRecoveryContent(dailyRows);
    const latest = dailyRows[dailyRows.length - 1];
    const populatedFields = new Set<string>();
    for (const row of dailyRows) {
      if (hasMarkdownContent(row.today_progress)) {
        populatedFields.add("today_progress");
      }
    }
    return {
      source: "daily_work_item_entries",
      recordCount: dailyRows.length,
      latestDate: latest.journal_date,
      populatedFields: [...populatedFields].sort(),
      contentLength: contentMarkdown.length,
      preview: recoveryPreview(contentMarkdown),
      contentMarkdown
    };
  }

  const legacyRows = connection
    .prepare(
      `
      SELECT *
      FROM progress_entries
      WHERE work_item_id = ?
        AND content IS NOT NULL
        AND TRIM(content) <> ''
      ORDER BY entry_date ASC, created_at ASC
      `
    )
    .all(workItemId) as ProgressEntry[];
  if (legacyRows.length > 0) {
    const contentMarkdown = buildLegacyEntriesRecoveryContent(legacyRows);
    const latest = legacyRows[legacyRows.length - 1];
    const populatedFields = new Set<string>();
    for (const row of legacyRows) {
      if (hasMarkdownContent(row.content)) {
        populatedFields.add("content");
      }
    }
    return {
      source: "progress_entries",
      recordCount: legacyRows.length,
      latestDate: latest.entry_date,
      populatedFields: [...populatedFields].sort(),
      contentLength: contentMarkdown.length,
      preview: recoveryPreview(contentMarkdown),
      contentMarkdown
    };
  }

  return null;
}

function getWorkItemHistoryRecoveryPreview(workItemId: string): WorkItemHistoryRecoveryPreview | null {
  const recovery = buildWorkItemHistoryRecovery(workItemId);
  return recovery ? toRecoveryPreview(recovery) : null;
}

export function getWorkItemHistoryRecovery(workItemId: string): WorkItemHistoryRecovery | null {
  return buildWorkItemHistoryRecovery(workItemId);
}

export function restoreWorkItemHistoryToNote(workItemId: string): RestoreWorkItemHistoryResult {
  const currentNote = getOrCreateWorkItemNote(workItemId);
  if (hasMarkdownContent(currentNote.content_markdown)) {
    return {
      restored: false,
      workItemNote: currentNote,
      recovery: null,
      skippedReason: "note_not_empty" as const
    };
  }

  const recovery = buildWorkItemHistoryRecovery(workItemId);
  if (!recovery) {
    return {
      restored: false,
      workItemNote: currentNote,
      recovery: null,
      skippedReason: "no_recoverable_content" as const
    };
  }

  const now = getTimestamp();
  database()
    .prepare(
      `
      UPDATE work_item_notes
      SET content_markdown = ?,
          updated_at = ?
      WHERE id = ?
      `
    )
    .run(recovery.contentMarkdown, now, currentNote.id);

  return {
    restored: true,
    workItemNote: getOrCreateWorkItemNote(workItemId),
    recovery
  };
}

export function getDailyJournal(journalDate: string): DailyJournalView {
  const connection = database();
  const journal = getOrCreateDailyJournal(journalDate);
  const previousWorkDate = getPreviousWorkDate(journalDate);

  const items = connection
    .prepare(
      `
      SELECT DISTINCT
        wi.*,
        p.id AS project_id_for_group,
        p.name AS project_name,
        p.description AS project_description,
        p.status AS project_status,
        p.created_at AS project_created_at,
        p.updated_at AS project_updated_at,
        p.archived_at AS project_archived_at,
        (
          SELECT latest.content
          FROM (
            SELECT dwe.today_progress AS content, dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.content AS content, pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          WHERE latest.content IS NOT NULL AND TRIM(latest.content) <> ''
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_content,
        (
          SELECT latest.next_step
          FROM (
            SELECT dwe.next_step AS next_step, dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.next_step AS next_step, pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          WHERE latest.next_step IS NOT NULL AND TRIM(latest.next_step) <> ''
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_next_step,
        (
          SELECT latest.blocker
          FROM (
            SELECT dwe.blocker AS blocker, dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.blocker AS blocker, pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          WHERE latest.blocker IS NOT NULL AND TRIM(latest.blocker) <> ''
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_blocker,
        (
          SELECT latest.updated_at
          FROM (
            SELECT dwe.updated_at AS updated_at
            FROM daily_work_item_entries dwe
            WHERE dwe.work_item_id = wi.id
            UNION ALL
            SELECT pe.created_at AS updated_at
            FROM progress_entries pe
            WHERE pe.work_item_id = wi.id
          ) latest
          ORDER BY latest.updated_at DESC
          LIMIT 1
        ) AS latest_created_at
      FROM work_items wi
      JOIN projects p ON p.id = wi.project_id
      LEFT JOIN daily_work_item_entries today_entry
        ON today_entry.work_item_id = wi.id AND today_entry.journal_date = ?
      WHERE p.status = 'active'
        AND wi.status <> 'archived'
        AND (wi.status = 'active' OR today_entry.id IS NOT NULL)
      ORDER BY p.updated_at DESC, wi.updated_at DESC
      `
    )
    .all(journalDate) as Array<
    WorkItemWithLatest & {
      project_id_for_group: string;
      project_name: string;
      project_description: string | null;
      project_status: Project["status"];
      project_created_at: string;
      project_updated_at: string;
      project_archived_at: string | null;
    }
  >;

  const groupMap = new Map<string, DailyJournalView["groups"][number]>();
  for (const item of items) {
    const project: Project = {
      id: item.project_id_for_group,
      name: item.project_name,
      description: item.project_description,
      status: item.project_status,
      created_at: item.project_created_at,
      updated_at: item.project_updated_at,
      archived_at: item.project_archived_at
    };
    const group =
      groupMap.get(project.id) ??
      ({
        project,
        projectMemo: getOrCreateProjectMemo(project.id),
        activeCount: 0,
        items: []
      } satisfies DailyJournalView["groups"][number]);
    const entry = getDailyEntry(journalDate, item.id);
    const previousEntry = getLatestDailyEntryBefore(journalDate, item.id);
    const workItemNote = getOrCreateWorkItemNote(item.id);
    const recoverableHistory = hasMarkdownContent(workItemNote.content_markdown)
      ? null
      : getWorkItemHistoryRecoveryPreview(item.id);
    group.items.push({
      project,
      workItem: item,
      entry,
      previousEntry,
      previousWorkDate: previousEntry?.journal_date ?? previousWorkDate,
      workItemNote,
      previousNoteSnapshot: getLatestWorkItemNoteSnapshotBefore(item.id, journalDate),
      recoverableHistory
    });
    group.activeCount = group.items.length;
    groupMap.set(project.id, group);
  }

  const projects = connection
    .prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC")
    .all() as Project[];

  const entriesToday = connection
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM daily_work_item_entries
      WHERE journal_date = ?
      `
    )
    .get(journalDate) as { count: number };
  const doneToday = connection
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM daily_work_item_entries
      WHERE journal_date = ? AND status_for_today = 'done_today'
      `
    )
    .get(journalDate) as { count: number };

  return {
    journalDate,
    previousWorkDate,
    journal,
    stats: {
      activeProjects: projects.length,
      workItems: items.length,
      filledEntries: Number(entriesToday.count),
      completedToday: Number(doneToday.count)
    },
    groups: [...groupMap.values()],
    projects
  };
}

export function getTodayJournal(): DailyJournalView {
  return getDailyJournal(getLocalDateKey());
}

export function upsertDailyWorkItemEntry(input: UpsertDailyWorkItemEntryInput): SaveDailyWorkItemResult {
  const workItem = getWorkItem(input.workItemId);
  if (workItem.project_id !== input.projectId) {
    throw new Error("Work item does not belong to the selected project.");
  }
  const project = getProject(input.projectId);
  if (project.status !== "active") {
    throw new Error("Archived projects cannot receive daily work entries.");
  }

  const todayProgress = cleanDailyText(input.todayProgress);
  const nextStep = cleanDailyText(input.nextStep);
  const blocker = cleanDailyText(input.blocker);
  const statusForToday = normalizeDailyStatus(input.statusForToday);
  const noteContentProvided = Object.prototype.hasOwnProperty.call(input, "workItemNoteContentMarkdown");
  const shouldWriteDailyEntry = Boolean(todayProgress || nextStep || blocker || statusForToday !== "in_progress");
  if (!shouldWriteDailyEntry && !noteContentProvided) {
    throw new Error("Fill at least one of today's progress, next step, blocker, or change today's status.");
  }

  const now = getTimestamp();
  const currentNote = getOrCreateWorkItemNote(input.workItemId);
  const noteContentMarkdown = input.workItemNoteContentMarkdown ?? currentNote.content_markdown ?? "";
  const existing = getDailyEntry(input.journalDate, input.workItemId);
  const entry: DailyWorkItemEntry | null = shouldWriteDailyEntry
    ? {
        id: existing?.id ?? randomUUID(),
        journal_date: input.journalDate,
        project_id: input.projectId,
        work_item_id: input.workItemId,
        today_progress: todayProgress,
        next_step: nextStep,
        blocker,
        status_for_today: statusForToday,
        created_at: existing?.created_at ?? now,
        updated_at: now
      }
    : null;

  const transaction = database().transaction(() => {
    if (noteContentProvided) {
      database()
        .prepare(
          `
          UPDATE work_item_notes
          SET content_markdown = ?,
              updated_at = ?
          WHERE id = ?
          `
        )
        .run(noteContentMarkdown, now, currentNote.id);
    }
    if (entry) {
      getOrCreateDailyJournal(input.journalDate);
      database()
        .prepare(
          `
          INSERT INTO daily_work_item_entries
            (id, journal_date, project_id, work_item_id, today_progress, next_step, blocker, status_for_today, created_at, updated_at)
          VALUES
            (@id, @journal_date, @project_id, @work_item_id, @today_progress, @next_step, @blocker, @status_for_today, @created_at, @updated_at)
          ON CONFLICT(journal_date, work_item_id) DO UPDATE SET
            project_id = excluded.project_id,
            today_progress = excluded.today_progress,
            next_step = excluded.next_step,
            blocker = excluded.blocker,
            status_for_today = excluded.status_for_today,
            updated_at = excluded.updated_at
          `
        )
        .run(entry);
      database()
        .prepare("UPDATE daily_journals SET updated_at = ? WHERE journal_date = ?")
        .run(now, input.journalDate);
    } else if (existing) {
      database()
        .prepare("DELETE FROM daily_work_item_entries WHERE journal_date = ? AND work_item_id = ?")
        .run(input.journalDate, input.workItemId);
      database()
        .prepare("UPDATE daily_journals SET updated_at = ? WHERE journal_date = ?")
        .run(now, input.journalDate);
    }
    database()
      .prepare("UPDATE work_items SET updated_at = ? WHERE id = ?")
      .run(now, input.workItemId);
    database()
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(now, input.projectId);
    if (statusForToday === "done_today") {
      database()
        .prepare(
          `
          UPDATE work_items
          SET status = 'done',
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?
          WHERE id = ?
          `
        )
        .run(now, now, input.workItemId);
    }
  });
  transaction();

  return {
    entry: getDailyEntry(input.journalDate, input.workItemId),
    workItemNote: getOrCreateWorkItemNote(input.workItemId)
  };
}

export function reopenDailyJournal(journalDate: string): DailyJournal {
  const now = getTimestamp();
  getOrCreateDailyJournal(journalDate);
  database()
    .prepare(
      `
      UPDATE daily_journals
      SET status = 'draft', closed_at = NULL, updated_at = ?
      WHERE journal_date = ?
      `
    )
    .run(now, journalDate);
  return getOrCreateDailyJournal(journalDate);
}

type DailyReportEntryRow = DailyWorkItemEntry & {
  project_name: string;
  work_item_title: string;
  work_item_status: WorkItem["status"];
};

function listDailyEntriesForReport(journalDate: string) {
  return database()
    .prepare(
      `
      SELECT
        dwe.*,
        p.name AS project_name,
        wi.title AS work_item_title,
        wi.status AS work_item_status
      FROM daily_work_item_entries dwe
      JOIN projects p ON p.id = dwe.project_id
      JOIN work_items wi ON wi.id = dwe.work_item_id
      WHERE dwe.journal_date = ?
      ORDER BY p.name COLLATE NOCASE ASC, wi.title COLLATE NOCASE ASC
      `
    )
    .all(journalDate) as DailyReportEntryRow[];
}

function appendDailyReportField(lines: string[], label: string, value: string | null | undefined): void {
  const cleaned = normalizeReportText(value);
  if (!cleaned) {
    return;
  }
  lines.push(`- ${label}：`);
  for (const line of cleaned.split("\n")) {
    lines.push(`  ${line}`);
  }
}

function dailyReportStatusLabel(status: DailyWorkItemStatus): string | null {
  if (status === "done_today") {
    return "今日完成";
  }
  if (status === "paused") {
    return "暂停";
  }
  return null;
}

function appendDailyReportSection(lines: string[], title: string, rows: DailyReportEntryRow[]): void {
  lines.push(`## ${title}`, "");
  if (rows.length === 0) {
    lines.push("暂无。", "");
    return;
  }
  let currentProjectName: string | null = null;
  for (const row of rows) {
    if (currentProjectName !== row.project_name) {
      currentProjectName = row.project_name;
      lines.push(`### ${row.project_name}`, "");
    }
    lines.push(`#### ${row.work_item_title}`);
    appendDailyReportField(lines, "今日变更摘要", row.today_progress);
    appendDailyReportField(lines, "下一步计划", row.next_step);
    appendDailyReportField(lines, "阻碍 / 需要帮助", row.blocker);
    const statusLabel = dailyReportStatusLabel(row.status_for_today);
    if (statusLabel) {
      lines.push(`- 今日状态：${statusLabel}`);
    }
    lines.push("");
  }
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(dateKey: string, offset: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + offset);
  return formatDateKey(date);
}

function getWeekPeriod(dateKey: string): { start: string; end: string } {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const start = addLocalDays(dateKey, offsetToMonday);
  return { start, end: addLocalDays(start, 6) };
}

function getMonthPeriod(dateKey: string): { start: string; end: string; year: number; month: number } {
  const date = parseDateKey(dateKey);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = formatDateKey(new Date(year, month - 1, 1));
  const end = formatDateKey(new Date(year, month, 0));
  return { start, end, year, month };
}

function formatGeneratedAt(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function monthDay(dateKey: string): string {
  return dateKey.slice(5);
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = value?.trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  }
  return result;
}

function normalizeReportText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isMeaninglessReportText(value: string | null | undefined): boolean {
  const cleaned = normalizeReportText(value)
    .replace(/[。.!！?？\s]/g, "")
    .toLowerCase();
  if (!cleaned) {
    return true;
  }
  return new Set([
    "暂无",
    "无",
    "没有",
    "无阻碍",
    "暂无阻碍",
    "暂未发现",
    "无风险",
    "暂无风险",
    "none",
    "no",
    "na",
    "n/a",
    "nothing"
  ]).has(cleaned);
}

function formatReportField(value: string | null | undefined): string {
  const cleaned = value?.trim();
  return cleaned || "暂无。";
}

function uniqueMeaningfulTexts(
  rows: PeriodEntryRow[],
  selector: (row: PeriodEntryRow) => string | null | undefined,
  limit = 0
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const row of [...rows].reverse()) {
    const raw = selector(row);
    if (isMeaninglessReportText(raw)) {
      continue;
    }
    const cleaned = normalizeReportText(raw);
    if (seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    result.push(raw?.trim() ?? cleaned);
    if (limit > 0 && result.length >= limit) {
      break;
    }
  }
  return result;
}

type PeriodEntryRow = DailyWorkItemEntry & {
  project_name: string;
  work_item_title: string;
};

interface PeriodWorkItemGroup {
  projectId: string;
  projectName: string;
  workItemId: string;
  workItemTitle: string;
  rows: PeriodEntryRow[];
}

function periodRows(periodStart: string, periodEnd: string): PeriodEntryRow[] {
  return database()
    .prepare(
      `
      SELECT
        dwe.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM daily_work_item_entries dwe
      JOIN daily_journals dj ON dj.journal_date = dwe.journal_date
      JOIN projects p ON p.id = dwe.project_id
      JOIN work_items wi ON wi.id = dwe.work_item_id
      WHERE dwe.journal_date BETWEEN ? AND ?
        AND dj.status = 'closed'
        AND dj.report_markdown IS NOT NULL
        AND TRIM(dj.report_markdown) <> ''
      ORDER BY p.name COLLATE NOCASE ASC, wi.title COLLATE NOCASE ASC, dwe.journal_date ASC
      `
    )
    .all(periodStart, periodEnd) as PeriodEntryRow[];
}

function closedJournalCount(periodStart: string, periodEnd: string): number {
  const row = database()
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM daily_journals
      WHERE journal_date BETWEEN ? AND ?
        AND status = 'closed'
        AND report_markdown IS NOT NULL
        AND TRIM(report_markdown) <> ''
      `
    )
    .get(periodStart, periodEnd) as { count: number };
  return row.count;
}

function groupPeriodRows(rows: PeriodEntryRow[]): Map<string, Map<string, PeriodWorkItemGroup>> {
  const projects = new Map<string, Map<string, PeriodWorkItemGroup>>();
  for (const row of rows) {
    let workItems = projects.get(row.project_id);
    if (!workItems) {
      workItems = new Map();
      projects.set(row.project_id, workItems);
    }
    let group = workItems.get(row.work_item_id);
    if (!group) {
      group = {
        projectId: row.project_id,
        projectName: row.project_name,
        workItemId: row.work_item_id,
        workItemTitle: row.work_item_title,
        rows: []
      };
      workItems.set(row.work_item_id, group);
    }
    group.rows.push(row);
  }
  return projects;
}

function periodStatus(rows: PeriodEntryRow[]): string {
  if (rows.some((row) => row.status_for_today === "done_today")) {
    return "已完成";
  }
  if (rows.length > 0 && rows.every((row) => row.status_for_today === "paused")) {
    return "暂停";
  }
  return "持续推进";
}

function appendPeriodProjectSummary(
  lines: string[],
  rows: PeriodEntryRow[],
  _periodLabel: "本周" | "本月",
  _planLabel: "下一步" | "下月计划"
): void {
  const projects = groupPeriodRows(rows);
  if (projects.size === 0) {
    lines.push("- 暂无。", "");
    return;
  }

  for (const workItems of projects.values()) {
    const projectName = [...workItems.values()][0]?.projectName;
    if (!projectName) {
      continue;
    }
    lines.push(`### ${projectName}`, "");
    for (const item of workItems.values()) {
      const dates = [...new Set(item.rows.map((row) => monthDay(row.journal_date)))];

      lines.push(`#### ${item.workItemTitle}`);
      lines.push(`涉及日期：${dates.length > 0 ? dates.join("、") : "暂无"}`, "");
      for (const row of item.rows) {
        lines.push(`##### ${monthDay(row.journal_date)}`);
        lines.push(`今日状态：${periodStatus([row])}`, "");
        lines.push("今日进展：");
        lines.push(formatReportField(row.today_progress), "");
        lines.push("下一步计划：");
        lines.push(formatReportField(row.next_step), "");
        lines.push("阻碍 / 需要帮助：");
        lines.push(formatReportField(row.blocker), "");
      }
      lines.push("");
    }
  }
}

function appendCompletionSection(lines: string[], rows: PeriodEntryRow[], title: string): void {
  lines.push(`## ${title}`, "");
  const completed = new Map<string, PeriodEntryRow[]>();
  for (const row of rows) {
    if (row.status_for_today === "done_today") {
      completed.set(row.work_item_id, [...(completed.get(row.work_item_id) ?? []), row]);
    }
  }
  if (completed.size === 0) {
    lines.push("- 暂无。", "");
    return;
  }
  for (const itemRows of completed.values()) {
    const first = itemRows[0];
    const dates = [...new Set(itemRows.map((row) => monthDay(row.journal_date)))].join("、");
    lines.push(`- ${first.project_name} / ${first.work_item_title}（${dates}）`);
  }
  lines.push("");
}

function appendBlockerSection(lines: string[], rows: PeriodEntryRow[], title: string): void {
  lines.push(`## ${title}`, "");
  const blockers = rows.filter((row) => !isMeaninglessReportText(row.blocker));
  if (blockers.length === 0) {
    lines.push("- 暂无。", "");
    return;
  }
  const seen = new Set<string>();
  for (const row of blockers) {
    const cleaned = normalizeReportText(row.blocker);
    const key = `${row.project_id}:${row.work_item_id}:${cleaned}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push(`### ${row.project_name} / ${row.work_item_title}（${monthDay(row.journal_date)}）`);
    lines.push(formatReportField(row.blocker), "");
  }
  lines.push("");
}

function appendPlanSection(lines: string[], rows: PeriodEntryRow[], title: string): void {
  lines.push(`## ${title}`, "");
  const byProject = new Map<string, string[]>();
  for (const row of [...rows].reverse()) {
    if (isMeaninglessReportText(row.next_step)) {
      continue;
    }
    const nextStep = row.next_step?.trim() ?? "";
    const steps = byProject.get(row.project_name) ?? [];
    if (!steps.includes(nextStep)) {
      steps.push(nextStep);
    }
    byProject.set(row.project_name, steps);
  }
  if (byProject.size === 0) {
    lines.push("- 暂无。", "");
    return;
  }
  for (const [projectName, steps] of byProject) {
    lines.push(`### ${projectName}`);
    for (const step of steps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }
}

function buildWeeklyReportMarkdown(periodStart: string, periodEnd: string, rows: PeriodEntryRow[]): string {
  const generatedAt = formatGeneratedAt();
  const recordDays = new Set(rows.map((row) => row.journal_date)).size;
  const projectCount = new Set(rows.map((row) => row.project_id)).size;
  const workItemCount = new Set(rows.map((row) => row.work_item_id)).size;
  const doneCount = new Set(rows.filter((row) => row.status_for_today === "done_today").map((row) => row.work_item_id)).size;
  const reportCount = closedJournalCount(periodStart, periodEnd);
  const lines = [
    `# 工作周报 - ${periodStart} 至 ${periodEnd}`,
    "",
    `生成时间：${generatedAt}`,
    "",
    "## 一、本周概览",
    "",
    `- 记录天数：${recordDays} 天`,
    `- 涉及项目：${projectCount} 个`,
    `- 推进工作项：${workItemCount} 个`,
    `- 完成工作项：${doneCount} 个`,
    `- 生成日报：${reportCount} 篇`,
    "",
    "## 二、按项目汇总",
    ""
  ];
  appendPeriodProjectSummary(lines, rows, "本周", "下一步");
  appendCompletionSection(lines, rows, "三、本周完成事项");
  appendBlockerSection(lines, rows, "四、本周阻碍与风险");
  appendPlanSection(lines, rows, "五、下周计划");
  return lines.join("\n").trimEnd() + "\n";
}

function buildMonthlyReportMarkdown(periodStart: string, periodEnd: string, rows: PeriodEntryRow[]): string {
  const { year, month } = getMonthPeriod(periodStart);
  const generatedAt = formatGeneratedAt();
  const recordDays = new Set(rows.map((row) => row.journal_date)).size;
  const projectCount = new Set(rows.map((row) => row.project_id)).size;
  const workItemCount = new Set(rows.map((row) => row.work_item_id)).size;
  const doneCount = new Set(rows.filter((row) => row.status_for_today === "done_today").map((row) => row.work_item_id)).size;
  const reportCount = closedJournalCount(periodStart, periodEnd);
  const lines = [
    `# 工作月报 - ${year}年${month}月`,
    "",
    `生成时间：${generatedAt}`,
    "",
    "## 一、本月概览",
    "",
    `- 记录天数：${recordDays} 天`,
    `- 涉及项目：${projectCount} 个`,
    `- 推进工作项：${workItemCount} 个`,
    `- 完成工作项：${doneCount} 个`,
    `- 生成日报：${reportCount} 篇`,
    "",
    "## 二、按项目与工作项汇总",
    ""
  ];
  appendPeriodProjectSummary(lines, rows, "本月", "下月计划");
  appendCompletionSection(lines, rows, "三、本月完成事项");
  appendBlockerSection(lines, rows, "四、本月阻碍与风险");
  appendPlanSection(lines, rows, "五、下月计划");
  return lines.join("\n").trimEnd() + "\n";
}

function upsertPeriodReport(
  reportType: PeriodReportType,
  periodStart: string,
  periodEnd: string,
  title: string,
  markdown: string
): void {
  const now = getTimestamp();
  database()
    .prepare(
      `
      INSERT INTO period_reports
        (id, report_type, period_start, period_end, title, report_markdown, generated_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_type, period_start, period_end) DO UPDATE SET
        title = excluded.title,
        report_markdown = excluded.report_markdown,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
      `
    )
    .run(randomUUID(), reportType, periodStart, periodEnd, title, markdown, now, now);
}

function updatePeriodReportsForDate(journalDate: string): void {
  const week = getWeekPeriod(journalDate);
  const weekRows = periodRows(week.start, week.end);
  upsertPeriodReport(
    "weekly",
    week.start,
    week.end,
    `工作周报 - ${week.start} 至 ${week.end}`,
    buildWeeklyReportMarkdown(week.start, week.end, weekRows)
  );

  const month = getMonthPeriod(journalDate);
  const monthRows = periodRows(month.start, month.end);
  upsertPeriodReport(
    "monthly",
    month.start,
    month.end,
    `工作月报 - ${month.year}年${month.month}月`,
    buildMonthlyReportMarkdown(month.start, month.end, monthRows)
  );
}

function snapshotWorkItemNotesForDate(journalDate: string, dailyEntryWorkItemIds: Set<string>): void {
  const notes = database()
    .prepare("SELECT * FROM work_item_notes")
    .all() as WorkItemNote[];

  for (const note of notes) {
    const currentContent = note.content_markdown ?? "";
    const previousSnapshot = getLatestWorkItemNoteSnapshotBefore(note.work_item_id, journalDate);
    const changedSincePreviousSnapshot = previousSnapshot
      ? (previousSnapshot.content_markdown ?? "") !== currentContent
      : Boolean(currentContent.trim());
    if (dailyEntryWorkItemIds.has(note.work_item_id) || changedSincePreviousSnapshot) {
      upsertWorkItemNoteSnapshot(note.work_item_id, journalDate, currentContent);
    }
  }
}

export function generateDailyReport(journalDate: string): MarkdownPayload {
  const connection = database();
  const todayRows = listDailyEntriesForReport(journalDate);
  const completed = todayRows.filter((row) => row.status_for_today === "done_today");
  const advanced = todayRows.filter(
    (row) =>
      row.status_for_today !== "done_today" &&
      (Boolean(row.today_progress?.trim()) ||
        Boolean(row.next_step?.trim()) ||
        Boolean(row.blocker?.trim()) ||
        row.status_for_today === "paused")
  );

  const lines = [`# 工作日报 - ${journalDate}`, "", `生成时间：${formatGeneratedAt()}`, ""];
  appendDailyReportSection(lines, "一、今日完成", completed);
  appendDailyReportSection(lines, "二、今日推进", advanced);

  const markdown = lines.join("\n").trimEnd() + "\n";
  const now = getTimestamp();
  getOrCreateDailyJournal(journalDate);
  connection
    .prepare(
      `
      UPDATE daily_journals
      SET status = 'closed',
          report_markdown = ?,
          closed_at = ?,
          updated_at = ?
      WHERE journal_date = ?
      `
    )
    .run(markdown, now, now, journalDate);
  snapshotWorkItemNotesForDate(journalDate, new Set(todayRows.map((row) => row.work_item_id)));

  try {
    updatePeriodReportsForDate(journalDate);
    return { date: journalDate, markdown };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Period reports update failed.";
    return { date: journalDate, markdown, reportSyncError: message };
  }
}

export function closeTodayJournal(): MarkdownPayload {
  return generateDailyReport(getLocalDateKey());
}

export function listDailyReports(): DailyReportListItem[] {
  return database()
    .prepare(
      `
      SELECT
        id,
        journal_date AS date,
        status,
        report_markdown AS markdown,
        closed_at,
        updated_at
      FROM daily_journals
      WHERE status = 'closed'
        AND report_markdown IS NOT NULL
        AND TRIM(report_markdown) <> ''
      ORDER BY journal_date DESC
      `
    )
    .all() as DailyReportListItem[];
}

export function hashMarkdownContent(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

export function getPeriodReportForAi(reportId: string, type: PeriodReportType): PeriodReportListItem | null {
  if (type !== "weekly" && type !== "monthly") {
    throw new Error("Invalid report type.");
  }
  const row = database()
    .prepare(
      `
      SELECT
        id,
        report_type,
        period_start,
        period_end,
        title,
        report_markdown AS markdown,
        generated_at,
        updated_at
      FROM period_reports
      WHERE id = ?
        AND report_type = ?
      `
    )
    .get(reportId, type) as
    | (Omit<
      PeriodReportListItem,
      "aiRefinedMarkdown" | "aiRefinedAt" | "aiProvider" | "aiModel" | "aiIsStale"
    >)
    | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,
    aiRefinedMarkdown: null,
    aiRefinedAt: null,
    aiProvider: null,
    aiModel: null,
    aiIsStale: false
  };
}

export function saveAiReportRefinement(input: {
  periodReport: PeriodReportListItem;
  refinedMarkdown: string;
  provider: string;
  model: string;
}): { generatedAt: string } {
  const now = getTimestamp();
  const sourceHash = hashMarkdownContent(input.periodReport.markdown);
  database()
    .prepare(
      `
      INSERT INTO ai_report_refinements
        (
          id,
          period_report_id,
          report_type,
          period_start,
          period_end,
          refinement_mode,
          refined_markdown,
          source_markdown_hash,
          provider,
          model,
          generated_at,
          updated_at
        )
      VALUES
        (?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_report_id, refinement_mode) DO UPDATE SET
        report_type = excluded.report_type,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        refined_markdown = excluded.refined_markdown,
        source_markdown_hash = excluded.source_markdown_hash,
        provider = excluded.provider,
        model = excluded.model,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      input.periodReport.id,
      input.periodReport.report_type,
      input.periodReport.period_start,
      input.periodReport.period_end,
      input.refinedMarkdown,
      sourceHash,
      input.provider,
      input.model,
      now,
      now
    );
  return { generatedAt: now };
}

export function listPeriodReports(type: PeriodReportType): PeriodReportListItem[] {
  if (type !== "weekly" && type !== "monthly") {
    throw new Error("Invalid report type.");
  }
  const rows = database()
    .prepare(
      `
      SELECT
        pr.id,
        pr.report_type,
        pr.period_start,
        pr.period_end,
        pr.title,
        pr.report_markdown AS markdown,
        pr.generated_at,
        pr.updated_at,
        ar.refined_markdown AS aiRefinedMarkdown,
        ar.generated_at AS aiRefinedAt,
        ar.provider AS aiProvider,
        ar.model AS aiModel,
        ar.source_markdown_hash AS aiSourceMarkdownHash
      FROM period_reports pr
      LEFT JOIN ai_report_refinements ar
        ON ar.period_report_id = pr.id
       AND ar.refinement_mode = 'standard'
      WHERE pr.report_type = ?
      ORDER BY pr.period_start DESC
      `
    )
    .all(type) as Array<
    Omit<PeriodReportListItem, "aiIsStale"> & {
      aiSourceMarkdownHash: string | null;
    }
  >;

  return rows.map((row) => ({
    id: row.id,
    report_type: row.report_type,
    period_start: row.period_start,
    period_end: row.period_end,
    title: row.title,
    markdown: row.markdown,
    generated_at: row.generated_at,
    updated_at: row.updated_at,
    aiRefinedMarkdown: row.aiRefinedMarkdown,
    aiRefinedAt: row.aiRefinedAt,
    aiProvider: row.aiProvider,
    aiModel: row.aiModel,
    aiIsStale: Boolean(row.aiSourceMarkdownHash && row.aiSourceMarkdownHash !== hashMarkdownContent(row.markdown))
  }));
}

const testProjectPrefix = "[测试]";

interface TestDataResult {
  projectCount: number;
  workItemCount: number;
  dailyEntryCount: number;
  dailyReportCount: number;
  weeklyReportCount: number;
  monthlyReportCount: number;
}

const testProjectSpecs = [
  {
    name: "[测试] 流梭",
    description: "用于验证每日工作页、日报、周报、月报、Reports 和 AI 提炼入口的开发测试项目。",
    items: [
      "每日工作页模型调整",
      "今日记录编辑页优化",
      "报告与热力图功能验证",
      "AI 报告提炼接入"
    ]
  },
  {
    name: "[测试] 个人网站",
    description: "用于验证内容型项目的多段记录、排版和导出。",
    items: ["首页视觉层级优化", "文章页排版调整"]
  },
  {
    name: "[测试] 数据治理报表系统",
    description: "用于验证业务系统类工作项、阻碍、权限流程和质量报表。",
    items: ["质量数据日报表复核", "权限申请流程优化", "周报月报导出验证"]
  },
  {
    name: "[测试] 公众号内容运营",
    description: "用于验证长文本素材整理、复盘类内容和搜索。",
    items: ["AI 工作流文章整理", "产品复盘素材归档"]
  }
];

function longTestProgress(topic: string): string {
  const paragraphs = [
    `# ${topic}`,
    "",
    "今天主要围绕真实工作流做了一次完整复盘。先把用户从 Today 总览进入单个记录页的路径重新跑了一遍，再检查保存、返回、日报生成、Reports 查看和导出几个动作之间的数据是否一致。",
    "",
    "## 关键观察",
    "",
    "1. 用户在记录具体工作时，经常不是写一句话，而是会把会议结论、判断依据、待确认问题和临时备注放在同一个文本框里。",
    "2. 报告作为正式归档文档，应该完整保留这些信息，不能像列表卡片那样只展示前几行。",
    "3. AI 提炼可以作为压缩总结，但它不能反向影响规则版报告，也不能替代本地结构化数据。",
    "",
    "## 今天推进",
    "",
    "- 检查了 daily_work_item_entries 中 today_progress、next_step、blocker 三个字段在长文本情况下的保存和展示。",
    "- 对照 Reports 页面确认规则版报告、复制 Markdown、导出 .md 使用的是同一份完整 markdown。",
    "- 用多段、编号、Markdown 标题和项目符号模拟真实工作记录，观察换行和空行是否保留。",
    "- 记录了需要继续验证的边界：同一工作项跨多个日期、一个日期多个工作项、阻碍内容去重、今日完成状态进入完成事项汇总。",
    "",
    "## 复盘",
    "",
    "这条记录故意写得比较长，用来验证日报、周报和月报是否会完整输出。正式报告不是前端摘要，也不是列表预览，所以这里的段落、编号、项目符号和换行都应该原样保留下来。后续如果用户觉得报告太长，应该通过 AI 提炼版另行生成摘要，而不是牺牲规则版归档的完整性。"
  ];
  return [...paragraphs, "", ...paragraphs.slice(2, 12)].join("\n");
}

function testProgressText(workItemTitle: string, dateKey: string, variant: number): string {
  if (variant % 7 === 0) {
    return longTestProgress(`${workItemTitle} - ${dateKey}`);
  }
  const templates = [
    `梳理了 ${workItemTitle} 的关键路径，确认数据从记录、保存到报告展示的闭环可以跑通。补充了一个边界场景：用户先保存下一步计划，再回头补充今日进展。`,
    `和当前实现逐项对齐，重点检查 ${workItemTitle} 在浅色 / 深色主题下的可读性，以及长文本保存后是否还能被搜索命中。`,
    `完成 ${workItemTitle} 的一次回归验证。今天主要看列表摘要、详情页完整内容和导出 Markdown 三处内容是否一致。`,
    `把 ${workItemTitle} 的测试用例拆成轻量记录和深度记录两类，方便同时观察热力图活跃度和 Reports 页面摘要效果。`,
    `根据昨天留下的 next_step 继续推进 ${workItemTitle}，记录了可复现问题和下一步验证口径。`
  ];
  return templates[variant % templates.length];
}

function testNextStep(workItemTitle: string, variant: number): string {
  const templates = [
    `继续验证 ${workItemTitle} 在周报和月报中的完整输出，并检查复制 / 导出的 Markdown。`,
    `补充 ${workItemTitle} 的边界数据，尤其是长文本、空 blocker 和重复 next_step。`,
    `回到真实使用路径中复核 ${workItemTitle}，确认 Today、Reports、Heatmap 三处联动一致。`,
    `邀请自己用一整天的记录量压测 ${workItemTitle}，观察是否出现滚动、换行或报告过长问题。`
  ];
  return templates[variant % templates.length];
}

function testBlocker(variant: number): string | null {
  const blockers = [
    "接口返回字段含义不一致，需要和开发确认口径。",
    "本地数据库迁移后需要复核旧目录是否仍被引用。",
    "周报和月报的规则版内容偏长，需要区分完整版和 AI 提炼版。",
    null,
    "暂无",
    null
  ];
  return blockers[variant % blockers.length];
}

function clearTestDataInternal(): TestDataResult {
  const connection = database();
  const projectIds = (
    connection
      .prepare("SELECT id FROM projects WHERE name LIKE ?")
      .all(`${testProjectPrefix}%`) as Array<{ id: string }>
  ).map((row) => row.id);
  if (projectIds.length === 0) {
    return {
      projectCount: 0,
      workItemCount: 0,
      dailyEntryCount: 0,
      dailyReportCount: 0,
      weeklyReportCount: 0,
      monthlyReportCount: 0
    };
  }

  const placeholders = projectIds.map(() => "?").join(",");
  const workItemCount = (connection
    .prepare(`SELECT COUNT(*) AS count FROM work_items WHERE project_id IN (${placeholders})`)
    .get(...projectIds) as { count: number }).count;
  const dailyEntryCount = (connection
    .prepare(`SELECT COUNT(*) AS count FROM daily_work_item_entries WHERE project_id IN (${placeholders})`)
    .get(...projectIds) as { count: number }).count;
  const affectedDates = (
    connection
      .prepare(`SELECT DISTINCT journal_date FROM daily_work_item_entries WHERE project_id IN (${placeholders})`)
      .all(...projectIds) as Array<{ journal_date: string }>
  ).map((row) => row.journal_date);
  const affectedPeriods = new Map<string, { type: PeriodReportType; start: string; end: string }>();
  for (const date of affectedDates) {
    const week = getWeekPeriod(date);
    affectedPeriods.set(`weekly:${week.start}:${week.end}`, { type: "weekly", start: week.start, end: week.end });
    const month = getMonthPeriod(date);
    affectedPeriods.set(`monthly:${month.start}:${month.end}`, { type: "monthly", start: month.start, end: month.end });
  }
  const periodReportIds: string[] = [];
  for (const period of affectedPeriods.values()) {
    const row = connection
      .prepare(
        `
        SELECT id
        FROM period_reports
        WHERE report_type = ?
          AND period_start = ?
          AND period_end = ?
        `
      )
      .get(period.type, period.start, period.end) as { id: string } | undefined;
    if (row) {
      periodReportIds.push(row.id);
    }
  }

  const transaction = connection.transaction(() => {
    if (periodReportIds.length > 0) {
      const periodPlaceholders = periodReportIds.map(() => "?").join(",");
      connection.prepare(`DELETE FROM ai_report_refinements WHERE period_report_id IN (${periodPlaceholders})`).run(...periodReportIds);
      connection.prepare(`DELETE FROM period_reports WHERE id IN (${periodPlaceholders})`).run(...periodReportIds);
    }
    connection.prepare(`DELETE FROM daily_work_item_entries WHERE project_id IN (${placeholders})`).run(...projectIds);
    connection.prepare(`DELETE FROM progress_entries WHERE project_id IN (${placeholders})`).run(...projectIds);
    connection.prepare(`DELETE FROM work_items WHERE project_id IN (${placeholders})`).run(...projectIds);
    connection.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...projectIds);
  });
  transaction();

  for (const date of affectedDates) {
    const remaining = connection
      .prepare("SELECT COUNT(*) AS count FROM daily_work_item_entries WHERE journal_date = ?")
      .get(date) as { count: number };
    if (remaining.count > 0) {
      generateDailyReport(date);
    } else {
      connection.prepare("DELETE FROM daily_journals WHERE journal_date = ?").run(date);
    }
  }

  for (const period of affectedPeriods.values()) {
    const remainingJournal = connection
      .prepare(
        `
        SELECT journal_date
        FROM daily_journals
        WHERE journal_date BETWEEN ? AND ?
          AND status = 'closed'
          AND report_markdown IS NOT NULL
          AND TRIM(report_markdown) <> ''
        ORDER BY journal_date DESC
        LIMIT 1
        `
      )
      .get(period.start, period.end) as { journal_date: string } | undefined;
    if (remainingJournal) {
      updatePeriodReportsForDate(remainingJournal.journal_date);
    }
  }

  return {
    projectCount: projectIds.length,
    workItemCount: Number(workItemCount),
    dailyEntryCount: Number(dailyEntryCount),
    dailyReportCount: affectedDates.length,
    weeklyReportCount: [...affectedPeriods.values()].filter((period) => period.type === "weekly").length,
    monthlyReportCount: [...affectedPeriods.values()].filter((period) => period.type === "monthly").length
  };
}

function clearTestData(): TestDataResult {
  return clearTestDataInternal();
}

function generateTestData(): TestDataResult {
  clearTestDataInternal();
  const connection = database();
  const now = getTimestamp();
  const today = getLocalDateKey();
  const dates = Array.from({ length: 21 }, (_value, index) => addLocalDays(today, index - 20)).filter((dateKey) => {
    const day = parseDateKey(dateKey).getDay();
    return day >= 1 && day <= 5 || dateKey === today;
  });

  const projectIds = new Map<string, string>();
  const workItemIds = new Map<string, string>();
  const transaction = connection.transaction(() => {
    for (const project of testProjectSpecs) {
      const projectId = randomUUID();
      projectIds.set(project.name, projectId);
      connection
        .prepare(
          `
          INSERT INTO projects
            (id, name, description, status, created_at, updated_at, archived_at)
          VALUES
            (?, ?, ?, 'active', ?, ?, NULL)
          `
        )
        .run(projectId, project.name, project.description, now, now);

      for (const title of project.items) {
        const workItemId = randomUUID();
        workItemIds.set(`${project.name}/${title}`, workItemId);
        connection
          .prepare(
            `
            INSERT INTO work_items
              (id, project_id, title, description, status, created_at, updated_at, completed_at, archived_at)
            VALUES
              (?, ?, ?, ?, 'active', ?, ?, NULL, NULL)
            `
          )
          .run(workItemId, projectId, title, `开发测试工作项：${title}`, now, now);
      }
    }

    const allItems = [...workItemIds.entries()].map(([key, id]) => {
      const [projectName, title] = key.split("/");
      return { projectName, title, id, projectId: projectIds.get(projectName)! };
    });
    const completedIds = new Set<string>();

    for (const [dayIndex, dateKey] of dates.entries()) {
      const count = dayIndex % 5 === 0 ? 5 : dayIndex % 4 === 0 ? 1 : 3;
      const selected = Array.from({ length: count }, (_value, offset) => allItems[(dayIndex * 2 + offset * 3) % allItems.length]);
      for (const [entryIndex, item] of selected.entries()) {
        const variant = dayIndex + entryIndex;
        const status: DailyWorkItemEntry["status_for_today"] =
          variant % 11 === 0 ? "done_today" : variant % 9 === 0 ? "paused" : "in_progress";
        if (status === "done_today") {
          completedIds.add(item.id);
        }
        connection
          .prepare(
            `
            INSERT INTO daily_work_item_entries
              (id, journal_date, project_id, work_item_id, today_progress, next_step, blocker, status_for_today, created_at, updated_at)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(journal_date, work_item_id) DO UPDATE SET
              today_progress = excluded.today_progress,
              next_step = excluded.next_step,
              blocker = excluded.blocker,
              status_for_today = excluded.status_for_today,
              updated_at = excluded.updated_at
            `
          )
          .run(
            randomUUID(),
            dateKey,
            item.projectId,
            item.id,
            testProgressText(item.title, dateKey, variant),
            testNextStep(item.title, variant),
            testBlocker(variant),
            status,
            `${dateKey}T09:${String((variant * 7) % 60).padStart(2, "0")}:00.000Z`,
            `${dateKey}T18:${String((variant * 11) % 60).padStart(2, "0")}:00.000Z`
          );
      }
    }

    for (const id of completedIds) {
      connection
        .prepare("UPDATE work_items SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id);
    }
  });
  transaction();

  for (const date of dates) {
    generateDailyReport(date);
  }

  const projectCount = (connection.prepare("SELECT COUNT(*) AS count FROM projects WHERE name LIKE ?").get(`${testProjectPrefix}%`) as { count: number }).count;
  const workItemCount = (connection
    .prepare("SELECT COUNT(*) AS count FROM work_items wi JOIN projects p ON p.id = wi.project_id WHERE p.name LIKE ?")
    .get(`${testProjectPrefix}%`) as { count: number }).count;
  const dailyEntryCount = (connection
    .prepare("SELECT COUNT(*) AS count FROM daily_work_item_entries dwe JOIN projects p ON p.id = dwe.project_id WHERE p.name LIKE ?")
    .get(`${testProjectPrefix}%`) as { count: number }).count;
  const dailyReportCount = (connection
    .prepare("SELECT COUNT(*) AS count FROM daily_journals WHERE report_markdown LIKE ?")
    .get(`%${testProjectPrefix}%`) as { count: number }).count;
  const weeklyReportCount = (connection
    .prepare("SELECT COUNT(*) AS count FROM period_reports WHERE report_type = 'weekly' AND report_markdown LIKE ?")
    .get(`%${testProjectPrefix}%`) as { count: number }).count;
  const monthlyReportCount = (connection
    .prepare("SELECT COUNT(*) AS count FROM period_reports WHERE report_type = 'monthly' AND report_markdown LIKE ?")
    .get(`%${testProjectPrefix}%`) as { count: number }).count;

  return {
    projectCount: Number(projectCount),
    workItemCount: Number(workItemCount),
    dailyEntryCount: Number(dailyEntryCount),
    dailyReportCount: Number(dailyReportCount),
    weeklyReportCount: Number(weeklyReportCount),
    monthlyReportCount: Number(monthlyReportCount)
  };
}

function characterCount(...values: Array<string | null | undefined>): number {
  return countTextMetricCharacters(...values);
}

function textDepthScore(length: number): number {
  if (length <= 0) {
    return 0;
  }
  if (length <= 100) {
    return 2;
  }
  if (length <= 300) {
    return 4;
  }
  if (length <= 800) {
    return 6;
  }
  if (length <= 1500) {
    return 8;
  }
  return 10;
}

function heatLevel(score: number): HeatmapDay["level"] {
  if (score <= 0) {
    return 0;
  }
  if (score <= 3) {
    return 1;
  }
  if (score <= 7) {
    return 2;
  }
  if (score <= 12) {
    return 3;
  }
  return 4;
}

function monthDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getMonthlyHeatmap(year: number, month: number): HeatmapMonth {
  const safeYear = Math.trunc(year);
  const safeMonth = Math.trunc(month);
  if (!Number.isFinite(safeYear) || !Number.isFinite(safeMonth) || safeMonth < 1 || safeMonth > 12) {
    throw new Error("Invalid heatmap month");
  }

  const dayCount = new Date(safeYear, safeMonth, 0).getDate();
  const startDate = monthDateKey(safeYear, safeMonth, 1);
  const endDate = monthDateKey(safeYear, safeMonth, dayCount);
  const days = new Map<string, HeatmapDay>();

  for (let day = 1; day <= dayCount; day += 1) {
    const date = monthDateKey(safeYear, safeMonth, day);
    days.set(date, {
      date,
      day,
      activityScore: 0,
      level: 0,
      totalTextLength: 0,
      entryCount: 0,
      textEntryCount: 0,
      projectCount: 0,
      doneCount: 0,
      pausedCount: 0,
      hasClosedJournal: false,
      hasReport: false,
      reportMarkdown: null,
      closedAt: null,
      legacyEntryCount: 0
    });
  }

  const journalRows = database()
    .prepare(
      `
      SELECT journal_date, status, report_markdown, closed_at
      FROM daily_journals
      WHERE journal_date BETWEEN ? AND ?
      `
    )
    .all(startDate, endDate) as Array<{
    journal_date: string;
    status: DailyJournal["status"];
    report_markdown: string | null;
    closed_at: string | null;
  }>;

  for (const row of journalRows) {
    const day = days.get(row.journal_date);
    if (!day) {
      continue;
    }
    day.hasClosedJournal = row.status === "closed";
    day.hasReport = row.status === "closed" && Boolean(row.report_markdown?.trim());
    day.reportMarkdown = day.hasReport ? row.report_markdown : null;
    day.closedAt = row.closed_at;
  }

  const dailyRows = database()
    .prepare(
      `
      SELECT
        dwe.journal_date,
        dwe.project_id,
        dwe.work_item_id,
        dwe.today_progress,
        dwe.next_step,
        dwe.blocker,
        dwe.status_for_today,
        COALESCE(
          wins.content_markdown,
          CASE
            WHEN COALESCE(dj.status, 'draft') <> 'closed' THEN win.content_markdown
            ELSE NULL
          END
        ) AS work_item_note_content
      FROM daily_work_item_entries dwe
      LEFT JOIN daily_journals dj ON dj.journal_date = dwe.journal_date
      LEFT JOIN work_item_note_snapshots wins
        ON wins.work_item_id = dwe.work_item_id
        AND wins.snapshot_date = dwe.journal_date
      LEFT JOIN work_item_notes win ON win.work_item_id = dwe.work_item_id
      WHERE dwe.journal_date BETWEEN ? AND ?
      `
    )
    .all(startDate, endDate) as Array<{
    journal_date: string;
    project_id: string;
    work_item_id: string;
    today_progress: string | null;
    next_step: string | null;
    blocker: string | null;
    status_for_today: DailyWorkItemStatus;
    work_item_note_content: string | null;
  }>;

  const rowsByDate = new Map<string, typeof dailyRows>();
  for (const row of dailyRows) {
    const rows = rowsByDate.get(row.journal_date) ?? [];
    rows.push(row);
    rowsByDate.set(row.journal_date, rows);
  }

  const legacyRows = database()
    .prepare(
      `
      SELECT entry_date, COUNT(*) AS legacyEntryCount
      FROM progress_entries
      WHERE entry_date BETWEEN ? AND ?
      GROUP BY entry_date
      `
    )
    .all(startDate, endDate) as Array<{ entry_date: string; legacyEntryCount: number }>;

  for (const row of legacyRows) {
    const day = days.get(row.entry_date);
    if (day) {
      day.legacyEntryCount = row.legacyEntryCount;
    }
  }

  for (const [date, day] of days) {
    const entries = rowsByDate.get(date) ?? [];
    const projectIds = new Set<string>();
    let mainEntryScore = 0;
    let mainEntryHasText = false;
    let textEntryCount = 0;

    day.entryCount = entries.length;
    for (const entry of entries) {
      projectIds.add(entry.project_id);
      const dailyFields = [entry.today_progress, entry.next_step, entry.blocker];
      const metricFields = [...dailyFields, entry.work_item_note_content];
      const filledFieldCount = dailyFields.filter((value) => Boolean(value?.trim())).length;
      const entryTextLength = characterCount(...metricFields);
      const hasText = entryTextLength > 0;
      const entryScore = textDepthScore(entryTextLength) + (filledFieldCount > 0 ? filledFieldCount : 0);

      day.totalTextLength += entryTextLength;
      if (hasText) {
        textEntryCount += 1;
      }
      if (entry.status_for_today === "done_today") {
        day.doneCount += 1;
      }
      if (entry.status_for_today === "paused") {
        day.pausedCount += 1;
      }
      if (entryScore > mainEntryScore) {
        mainEntryScore = entryScore;
        mainEntryHasText = hasText;
      }
    }

    day.textEntryCount = textEntryCount;
    day.projectCount = projectIds.size;

    const otherTextEntryCount = textEntryCount > 0 ? textEntryCount - (mainEntryHasText ? 1 : 0) : 0;
    const extraItemScore = Math.min(otherTextEntryCount * 2, 6);
    const reportScore = day.hasReport ? 2 : 0;
    const stateTraceScore =
      textEntryCount === 0 && entries.some((entry) => entry.status_for_today === "done_today" || entry.status_for_today === "paused")
        ? 1
        : 0;

    let activityScore = mainEntryScore + extraItemScore + reportScore + stateTraceScore;
    if (entries.length === 0 && day.legacyEntryCount > 0) {
      activityScore = Math.max(activityScore, 1);
    }

    day.activityScore = activityScore;
    day.level = heatLevel(activityScore);
  }

  const dayList = [...days.values()];
  const summary = {
    activeDays: dayList.filter((day) => day.activityScore > 0).length,
    closedJournalDays: dayList.filter((day) => day.hasReport).length,
    doneCount: dayList.reduce((total, day) => total + day.doneCount, 0),
    totalTextLength: dayList.reduce((total, day) => total + day.totalTextLength, 0),
    highActivityDays: dayList.filter((day) => day.level === 4).length,
    longestStreak: 0
  };

  let currentStreak = 0;
  for (const day of dayList) {
    if (day.activityScore > 0) {
      currentStreak += 1;
      summary.longestStreak = Math.max(summary.longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return {
    year: safeYear,
    month: safeMonth,
    days: dayList,
    summary
  };
}

export function getProjectDetail(id: string): ProjectDetail {
  const project = getProject(id);
  const withWorkItemNotes = (items: WorkItemWithLatest[]): ProjectWorkItem[] =>
    items.map((item) => ({
      ...item,
      workItemNote: getOrCreateWorkItemNote(item.id),
      previousNoteSnapshot: getLatestWorkItemNoteSnapshotBefore(item.id, getLocalDateKey())
    }));
  const dailyTimeline = database()
    .prepare(
      `
      SELECT
        dwe.id,
        'daily' AS source,
        dwe.project_id,
        dwe.work_item_id,
        dwe.journal_date AS entry_date,
        COALESCE(dwe.today_progress, '') AS content,
        dwe.today_progress,
        dwe.next_step,
        dwe.blocker,
        dwe.status_for_today,
        dwe.created_at,
        dwe.updated_at,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM daily_work_item_entries dwe
      JOIN projects p ON p.id = dwe.project_id
      JOIN work_items wi ON wi.id = dwe.work_item_id
      WHERE dwe.project_id = ?
      ORDER BY dwe.journal_date DESC, dwe.updated_at DESC
      `
    )
    .all(id) as TimelineEntry[];
  const legacyTimeline = database()
    .prepare(
      `
      SELECT
        pe.id,
        'legacy' AS source,
        pe.project_id,
        pe.work_item_id,
        pe.entry_date,
        pe.content,
        pe.content AS today_progress,
        pe.next_step,
        pe.blocker,
        NULL AS status_for_today,
        pe.created_at,
        pe.updated_at,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM progress_entries pe
      JOIN projects p ON p.id = pe.project_id
      LEFT JOIN work_items wi ON wi.id = pe.work_item_id
      WHERE pe.project_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM daily_work_item_entries dwe
          WHERE dwe.journal_date = pe.entry_date
            AND dwe.work_item_id = pe.work_item_id
        )
      ORDER BY pe.created_at DESC
      `
    )
    .all(id) as TimelineEntry[];
  const timeline = [...dailyTimeline, ...legacyTimeline].sort((a, b) => {
    const byDate = b.entry_date.localeCompare(a.entry_date);
    if (byDate !== 0) {
      return byDate;
    }
    if (a.source !== b.source) {
      return a.source === "daily" ? -1 : 1;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });

  return {
    project,
    activeItems: withWorkItemNotes(getItemsWithLatest(id, "active")),
    completedItems: withWorkItemNotes(getItemsWithLatest(id, "done")),
    timeline
  };
}

function firstMatchingField(
  term: string,
  fields: Array<[field: string, value: string | null | undefined]>
): { field: string; value: string } {
  const normalizedTerm = term.toLocaleLowerCase();
  for (const [field, value] of fields) {
    if (value && value.toLocaleLowerCase().includes(normalizedTerm)) {
      return { field, value };
    }
  }
  return { field: fields[0][0], value: fields[0][1] ?? "" };
}

function snippet(value: string, term: string): string {
  const normalizedValue = value.toLocaleLowerCase();
  const index = normalizedValue.indexOf(term.toLocaleLowerCase());
  if (index < 0) {
    return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
  const start = Math.max(0, index - 36);
  const end = Math.min(value.length, index + term.length + 84);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";
  return `${prefix}${value.slice(start, end)}${suffix}`;
}

function searchLegacy(term: string): SearchResult[] {
  const cleaned = term.trim();
  if (!cleaned) {
    return [];
  }
  const like = `%${cleaned}%`;
  const connection = database();

  const projectResults = (
    connection
      .prepare(
        `
        SELECT p.*
        FROM projects p
        WHERE p.name LIKE ?
        ORDER BY p.updated_at DESC
        LIMIT 10
        `
      )
      .all(like) as Project[]
  ).map<SearchResult>((project) => ({
    id: `project:${project.id}`,
    type: "project",
    title: project.name,
    projectId: project.id,
    projectName: project.name,
    workItemId: null,
    workItemTitle: null,
    snippet: project.description || "项目名称命中",
    matchedField: "项目名称",
    createdAt: project.updated_at
  }));

  const itemResults = (
    connection
      .prepare(
        `
        SELECT wi.*, p.name AS project_name
        FROM work_items wi
        JOIN projects p ON p.id = wi.project_id
        WHERE wi.title LIKE ?
        ORDER BY wi.updated_at DESC
        LIMIT 10
        `
      )
      .all(like) as Array<WorkItem & { project_name: string }>
  ).map<SearchResult>((item) => ({
    id: `work_item:${item.id}`,
    type: "work_item",
    title: item.title,
    projectId: item.project_id,
    projectName: item.project_name,
    workItemId: item.id,
    workItemTitle: item.title,
    snippet: item.description || "工作事项标题命中",
    matchedField: "工作事项标题",
    createdAt: item.updated_at
  }));

  const progressResults = (
    connection
      .prepare(
        `
        SELECT
          pe.*,
          p.name AS project_name,
          wi.title AS work_item_title
        FROM progress_entries pe
        JOIN projects p ON p.id = pe.project_id
        LEFT JOIN work_items wi ON wi.id = pe.work_item_id
        WHERE pe.content LIKE ?
          OR pe.next_step LIKE ?
          OR pe.blocker LIKE ?
        ORDER BY pe.created_at DESC
        LIMIT 20
        `
      )
      .all(like, like, like) as Array<
      ProgressEntry & { project_name: string; work_item_title: string | null }
    >
  ).map<SearchResult>((entry) => {
    const match = firstMatchingField(cleaned, [
      ["进展内容", entry.content],
      ["下一步计划", entry.next_step],
      ["阻碍", entry.blocker]
    ]);
    return {
      id: `progress:${entry.id}`,
      type: "progress",
      title: entry.work_item_title || "未关联工作项",
      projectId: entry.project_id,
      projectName: entry.project_name,
      workItemId: entry.work_item_id,
      workItemTitle: entry.work_item_title,
      snippet: snippet(match.value, cleaned),
      matchedField: match.field,
      createdAt: entry.created_at
    };
  });

  return [...progressResults, ...itemResults, ...projectResults].slice(0, 30);
}

export function search(term: string): SearchResult[] {
  const cleaned = term.trim();
  if (!cleaned) {
    return [];
  }
  const like = `%${cleaned}%`;
  const connection = database();

  const projectResults = (
    connection
      .prepare(
        `
        SELECT p.*
        FROM projects p
        WHERE p.name LIKE ?
        ORDER BY p.updated_at DESC
        LIMIT 10
        `
      )
      .all(like) as Project[]
  ).map<SearchResult>((project) => ({
    id: `project:${project.id}`,
    type: "project",
    title: project.name,
    projectId: project.id,
    projectName: project.name,
    workItemId: null,
    workItemTitle: null,
    snippet: project.description || project.name,
    matchedField: "projectName",
    createdAt: project.updated_at
  }));

  const itemResults = (
    connection
      .prepare(
        `
        SELECT wi.*, p.name AS project_name
        FROM work_items wi
        JOIN projects p ON p.id = wi.project_id
        WHERE wi.title LIKE ? OR wi.description LIKE ?
        ORDER BY wi.updated_at DESC
        LIMIT 10
        `
      )
      .all(like, like) as Array<WorkItem & { project_name: string }>
  ).map<SearchResult>((item) => {
    const match = firstMatchingField(cleaned, [
      ["workItemTitle", item.title],
      ["workItemDescription", item.description]
    ]);
    return {
      id: `work_item:${item.id}`,
      type: "work_item",
      title: item.title,
      projectId: item.project_id,
      projectName: item.project_name,
      workItemId: item.id,
      workItemTitle: item.title,
      snippet: snippet(match.value, cleaned),
      matchedField: match.field,
      createdAt: item.updated_at
    };
  });

  const dailyEntryResults = (
    connection
      .prepare(
        `
        SELECT
          dwe.*,
          p.name AS project_name,
          wi.title AS work_item_title
        FROM daily_work_item_entries dwe
        JOIN projects p ON p.id = dwe.project_id
        JOIN work_items wi ON wi.id = dwe.work_item_id
        WHERE dwe.today_progress LIKE ?
          OR dwe.next_step LIKE ?
          OR dwe.blocker LIKE ?
        ORDER BY dwe.updated_at DESC
        LIMIT 20
        `
      )
      .all(like, like, like) as Array<
      DailyWorkItemEntry & { project_name: string; work_item_title: string }
    >
  ).map<SearchResult>((entry) => {
    const match = firstMatchingField(cleaned, [
      ["todayProgress", entry.today_progress],
      ["nextStep", entry.next_step],
      ["blocker", entry.blocker]
    ]);
    return {
      id: `daily_entry:${entry.id}`,
      type: "daily_entry",
      title: `${entry.journal_date} / ${entry.work_item_title}`,
      projectId: entry.project_id,
      projectName: entry.project_name,
      workItemId: entry.work_item_id,
      workItemTitle: entry.work_item_title,
      snippet: snippet(match.value, cleaned),
      matchedField: match.field,
      createdAt: entry.updated_at,
      entryDate: entry.journal_date
    };
  });

  const dailyReportResults = (
    connection
      .prepare(
        `
        SELECT *
        FROM daily_journals
        WHERE report_markdown LIKE ?
        ORDER BY updated_at DESC
        LIMIT 10
        `
      )
      .all(like) as DailyJournal[]
  ).map<SearchResult>((journal) => ({
    id: `daily_report:${journal.id}`,
    type: "daily_report",
    title: `Report ${journal.journal_date}`,
    projectId: null,
    projectName: null,
    workItemId: null,
    workItemTitle: null,
    snippet: snippet(journal.report_markdown || "", cleaned),
    matchedField: "dailyReport",
    createdAt: journal.updated_at,
    entryDate: journal.journal_date
  }));

  const memoResults = (
    connection
      .prepare(
        `
        SELECT
          pm.*,
          p.name AS project_name
        FROM project_memos pm
        JOIN projects p ON p.id = pm.project_id
        WHERE pm.content_markdown LIKE ?
        ORDER BY pm.updated_at DESC
        LIMIT 10
        `
      )
      .all(like) as Array<ProjectMemo & { project_name: string }>
  ).map<SearchResult>((memo) => ({
    id: `project_memo:${memo.id}`,
    type: "project_memo",
    title: memo.project_name,
    projectId: memo.project_id,
    projectName: memo.project_name,
    workItemId: null,
    workItemTitle: null,
    snippet: snippet(memo.content_markdown || "", cleaned),
    matchedField: "projectMemo",
    createdAt: memo.updated_at
  }));

  const workItemNoteResults = (
    connection
      .prepare(
        `
        SELECT
          win.*,
          p.id AS project_id,
          p.name AS project_name,
          wi.title AS work_item_title
        FROM work_item_notes win
        JOIN work_items wi ON wi.id = win.work_item_id
        JOIN projects p ON p.id = wi.project_id
        WHERE win.content_markdown LIKE ?
        ORDER BY win.updated_at DESC
        LIMIT 10
        `
      )
      .all(like) as Array<WorkItemNote & { project_id: string; project_name: string; work_item_title: string }>
  ).map<SearchResult>((note) => ({
    id: `work_item_note:${note.id}`,
    type: "work_item_note",
    title: note.work_item_title,
    projectId: note.project_id,
    projectName: note.project_name,
    workItemId: note.work_item_id,
    workItemTitle: note.work_item_title,
    snippet: snippet(note.content_markdown || "", cleaned),
    matchedField: "workItemNote",
    createdAt: note.updated_at
  }));

  const legacyResults = (
    connection
      .prepare(
        `
        SELECT
          pe.*,
          p.name AS project_name,
          wi.title AS work_item_title
        FROM progress_entries pe
        JOIN projects p ON p.id = pe.project_id
        LEFT JOIN work_items wi ON wi.id = pe.work_item_id
        WHERE pe.content LIKE ?
          OR pe.next_step LIKE ?
          OR pe.blocker LIKE ?
        ORDER BY pe.created_at DESC
        LIMIT 20
        `
      )
      .all(like, like, like) as Array<
      ProgressEntry & { project_name: string; work_item_title: string | null }
    >
  ).map<SearchResult>((entry) => {
    const match = firstMatchingField(cleaned, [
      ["legacyProgress", entry.content],
      ["legacyNextStep", entry.next_step],
      ["legacyBlocker", entry.blocker]
    ]);
    return {
      id: `progress:${entry.id}`,
      type: "progress",
      title: entry.work_item_title || "Legacy project entry",
      projectId: entry.project_id,
      projectName: entry.project_name,
      workItemId: entry.work_item_id,
      workItemTitle: entry.work_item_title,
      snippet: snippet(match.value, cleaned),
      matchedField: match.field,
      createdAt: entry.created_at,
      entryDate: entry.entry_date
    };
  });

  return [
    ...dailyEntryResults,
    ...dailyReportResults,
    ...memoResults,
    ...workItemNoteResults,
    ...legacyResults,
    ...itemResults,
    ...projectResults
  ].slice(0, 30);
}

function generateTodayMarkdownLegacy(): { date: string; markdown: string } {
  const today = getLocalDateKey();
  const rows = database()
    .prepare(
      `
      SELECT
        pe.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM progress_entries pe
      JOIN projects p ON p.id = pe.project_id
      LEFT JOIN work_items wi ON wi.id = pe.work_item_id
      WHERE pe.entry_date = ?
      ORDER BY p.name COLLATE NOCASE ASC, wi.title COLLATE NOCASE ASC, pe.created_at ASC
      `
    )
    .all(today) as TimelineEntry[];

  if (rows.length === 0) {
    return {
      date: today,
      markdown: `# 工作记录 - ${today}\n\n暂无今日进展记录。\n`
    };
  }

  const projectMap = new Map<string, Map<string, TimelineEntry[]>>();
  for (const entry of rows) {
    const projectEntries = projectMap.get(entry.project_name) ?? new Map<string, TimelineEntry[]>();
    const itemName = entry.work_item_title || "未关联工作项";
    const itemEntries = projectEntries.get(itemName) ?? [];
    itemEntries.push(entry);
    projectEntries.set(itemName, itemEntries);
    projectMap.set(entry.project_name, projectEntries);
  }

  const lines = [`# 工作记录 - ${today}`, ""];
  for (const [projectName, items] of projectMap.entries()) {
    lines.push(`## ${projectName}`, "");
    for (const [itemName, entries] of items.entries()) {
      lines.push(`### ${itemName}`);
      for (const entry of entries) {
        lines.push(`- 进展：${entry.content.trim() || "暂无"}`);
        lines.push(`- 下一步：${entry.next_step?.trim() || "暂无"}`);
        lines.push(`- 阻碍：${entry.blocker?.trim() || "暂无"}`);
        lines.push("");
      }
    }
  }

  return {
    date: today,
    markdown: lines.join("\n").trimEnd() + "\n"
  };
}

export function generateTodayMarkdown(): { date: string; markdown: string } {
  return generateDailyReport(getLocalDateKey());
}

export async function writeMarkdownFile(input: ExportMarkdownInput, filePath: string): Promise<void> {
  await writeFile(filePath, input.markdown, "utf8");
}

function validateDatabaseFile(filePath: string): void {
  const validationDb = new Database(filePath, { readonly: true });
  try {
    const rows = validationDb
      .prepare(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('projects', 'work_items', 'progress_entries')
        `
      )
      .all() as Array<{ name: string }>;
    const tableNames = new Set(rows.map((row) => row.name));
    for (const tableName of ["projects", "work_items", "progress_entries"]) {
      if (!tableNames.has(tableName)) {
        throw new Error(`迁移后的数据库缺少 ${tableName} 表。`);
      }
    }
    validationDb.prepare("SELECT COUNT(*) AS count FROM projects").get();
    validationDb.prepare("SELECT COUNT(*) AS count FROM work_items").get();
    validationDb.prepare("SELECT COUNT(*) AS count FROM progress_entries").get();
  } finally {
    validationDb.close();
  }
}

async function switchToExistingDatabaseDirectory(targetDirectory: string): Promise<MigrationResult> {
  const previousDirectory = resolveDataDirectory().configuredDataDirectory;
  try {
    closeDatabase();
    setDataDirectory(targetDirectory);
    reopenDatabase();
    return {
      canceled: false,
      operation: "switched",
      message: "已切换到所选数据目录。",
      settings: getSettingsInfo()
    };
  } catch (error) {
    setDataDirectory(previousDirectory);
    try {
      reopenDatabase();
    } catch {
      closeDatabase();
    }
    throw error;
  }
}

export async function migrateDatabaseToDirectory(
  selectedDirectory: string,
  confirmUseExisting?: (targetDirectory: string, targetDatabasePath: string) => Promise<boolean>
): Promise<MigrationResult> {
  const currentDirectory = getCurrentDataDirectory();
  const targetDirectory = resolve(selectedDirectory);
  const currentDatabasePath = getCurrentDatabasePath();
  const targetDatabasePath = getDatabasePathForDirectory(targetDirectory);
  const tempDatabasePath = `${targetDatabasePath}.tmp`;

  if (pathsEqual(targetDirectory, currentDirectory)) {
    return {
      canceled: false,
      operation: "unchanged",
      message: "当前已经在使用该数据目录。",
      settings: getSettingsInfo()
    };
  }

  const workspaceRoot = resolve(process.cwd());
  const appPath = resolve(app.getAppPath());
  if (isInsideDirectory(targetDirectory, workspaceRoot) || isInsideDirectory(targetDirectory, appPath)) {
    throw new Error("不能把数据库目录设置在源码目录或开发工作区内。");
  }

  await ensureDirectoryWritable(targetDirectory);

  if (existsSync(targetDatabasePath)) {
    try {
      validateDatabaseFile(targetDatabasePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "数据库校验失败";
      throw new Error(`该目录中的数据库文件无效，无法切换数据目录。当前数据目录未改变。${reason}`);
    }

    if (confirmUseExisting) {
      const confirmed = await confirmUseExisting(targetDirectory, targetDatabasePath);
      if (!confirmed) {
        return { canceled: true };
      }
    }

    return switchToExistingDatabaseDirectory(targetDirectory);
  }

  if (existsSync(tempDatabasePath)) {
    throw new Error(
      `目标目录已存在 ${getDatabaseFileName()}.tmp，无法确认是否为本次迁移产生，请先手动清理该目录后重试。`
    );
  }

  database();
  checkpointDatabase();
  closeDatabase();

  let tempCreated = false;
  let configChanged = false;
  let attachmentsCopied = false;
  const previousDirectory = resolveDataDirectory().configuredDataDirectory;
  try {
    await copyFile(currentDatabasePath, tempDatabasePath, constants.COPYFILE_EXCL);
    tempCreated = true;
    validateDatabaseFile(tempDatabasePath);
    attachmentsCopied = await copyAttachmentsDirectory(currentDirectory, targetDirectory);
    renameSync(tempDatabasePath, targetDatabasePath);
    tempCreated = false;
    setDataDirectory(targetDirectory);
    configChanged = true;
    reopenDatabase();
    return {
      canceled: false,
      operation: "migrated",
      message: "已将当前数据库迁移到新的数据目录。",
      settings: getSettingsInfo()
    };
  } catch (error) {
    if (tempCreated && existsSync(tempDatabasePath)) {
      try {
        unlinkSync(tempDatabasePath);
      } catch {
        // The original database remains untouched; report the migration failure below.
      }
    }
    if (configChanged) {
      setDataDirectory(previousDirectory);
    }
    if (attachmentsCopied) {
      try {
        rmSync(attachmentsDirectory(targetDirectory), { recursive: true, force: true });
      } catch {
        // The original attachments remain untouched; report the migration failure below.
      }
    }
    reopenDatabase();
    throw error;
  }
}

export async function useExistingDatabaseDirectory(selectedDirectory: string): Promise<MigrationResult> {
  const targetDirectory = resolve(selectedDirectory);
  const currentDirectory = getCurrentDataDirectory();
  const targetDatabasePath = getDatabasePathForDirectory(targetDirectory);

  if (pathsEqual(targetDirectory, currentDirectory)) {
    return {
      canceled: false,
      operation: "unchanged",
      message: "所选目录就是当前数据库目录，无需切换。",
      settings: getSettingsInfo()
    };
  }

  const workspaceRoot = resolve(process.cwd());
  const appPath = resolve(app.getAppPath());
  if (isInsideDirectory(targetDirectory, workspaceRoot) || isInsideDirectory(targetDirectory, appPath)) {
    throw new Error("不能把数据库目录设置在源码目录或开发工作区内。");
  }

  await ensureDirectoryWritable(targetDirectory);

  if (!existsSync(targetDatabasePath)) {
    throw new Error("未找到流梭数据库文件。");
  }

  validateDatabaseFile(targetDatabasePath);

  return switchToExistingDatabaseDirectory(targetDirectory);
}

export function reloadDatabaseFromSettings(): MigrationResult {
  const previousDatabasePath = getCurrentDatabasePath();
  try {
    closeDatabase();
    reopenDatabase();
    return {
      canceled: false,
      operation: "reloaded",
      message: "当前数据目录已重新加载。",
      settings: getSettingsInfo()
    };
  } catch (error) {
    try {
      if (existsSync(previousDatabasePath)) {
        db = new Database(previousDatabasePath);
        db.pragma("foreign_keys = ON");
        db.pragma("journal_mode = WAL");
        runMigrations(db);
      }
    } catch {
      closeDatabase();
    }
    throw error;
  }
}
