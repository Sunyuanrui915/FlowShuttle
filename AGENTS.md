# Flow Shuttle Development Guidelines

Flow Shuttle / 流梭 is a local-first desktop app. Make incremental, focused changes and keep user data safe.

## Read First

Before doing any work, read:

1. This `AGENTS.md`
2. `LOOPS.md` if it exists in the project root
3. The task-related source, docs, or design files
4. The current `git status` and relevant `git diff`

If `LOOPS.md` is present, follow it for non-trivial tasks. If `LOOPS.md` is not present, follow the Default Execution Loop in this file.

Do not rely only on memory. Always re-read current project files before changing anything.

## Default Execution Loop

1. Read the current state.
2. Restate the task contract, including done criteria and out-of-scope work.
3. Make a minimal plan.
4. Change only necessary files.
5. Verify with available commands or clear manual checks.
6. Read logs, traces, and diffs when something fails.
7. Repair only when the cause is clear.
8. Stop and report if the contract is unclear or risk is too high.
9. End non-trivial tasks with a Loop Report.

## Project Context

Flow Shuttle / 流梭 is a local-first Electron desktop app for personal work progress journaling. It uses React, TypeScript, SQLite, `electron-vite`, `electron-builder`, NSIS, and GitHub Releases.

Core areas include:

- Today: daily work page where each work item has one editable daily block.
- Reports: daily, weekly, and monthly reports generated from local records.
- Heatmap: activity calendar based on real recorded work items.
- Projects: project lists, project detail pages, project timelines, and project notes.
- Settings: appearance, language, data directory, version, and update settings.
- AI assistance: user-owned API key for summaries and report assistance.
- Auto update: weak update notification based on electron-builder / electron-updater / GitHub Releases / NSIS.

## Must Preserve

- Keep Flow Shuttle local-first. Do not upload user work data by default.
- Keep user data safe. Be extremely careful with save logic, data directory behavior, migrations, and report generation.
- Keep AI features based on user-owned API keys unless a task explicitly says otherwise.
- Markdown report/export content must remain complete and must not be truncated.
- When changing UI text, update or check i18n entries.
- Do not change SQLite schema, migrations, IPC, preload, main process, save logic, report generation, or data directory behavior unless the task explicitly asks for it.
- Do not rewrite unrelated code or reorganize core directories for cleanup.
- Do not introduce new dependencies unless necessary and explained.
- Do not change license, release, or auto-update behavior unless the task explicitly asks for it.

## Protected Areas

Do not change these areas unless the current task explicitly requires it:

- SQLite schema and migrations
- IPC contracts and preload bridge
- Main process startup, security, and window behavior
- Save logic and data directory behavior
- Report generation and Markdown export
- Attachments and user data paths
- Auto-update release behavior

If a task touches these areas, read the related code and logs first, make the smallest safe change, and run the strongest available checks.

## Auto Update Constraints

When touching auto-update behavior, preserve the weak prompt flow:

- Use electron-builder / electron-updater / GitHub Releases / NSIS.
- Keep `autoDownload=false`.
- Keep `autoInstallOnAppQuit=false`.
- Skip real update checks in development.
- In packaged builds, check in the background after startup delay.
- The sidebar/bottom version area should only provide weak status hints.
- Download and restart/install actions should stay in Settings > Version & Update.
- Do not force download or force install updates.

## Working Rules

- Make incremental changes only.
- Do not rewrite unrelated code.
- Do not introduce new dependencies unless necessary and explained.
- Keep user data local-first.
- When changing UI text, check i18n entries.
- Markdown export must remain complete and must not be truncated.
- Before committing, run typecheck/build commands if available.
- For documentation-only tasks, do not modify business code, config, dependencies, lock files, or data files.
- Keep `LOOPS.md` as an optional local workflow file. Do not add it to version control unless the project owner explicitly asks.
- If current diffs include unrelated work, leave it alone and mention it in the report.

## Common Checks

Use the commands that exist in this repository. Do not invent commands.

- `npm run typecheck`
- `npm run build`
- `npm run dist:win`
- `npm run dist`
- `npm run dist:dir`
- `npm run dev`
- `npm run create:test-data` - development/debugging only; generates local test data.

There is no dedicated lint or test script in `package.json` at the time of writing. If a command is unavailable in the local shell, run the equivalent underlying project command and explain that in the Loop Report.

## Loop Report

Every non-trivial task must end with:

- What changed
- Files changed
- Checks run
- Result
- Remaining risks
- Next bottleneck

## 中文说明

- 流梭是本地优先桌面应用，默认不上传用户工作内容。
- 任何任务开始前先读本文件；如果根目录存在 `LOOPS.md`，则优先读取并遵守。
- 非简单任务必须按 loop 执行；没有 `LOOPS.md` 时按本文件内置 Default Execution Loop 执行，不能只凭上下文记忆直接大改。
- 修改要小步、可验证，不要为了整理而重构核心业务目录。
- 涉及数据库、数据目录、保存逻辑、导出逻辑、自动更新逻辑时必须格外谨慎。
