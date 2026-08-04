# Flow Shuttle User Guide / 流梭使用指南

## 简体中文

### 1. 流梭是什么

流梭是一款本地优先的个人工作流转日记工具，帮助你把每天的工作接成线。

它不是团队项目管理工具，也不是普通 Todo List。它更适合个人知识工作者持续维护项目、工作项、完整内容和每日推进记录。

所有工作内容保存在你选择的本地数据目录中。除非你主动使用 AI 提炼，否则应用不会把工作内容发送给外部服务。

### 2. 核心概念

#### 项目与工作项

项目是工作内容的上层容器，例如一个产品、一个系统或一个长期任务。工作项是项目下需要持续推进的具体事情。

#### 工作项当前内容

工作项当前内容是一份持续编辑的完整稿。你可以每天在它的基础上继续修改，但它不会直接作为当天的日报正文。

#### 每日记录

每个工作项每天只有一份每日记录，主要包含：

- 今日变更摘要：今天实际新增、修改或推进的内容。
- 下一步计划：接下来准备做什么。
- 阻碍 / 需要帮助：当前卡点或需要协助的地方。

今日变更摘要会进入日报、周报和月报。以上字段和工作项当前内容的真实编辑痕迹，也会共同影响热力图。

#### 项目备忘录

项目备忘录是一份长期文档，适合保存业务口径、链接、截图、说明和注意事项，不必重复写进每天的记录。

#### 报告

流梭可以根据每日记录生成日报，并同步汇总周报和月报。规则版报告始终可用，AI 提炼版是独立的可选版本。

#### 热力图

热力图根据本地每日记录和真实编辑痕迹计算活跃度。它不截图、不监控桌面，也不记录专注时长。

### 3. 第一次使用

1. 在“项目”中创建一个项目。
2. 在项目下创建工作项；未完成工作项会出现在“今日工作页”。
3. 在今日工作页选择项目，再点击工作项进入编辑页。
4. 在“工作项当前内容”中维护完整稿。
5. 在“今日变更记录”中填写今日变更摘要、下一步计划或阻碍。
6. 选择今日状态并保存。
7. 下班前点击“结束今天工作”生成日报。

### 4. 使用今日工作页

#### 搜索和定位工作项

顶部搜索框可以按项目、工作项或进展内容查找记录。左侧项目列表用于切换当前项目，右侧展示该项目今天可记录的工作项。

#### 工作项状态与顶部星图

顶部星图代表今天仍可推进的工作项。新建或重新启用工作项后，星点会进入星图；工作项保存为“已完成”后，星点会离开。无论你从“项目”页还是工作项编辑页修改状态，今日工作页都会同步更新。

“进行中”和“暂停”的工作项仍保留在今日工作页。可显示的星点超过上限时，右上角会用“星星 +N”汇总其余数量，完整工作项仍可在下方列表中查看。

#### 已填写与阻碍标识

“已填写”表示当天已经保存了记录，并不等于没有阻碍。只要“阻碍 / 需要帮助”中有内容，工作项名称旁就会显示警示图标，方便在列表中快速识别。

#### 保存与结束今天工作

编辑器会定时保存有变更的非空内容，也可以使用页面上的保存按钮或 `Ctrl+S` 主动保存。

点击“结束今天工作”后，流梭会根据当天记录生成日报，并同步更新对应的周报和月报。这个动作不会删除本地数据，也不会上传工作内容。

应用保持运行时，如果当天还没有有效日报，23:00 会自动保存当前编辑并完成当日收口；如果已经有有效日报，自动任务会跳过，不会覆盖现有正文。

### 5. 使用工作项编辑页

#### 当前内容和今日变更摘要的区别

工作项当前内容是持续维护的完整稿；今日变更摘要是当天工作痕迹，适合进入报告。

如果你只修改了工作项当前内容而没有填写今日变更摘要，日报不会把完整稿当作今天的工作量，但热力图仍可以识别当天发生过真实编辑。

#### 上一工作日参考

左侧“上一工作日参考”会展示最近一次记录的当前内容、变更摘要、下一步计划和阻碍。需要复用内容时，可以直接复制原文；参考栏也可以收起，为编辑区留出更多空间。

#### 今日状态与编辑纸张

编辑页右上角可以选择“进行中”“已完成”或“暂停”。状态与正文会在保存后生效。

“编辑纸张”提供纯净、云岚、森语和夜航四种背景，只改变编辑画布的视觉，不改变内容和统计方式。

### 6. 生成、编辑与导出报告

#### 生成报告

在今日工作页点击“结束今天工作”会生成当日日报。生成或重新生成日报时，对应周报和月报会同步更新。

#### 编辑已生成的报告

日报、周报和月报都可以在“报告”页直接编辑。点击“编辑”后，可以保存、取消，或使用 `Ctrl+S` 保存；正文为空时不能保存。

编辑期间会暂时锁定报告切换；点击取消或带着未保存修改离开“报告”页时，会出现确认提示。复制 Markdown 和导出文件始终使用最近一次保存的完整正文。

注意：重新生成日报或同步周期报告时，手动修改过的规则版正文会被新生成内容覆盖。

#### AI 提炼版

周报和月报的规则版与 AI 提炼版分别保存，编辑其中一个不会直接改动另一个。再次执行 AI 提炼会覆盖已有的 AI 提炼版，应用会先请求确认。

### 7. 查看热力图

#### 月度概览

顶部显示本月记录天数，以及已生成日报、总记录字数、充分记录和最长连续记录四项指标。可以切换月份，也可以一键回到本月。

#### 星座日历

日历不再使用多套方块规则，而是用一套综合活跃度控制星座点亮程度。活跃度综合考虑内容深度、结构完整度、更新广度和日终收口。

每个日期都有基于日号生成的四点星座。记录越充分，点亮并连接的星点越多；已点亮的星点会以不同节奏轻微闪烁。底部图例从“少”到“多”展示五档状态。

#### 当天详情

点击日期后，右侧会显示当天更新的工作项数量、涉及项目、记录字数、完成和暂停数量，以及日报状态。当天已有日报时，可以直接打开查看。

### 8. 项目、备忘录与归档

“项目”页用于创建、编辑和管理项目及工作项，也可以快速记录进展。项目备忘录适合维护一份长期文档，并支持 Markdown 和粘贴图片。

归档项目后，它会从当前项目列表移到“归档”，历史内容不会被删除。取消归档后，项目会回到项目列表，其中未完成的工作项会重新出现在今日工作页。

### 9. 本地数据与迁移

工作记录保存在本地 SQLite 数据库中，粘贴到编辑器或备忘录中的图片也保存在同一数据目录下。

换电脑或搬运数据时，请复制整个数据目录，而不只是 SQLite 文件，然后在另一台电脑的“设置 > 本地数据存储”中选择该目录。

### 10. 设置、AI 与版本更新

“设置”中可以切换外观和语言、管理本地数据目录、配置 AI，以及查看版本更新。

AI 报告提炼默认关闭。启用后，需要配置兼容 OpenAI 接口的服务和自己的 API Key。只有在你主动触发提炼时才会调用 AI；不启用 AI 也能正常使用本地规则报告。

流梭会在后台弱提示新版本，但不会自动下载或强制安装。你可以在“版本与更新”中主动检查、查看 Release 摘要和下载进度；下载完成后，只有点击“重启并安装”才会退出应用并安装。展开详情后，还可以打开 Release 页面或前往 GitHub 仓库点 Star。

### 11. 常见问题

#### 为什么我修改了工作项当前内容，但日报里没有出现？

日报使用今日变更摘要。工作项当前内容是完整稿，不会直接进入日报；真实编辑仍可能计入热力图。

#### 为什么工作项显示“已填写”，旁边还有警示图标？

“已填写”只表示当天记录已保存。警示图标表示阻碍字段不为空，两者可以同时出现。

#### 为什么手动修改的报告后来变回去了？

重新生成日报或同步周报、月报会覆盖规则版的手动修改。需要保留修改时，请避免再次生成该报告，并先导出或复制已保存版本。

#### 为什么工作项从顶部星图中消失了？

保存为“已完成”的工作项会离开当前星图，但项目和历史记录仍然保留。将它重新启用后，它会再次回到今日工作页和星图。

#### 我可以把数据同步到云端吗？

当前版本不提供云同步。你可以手动复制完整数据目录到另一台电脑继续使用。

## English

### 1. What Is Flow Shuttle

Flow Shuttle is a local-first personal work progress journal. It helps you connect each day of work into a continuous thread.

It is not a team project management system or a plain todo list. It is designed for individual knowledge workers who continuously maintain projects, work items, full drafts, and daily progress records.

All work content is stored in the local data directory you choose. Unless you actively use AI refinement, the app does not send your work content to an external service.

### 2. Core Concepts

#### Projects and Work Items

A project is the top-level container for a body of work, such as a product, system, or long-running task. A work item is a concrete piece of work under a project that may be advanced over multiple days.

#### Work Item Current Content

Work Item Current Content is a living full draft. You can keep editing it from day to day, but it is not used directly as the daily report body.

#### Daily Record

Each work item has one daily record per day. Its main fields are:

- Today’s Change Summary: what was actually added, changed, or moved forward today.
- Next Step: what you plan to do next.
- Blocker / Help Needed: current blockers or help you need.

Today’s Change Summary is used in daily, weekly, and monthly reports. These fields and real edits to current content also contribute to the heatmap.

#### Project Memo

A Project Memo is a long-lived document for rules, links, screenshots, notes, and context that should not need to be repeated in every daily record.

#### Reports

Flow Shuttle generates daily reports from daily records and keeps weekly and monthly summaries in sync. Rule-based reports are always available; AI-refined reports are separate optional versions.

#### Heatmap

The heatmap calculates activity from local daily records and real editing traces. It does not take screenshots, monitor your desktop, or track focus time.

### 3. First-Time Use

1. Create a project from Projects.
2. Create work items under the project; open work items appear on Today.
3. Select a project on Today, then click a work item to open the editor.
4. Maintain the full draft in Work Item Current Content.
5. Fill in Today’s Change Summary, Next Step, or Blocker under Today’s Changes.
6. Choose today’s status and save.
7. Click Finish Today’s Work before you leave to generate the daily report.

### 4. Using Today

#### Search and Find Work

Use the top search box to find projects, work items, or progress content. The project list on the left changes the active project; the panel on the right shows its work items available for today.

#### Work Item Status and the Top Star Map

The top star map represents work items that can still be advanced today. A newly created or reactivated work item enters the map; a work item saved as Done leaves it. Today stays in sync whether the status was changed from Projects or from the work item editor.

In Progress and Paused items remain on Today. When there are more stars than the map can show, the upper-right “star +N” indicator summarizes the rest; every work item remains available in the list below.

#### Filled State and Blocker Indicator

Filled means a daily record has been saved; it does not mean the item has no blocker. If Blocker / Help Needed contains text, a warning icon appears beside the work item name so it can be spotted in the list.

#### Saving and Finishing the Day

The editor periodically saves changed, non-empty content. You can also use the Save button or press `Ctrl+S` to save immediately.

Finish Today’s Work generates the daily report and updates the related weekly and monthly reports. It does not delete local data or upload your work content.

While the app remains open, Flow Shuttle automatically saves the current editor and closes the day at 23:00 if no valid daily report exists. If a valid report is already present, the automatic task skips the day and does not overwrite the report body.

### 5. Using the Work Item Editor

#### Current Content vs Today’s Change Summary

Work Item Current Content is the continuously maintained full draft. Today’s Change Summary is the day-level work trace intended for reports.

If you only edit current content without filling in Today’s Change Summary, the daily report does not treat the full draft as today’s report content. The heatmap can still detect that real editing happened that day.

#### Previous Workday Reference

Previous Workday Reference shows the most recent current content, change summary, next step, and blocker. You can copy the original text when it is useful, or collapse the reference rail to give the editor more space.

#### Today’s Status and Editor Paper

Use the control in the upper-right to choose In Progress, Done, or Paused. The status and content take effect after saving.

Editor Paper offers Clean, Cloud Mist, Forest Whisper, and Night Voyage backgrounds. It only changes the editing canvas appearance; it does not change content or statistics.

### 6. Generating, Editing, and Exporting Reports

#### Generate Reports

Finish Today’s Work creates the daily report. Generating or regenerating a daily report also updates the related weekly and monthly reports.

#### Edit Generated Reports

Daily, weekly, and monthly reports can all be edited directly from Reports. After selecting Edit, use Save, Cancel, or `Ctrl+S`; an empty report body cannot be saved.

Report switching is temporarily locked while editing. Canceling or leaving Reports with unsaved changes prompts you for confirmation. Copy Markdown and exported files always use the complete, most recently saved body.

Note: regenerating a daily report or syncing a period report overwrites manual edits to its rule-based body.

#### AI-Refined Versions

The rule-based and AI-refined versions of weekly and monthly reports are stored separately. Editing one does not directly change the other. Running AI refinement again replaces the existing AI-refined version after confirmation.

### 7. Reading the Heatmap

#### Monthly Overview

The top area shows recorded days as the primary metric, followed by generated daily reports, total recorded characters, sufficient-record days, and the longest recording streak. You can browse other months or jump back to the current month.

#### Constellation Calendar

The calendar uses one combined activity model instead of separate block rules. Activity combines content depth, structural completeness, update breadth, and day closeout.

Each date has a four-point constellation generated from its day number. More complete records light and connect more stars, and active stars shimmer at slightly different rhythms. The legend shows five levels from Less to More.

#### Day Details

Select a date to see updated work items, involved projects, recorded characters, completed and paused counts, and report status. If a daily report exists, you can open it directly.

### 8. Projects, Memos, and Archive

Use Projects to create and manage projects and work items, or to save quick progress. A Project Memo is a long-lived Markdown document and supports pasted images.

Archiving moves a project out of the current project list and into Archive without deleting its history. Unarchiving returns it to Projects, and its unfinished work items reappear on Today.

### 9. Local Data and Migration

Work records are stored in a local SQLite database. Images pasted into an editor or Project Memo are stored in the same data directory.

When moving to another computer, copy the entire data directory rather than only the SQLite file, then select that directory from Settings > Local Data Storage on the other computer.

### 10. Settings, AI, and Updates

Settings lets you change appearance and language, manage the local data directory, configure AI, and view version updates.

AI report refinement is disabled by default. To enable it, configure an OpenAI-compatible service with your own API key. AI is only called when you actively trigger refinement; rule-based local reports continue to work without AI.

Flow Shuttle can show a background, low-pressure update hint but does not download or force-install updates automatically. From Version & Update, you can check manually and view the Release summary or download progress. After a download, the app only exits and installs when you choose Restart and Install. Expand Details to open the Release page or visit the GitHub repository to leave a star.

### 11. FAQ

#### Why did I edit current content but not see it in the daily report?

Daily reports use Today’s Change Summary. Current content is the full draft and is not inserted directly into the daily report, although real edits can still contribute to the heatmap.

#### Why does an item say Filled and still show a warning icon?

Filled only means the daily record was saved. The warning icon means the blocker field is not empty, so both can appear at the same time.

#### Why did my manual report edits disappear later?

Regenerating a daily report or syncing a weekly or monthly report replaces manual edits to the rule-based version. To preserve a revision, avoid regenerating that report and export or copy the saved version first.

#### Why did a work item disappear from the top star map?

Items saved as Done leave the current map, but the project and its history remain. Reactivate the item to return it to Today and the map.

#### Can I sync data to the cloud?

The current version does not provide cloud sync. You can manually copy the complete data directory to another computer.
