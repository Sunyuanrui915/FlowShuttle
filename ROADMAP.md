# Roadmap

[简体中文](#简体中文) | [English](#english)

## 简体中文

### 已发布

#### v0.1.4

当前公开版本。重点包含：

* 修复 Today 页面在没有今日变更摘要时的“摘要已填”状态识别问题；
* 修复上一工作日参考中换行内容被显示成分段的问题；
* 增加编辑器换行 / 分段操作提示；
* 优化图片右键菜单，选中图片时隐藏不适合图片场景的粘贴操作；
* 增加工作项编辑能力，支持修改标题、描述和状态；
* 优化部分 UI 显示细节；
* 继续保持本地优先、SQLite 存储、不强制登录、不上传工作内容的产品方向。

#### v0.1.3

重点包含：

* 修复 Settings 中 Release 说明显示原始 HTML 标签的问题；
* 修复上一工作日参考 / 上一快照中的 Markdown 换行和 attachment 图片显示问题；
* 修复「保存本项」后 Today 总览摘要状态刷新不及时的问题；
* 更新 Windows 安装包与 Release 文档；
* 继续保持本地优先、SQLite 存储、不强制登录、不上传工作内容的产品方向。

#### v0.1.2

重点包含：

* 修复新建项目弹窗中的输入焦点问题；
* 修复 Markdown 编辑器中图片相邻文本和任务列表切换的光标问题；
* 新增应用内使用指南，并在 Today 空状态和 Settings 中提供入口；
* 修正热力图统计口径，使工作项当前内容的实际编辑也能体现活跃度；
* 更新 Windows 安装包与 Release 文档；
* 继续保持本地优先、SQLite 存储、不强制登录、不上传工作内容的产品方向。

#### v0.1.1

重点包含：

* 优化编辑与记录体验；
* 优化界面细节和默认主题；
* 完善 Windows 安装包和应用图标；
* 增加版本与更新入口；
* 补充 README、Release Notes、截图和公开发布说明；
* 发布 Windows 安装包；
* 保留本地优先、SQLite 存储、不强制登录、不上传工作内容的产品方向。

#### v0.1.0

首个公开发布版本，完成基础能力：

* 项目与工作项管理；
* Today 每日记录；
* 日报 / 周报 / 月报生成；
* 项目时间线；
* 工作活跃度热力图；
* Markdown 导出；
* 本地 SQLite 存储；
* Windows 安装包；
* 自动更新框架预留。

### 近期计划

#### v0.1.x

* 收集第一批用户反馈；
* 修复安装、启动、更新检查、数据目录等基础体验问题；
* 优化 README、官网说明、使用指南和故障排查；
* 完善 Issue 模板和反馈流程；
* 在仓库公开后验证应用内检查更新能力；
* 优化 Today、项目详情、报告、热力图、设置等核心页面的细节体验；
* 继续验证自动更新流程。

### 后续方向

#### v0.2.x

* 根据真实使用反馈优化记录流程；
* 完善日报 / 周报 / 月报模板；
* 优化 AI 提炼体验；
* 增强数据备份、迁移和导出说明；
* 评估是否需要代码签名；
* 评估多平台安装包支持；
* 持续保持本地优先和个人工具定位。

### 不在近期计划中

* 团队协作；
* 云同步；
* 移动端 App；
* 企业后台管理；
* 上级查看进度；
* 强制登录；
* 默认上传工作内容。

## English

### Released

#### v0.1.4

Current public release. Highlights:

* Fixed Today summary-filled state detection when no valid change summary exists;
* Fixed line-break rendering in previous workday references;
* Added editor guidance for line breaks and paragraph breaks;
* Improved the image context menu by hiding paste actions that do not apply to selected images;
* Added work item editing for title, description, and status updates;
* Improved several UI display details;
* Continued the local-first direction with SQLite storage, no mandatory login, and no uploading of work content by default.

#### v0.1.3

Highlights:

* Fixed release notes being displayed as raw HTML in Settings;
* Fixed Markdown line breaks and attachment images not rendering correctly in previous workday references and previous snapshots;
* Fixed Today overview not refreshing saved change summary status after clicking Save Item;
* Updated the Windows installer and release documentation;
* Continued the local-first direction with SQLite storage, no mandatory login, and no uploading of work content by default.

#### v0.1.2

Highlights:

* Fixed a focus issue in the new project dialog;
* Fixed a cursor issue around images and task-list toggles in the Markdown editor;
* Added an in-app user guide with entry points from the Today empty state and Settings;
* Updated heatmap activity calculation so real edits to work item current content can contribute to activity;
* Updated the Windows installer and release documentation;
* Continued the local-first direction with SQLite storage, no mandatory login, and no uploading of work content by default.

#### v0.1.1

Highlights:

* Improved editing and daily recording experience;
* Improved UI details and default theme behavior;
* Completed Windows installer and application icon setup;
* Added version and update entry;
* Updated README, release notes, screenshots, and public release documentation;
* Released Windows installer;
* Continued the local-first direction with SQLite storage, no mandatory login, and no uploading of work content by default.

#### v0.1.0

First public release with core features:

* Project and work item management;
* Today daily records;
* Daily / weekly / monthly report generation;
* Project timeline;
* Work activity heatmap;
* Markdown export;
* Local SQLite storage;
* Windows installer;
* Update framework prepared.

### Near-term plans

#### v0.1.x

* Collect early user feedback;
* Fix issues around installation, startup, update checks, and data directory behavior;
* Improve README, website copy, user guide, and troubleshooting documentation;
* Improve issue templates and feedback flow;
* Verify in-app update checks after the repository becomes public;
* Refine Today, project detail, reports, heatmap, and settings pages;
* Continue validating the update workflow.

### Future direction

#### v0.2.x

* Improve the recording workflow based on real usage feedback;
* Improve daily / weekly / monthly report templates;
* Improve AI summarization experience;
* Improve data backup, migration, and export guidance;
* Evaluate code signing;
* Evaluate multi-platform installer support;
* Continue keeping Flow Shuttle local-first and personal-tool oriented.

### Not in near-term scope

* Team collaboration;
* Cloud sync;
* Mobile app;
* Enterprise admin console;
* Manager progress tracking;
* Mandatory login;
* Uploading work content by default.
