# Flow Shuttle User Guide

## 1. What Is Flow Shuttle

Flow Shuttle is a local-first personal work progress journal. It helps you connect each day of work into a continuous thread.

It is not a team project management system and it is not a plain todo list. It is better suited for individual knowledge workers who need to track projects, work items, current content, and daily changes across multiple days.

## 2. Core Concepts

### Project

A project is the top-level container for a body of work, such as a product, system, or long-running task.

### Work Item

A work item is a concrete piece of work under a project that may need to be advanced over multiple days.

### Work Item Current Content

Work item current content is a living full draft. You can keep editing it day by day. It does not directly enter daily reports.

### Today’s Change Summary

Today’s change summary records what was actually added, changed, or advanced today. It is used by daily reports, weekly reports, monthly reports, and activity statistics.

### Project Memo

Project memos are for long-term context such as rules, links, screenshots, notes, and details that should stay with a project.

### Reports

Flow Shuttle can generate daily, weekly, and monthly reports from daily records.

### Heatmap

The heatmap is based on daily work records and real editing traces. It does not take screenshots, monitor your desktop, or track focus time.

## 3. First-Time Use

1. Create a project.
2. Create work items under that project.
3. Open the Today page.
4. Click a work item to open the daily record editor.
5. Maintain the full draft in Work Item Current Content.
6. Write today’s real progress in Today’s Change Summary.
7. Click Finish Today’s Work to generate the daily report.

## 4. Current Content vs Today’s Change Summary

Work item current content is the full draft and is suitable for continuous editing.

Today’s change summary is the day-level work trace and is suitable for reports and statistics.

If you only edit work item current content without filling in today’s change summary, the daily report will not treat the full draft as today’s report content. The heatmap can still reflect that real editing happened that day.

## 5. How To Generate Reports

After you click Finish Today’s Work on the Today page, Flow Shuttle generates the daily report for that day.

When a daily report is generated or regenerated, the related weekly and monthly reports are updated as well.

## 6. How To Read The Heatmap

Open Heatmap from the sidebar to view work activity across the current month.

Activity comes from daily records and editing traces, not desktop screenshots or background monitoring.

## 7. Moving Data Between Computers

Flow Shuttle stores data in the local data directory.

To use the same data on another computer, copy the entire data directory and then select that directory from Settings on the other computer.

Note:

Copy the whole data directory, not only the SQLite file. Images pasted into content are also stored in the data directory.

## 8. Using AI Refinement

AI refinement is disabled by default.

You can configure an OpenAI-compatible AI service from Settings.

AI is only called when you actively trigger refinement. Rule-based local reports remain available without AI.

## 9. FAQ

### Why did I edit work item current content but not see it in the daily report?

Daily reports use today’s change summary. Work item current content is a full draft and is not directly included in the daily report.

### Can I sync data to the cloud?

The current version does not provide cloud sync. You can manually copy the data directory to another computer and continue there.
