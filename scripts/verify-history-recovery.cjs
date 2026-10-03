const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { dirname, resolve } = require("node:path");
const { test, after } = require("node:test");
const Database = require("better-sqlite3");
const db = require(process.env.FLOW_SHUTTLE_HISTORY_TEST_DATABASE);
const today = db.getTodayJournal().journalDate;
assert.equal(dirname(resolve(db.getCurrentDatabasePath())), resolve(process.env.FLOW_SHUTTLE_HISTORY_TEST_PROFILE));
const offsetDate = days => {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const fixture = title => {
  const project = db.createProject({ name: `历史提示测试 ${title}` });
  const item = db.createWorkItem({ projectId: project.id, title });
  return { project, item };
};
const blockFor = id => db.getTodayJournal().groups.flatMap(group => group.items).find(block => block.workItem.id === id);
const saveSummary = (fixture, date, summary) => db.upsertDailyWorkItemEntry({
  projectId: fixture.project.id, workItemId: fixture.item.id, journalDate: date,
  todayProgress: summary, statusForToday: "in_progress"
});
const writeFixture = action => {
  const connection = new Database(db.getCurrentDatabasePath());
  try { action(connection); } finally { connection.close(); }
};
after(() => db.closeDatabase());

test("a newly saved today summary remains separate from current content and recovery", () => {
  const f = fixture("今天只写变更摘要");
  assert.equal(blockFor(f.item.id).recoverableHistory, null);
  const before = db.getTodayJournal().stats.filledEntries;
  saveSummary(f, today, "今日摘要必须完整保留在日报中");
  const block = blockFor(f.item.id);
  assert.equal(block.entry.today_progress, "今日摘要必须完整保留在日报中");
  assert.equal(block.workItemNote.content_markdown ?? "", "");
  assert.equal(block.recoverableHistory, null);
  assert.equal(db.getWorkItemHistoryRecovery(f.item.id), null);
  const restore = db.restoreWorkItemHistoryToNote(f.item.id);
  assert.equal(restore.restored, false);
  assert.equal(restore.skippedReason, "no_recoverable_content");
  assert.equal(db.getTodayJournal().stats.filledEntries, before + 1);
});

test("past summaries remain recoverable while today's summary is excluded", () => {
  const f = fixture("保留真实历史每日记录");
  saveSummary(f, offsetDate(-1), "昨天已经存在的历史摘要");
  saveSummary(f, today, "今天刚保存的摘要");
  const recovery = db.getWorkItemHistoryRecovery(f.item.id);
  assert.equal(recovery.source, "daily_work_item_entries");
  assert.equal(recovery.recordCount, 1);
  assert.equal(recovery.latestDate, offsetDate(-1));
  assert.ok(recovery.contentMarkdown.includes("昨天已经存在的历史摘要"));
  assert.ok(!recovery.contentMarkdown.includes("今天刚保存的摘要"));
  const before = db.getTodayJournal().stats.filledEntries;
  const restore = db.restoreWorkItemHistoryToNote(f.item.id);
  assert.equal(restore.restored, true);
  const block = blockFor(f.item.id);
  assert.equal(block.entry.today_progress, "今天刚保存的摘要");
  assert.equal(block.workItemNote.content_markdown, recovery.contentMarkdown);
  assert.equal(block.recoverableHistory, null);
  assert.equal(db.getTodayJournal().stats.filledEntries, before);
});

test("future summaries do not become recovery history", () => {
  const f = fixture("排除未来日期摘要");
  saveSummary(f, offsetDate(1), "未来日期的记录");
  assert.equal(db.getWorkItemHistoryRecovery(f.item.id), null);
  assert.equal(blockFor(f.item.id).recoverableHistory, null);
});

test("a genuine current-content snapshot from today still takes priority", () => {
  const f = fixture("完整稿快照仍能恢复");
  const content = "完整工作项内容的真实快照";
  const now = new Date().toISOString();
  writeFixture(connection => connection.prepare(
    "INSERT INTO work_item_note_snapshots VALUES (?, ?, ?, ?, ?, ?)"
  ).run(randomUUID(), f.item.id, today, content, now, now));
  saveSummary(f, today, "今天的摘要不是完整稿");
  const recovery = db.getWorkItemHistoryRecovery(f.item.id);
  assert.equal(recovery.source, "work_item_note_snapshots");
  assert.equal(recovery.contentMarkdown, content);
  assert.equal(blockFor(f.item.id).recoverableHistory.source, "work_item_note_snapshots");
});

test("legacy progress remains recoverable and cannot overwrite nonempty current content", () => {
  const f = fixture("旧版内容保留恢复能力");
  const now = new Date().toISOString();
  writeFixture(connection => connection.prepare(
    "INSERT INTO progress_entries VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)"
  ).run(randomUUID(), f.project.id, f.item.id, today, "旧版追加式进展", now, now));
  assert.equal(db.getWorkItemHistoryRecovery(f.item.id).source, "progress_entries");
  db.upsertDailyWorkItemEntry({ projectId: f.project.id, workItemId: f.item.id, journalDate: today,
    statusForToday: "in_progress", workItemNoteContentMarkdown: "正在维护的完整正文" });
  assert.equal(blockFor(f.item.id).recoverableHistory, null);
  const restore = db.restoreWorkItemHistoryToNote(f.item.id);
  assert.equal(restore.restored, false);
  assert.equal(restore.skippedReason, "note_not_empty");
  assert.equal(restore.workItemNote.content_markdown, "正在维护的完整正文");
});

test("excluding today's recovery does not truncate its generated daily report", () => {
  const report = db.generateDailyReport(today);
  assert.ok(report.markdown.includes("今日摘要必须完整保留在日报中"));
});
