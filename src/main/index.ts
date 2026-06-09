import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
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
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getReleaseDetailsUrl,
  getUpdateStatus,
  initializeAutoUpdater,
  quitAndInstallAppUpdate,
  scheduleBackgroundUpdateCheck
} from "./updater";
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
  SaveAttachmentAsInput,
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
const userDataDirectoryName = "Flow Shuttle";
const appUserModelId = "app.flowshuttle";
const appIconRelativePath = join("assets", "icons", "flow-shuttle-icon.ico");
const releasesLatestUrl = "https://github.com/Sunyuanrui915/FlowShuttle/releases/latest";
const dailyAutoReportHour = 23;
const dailyAutoReportMinute = 0;
let dailyAutoReportTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindowRef: BrowserWindow | null = null;

app.setName(appDisplayName);
app.setPath("userData", join(app.getPath("appData"), userDataDirectoryName));
if (process.platform === "win32") {
  app.setAppUserModelId(appUserModelId);
}

function titleForLanguage(language: LanguagePreference): string {
  return language === "en" ? "Flow Shuttle" : "\u6d41\u68ad";
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

function resolveWindowIconPath(): string | undefined {
  const candidates = [join(process.resourcesPath, appIconRelativePath), join(app.getAppPath(), appIconRelativePath), join(process.cwd(), appIconRelativePath)];
  return candidates.find((candidate) => existsSync(candidate));
}

function createWindow(): void {
  const windowIconPath = resolveWindowIconPath();
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: currentWindowTitle(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#151922" : "#f6f8fb",
    autoHideMenuBar: true,
    show: false,
    ...(windowIconPath ? { icon: windowIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindowRef = mainWindow;

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });

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

function focusedWindowForSender(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function safeSuggestedFileName(sourcePath: string, suggestedName?: string): string {
  const fallback = basename(sourcePath) || "flow-shuttle-image.png";
  const sourceExtension = extname(fallback);
  const rawName = suggestedName?.trim() || fallback;
  const sanitized = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\.+$/g, "").trim();
  if (!sanitized) {
    return fallback;
  }
  return extname(sanitized) ? sanitized : `${sanitized}${sourceExtension || ".png"}`;
}

function registerIpc(): void {
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:check-for-updates", () => checkForAppUpdates());
  ipcMain.handle("app:open-releases-page", async () => {
    await shell.openExternal(getReleaseDetailsUrl() ?? releasesLatestUrl);
  });
  ipcMain.handle("updates:get-status", () => getUpdateStatus());
  ipcMain.handle("updates:check", () => checkForAppUpdates());
  ipcMain.handle("updates:download", () => downloadAppUpdate());
  ipcMain.handle("updates:quit-and-install", () => quitAndInstallAppUpdate());
  ipcMain.handle("updates:open-release-page", async () => {
    await shell.openExternal(getReleaseDetailsUrl() ?? releasesLatestUrl);
  });

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
  ipcMain.handle("editor:cut", (event) => {
    focusedWindowForSender(event)?.webContents.cut();
  });
  ipcMain.handle("editor:copy", (event) => {
    focusedWindowForSender(event)?.webContents.copy();
  });
  ipcMain.handle("editor:paste", (event) => {
    focusedWindowForSender(event)?.webContents.paste();
  });
  ipcMain.handle("editor:read-clipboard-text", () => clipboard.readText());
  ipcMain.handle("editor:read-clipboard-image", () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }
    const png = image.toPNG();
    const data = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    return {
      mimeType: "image/png",
      suggestedName: "clipboard-image.png",
      data
    };
  });
  ipcMain.handle("editor:write-clipboard-text", (_event, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle("attachments:save-image-as", async (_event, input: SaveAttachmentAsInput) => {
    if (!input.url.startsWith("attachment://")) {
      throw new Error("Only attachment images can be saved from Flow Shuttle.");
    }
    const sourcePath = resolveAttachmentUrlToFilePath(input.url);
    const result = await dialog.showSaveDialog({
      title: "Save Image As",
      defaultPath: safeSuggestedFileName(sourcePath, input.suggestedName),
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await copyFile(sourcePath, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("attachments:copy-image", (_event, input: SaveAttachmentAsInput) => {
    if (!input.url.startsWith("attachment://")) {
      throw new Error("Only attachment images can be copied from Flow Shuttle.");
    }
    const sourcePath = resolveAttachmentUrlToFilePath(input.url);
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) {
      throw new Error("Image could not be copied.");
    }
    clipboard.writeImage(image);
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
  initializeAutoUpdater();
  scheduleBackgroundUpdateCheck();

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
