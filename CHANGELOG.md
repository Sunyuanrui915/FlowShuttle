# Changelog

## v0.4.4 - 2026-09-19

### Added

* 编辑框内新增查找与替换。通过工具栏搜索按钮或 `Ctrl+F` 查找，支持匹配高亮、数量、前后跳转和区分大小写；`Ctrl+H` 展开替换，可替换当前项或全部匹配，全部替换支持一次撤销。
* Added in-editor find and replace through the toolbar search button or `Ctrl+F`, with match highlighting, counts, navigation, and case sensitivity. `Ctrl+H` opens replacement controls for one match or all matches, and Replace all can be undone in one step.

### Improved

* 工具栏随编辑区宽度自动展开或收纳。窗口缩小或参考栏展开时，放不下的格式工具进入带图标、文字和快捷键提示的“更多”下拉菜单，搜索与 AI 润色入口保持可见。
* The toolbar now adapts to the editor's width. Narrowing the window or opening the reference panel moves overflow formatting tools into a More dropdown with icons, labels, and shortcut hints, while Search and AI Polish remain visible.

## v0.4.3 - 2026-08-30

### Improved

* 统一编辑器的换行与分段逻辑。`Enter` 与 `Shift+Enter` 在正文、标题、引用和列表中保持一致，多行内容粘贴时能够保留原有段落和空行，保存重开后结构保持稳定。
* Unified editor paragraph and line-break behavior. `Enter` and `Shift+Enter` now behave consistently across body text, headings, quotes, and lists; pasted multi-line content preserves its paragraphs and blank lines, including after saving and reopening.
* 优化多段内容的识别与批量格式处理。选中多段正文、标题、引用或列表后，可以统一设置文字高亮、列表或代码块等格式；删除空列表项、转换格式或撤销后，内容结构和行间距保持一致。
* Improved multi-block recognition and batch formatting across body text, headings, quotes, and lists. Highlighting, list formatting, code-block conversion, empty-item deletion, and undo now preserve document structure and spacing more consistently.

## v0.4.2 - 2026-08-23

### Fixed

* 修复系统托盘右键菜单弹出时的闪烁，并优化菜单显示与关闭行为。
* Fixed visible flashing when opening the system-tray right-click menu and refined its display and dismissal behavior.

### Improved

* 图片大图预览在放大后支持拖动查看，可完整浏览图片边缘内容。
* Zoomed full-image previews can now be dragged so edge content remains reachable.

## v0.4.1 - 2026-08-16

### Added

* 新增 Windows 系统托盘常驻。关闭主窗口后流梭继续在后台运行；点击托盘图标可重新打开，右键可退出流梭，菜单适配 Windows 深浅色主题。
* Added Windows system-tray support. Closing the main window now keeps Flow Shuttle running in the background; click the tray icon to restore it or right-click to quit, with light and dark Windows tray appearances.
* 编辑器图片支持双击进入大图预览，并可切换上一张或下一张、使用滚轮或按钮缩放、旋转、适应窗口、复制和下载。
* Added full image preview from the editor, with previous/next navigation, wheel and button zoom, rotation, fit-to-window, copy, and download actions.

### Improved

* Today 页现在会显示暂时没有工作项的进行中项目，仍可直接进入项目备忘录记录长期内容。
* Today now includes active projects that do not yet have work items, keeping their project memos directly accessible.
* 调整项目备忘录编辑工具栏，常用格式操作更直接，AI 润色入口固定在工具栏右侧。
* Refined the project-memo toolbar so common formatting actions are more direct and AI Polish remains aligned at the right edge.

## v0.4.0 - 2026-08-13

### Added

* 编辑器新增段落层级下拉菜单，可在正文与 H1-H6 标题之间切换。
* Added a paragraph-level dropdown for switching between body text and H1-H6 headings.
* 新增三级有序列表和无序列表。列表项支持通过工具栏或 `Tab` / `Shift+Tab` 增加、减少缩进，最多嵌套三级。
* Added ordered and unordered lists with up to three nesting levels. Use the toolbar or `Tab` / `Shift+Tab` to increase or decrease list indentation.
* 点击有序列表编号可选择“继续之前的编号”“开始新列表”或“修改编号值”；数字、英文字母和罗马数字层级均支持这些操作。
* Added marker actions for ordered lists: Continue Previous Numbering, Start New List, and Change Number Value. These actions work at decimal, alphabetic, and Roman numeral levels.
* 新增下划线、文字颜色和高亮颜色，并补全粗体、斜体、删除线等常用文字格式入口。
* Added underline, text color, and highlight color, together with complete toolbar access to bold, italic, and strikethrough.
* “更多”菜单新增格式刷和清除格式；格式刷采用一次性应用方式，避免误改后续内容。
* Added a one-shot Format Painter and Clear Formatting command to the More menu.
* 编辑器右下角新增实时字数显示。
* Added a live character count in the lower-right corner of the editor.
* 图片选中后可拖动控制点调整显示大小，并可选择无边框、浅边框、深边框、投影或画框样式。
* Selected images can now be resized with drag handles and displayed with no border, a light border, a dark border, a shadow, or a frame.
* 设置页在“关于流梭”下方新增独立反馈入口。反馈支持填写最多 2000 字的内容、选填联系邮箱，以及粘贴、拖拽或选择最多 5 张截图。
* Added a dedicated Feedback entry below About Flow Shuttle in Settings. Feedback supports up to 2,000 characters, an optional contact email, and up to five screenshots added by paste, drag-and-drop, or file selection.

### Improved

* 重新设计编辑器工具栏的图标、分组与间距，提升常用操作的识别度并减少横向占用。
* Redesigned editor toolbar icons, grouping, and spacing to improve recognition while using less horizontal space.

## v0.3.3 - 2026-08-09

### Fixed

* 修复 Today 页面 `Ctrl+F` 无法聚焦搜索框的问题。
* Fixed `Ctrl+F` not focusing the Today search field.

### Improved

* 在可编辑的富文本编辑器中加入按需开启的“AI 润色”：选中文字后即可直接润色并查看实时生成进度；结果生成后可预览、确认替换或取消，支持长文本和段落调整，原文不会被静默覆盖。
* Introduced opt-in AI Polish for editable rich-text editors. Select text to polish it with live generation progress, then preview, confirm replacement, or cancel. Long selections and paragraph adjustments are supported, and the original is never silently overwritten.
* 优化 AI 设置中“清除 Key”按钮的视觉样式。
* Refined the Clear Key control in AI settings.
* 加强 AI 服务配置、请求处理和图片附件操作的安全性与稳定性。
* Improved security and reliability around AI service configuration, request handling, and image attachments.

## v0.3.2 - 2026-08-05

### Fixed

* 修复工作项暂停、已填写与阻碍状态的联动问题，避免仅切换状态时误显示“已填写”或生成空的项目进展记录。
* Fixed coordination between Paused, Filled, and blocker states, preventing status-only changes from being treated as filled or creating empty timeline entries.

### Improved

* 优化今日工作页与报告页搜索：聚焦项目、工作项和完整进展内容，支持点击结果定位，并改进关键词高亮、结果列表与滚动展示。
* Refined search across Today and Reports with focused results, direct navigation, clearer keyword highlighting, and cleaner result-list scrolling.

## v0.3.1 - 2026-08-05

### Improved

* 优化数据目录选择逻辑：已有数据库时直接加载，没有数据库时创建空白数据库，不再自动迁移当前数据，并加强异常数据库文件的安全校验。
* Improved data directory selection: existing databases are loaded directly, blank databases are created when needed, current data is no longer migrated automatically, and invalid database files receive stronger safety checks.

## v0.3.0 - 2026-08-04

### Added

* 新增日报、周报和月报的应用内编辑与保存能力，并在离开未保存内容时进行确认。
* Added in-app editing and saving for daily, weekly, and monthly reports, with confirmation before leaving unsaved changes.
* 新增编辑器背景切换，以及设置页版本信息展开区域。
* Added editor backgrounds and an expandable version information section in Settings.

### Improved

* 全面更新 Today、项目、报告、热力图、归档与设置页面的视觉层级和多分辨率适配。
* Refreshed the visual hierarchy and multi-resolution layout across Today, Projects, Reports, Heatmap, Archive, and Settings.
* Today 页改用星座式工作项概览，并通过颜色、图标和动画区分已填写、阻碍与状态变化。
* Reworked the Today overview as a constellation with color, icon, and motion feedback for filled items, blockers, and status changes.
* 热力图改为统一的综合热度口径，通过星座图形和当天摘要呈现记录活跃程度。
* Unified heatmap activity into one composite scale with constellation graphics and a selected-day summary.
* 页签切换增加滑动反馈，状态选择菜单和常用提示样式同步优化。
* Added sliding feedback for tab changes and refined status menus and common prompts.
* 更新中英双语使用指南，使页面说明与当前界面和交互保持一致。
* Updated the bilingual user guide to match the current interface and interactions.

## v0.2.3 - 2026-07-30

### Fixed

* 修复上一工作日参考将 Markdown 内部段落误显示为多条分隔线，并在复制时产生多余空行的问题。
* Fixed previous workday references showing Markdown paragraphs as repeated separators and producing extra blank lines when copied.
* 修复项目归档后未显示在归档页面的问题。
* Fixed archived projects not appearing on the Archive page.

### Improved

* 归档项目详情的“更多操作”中新增“取消归档”，可将项目恢复到项目列表，并让未完成工作项重新出现在 Today 页。
* Added an Unarchive Project action to archived project details, restoring the project to Projects and its open work items to Today.
* 优化今日记录编辑页的工作项状态选择框，移除 hover / focus 时叠加的蓝色外框。
* Refined the work item status selector by removing the duplicated blue hover / focus ring.

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
