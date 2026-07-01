# Changelog

## Unreleased

* 暂无。

## v0.2.2 - 2026-07-01

### Fixed

* 修复今日记录编辑器和项目备忘录中，内部空行在保存并重新打开后可能被压缩或丢失的问题。
* Fixed an issue where internal blank lines in daily editors and project memos could be compressed or lost after saving and reopening.
* 修复设置页“版本与更新”直接展示完整 Release Notes、中文界面可能混入英文说明的问题。
* Fixed the Version & Updates card showing full Release Notes and potentially mixing English notes into Chinese UI.

### Improved

* 设置页“版本与更新”改为展示当前语言的一句更新摘要。
* The Version & Updates card now shows a one-sentence release summary in the current UI language.
* 设置页新增“关于流梭 / 作者与反馈”入口。
* Added an About Flow Shuttle / Author & Feedback entry in Settings.
* 移除 Settings 外观显示模式下方“当前选择 / 当前使用”的状态提示文字。
* Removed the extra current theme status text under the appearance selector in Settings.

## v0.2.1 - 2026-06-29

### Fixed

* 修复编辑器中回车后，新输入内容可能出现在输入区域下方不可见的问题。
* Fixed an issue where newly entered text after pressing Enter could become hidden below the editor area.
* 修复任务列表、有序列表、引用等工具栏操作可能错误作用于多行内容的问题。
* Fixed an issue where task lists, ordered lists, quotes, and related formatting commands could incorrectly affect multiple lines.
* 修复没有实际修改内容时，保存工作项仍可能在项目进展时间线新增记录的问题。
* Fixed an issue where saving a work item without real changes could still create a project timeline record.

### Improved

* 项目详情页中，进行中工作项和已完成工作项改为页签切换。
* Changed the project detail work item layout from side-by-side sections to tabs for active and completed work items.
* 修复工作项删除按钮超出卡片边界的问题。
* Fixed the delete button overflowing outside work item cards.
* 优化输入框默认提示文字颜色，降低对正文编辑的干扰。
* Lightened placeholder text colors across inputs and editors.

## v0.2.0 - 2026-06-27

### Fixed

* 修复只点击“保存本项”、但没有填写今日变更摘要时，总记录字数和热力图活跃值异常升高的问题。
* Fixed an issue where clicking “Save Item” without a valid change summary could incorrectly increase total text length and heatmap activity score.
* 修复上一工作日参考中换行和分段显示不一致的问题，减少次日回看时的阅读干扰。
* Fixed inconsistent line break and paragraph rendering in previous workday references.

### Improved

* 优化上一工作日参考、编辑器、搜索、单实例运行和 Today 返回体验。
* Improved previous workday references, editor behavior, search, single-instance behavior, and Today return navigation.
* 增加项目和工作项的手动顺序调整能力。
* Added manual ordering for projects and work items.

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
