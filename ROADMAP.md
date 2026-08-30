# Roadmap

[简体中文](#简体中文) | [English](#english)

最后更新 / Last updated: 2026-08-30

## 简体中文

### 当前阶段

流梭是一款本地优先的 Windows 桌面端个人工作进展日志工具。当前阶段继续围绕真实日常使用，优先完善记录、回看、编辑、报告和本地数据安全，不扩张为团队协作平台。

### 已发布

#### v0.4.3

- 统一编辑器的换行与分段逻辑，使 `Enter` 与 `Shift+Enter` 在正文、标题、引用和列表中保持一致。
- 保留多行粘贴内容中的段落和空行，并让空行在保存重开后保持稳定。
- 优化多段内容的识别与批量格式处理，覆盖文字高亮、列表和代码块等常用格式。
- 优化空列表项删除、连续列表归一和撤销行为，减少结构变化造成的行间距不一致。

#### v0.4.2

- 消除系统托盘右键菜单弹出时的可见闪烁，并优化菜单显示与关闭行为。
- 图片大图预览在放大后支持拖动查看，可完整浏览边缘内容。

#### v0.4.1

- 新增 Windows 系统托盘常驻，以及关闭窗口后的重新打开和退出能力。
- 编辑器图片支持完整大图预览、缩放、旋转、适应窗口、复制和下载。
- Today 页显示暂时没有工作项的进行中项目，仍可维护项目备忘录。
- 优化项目备忘录工具栏布局和图片查看体验。

#### v0.4.0

- 编辑器新增正文与 H1-H6、三级列表、编号控制、文字颜色、高亮颜色、格式刷和清除格式。
- 图片支持调整显示大小和切换边框、投影、画框等展示样式。
- 编辑器右下角新增实时字数显示。
- 设置页新增反馈入口，可提交文字、选填邮箱和最多 5 张截图。

更早版本的完整变化请查看 [CHANGELOG.md](./CHANGELOG.md)。

### 近期计划

- 持续根据真实记录场景优化编辑器、Today、项目备忘录和报告工作流。
- 完善日报、周报和月报模板，以及生成后编辑、回看和导出体验。
- 加强本地数据备份、迁移、恢复和导出说明，继续把用户数据安全放在首位。
- 持续验证自动更新、反馈通道和 Windows 安装体验的稳定性。
- 在用户主动触发、使用自有 API Key 和原文可恢复的边界内优化 AI 辅助能力。
- 继续按版本变化逐步补充脱敏后的最新产品截图。

### 中期评估

- 评估 Windows 代码签名的成本与收益。
- 评估 macOS 等其他桌面平台的安装包支持。
- 评估是否需要更明确的本地备份提醒和可恢复机制。

### 不在近期计划中

- 团队协作；
- 云同步；
- 移动端 App；
- 企业后台管理；
- 上级查看进度；
- 强制登录；
- 默认上传工作内容。

## English

### Current Stage

Flow Shuttle is a local-first Windows desktop journal for personal work progress. The current stage remains focused on real daily use: recording, review, editing, reports, and local data safety. It is not expanding into a team collaboration platform.

### Released

#### v0.4.3

- Unify editor paragraph and line-break behavior so `Enter` and `Shift+Enter` act consistently across body text, headings, quotes, and lists.
- Preserve paragraphs and blank lines in pasted multi-line content, including after saving and reopening.
- Improve multi-block recognition and batch formatting across highlights, lists, code blocks, and related formats.
- Refine empty-list-item deletion, adjacent-list normalization, and undo behavior to keep structure and spacing consistent.

#### v0.4.2

- Removed visible flashing from the system-tray right-click menu and refined its display and dismissal behavior.
- Added panning for zoomed full-image previews so edge content remains reachable.

#### v0.4.1

- Added Windows system-tray continuity, including restoring and quitting after the main window closes.
- Added full image preview with navigation, zoom, rotation, fit-to-window, copy, and download actions.
- Kept active projects without work items available on Today for project-memo updates.
- Refined the project-memo toolbar and image-viewing experience.

#### v0.4.0

- Added body text and H1-H6 formatting, three-level lists, numbering controls, text and highlight colors, Format Painter, and Clear Formatting.
- Added image resizing and border, shadow, and frame presentation styles.
- Added a live character count in the editor.
- Added explicit feedback submission with text, an optional email, and up to five screenshots.

See [CHANGELOG.md](./CHANGELOG.md) for the complete history of earlier releases.

### Near-Term Plans

- Continue refining the editor, Today, project memos, and report workflows based on real recording scenarios.
- Improve daily, weekly, and monthly report templates together with post-generation editing, review, and export.
- Strengthen local backup, migration, recovery, and export guidance while keeping user data safety first.
- Continue validating automatic updates, the feedback channel, and the Windows installation experience.
- Refine AI assistance only within user-triggered, user-keyed, and recoverable-original boundaries.
- Continue adding current sanitized product screenshots as the product evolves.

### Mid-Term Evaluation

- Evaluate the cost and benefit of Windows code signing.
- Evaluate installer support for macOS and other desktop platforms.
- Evaluate clearer local backup reminders and recovery mechanisms.

### Not in Near-Term Scope

- Team collaboration;
- Cloud sync;
- Mobile apps;
- Enterprise administration;
- Manager progress tracking;
- Mandatory login;
- Uploading work content by default.
