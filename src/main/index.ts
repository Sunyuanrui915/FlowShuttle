import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  archiveProject,
  completeWorkItem,
  createProgress,
  createProject,
  createWorkItem,
  closeTodayJournal,
  deleteProject,
  deleteWorkItem,
  generateTodayMarkdown,
  generateDailyReport,
  getCurrentDataDirectory,
  getDailyJournal,
  getMonthlyHeatmap,
  getPreviousWorkDate,
  getProjectDeleteSummary,
  getProjectDetail,
  getWorkItemHistoryRecovery,
  getSettingsInfo,
  getTodayJournal,
  getTodayOverview,
  listActiveProjects,
  listDailyReports,
  listPeriodReports,
  listTodayProgress,
  migrateDatabaseToDirectory,
  prepareDataDirectoryForCopy,
  reloadDatabaseFromSettings,
  reopenDailyJournal,
  resolveAttachmentUrlToFilePath,
  restoreWorkItemHistoryToNote,
  saveDailyWorkItemAttachment,
  saveWorkItemNoteAttachment,
  saveProjectMemo,
  saveProjectMemoAttachment,
  search,
  getWorkItemDeleteSummary,
  getOrCreateProjectMemo,
  upsertDailyWorkItemEntry,
  updateProject,
  useExistingDatabaseDirectory,
  writeMarkdownFile
} from "./database";
import { clearAiApiKey, draftDailyChange, getAiSettings, refineAiReport, saveAiSettings, testAiConnection } from "./ai";
import { getLocalDateKey } from "./date";
import { applyThemeFromConfig, getThemePreference, loadConfig, setLanguagePreference, setThemePreference } from "./settings";
import type {
  AiRefineReportInput,
  AiDraftDailyChangeInput,
  AiSaveSettingsInput,
  CreateProgressInput,
  CreateProjectInput,
  CreateWorkItemInput,
  ExportMarkdownInput,
  LanguagePreference,
  PeriodReportType,
  ThemePreference,
  UpsertDailyWorkItemEntryInput,
  UpdateProjectInput,
  SaveMemoAttachmentInput,
  SaveDailyEntryAttachmentInput,
  SaveWorkItemNoteAttachmentInput,
  SaveProjectMemoInput,
  DailyAutoReportEvent
} from "../shared/types";

const appDisplayName = "Flow Shuttle";
const legacyUserDataDirectoryName = "Work Progress Journal";
const dailyAutoReportHour = 23;
const dailyAutoReportMinute = 0;
let dailyAutoReportTimer: ReturnType<typeof setTimeout> | null = null;

app.setName(appDisplayName);
app.setPath("userData", join(app.getPath("appData"), legacyUserDataDirectoryName));

function titleForLanguage(language: LanguagePreference): string {
  return language === "en" ? "Flow Shuttle" : "流梭";
}

function currentWindowTitle(): string {
  return titleForLanguage(loadConfig().language);
}

function nextDailyAutoReportRun(now = new Date()): Date {
  const nextRun = new Date(now);
  nextRun.setHours(dailyAutoReportHour, dailyAutoReportMinute, 0, 0);
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  return nextRun;
}

function sendDailyAutoReportEvent(event: DailyAutoReportEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("daily:auto-report-generated", event);
  }
}

function scheduleDailyAutoReport(now = new Date()): void {
  if (dailyAutoReportTimer) {
    clearTimeout(dailyAutoReportTimer);
  }

  const nextRun = nextDailyAutoReportRun(now);
  const journalDate = getLocalDateKey(nextRun);
  const delay = Math.max(0, nextRun.getTime() - now.getTime());

  dailyAutoReportTimer = setTimeout(() => {
    dailyAutoReportTimer = null;
    try {
      const payload = generateDailyReport(journalDate);
      sendDailyAutoReportEvent({ success: true, ...payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Daily auto report generation failed.";
      sendDailyAutoReportEvent({ success: false, date: journalDate, error: message });
      console.error(message);
    } finally {
      scheduleDailyAutoReport();
    }
  }, delay);
}

function clearDailyAutoReportSchedule(): void {
  if (dailyAutoReportTimer) {
    clearTimeout(dailyAutoReportTimer);
    dailyAutoReportTimer = null;
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "attachment",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

function notifySettingsChanged(): void {
  const settings = getSettingsInfo();
  for (const window of BrowserWindow.getAllWindows()) {
    window.setTitle(titleForLanguage(settings.language));
    window.webContents.send("settings:changed", settings);
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: currentWindowTitle(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#151922" : "#f6f8fb",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function hideApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}

function registerAttachmentProtocol(): void {
  protocol.handle("attachment", (request) => {
    const filePath = resolveAttachmentUrlToFilePath(request.url);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerIpc(): void {
  ipcMain.handle("projects:list-active", () => listActiveProjects());
  ipcMain.handle("projects:create", (_event, input: CreateProjectInput) => createProject(input));
  ipcMain.handle("projects:update", (_event, input: UpdateProjectInput) => updateProject(input));
  ipcMain.handle("projects:archive", (_event, id: string) => archiveProject(id));
  ipcMain.handle("projects:get-detail", (_event, id: string) => getProjectDetail(id));
  ipcMain.handle("projects:get-delete-summary", (_event, id: string) => getProjectDeleteSummary(id));
  ipcMain.handle("projects:delete", (_event, id: string) => deleteProject(id));

  ipcMain.handle("work-items:create", (_event, input: CreateWorkItemInput) =>
    createWorkItem(input)
  );
  ipcMain.handle("work-items:complete", (_event, id: string) => completeWorkItem(id));
  ipcMain.handle("work-items:get-delete-summary", (_event, id: string) => getWorkItemDeleteSummary(id));
  ipcMain.handle("work-items:delete", (_event, id: string) => deleteWorkItem(id));

  ipcMain.handle("progress:create", (_event, input: CreateProgressInput) => createProgress(input));
  ipcMain.handle("progress:list-today", () => listTodayProgress());

  ipcMain.handle("today:get-overview", () => getTodayOverview());
  ipcMain.handle("daily:get-today-journal", () => getTodayJournal());
  ipcMain.handle("daily:get-journal", (_event, date: string) => getDailyJournal(date));
  ipcMain.handle("daily:upsert-work-item-entry", (_event, input: UpsertDailyWorkItemEntryInput) =>
    upsertDailyWorkItemEntry(input)
  );
  ipcMain.handle("daily:save-attachment", (_event, input: SaveDailyEntryAttachmentInput) =>
    saveDailyWorkItemAttachment(input)
  );
  ipcMain.handle("daily:save-work-item-note-attachment", (_event, input: SaveWorkItemNoteAttachmentInput) =>
    saveWorkItemNoteAttachment(input)
  );
  ipcMain.handle("daily:close-today", () => closeTodayJournal());
  ipcMain.handle("daily:generate-report", (_event, date: string) => generateDailyReport(date));
  ipcMain.handle("daily:reopen-journal", (_event, date: string) => reopenDailyJournal(date));
  ipcMain.handle("daily:get-previous-work-date", (_event, date: string) => getPreviousWorkDate(date));
  ipcMain.handle("daily:get-work-item-history-recovery", (_event, workItemId: string) =>
    getWorkItemHistoryRecovery(workItemId)
  );
  ipcMain.handle("daily:restore-work-item-history", (_event, workItemId: string) =>
    restoreWorkItemHistoryToNote(workItemId)
  );
  ipcMain.handle("search:query", (_event, term: string) => search(term));
  ipcMain.handle("markdown:generate-today", () => generateTodayMarkdown());
  ipcMain.handle("markdown:export-today", async (_event, input: ExportMarkdownInput) => {
    const result = await dialog.showSaveDialog({
      title: "Export Markdown",
      defaultPath: input.fileName ?? `work-log-${input.date}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await writeMarkdownFile(input, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("memos:get-project-memo", (_event, projectId: string) => getOrCreateProjectMemo(projectId));
  ipcMain.handle("memos:save-project-memo", (_event, input: SaveProjectMemoInput) => saveProjectMemo(input));
  ipcMain.handle("memos:save-attachment", (_event, input: SaveMemoAttachmentInput) =>
    saveProjectMemoAttachment(input)
  );
  ipcMain.handle("reports:list-daily", () => listDailyReports());
  ipcMain.handle("reports:list-period", (_event, type: PeriodReportType) => listPeriodReports(type));
  ipcMain.handle("heatmap:get-monthly", (_event, year: number, month: number) => getMonthlyHeatmap(year, month));

  ipcMain.handle("settings:get", () => getSettingsInfo());
  ipcMain.handle("settings:set-theme", (_event, theme: ThemePreference) => {
    setThemePreference(theme);
    notifySettingsChanged();
    return getSettingsInfo();
  });
  ipcMain.handle("settings:set-language", (_event, language: LanguagePreference) => {
    setLanguagePreference(language);
    notifySettingsChanged();
    return getSettingsInfo();
  });
  ipcMain.handle("settings:open-data-directory", async () => {
    prepareDataDirectoryForCopy();
    const result = await shell.openPath(getCurrentDataDirectory());
    if (result) {
      throw new Error(result);
    }
  });
  ipcMain.handle("settings:prepare-data-directory-for-copy", () => {
    const result = prepareDataDirectoryForCopy();
    notifySettingsChanged();
    return result;
  });
  ipcMain.handle("settings:choose-and-migrate-data-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择数据目录",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const migration = await migrateDatabaseToDirectory(result.filePaths[0], async () => {
      const confirmation = await dialog.showMessageBox({
        type: "warning",
        buttons: ["继续", "取消"],
        defaultId: 1,
        cancelId: 1,
        title: "切换数据目录",
        message: "该目录中已存在流梭数据库。",
        detail:
          "继续后，应用将切换读取该目录中的数据，不会合并当前数据，也不会覆盖目标数据库。是否继续？"
      });
      return confirmation.response === 0;
    });
    notifySettingsChanged();
    return migration;
  });
  ipcMain.handle("settings:use-existing-data-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Use an existing data directory",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const migration = await useExistingDatabaseDirectory(result.filePaths[0]);
    notifySettingsChanged();
    return migration;
  });
  ipcMain.handle("settings:reload-data-directory", () => {
    const result = reloadDatabaseFromSettings();
    notifySettingsChanged();
    return result;
  });

  ipcMain.handle("ai:get-settings", () => getAiSettings());
  ipcMain.handle("ai:save-settings", (_event, input: AiSaveSettingsInput) => {
    const result = saveAiSettings(input);
    notifySettingsChanged();
    return result;
  });
  ipcMain.handle("ai:clear-api-key", () => {
    const result = clearAiApiKey();
    notifySettingsChanged();
    return result;
  });
  ipcMain.handle("ai:test-connection", () => testAiConnection());
  ipcMain.handle("ai:refine-report", (_event, input: AiRefineReportInput) => refineAiReport(input));
  ipcMain.handle("ai:draft-daily-change", (_event, input: AiDraftDailyChangeInput) => draftDailyChange(input));
}

app.whenReady().then(() => {
  applyThemeFromConfig();
  hideApplicationMenu();
  registerAttachmentProtocol();
  registerIpc();
  createWindow();
  scheduleDailyAutoReport();

  nativeTheme.on("updated", () => {
    if (getThemePreference() === "system") {
      notifySettingsChanged();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  clearDailyAutoReportSchedule();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
