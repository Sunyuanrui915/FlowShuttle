# Flow Shuttle User Guide

## 1. What Is Flow Shuttle

Flow Shuttle is a local-first personal work progress journal. It helps you connect each day of work into a continuous thread.

It is not a team project management system or a plain todo list. It is designed for individual knowledge workers who continuously maintain projects, work items, full drafts, and daily progress records.

All work content is stored in the local data directory you choose. Unless you actively use AI refinement, the app does not send your work content to an external service.

## 2. Core Concepts

### Projects and Work Items

A project is the top-level container for a body of work, such as a product, system, or long-running task. A work item is a concrete piece of work under a project that may be advanced over multiple days.

### Work Item Current Content

Work Item Current Content is a living full draft. You can keep editing it from day to day, but it is not used directly as the daily report body.

### Daily Record

Each work item has one daily record per day. Its main fields are:

- Today’s Change Summary: what was actually added, changed, or moved forward today.
- Next Step: what you plan to do next.
- Blocker / Help Needed: current blockers or help you need.

Today’s Change Summary is used in daily, weekly, and monthly reports. These fields and real edits to current content also contribute to the heatmap.

### Project Memo

A Project Memo is a long-lived document for rules, links, screenshots, notes, and context that should not need to be repeated in every daily record.

### Reports

Flow Shuttle generates daily reports from daily records and keeps weekly and monthly summaries in sync. Rule-based reports are always available; AI-refined reports are separate optional versions.

### Heatmap

The heatmap calculates activity from local daily records and real editing traces. It does not take screenshots, monitor your desktop, or track focus time.

## 3. First-Time Use

1. Create a project from Projects.
2. Create work items under the project; open work items appear on Today.
3. Select a project on Today, then click a work item to open the editor.
4. Maintain the full draft in Work Item Current Content.
5. Fill in Today’s Change Summary, Next Step, or Blocker under Today’s Changes.
6. Choose today’s status and save.
7. Click Finish Today’s Work before you leave to generate the daily report.

## 4. Using Today

### Search and Find Work

Use the top search box to find projects, work items, or progress content. The project list on the left changes the active project; the panel on the right shows its work items available for today.

### Work Item Status and the Top Star Map

The top star map represents work items that can still be advanced today. A newly created or reactivated work item enters the map; a work item saved as Done leaves it. Today stays in sync whether the status was changed from Projects or from the work item editor.

In Progress and Paused items remain on Today. When there are more stars than the map can show, the upper-right “star +N” indicator summarizes the rest; every work item remains available in the list below.

### Filled State and Blocker Indicator

Filled means a daily record has been saved; it does not mean the item has no blocker. If Blocker / Help Needed contains text, a warning icon appears beside the work item name so it can be spotted in the list.

### Saving and Finishing the Day

The editor periodically saves changed, non-empty content. You can also use the Save button or press `Ctrl+S` to save immediately.

Finish Today’s Work generates the daily report and updates the related weekly and monthly reports. It does not delete local data or upload your work content.

While the app remains open, Flow Shuttle automatically saves the current editor and closes the day at 23:00 if no valid daily report exists. If a valid report is already present, the automatic task skips the day and does not overwrite the report body.

## 5. Using the Work Item Editor

### Current Content vs Today’s Change Summary

Work Item Current Content is the continuously maintained full draft. Today’s Change Summary is the day-level work trace intended for reports.

If you only edit current content without filling in Today’s Change Summary, the daily report does not treat the full draft as today’s report content. The heatmap can still detect that real editing happened that day.

### Previous Workday Reference

Previous Workday Reference shows the most recent current content, change summary, next step, and blocker. You can copy the original text when it is useful, or collapse the reference rail to give the editor more space.

### Today’s Status and Editor Paper

Use the control in the upper-right to choose In Progress, Done, or Paused. The status and content take effect after saving.

Editor Paper offers Clean, Cloud Mist, Forest Whisper, and Night Voyage backgrounds. It only changes the editing canvas appearance; it does not change content or statistics.

## 6. Generating, Editing, and Exporting Reports

### Generate Reports

Finish Today’s Work creates the daily report. Generating or regenerating a daily report also updates the related weekly and monthly reports.

### Edit Generated Reports

Daily, weekly, and monthly reports can all be edited directly from Reports. After selecting Edit, use Save, Cancel, or `Ctrl+S`; an empty report body cannot be saved.

Report switching is temporarily locked while editing. Canceling or leaving Reports with unsaved changes prompts you for confirmation. Copy Markdown and exported files always use the complete, most recently saved body.

Note: regenerating a daily report or syncing a period report overwrites manual edits to its rule-based body.

### AI-Refined Versions

The rule-based and AI-refined versions of weekly and monthly reports are stored separately. Editing one does not directly change the other. Running AI refinement again replaces the existing AI-refined version after confirmation.

## 7. Reading the Heatmap

### Monthly Overview

The top area shows recorded days as the primary metric, followed by generated daily reports, total recorded characters, sufficient-record days, and the longest recording streak. You can browse other months or jump back to the current month.

### Constellation Calendar

The calendar uses one combined activity model instead of separate block rules. Activity combines content depth, structural completeness, update breadth, and day closeout.

Each date has a four-point constellation generated from its day number. More complete records light and connect more stars, and active stars shimmer at slightly different rhythms. The legend shows five levels from Less to More.

### Day Details

Select a date to see updated work items, involved projects, recorded characters, completed and paused counts, and report status. If a daily report exists, you can open it directly.

## 8. Projects, Memos, and Archive

Use Projects to create and manage projects and work items, or to save quick progress. A Project Memo is a long-lived Markdown document and supports pasted images.

Archiving moves a project out of the current project list and into Archive without deleting its history. Unarchiving returns it to Projects, and its unfinished work items reappear on Today.

## 9. Local Data and Transfer

Work records are stored in a local SQLite database. Images pasted into an editor or Project Memo are stored in the same data directory.

When you choose a data directory, the app reads its existing Flow Shuttle database. If the directory does not contain one, the app creates a blank database.

When moving to another computer, copy the entire data directory rather than only the SQLite file, then select that directory from Settings > Local Data Storage on the other computer.

## 10. Settings, AI, and Updates

Settings lets you change appearance and language, manage the local data directory, configure AI, and view version updates.

AI report refinement is disabled by default. To enable it, configure an OpenAI-compatible service with your own API key. AI is only called when you actively trigger refinement; rule-based local reports continue to work without AI.

Flow Shuttle can show a background, low-pressure update hint but does not download or force-install updates automatically. From Version & Update, you can check manually and view the Release summary or download progress. After a download, the app only exits and installs when you choose Restart and Install. Expand Details to open the Release page or visit the GitHub repository to leave a star.

## 11. FAQ

### Why did I edit current content but not see it in the daily report?

Daily reports use Today’s Change Summary. Current content is the full draft and is not inserted directly into the daily report, although real edits can still contribute to the heatmap.

### Why does an item say Filled and still show a warning icon?

Filled only means the daily record was saved. The warning icon means the blocker field is not empty, so both can appear at the same time.

### Why did my manual report edits disappear later?

Regenerating a daily report or syncing a weekly or monthly report replaces manual edits to the rule-based version. To preserve a revision, avoid regenerating that report and export or copy the saved version first.

### Why did a work item disappear from the top star map?

Items saved as Done leave the current map, but the project and its history remain. Reactivate the item to return it to Today and the map.

### Can I sync data to the cloud?

The current version does not provide cloud sync. You can manually copy the complete data directory to another computer.
