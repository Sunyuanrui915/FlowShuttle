import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateInfo, UpdateDownloadedEvent } from "electron-updater";

const updateCheckDelayMs = 10_000;
let updaterInitialized = false;

function log(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`[auto-update] ${message}`);
    return;
  }
  console.info(`[auto-update] ${message}`, details);
}

function warn(message: string, details?: unknown): void {
  if (details === undefined) {
    console.warn(`[auto-update] ${message}`);
    return;
  }
  console.warn(`[auto-update] ${message}`, details);
}

function describeUpdate(info: UpdateInfo): Record<string, unknown> {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    files: info.files?.length ?? 0
  };
}

function registerUpdaterEvents(): void {
  autoUpdater.on("checking-for-update", () => {
    log("checking for update");
  });

  autoUpdater.on("update-available", (info) => {
    log("update available", describeUpdate(info));
  });

  autoUpdater.on("update-not-available", (info) => {
    log("update not available", describeUpdate(info));
  });

  autoUpdater.on("error", (error) => {
    warn("update check failed", error instanceof Error ? error.message : error);
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    log("download progress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on("update-downloaded", (event: UpdateDownloadedEvent) => {
    log("update downloaded", {
      ...describeUpdate(event),
      downloadedFile: event.downloadedFile
    });
  });
}

export function initializeAutoUpdater(): void {
  if (updaterInitialized) {
    return;
  }

  if (!app.isPackaged) {
    log("skipped in development");
    return;
  }

  updaterInitialized = true;

  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
      info: (message?: unknown) => log(String(message ?? "")),
      warn: (message?: unknown) => warn(String(message ?? "")),
      error: (message?: unknown) => warn(String(message ?? "")),
      debug: (message?: string) => log(message ?? "")
    };

    registerUpdaterEvents();

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((error: unknown) => {
        warn("update check promise rejected", error instanceof Error ? error.message : error);
      });
    }, updateCheckDelayMs);
  } catch (error) {
    warn("initialization failed", error instanceof Error ? error.message : error);
  }
}
