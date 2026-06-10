# Flow Shuttle User Guide / 流梭使用指南

## 简体中文

### 1. 流梭是什么

流梭是一款本地优先的个人工作流转日记工具，帮助你把每天的工作接成线。

它不是团队项目管理工具，也不是普通 Todo List。它更适合个人知识工作者记录跨天推进的项目、工作项、当前内容和每日变更。

### 2. 核心概念

项目是工作内容的上层容器，例如一个产品、一个系统、一个长期任务。

工作项是项目下需要持续推进的具体事情。

工作项当前内容是一份持续编辑的完整稿。你可以每天在它的基础上继续修改。它不会直接计入日报。

今日变更摘要只记录今天真实新增、修改或推进的内容。它会进入日报、周报、月报和工作统计。

项目备忘录用于保存长期信息，例如业务口径、链接、截图、说明和注意事项。

流梭可以根据每日记录生成日报、周报和月报。

热力图基于每日工作记录和真实编辑痕迹生成，不截图、不监控、不做专注计时。

### 3. 第一次使用

1. 创建一个项目。
2. 在项目下创建工作项。
3. 打开今日工作页。
4. 点击工作项进入今日记录编辑页。
5. 在“工作项当前内容”中维护完整内容。
6. 在“今日变更摘要”中写下今天真实推进。
7. 点击“结束今天工作”生成日报。

### 4. 当前内容和今日变更摘要

工作项当前内容是完整稿，适合持续编辑。

今日变更摘要是当天工作痕迹，适合进入日报和统计。

如果你只修改了工作项当前内容，但没有填写今日变更摘要，日报不会把完整稿当成今天的工作量；热力图会根据当天是否发生实际编辑来体现活跃度。

### 5. 数据与 AI

流梭的数据保存在本地数据目录中。如果要换电脑使用，请复制整个数据目录，而不只是 SQLite 文件。粘贴到内容中的图片也保存在数据目录中。

AI 提炼默认关闭。你可以在 Settings 中配置兼容 OpenAI 接口的 AI 服务。AI 只在你主动点击提炼时调用，本地规则报告始终可用。

## English

### 1. What Is Flow Shuttle

Flow Shuttle is a local-first personal work progress journal. It helps you connect each day of work into a continuous thread.

It is not a team project management system and it is not a plain todo list. It is better suited for individual knowledge workers who need to track projects, work items, current content, and daily changes across multiple days.

### 2. Core Concepts

A project is the top-level container for a body of work, such as a product, system, or long-running task.

A work item is a concrete piece of work under a project that may need to be advanced over multiple days.

Work item current content is a living full draft. You can keep editing it day by day. It does not directly enter daily reports.

Today’s change summary records what was actually added, changed, or advanced today. It is used by reports and activity statistics.

Project memos are for long-term context such as rules, links, screenshots, notes, and details that should stay with a project.

Flow Shuttle can generate daily, weekly, and monthly reports from daily records.

The heatmap is based on daily work records and real editing traces. It does not take screenshots, monitor your desktop, or track focus time.

### 3. First-Time Use

1. Create a project.
2. Create work items under that project.
3. Open the Today page.
4. Click a work item to open the daily record editor.
5. Maintain the full draft in Work Item Current Content.
6. Write today’s real progress in Today’s Change Summary.
7. Click Finish Today’s Work to generate the daily report.

### 4. Current Content And Today’s Change Summary

Work item current content is the full draft and is suitable for continuous editing.

Today’s change summary is the day-level work trace and is suitable for reports and statistics.

If you only edit work item current content without filling in today’s change summary, the daily report will not treat the full draft as today’s report content. The heatmap can still reflect that real editing happened that day.

### 5. Data And AI

Flow Shuttle stores data in the local data directory. To use the same data on another computer, copy the entire data directory, not only the SQLite file. Images pasted into content are also stored in the data directory.

AI refinement is disabled by default. You can configure an OpenAI-compatible AI service from Settings. AI is only called when you actively trigger refinement. Rule-based local reports remain available without AI.
