# Changelog

## Unreleased

* 暂无。

## v0.1.4 - 2026-06-21

### Fixed

* 修复没有今日变更摘要记录时，Today 页面仍显示“摘要已填”的问题。
* Fixed an issue where the Today page could show a change summary as filled even when no valid summary existed.
* 修复换行保存后，第二天在上一工作日参考中显示成分段的问题。
* Fixed an issue where line breaks could be rendered as separate paragraphs in the previous workday reference.

### Improved

* 增加换行与分段操作区分提示，帮助用户理解编辑器中的换行行为。
* Added guidance to clarify line breaks and paragraph breaks in the editor.
* 优化图片右键菜单，选中图片时不再显示不适合图片场景的粘贴操作。
* Improved the image context menu by removing paste actions that do not apply to selected images.
* 增加工作项编辑能力，支持修改工作项标题、描述和状态。
* Added work item editing, including title, description, and status updates.
* 优化部分 UI 显示细节。
* Improved several UI display details.

## v0.1.3 - 2026-06-13

### Fixed

* 修复 Settings 中 Release 说明直接显示 HTML 标签的问题。
* Fixed release notes being displayed as raw HTML in Settings.
* 修复上一工作日参考 / 上一快照中 Markdown 换行和 attachment 图片显示异常的问题。
* Fixed Markdown line breaks and attachment images not rendering correctly in previous workday references and previous snapshots.
* 修复今日记录编辑页点击「保存本项」后，Today 总览仍显示摘要未填的问题。
* Fixed Today overview not recognizing saved change summaries after clicking Save Item.

### Documentation

* 补充 v0.1.3 Windows 安装包与 Release 文档。
* Added v0.1.3 Windows installer release notes.

## v0.1.2 - 2026-06-10

### Added

* 新增应用内使用指南，并在 Today 空状态和 Settings 中提供入口。
* Added an in-app user guide, available from the Today empty state and Settings.

### Fixed

* 修复新建项目时“项目简介”输入焦点被项目名称输入框抢回的问题。
* Fixed the project description field losing focus back to the project name field when creating a project.
* 修复 Markdown 编辑器中图片相邻文本位置使用任务列表工具后，光标和回车换行异常的问题。
* Fixed a Markdown editor cursor issue around images and task-list toggles.
* 修正热力图统计口径，使当天实际编辑过的工作项当前内容也能体现为活跃度。
* Updated heatmap activity calculation so real edits to work item current content can contribute to activity.

### Documentation

* 补充 v0.1.2 Windows 安装包与 Release 文档，并增加中英双语使用指南。
* Added v0.1.2 Windows installer release notes and bilingual user guide documentation.

## v0.1.1

* 升级今日记录与备忘录的 Markdown 编辑体验，支持更稳定的标题、列表、任务列表、引用、代码块和高亮块编辑。
* 补充编辑器右键菜单、剪贴板文本操作、图片粘贴、图片复制和另存能力。
* 优化今日记录编辑页顶部信息区，减少空白并改善保存状态与操作区布局。
* 修正热力图字数统计口径，将工作项当前内容纳入统计，使当日记录字数更接近实际输入内容。
* 更新 v0.1.1 Windows 安装包与 Release 文档。

## v0.1.0

待发布。
