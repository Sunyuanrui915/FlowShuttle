const Database = require("better-sqlite3");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const devDataRoot = path.join(rootDir, "dev-data");
const dataDir = path.join(devDataRoot, "flow-shuttle-test-data");
const dbPath = path.join(dataDir, "flow-shuttle.sqlite");
const tempDbPath = path.join(dataDir, "flow-shuttle.sqlite.tmp");
const force = process.argv.includes("--force");
const statsOnly = process.argv.includes("--stats");

function assertInsideDevData(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(devDataRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${devDataRoot}`);
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addLocalDays(dateKey, offset) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function getWeekPeriod(dateKey) {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const start = addLocalDays(dateKey, offsetToMonday);
  return { start, end: addLocalDays(start, 6) };
}

function getMonthPeriod(dateKey) {
  const date = parseDateKey(dateKey);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = localDateKey(new Date(year, month - 1, 1));
  const end = localDateKey(new Date(year, month, 0));
  return { start, end, year, month };
}

function timestamp(dateKey, hour, minute) {
  return `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000+08:00`;
}

function nowTimestamp() {
  return new Date().toISOString();
}

function monthDay(dateKey) {
  return dateKey.slice(5);
}

function generatedAt() {
  const date = new Date();
  return `${localDateKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const projects = [
  {
    name: "[测试] 流梭",
    description: "验证今日工作页、日报、周报、月报、Reports、热力图和 AI 提炼入口的测试项目。",
    items: [
      "今日工作页总览",
      "长文本记录体验",
      "日报周报月报生成",
      "AI 提炼入口验证",
      "删除项目与工作项回归"
    ]
  },
  {
    name: "[测试] 个人网站",
    description: "验证内容型项目的多段记录、搜索、导出和报告归纳。",
    items: ["首页视觉层级优化", "文章页排版调整", "项目复盘素材整理"]
  },
  {
    name: "[测试] 数据治理报表系统",
    description: "验证业务系统类工作记录、风险阻碍、权限流程和质量报表。",
    items: ["质量数据日报表复核", "权限申请流程优化", "指标口径确认", "周报月报导出验证"]
  },
  {
    name: "[测试] 公众号内容运营",
    description: "验证长文本素材整理、选题复盘和跨日期计划流转。",
    items: ["AI 工作流文章整理", "产品复盘素材归档", "选题池维护"]
  }
];

function longProgress(title, dateKey) {
  return [
    `# ${title} - ${dateKey}`,
    "",
    "今天做了一次偏真实工作流的长文本记录验证。记录里包含会议结论、判断依据、临时备注和后续计划，目的是确认正式日报、周报、月报不会把用户输入截断成摘要。",
    "",
    "## 关键观察",
    "",
    "1. 真实工作记录经常不是一句话，而是由上下文、推进过程、待确认事项和风险判断组成。",
    "2. Reports 列表可以只显示摘要，但正式 Markdown、复制和导出必须保留完整内容。",
    "3. 如果用户需要更短的版本，应通过 AI 提炼版实现，而不是牺牲规则版报告的完整性。",
    "",
    "## 今天推进",
    "",
    "- 检查了 Today 总览、今日记录编辑页、Reports 详情、复制 Markdown 和导出 .md 的链路。",
    "- 使用多段落、编号、项目符号和空行模拟真实记录，确认换行可以保留。",
    "- 验证同一工作项跨多个日期时，周报 / 月报能按日期展开完整记录。",
    "- 补充阻碍和下一步计划，方便观察报告中的风险区和计划区。",
    "",
    "## 复盘",
    "",
    "这条长记录故意写得比较完整，用来压测热力图活跃度、搜索结果、报告生成和 AI 提炼入口。它不应该在正式报告中被替换成“详见日报”，也不应该出现“其余日期略”这类占位说明。"
  ].join("\n");
}

function progressText(title, dateKey, variant) {
  if (variant % 7 === 0) {
    return longProgress(title, dateKey);
  }
  const list = [
    `梳理了「${title}」的主流程，确认从记录、保存到报告展示的闭环可以跑通。`,
    `复核「${title}」在浅色和深色模式下的可读性，顺手记录了两个需要继续观察的边界场景。`,
    `完成「${title}」的一次回归验证，重点检查 Today 摘要、Reports 详情和导出 Markdown 是否一致。`,
    `把「${title}」拆成轻量记录和深度记录两类，方便同时观察热力图深浅等级。`,
    `根据上一工作日留下的 next_step 继续推进「${title}」，记录了可复现问题和下一步验证口径。`
  ];
  return list[variant % list.length];
}

function nextStep(title, variant) {
  const list = [
    `继续验证「${title}」在周报和月报中的完整输出。`,
    `补充「${title}」的边界数据，尤其是长文本、空 blocker 和重复 next_step。`,
    `回到真实使用路径中复核「${title}」，确认 Today、Reports、Heatmap 三处联动一致。`,
    `用一整天的记录量压测「${title}」，观察是否出现滚动、换行或报告过长问题。`
  ];
  return list[variant % list.length];
}

function blocker(variant) {
  const list = [
    "接口返回字段含义不一致，需要和开发确认口径。",
    "本地数据库迁移后需要复核旧目录是否仍被引用。",
    "周报和月报的规则版内容偏长，需要区分完整版和 AI 提炼版。",
    null,
    "暂无",
    null
  ];
  return list[variant % list.length];
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE work_items (
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

    CREATE TABLE progress_entries (
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

    CREATE TABLE daily_journals (
      id TEXT PRIMARY KEY,
      journal_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      report_markdown TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE daily_work_item_entries (
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

    CREATE TABLE period_reports (
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

    CREATE TABLE ai_report_refinements (
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

    CREATE TABLE project_memos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      content_markdown TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE memo_attachments (
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

    CREATE TABLE daily_entry_attachments (
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

    CREATE INDEX idx_work_items_project_status ON work_items(project_id, status);
    CREATE INDEX idx_progress_entries_entry_date ON progress_entries(entry_date);
    CREATE INDEX idx_progress_entries_project_created ON progress_entries(project_id, created_at);
    CREATE INDEX idx_progress_entries_work_item_created ON progress_entries(work_item_id, created_at);
    CREATE INDEX idx_daily_entries_date ON daily_work_item_entries(journal_date);
    CREATE INDEX idx_daily_entries_project_date ON daily_work_item_entries(project_id, journal_date);
    CREATE INDEX idx_daily_entries_work_item_date ON daily_work_item_entries(work_item_id, journal_date);
    CREATE INDEX idx_period_reports_type_period ON period_reports(report_type, period_start, period_end);
    CREATE INDEX idx_ai_report_refinements_report ON ai_report_refinements(period_report_id, refinement_mode);
    CREATE INDEX idx_ai_report_refinements_period ON ai_report_refinements(report_type, period_start, period_end);
    CREATE INDEX idx_memo_attachments_project ON memo_attachments(project_id, created_at);
    CREATE INDEX idx_daily_entry_attachments_work_item ON daily_entry_attachments(work_item_id, journal_date);
    CREATE INDEX idx_daily_entry_attachments_project ON daily_entry_attachments(project_id, journal_date);
  `);

  const insertMigration = db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
  [
    [1, "initial_schema"],
    [2, "daily_journal_schema"],
    [3, "period_reports_schema"],
    [4, "ai_report_refinements_schema"],
    [5, "project_memos_schema"],
    [6, "daily_entry_attachments_schema"]
  ].forEach(([version, name]) => insertMigration.run(version, name, nowTimestamp()));
}

function appendItems(lines, title, rows) {
  lines.push(`## ${title}`, "");
  if (rows.length === 0) {
    lines.push("- 暂无。", "");
    return;
  }
  rows.forEach((row) => {
    lines.push(`### ${row.project_name} / ${row.work_item_title}`);
    row.values.filter(Boolean).forEach((value) => lines.push(`- ${value}`));
    lines.push("");
  });
}

function dailyReport(dateKey, rows, previousRows) {
  const todayByWorkItem = new Set(rows.map((row) => row.work_item_id));
  const completed = rows
    .filter((row) => row.status_for_today === "done_today")
    .map((row) => ({
      ...row,
      values: [
        "状态：今日完成",
        row.today_progress ? `进展：${row.today_progress}` : "",
        row.next_step ? `下一步：${row.next_step}` : "",
        row.blocker ? `阻碍：${row.blocker}` : ""
      ]
    }));
  const advanced = rows
    .filter((row) => row.status_for_today !== "done_today" && row.today_progress?.trim())
    .map((row) => ({
      ...row,
      values: [
        row.today_progress ? `进展：${row.today_progress}` : "",
        row.next_step ? `下一步：${row.next_step}` : "",
        row.blocker ? `阻碍：${row.blocker}` : ""
      ]
    }));
  const carried = previousRows
    .filter((row) => row.next_step?.trim() && todayByWorkItem.has(row.work_item_id))
    .map((row) => ({ ...row, values: [`上一工作日计划：${row.next_step}`] }));
  const delayed = previousRows
    .filter((row) => row.next_step?.trim() && !todayByWorkItem.has(row.work_item_id))
    .map((row) => ({ ...row, values: [`未推进：${row.next_step}`] }));
  const blockers = rows
    .filter((row) => row.blocker?.trim() && row.blocker !== "暂无")
    .map((row) => ({ ...row, values: [`阻碍：${row.blocker}`] }));
  const tomorrow = rows
    .filter((row) => row.next_step?.trim())
    .map((row) => ({ ...row, values: [`下一步：${row.next_step}`] }));
  const lines = [`# 工作日报 - ${dateKey}`, ""];
  appendItems(lines, "今日完成", completed);
  appendItems(lines, "今日推进", advanced);
  appendItems(lines, "昨日计划流转", carried);
  appendItems(lines, "未推进 / 延期", delayed);
  appendItems(lines, "阻碍与风险", blockers);
  appendItems(lines, "明日计划", tomorrow);
  return `${lines.join("\n").trimEnd()}\n`;
}

function periodReport(type, start, end, rows) {
  const title = type === "weekly" ? `工作周报 - ${start} 至 ${end}` : `工作月报 - ${getMonthPeriod(start).year}年${getMonthPeriod(start).month}月`;
  const overviewTitle = type === "weekly" ? "本周概览" : "本月概览";
  const doneTitle = type === "weekly" ? "三、本周完成事项" : "三、本月完成事项";
  const blockerTitle = type === "weekly" ? "四、本周阻碍与风险" : "四、本月阻碍与风险";
  const planTitle = type === "weekly" ? "五、下周计划" : "五、下月计划";
  const lines = [
    `# ${title}`,
    "",
    `生成时间：${generatedAt()}`,
    "",
    `## 一、${overviewTitle}`,
    "",
    `- 记录天数：${new Set(rows.map((row) => row.journal_date)).size} 天`,
    `- 涉及项目：${new Set(rows.map((row) => row.project_id)).size} 个`,
    `- 推进工作项：${new Set(rows.map((row) => row.work_item_id)).size} 个`,
    `- 完成工作项：${new Set(rows.filter((row) => row.status_for_today === "done_today").map((row) => row.work_item_id)).size} 个`,
    "",
    "## 二、按项目与工作项汇总",
    ""
  ];

  const projectMap = new Map();
  rows.forEach((row) => {
    const project = projectMap.get(row.project_id) ?? { name: row.project_name, items: new Map() };
    const itemRows = project.items.get(row.work_item_id) ?? { title: row.work_item_title, rows: [] };
    itemRows.rows.push(row);
    project.items.set(row.work_item_id, itemRows);
    projectMap.set(row.project_id, project);
  });
  projectMap.forEach((project) => {
    lines.push(`### ${project.name}`, "");
    project.items.forEach((item) => {
      lines.push(`#### ${item.title}`);
      lines.push(`涉及日期：${[...new Set(item.rows.map((row) => monthDay(row.journal_date)))].join("、")}`, "");
      item.rows.forEach((row) => {
        lines.push(`##### ${monthDay(row.journal_date)}`);
        lines.push(`今日状态：${row.status_for_today === "done_today" ? "已完成" : row.status_for_today === "paused" ? "暂停" : "持续推进"}`, "");
        lines.push("今日进展：", row.today_progress?.trim() || "暂无。", "");
        lines.push("下一步计划：", row.next_step?.trim() || "暂无。", "");
        lines.push("阻碍 / 需要帮助：", row.blocker?.trim() || "暂无。", "");
      });
    });
  });

  lines.push(`## ${doneTitle}`, "");
  const doneRows = rows.filter((row) => row.status_for_today === "done_today");
  if (doneRows.length === 0) {
    lines.push("- 暂无。", "");
  } else {
    doneRows.forEach((row) => lines.push(`- ${row.project_name} / ${row.work_item_title}（${monthDay(row.journal_date)}）`));
    lines.push("");
  }

  lines.push(`## ${blockerTitle}`, "");
  const blockerRows = rows.filter((row) => row.blocker?.trim() && row.blocker !== "暂无");
  if (blockerRows.length === 0) {
    lines.push("- 暂无。", "");
  } else {
    blockerRows.forEach((row) => lines.push(`### ${row.project_name} / ${row.work_item_title}（${monthDay(row.journal_date)}）`, row.blocker, ""));
  }

  lines.push(`## ${planTitle}`, "");
  const planRows = rows.filter((row) => row.next_step?.trim());
  if (planRows.length === 0) {
    lines.push("- 暂无。", "");
  } else {
    planRows.forEach((row) => lines.push(`- ${row.project_name} / ${row.work_item_title}：${row.next_step}`));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function seed(db) {
  const now = nowTimestamp();
  const projectIds = new Map();
  const items = [];

  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, description, status, created_at, updated_at, archived_at)
    VALUES (?, ?, ?, 'active', ?, ?, NULL)
  `);
  const insertItem = db.prepare(`
    INSERT INTO work_items (id, project_id, title, description, status, created_at, updated_at, completed_at, archived_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, NULL)
  `);
  const insertMemo = db.prepare(`
    INSERT INTO project_memos (id, project_id, content_markdown, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  projects.forEach((project) => {
    const projectId = randomUUID();
    projectIds.set(project.name, projectId);
    insertProject.run(projectId, project.name, project.description, now, now);
    insertMemo.run(
      randomUUID(),
      projectId,
      `# ${project.name}\n\n## 项目背景\n${project.description}\n\n## 测试关注点\n- 长期背景材料只保存在项目备忘录中。\n- 备忘录不会进入日报、周报或月报。\n- 搜索项目备忘录内容时，应能跳转到该项目的备忘录页面。\n\n## 图片粘贴\n可在正式应用中直接粘贴截图，图片会保存到当前数据目录的 attachments/project-memos 子目录。`,
      now,
      now
    );
    project.items.forEach((title) => {
      const workItemId = randomUUID();
      items.push({ projectId, projectName: project.name, workItemId, title });
      insertItem.run(workItemId, projectId, title, `开发测试工作项：${title}`, now, now);
    });
  });

  const today = localDateKey();
  const dateRange = Array.from({ length: 24 }, (_value, index) => addLocalDays(today, index - 23));
  const recordDates = dateRange.filter((dateKey) => {
    const day = parseDateKey(dateKey).getDay();
    return day >= 1 && day <= 5 || dateKey === today;
  });

  const insertEntry = db.prepare(`
    INSERT INTO daily_work_item_entries
      (id, journal_date, project_id, work_item_id, today_progress, next_step, blocker, status_for_today, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const completed = new Set();
  recordDates.forEach((dateKey, dayIndex) => {
    const entryCount = dayIndex % 6 === 0 ? 6 : dayIndex % 5 === 0 ? 1 : dayIndex % 4 === 0 ? 5 : 3;
    const usedWorkItems = new Set();
    for (let offset = 0; usedWorkItems.size < entryCount && offset < items.length * 2; offset += 1) {
      const item = items[(dayIndex * 2 + offset * 3) % items.length];
      if (usedWorkItems.has(item.workItemId)) {
        continue;
      }
      usedWorkItems.add(item.workItemId);
      const variant = dayIndex + usedWorkItems.size - 1;
      const status = variant % 11 === 0 ? "done_today" : variant % 9 === 0 ? "paused" : "in_progress";
      if (status === "done_today") {
        completed.add(item.workItemId);
      }
      insertEntry.run(
        randomUUID(),
        dateKey,
        item.projectId,
        item.workItemId,
        progressText(item.title, dateKey, variant),
        nextStep(item.title, variant),
        blocker(variant),
        status,
        timestamp(dateKey, 9 + (variant % 4), (variant * 7) % 60),
        timestamp(dateKey, 17, (variant * 11) % 60)
      );
    }
  });

  const updateCompleted = db.prepare("UPDATE work_items SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?");
  completed.forEach((id) => updateCompleted.run(now, now, id));

  const insertLegacy = db.prepare(`
    INSERT INTO progress_entries (id, project_id, work_item_id, entry_date, content, next_step, blocker, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  items.slice(0, 4).forEach((item, index) => {
    const dateKey = recordDates[index] ?? today;
    insertLegacy.run(
      randomUUID(),
      item.projectId,
      item.workItemId,
      dateKey,
      `旧进展记录兼容验证：${item.title}`,
      `旧记录下一步：继续核对 ${item.title}`,
      index % 2 === 0 ? "旧记录阻碍：需要确认迁移兼容显示。" : null,
      timestamp(dateKey, 15, index * 8),
      timestamp(dateKey, 15, index * 8)
    );
  });

  const selectRowsForDate = db.prepare(`
    SELECT dwe.*, p.name AS project_name, wi.title AS work_item_title
    FROM daily_work_item_entries dwe
    JOIN projects p ON p.id = dwe.project_id
    JOIN work_items wi ON wi.id = dwe.work_item_id
    WHERE dwe.journal_date = ?
    ORDER BY p.name, wi.title
  `);
  const insertJournal = db.prepare(`
    INSERT INTO daily_journals (id, journal_date, status, report_markdown, created_at, updated_at, closed_at)
    VALUES (?, ?, 'closed', ?, ?, ?, ?)
  `);

  let previousRows = [];
  recordDates.forEach((dateKey) => {
    const rows = selectRowsForDate.all(dateKey);
    const markdown = dailyReport(dateKey, rows, previousRows);
    insertJournal.run(randomUUID(), dateKey, markdown, timestamp(dateKey, 18, 30), timestamp(dateKey, 18, 30), timestamp(dateKey, 18, 30));
    previousRows = rows;
  });

  const selectPeriodRows = db.prepare(`
    SELECT dwe.*, p.name AS project_name, wi.title AS work_item_title
    FROM daily_work_item_entries dwe
    JOIN daily_journals dj ON dj.journal_date = dwe.journal_date
    JOIN projects p ON p.id = dwe.project_id
    JOIN work_items wi ON wi.id = dwe.work_item_id
    WHERE dwe.journal_date BETWEEN ? AND ?
      AND dj.status = 'closed'
    ORDER BY p.name, wi.title, dwe.journal_date
  `);
  const insertPeriod = db.prepare(`
    INSERT INTO period_reports (id, report_type, period_start, period_end, title, report_markdown, generated_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const periods = new Map();
  recordDates.forEach((dateKey) => {
    const week = getWeekPeriod(dateKey);
    periods.set(`weekly:${week.start}:${week.end}`, { type: "weekly", start: week.start, end: week.end });
    const month = getMonthPeriod(dateKey);
    periods.set(`monthly:${month.start}:${month.end}`, { type: "monthly", start: month.start, end: month.end });
  });

  let firstWeeklyReport = null;
  periods.forEach((period) => {
    const rows = selectPeriodRows.all(period.start, period.end);
    if (rows.length === 0) {
      return;
    }
    const markdown = periodReport(period.type, period.start, period.end, rows);
    const title =
      period.type === "weekly"
        ? `工作周报 - ${period.start} 至 ${period.end}`
        : `工作月报 - ${getMonthPeriod(period.start).year}年${getMonthPeriod(period.start).month}月`;
    const id = randomUUID();
    insertPeriod.run(id, period.type, period.start, period.end, title, markdown, now, now);
    if (period.type === "weekly" && !firstWeeklyReport) {
      firstWeeklyReport = { id, period, markdown };
    }
  });

  if (firstWeeklyReport) {
    db.prepare(`
      INSERT INTO ai_report_refinements
        (id, period_report_id, report_type, period_start, period_end, refinement_mode, refined_markdown, source_markdown_hash, provider, model, generated_at, updated_at)
      VALUES
        (?, ?, 'weekly', ?, ?, 'standard', ?, ?, 'openai-compatible', 'test-model', ?, ?)
    `).run(
      randomUUID(),
      firstWeeklyReport.id,
      firstWeeklyReport.period.start,
      firstWeeklyReport.period.end,
      `# AI 提炼版测试周报\n\n这是一份本地测试数据中的 AI 提炼版示例，用于验证 Reports 中规则版 / AI 提炼版切换。它不会调用真实 AI 服务。\n`,
      createHash("sha256").update(firstWeeklyReport.markdown, "utf8").digest("hex"),
      now,
      now
    );
  }
}

function main() {
  assertInsideDevData(dataDir);
  if (statsOnly) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Test database does not exist: ${dbPath}`);
    }
    const db = new Database(dbPath, { fileMustExist: true });
    try {
      const count = (sql) => db.prepare(sql).get().count;
      console.log(
        JSON.stringify(
          {
            projects: count("SELECT COUNT(*) AS count FROM projects"),
            workItems: count("SELECT COUNT(*) AS count FROM work_items"),
            dailyEntries: count("SELECT COUNT(*) AS count FROM daily_work_item_entries"),
            dailyReports: count("SELECT COUNT(*) AS count FROM daily_journals WHERE status = 'closed'"),
            weeklyReports: count("SELECT COUNT(*) AS count FROM period_reports WHERE report_type = 'weekly'"),
            monthlyReports: count("SELECT COUNT(*) AS count FROM period_reports WHERE report_type = 'monthly'"),
            aiRefinements: count("SELECT COUNT(*) AS count FROM ai_report_refinements")
          },
          null,
          2
        )
      );
    } finally {
      db.close();
    }
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(dbPath) && !force) {
    throw new Error(`Test database already exists: ${dbPath}\nRun npm run create:test-data -- --force to replace it.`);
  }

  if (force) {
    for (const file of [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      `${dbPath}-journal`,
      tempDbPath,
      `${tempDbPath}-wal`,
      `${tempDbPath}-shm`,
      `${tempDbPath}-journal`
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  } else if (fs.existsSync(tempDbPath)) {
    throw new Error(`Temporary test database already exists: ${tempDbPath}\nRun npm run create:test-data -- --force to replace it.`);
  }

  const db = new Database(tempDbPath);
  try {
    createSchema(db);
    seed(db);
  } finally {
    db.close();
  }

  fs.renameSync(tempDbPath, dbPath);

  fs.writeFileSync(
    path.join(dataDir, "README.md"),
    [
      "# 流梭 Flow Shuttle 测试数据目录",
      "",
      "这个目录用于本地开发和回归验证。它包含一个完整的 `flow-shuttle.sqlite`，可以通过应用 Settings 中的“使用已有数据目录”读取。",
      "",
      "使用方式：",
      "1. 打开流梭。",
      "2. 进入 Settings。",
      "3. 点击“使用已有数据目录”。",
      "4. 选择本目录。",
      "5. 测试完成后，再切回你的真实数据目录。",
      "",
      "注意：这是独立测试数据目录，不会自动写入你的真实 userData 数据库。"
    ].join("\n"),
    "utf8"
  );

  console.log(`Created test data directory: ${dataDir}`);
  console.log(`Database: ${dbPath}`);
}

try {
  main();
  if (process.versions.electron) {
    process.exit(0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
