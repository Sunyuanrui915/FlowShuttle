import { contextBridge, ipcRenderer } from "electron";
import type {
  AiDraftDailyChangeInput,
  AppUpdateStatus,
  DailyAutoReportEvent,
  AiRefineReportInput,
  AiSaveSettingsInput,
  CreateProgressInput,
  CreateProjectInput,
  CreateWorkItemInput,
  ExportMarkdownInput,
  LanguagePreference,
  PeriodReportType,
  SaveAttachmentAsInput,
  SortMoveDirection,
  SaveDailyEntryAttachmentInput,
  SaveWorkItemNoteAttachmentInput,
  SaveMemoAttachmentInput,
  SaveProjectMemoInput,
  SettingsInfo,
  ThemePreference,
  UpsertDailyWorkItemEntryInput,
  UpdateProjectInput,
  UpdateWorkItemInput,
  WorkJournalApi
} from "../shared/types";

const updateStatusListeners = new WeakMap<
  (status: AppUpdateStatus) => void,
  (event: Electron.IpcRendererEvent, status: AppUpdateStatus) => void
>();

const api: WorkJournalApi = {
  appInfo: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
    checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
    openReleasesPage: () => ipcRenderer.invoke("app:open-releases-page")
  },
  updates: {
    getStatus: () => ipcRenderer.invoke("updates:get-status"),
    checkForUpdates: () => ipcRenderer.invoke("updates:check"),
    downloadUpdate: () => ipcRenderer.invoke("updates:download"),
    quitAndInstall: () => ipcRenderer.invoke("updates:quit-and-install"),
    openReleasePage: () => ipcRenderer.invoke("updates:open-release-page"),
    onStatus: (callback: (status: AppUpdateStatus) => void) => {
      const existingListener = updateStatusListeners.get(callback);
      if (existingListener) {
        ipcRenderer.removeListener("updates:status", existingListener);
      }
      const listener = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => {
        callback(status);
      };
      updateStatusListeners.set(callback, listener);
      ipcRenderer.on("updates:status", listener);
      return () => {
        ipcRenderer.removeListener("updates:status", listener);
        updateStatusListeners.delete(callback);
      };
    },
    removeStatusListener: (callback: (status: AppUpdateStatus) => void) => {
      const listener = updateStatusListeners.get(callback);
      if (!listener) {
        return;
      }
      ipcRenderer.removeListener("updates:status", listener);
      updateStatusListeners.delete(callback);
    }
  },
  projects: {
    listActive: () => ipcRenderer.invoke("projects:list-active"),
    create: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
    update: (input: UpdateProjectInput) => ipcRenderer.invoke("projects:update", input),
    move: (id: string, direction: SortMoveDirection) => ipcRenderer.invoke("projects:move", id, direction),
    archive: (id: string) => ipcRenderer.invoke("projects:archive", id),
    getDetail: (id: string) => ipcRenderer.invoke("projects:get-detail", id),
    getDeleteSummary: (id: string) => ipcRenderer.invoke("projects:get-delete-summary", id),
    delete: (id: string) => ipcRenderer.invoke("projects:delete", id)
  },
  workItems: {
    create: (input: CreateWorkItemInput) => ipcRenderer.invoke("work-items:create", input),
    update: (input: UpdateWorkItemInput) => ipcRenderer.invoke("work-items:update", input),
    move: (id: string, direction: SortMoveDirection) => ipcRenderer.invoke("work-items:move", id, direction),
    complete: (id: string) => ipcRenderer.invoke("work-items:complete", id),
    getDeleteSummary: (id: string) => ipcRenderer.invoke("work-items:get-delete-summary", id),
    delete: (id: string) => ipcRenderer.invoke("work-items:delete", id)
  },
  progress: {
    create: (input: CreateProgressInput) => ipcRenderer.invoke("progress:create", input),
    listToday: () => ipcRenderer.invoke("progress:list-today")
  },
  today: {
    getOverview: () => ipcRenderer.invoke("today:get-overview")
  },
  daily: {
    getTodayJournal: () => ipcRenderer.invoke("daily:get-today-journal"),
    getJournal: (date: string) => ipcRenderer.invoke("daily:get-journal", date),
    upsertWorkItemEntry: (input: UpsertDailyWorkItemEntryInput) =>
      ipcRenderer.invoke("daily:upsert-work-item-entry", input),
    getWorkItemHistoryRecovery: (workItemId: string) =>
      ipcRenderer.invoke("daily:get-work-item-history-recovery", workItemId),
    restoreWorkItemHistory: (workItemId: string) =>
      ipcRenderer.invoke("daily:restore-work-item-history", workItemId),
    saveAttachment: (input: SaveDailyEntryAttachmentInput) => ipcRenderer.invoke("daily:save-attachment", input),
    saveWorkItemNoteAttachment: (input: SaveWorkItemNoteAttachmentInput) =>
      ipcRenderer.invoke("daily:save-work-item-note-attachment", input),
    closeToday: () => ipcRenderer.invoke("daily:close-today"),
    generateReport: (date: string) => ipcRenderer.invoke("daily:generate-report", date),
    reopenJournal: (date: string) => ipcRenderer.invoke("daily:reopen-journal", date),
    getPreviousWorkDate: (date: string) => ipcRenderer.invoke("daily:get-previous-work-date", date),
    onAutoReportGenerated: (callback: (event: DailyAutoReportEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: DailyAutoReportEvent) => {
        callback(event);
      };
      ipcRenderer.on("daily:auto-report-generated", listener);
      return () => {
        ipcRenderer.removeListener("daily:auto-report-generated", listener);
      };
    }
  },
  search: {
    query: (term: string) => ipcRenderer.invoke("search:query", term)
  },
  markdown: {
    generateToday: () => ipcRenderer.invoke("markdown:generate-today"),
    exportToday: (input: ExportMarkdownInput) => ipcRenderer.invoke("markdown:export-today", input)
  },
  editor: {
    cut: () => ipcRenderer.invoke("editor:cut"),
    copy: () => ipcRenderer.invoke("editor:copy"),
    paste: () => ipcRenderer.invoke("editor:paste"),
    readClipboardText: () => ipcRenderer.invoke("editor:read-clipboard-text"),
    readClipboardImage: () => ipcRenderer.invoke("editor:read-clipboard-image"),
    writeClipboardText: (text: string) => ipcRenderer.invoke("editor:write-clipboard-text", text)
  },
  attachments: {
    saveImageAs: (input: SaveAttachmentAsInput) => ipcRenderer.invoke("attachments:save-image-as", input),
    copyImage: (input: SaveAttachmentAsInput) => ipcRenderer.invoke("attachments:copy-image", input)
  },
  memos: {
    getProjectMemo: (projectId: string) => ipcRenderer.invoke("memos:get-project-memo", projectId),
    saveProjectMemo: (input: SaveProjectMemoInput) => ipcRenderer.invoke("memos:save-project-memo", input),
    saveAttachment: (input: SaveMemoAttachmentInput) => ipcRenderer.invoke("memos:save-attachment", input)
  },
  reports: {
    listDaily: () => ipcRenderer.invoke("reports:list-daily"),
    listPeriod: (type: PeriodReportType) => ipcRenderer.invoke("reports:list-period", type)
  },
  heatmap: {
    getMonthlyHeatmap: (year: number, month: number) => ipcRenderer.invoke("heatmap:get-monthly", year, month)
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    setTheme: (theme: ThemePreference) => ipcRenderer.invoke("settings:set-theme", theme),
    setLanguage: (language: LanguagePreference) => ipcRenderer.invoke("settings:set-language", language),
    openDataDirectory: () => ipcRenderer.invoke("settings:open-data-directory"),
    prepareDataDirectoryForCopy: () =>
      ipcRenderer.invoke("settings:prepare-data-directory-for-copy"),
    chooseAndMigrateDataDirectory: () =>
      ipcRenderer.invoke("settings:choose-and-migrate-data-directory"),
    useExistingDataDirectory: () => ipcRenderer.invoke("settings:use-existing-data-directory"),
    reloadDataDirectory: () => ipcRenderer.invoke("settings:reload-data-directory"),
    onChanged: (callback: (settings: SettingsInfo) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: SettingsInfo) => {
        callback(settings);
      };
      ipcRenderer.on("settings:changed", listener);
      return () => {
        ipcRenderer.removeListener("settings:changed", listener);
      };
    }
  },
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:get-settings"),
    saveSettings: (input: AiSaveSettingsInput) => ipcRenderer.invoke("ai:save-settings", input),
    clearApiKey: () => ipcRenderer.invoke("ai:clear-api-key"),
    testConnection: () => ipcRenderer.invoke("ai:test-connection"),
    refineReport: (input: AiRefineReportInput) => ipcRenderer.invoke("ai:refine-report", input),
    draftDailyChange: (input: AiDraftDailyChangeInput) => ipcRenderer.invoke("ai:draft-daily-change", input)
  }
};

contextBridge.exposeInMainWorld("workJournal", api);
