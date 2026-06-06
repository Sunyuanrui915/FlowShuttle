# Flow Shuttle Development Guidelines

Flow Shuttle is a local-first desktop app. Make incremental, focused changes and keep user data safe.

## General Rules

- Make incremental changes only.
- Do not rewrite unrelated code.
- Do not introduce new dependencies unless necessary and explained.
- Keep user data local-first.
- When changing UI text, check i18n entries.
- Markdown export must remain complete and must not be truncated.
- Before committing, run typecheck/build commands if available.

## Protected Areas

Do not change SQLite schema, migrations, IPC, preload, main process, save logic, report generation, or data directory behavior unless the task explicitly asks for it.

## 中文说明

- 流梭是本地优先桌面应用，默认不上传用户工作内容。
- 修改要小步、可验证，不要为了整理而重构核心业务目录。
- 涉及数据库、数据目录、保存逻辑、导出逻辑时必须格外谨慎。
