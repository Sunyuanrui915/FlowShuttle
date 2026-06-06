# 流梭 Flow Shuttle

[简体中文](#简体中文) | [English](#english)

## 简体中文

### 流梭 Flow Shuttle 是什么

流梭是一个本地优先的个人工作进展日志工具。它用项目、工作项和每日记录，把零散的工作进展沉淀成可回顾、可导出的工作轨迹。

### 它解决什么问题

- 工作进展散落在聊天、文档和脑子里。
- 写日报、周报、月报时总要重新回忆。
- 项目推进过程缺少连续记录。
- 普通待办工具更关注任务完成，不适合沉淀真实工作过程。

### 核心功能

- 项目与工作项管理。
- Today 每日记录。
- 日报 / 周报 / 月报生成。
- 工作活跃度热力图。
- 项目时间线。
- Markdown 导出。
- 本地 SQLite 存储。
- 本地优先，不强制登录，不上传工作内容。

### 当前状态

流梭 Flow Shuttle 当前正在准备 `v0.1.0` 版本。核心功能和 UI 已基本稳定，当前仓库先保持私有，用于补齐 README、LICENSE、Roadmap、Release 准备和开源前安全检查。

公开后，普通用户可从 GitHub Releases 下载安装包；开发者可从源码运行和参与贡献。

### 安装与使用

当前仓库仍处于公开前整理阶段，暂不提供公开下载。

当前安装包仍处于私有测试阶段，不提供公开下载链接。

`v0.1.0` 发布后，普通用户请优先从 GitHub Releases 下载对应系统的安装包。如果只是日常使用流梭，不需要从源码运行项目。

### 本地开发

当前项目使用 Electron、React、TypeScript 和 SQLite。

本地开发只面向需要调试、验证问题或参与贡献的开发者。源码运行命令用于开发环境，不是普通用户的安装方式。

建议环境：

- Node.js 20 或更新版本。
- npm 10 或更新版本。

常用开发命令：

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run dist
```

开发辅助命令：

```bash
# 仅开发调试使用，用于生成本地测试数据。
npm run create:test-data
```

### 隐私与数据

流梭默认把数据保存在本地数据目录中，应用不强制登录，也不会主动上传用户工作内容。用户可以在应用设置中查看和迁移当前数据目录。

### Roadmap

近期计划：

* 完成 GitHub 私有仓库初始化
* 补齐 README / LICENSE / CONTRIBUTING / CHANGELOG / ROADMAP / AGENTS.md
* 完成开源前安全审查
* 准备 Windows 安装包
* 发布 `v0.1.0`
* 将仓库从 Private 切换为 Public
* 收集第一批用户反馈

### License

本项目代码采用 AGPL-3.0-only 开源。

普通用户下载安装、本地使用 Flow Shuttle，不需要公开个人数据。修改、分发或基于修改版提供网络服务时，需要遵守 AGPL-3.0 的源码开放要求。

## English

### What Is Flow Shuttle

Flow Shuttle is a local-first personal work progress journal. It organizes projects, work items, and daily records so scattered work updates can become a reviewable and exportable work history.

### What It Helps With

- Work progress is scattered across chats, documents, and memory.
- Daily, weekly, and monthly reports often require rebuilding context from scratch.
- Project progress is hard to review without a continuous record.
- Generic todo tools focus on completion, not the real process behind work.

### Core Features

- Project and work item management.
- Today view for daily work records.
- Daily, weekly, and monthly report generation.
- Work activity heatmap.
- Project timeline.
- Markdown export.
- Local SQLite storage.
- Local-first by default, with no required login and no forced upload of work content.

### Current Status

Flow Shuttle is currently preparing the `v0.1.0` release. Core features and UI are mostly stable, and the repository remains private while README, LICENSE, roadmap, release preparation, and pre-open-source safety checks are completed.

After the repository is public, regular users can download installers from GitHub Releases, and developers can run the project from source and contribute.

### Installation And Usage

This repository is still being prepared before public release, so public downloads are not available yet.

The current installer is still in private testing and does not provide a public download link.

After `v0.1.0` is released, regular users should prefer downloading the installer for their system from GitHub Releases. If you only use Flow Shuttle day to day, you do not need to run the project from source.

### Local Development

Flow Shuttle currently uses Electron, React, TypeScript, and SQLite.

Local development is intended for developers who need to debug, verify issues, or contribute. Source commands are for development environments, not the regular user installation path.

Recommended environment:

- Node.js 20 or newer.
- npm 10 or newer.

Common development commands:

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run dist
```

Development helper commands:

```bash
# Development/debugging only. Generates local test data.
npm run create:test-data
```

### Privacy And Data

Flow Shuttle stores data in a local data directory by default. The app does not require login and does not upload your work content. The current data directory can be viewed and migrated from the app settings.

### Roadmap

Near-term plan:

* Complete GitHub private repository initialization.
* Complete README / LICENSE / CONTRIBUTING / CHANGELOG / ROADMAP / AGENTS.md.
* Complete pre-open-source safety review.
* Prepare the Windows installer.
* Release `v0.1.0`.
* Switch the repository from Private to Public.
* Collect the first round of user feedback.

### License

AGPL-3.0-only.

End users can install and use Flow Shuttle locally without publishing personal data. If you modify, distribute, or provide a network service based on a modified version, you must follow the source availability requirements of AGPL-3.0.
