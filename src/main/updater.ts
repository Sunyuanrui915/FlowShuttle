import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateInfo, UpdateDownloadedEvent } from "electron-updater";
import type { AppUpdateCheckResult } from "../shared/types";

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

function compareVersion(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function configureAutoUpdater(): void {
  if (updaterInitialized) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (message?: unknown) => log(String(message ?? "")),
    warn: (message?: unknown) => warn(String(message ?? "")),
    error: (message?: unknown) => warn(String(message ?? "")),
    debug: (message?: string) => log(message ?? "")
  };

  registerUpdaterEvents();
  updaterInitialized = true;
}

export function initializeAutoUpdater(): void {
  if (!app.isPackaged) {
    log("skipped in development");
    return;
  }

  try {
    configureAutoUpdater();
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((error: unknown) => {
        warn("update check promise rejected", error instanceof Error ? error.message : error);
      });
    }, updateCheckDelayMs);
  } catch (error) {
    warn("initialization failed", error instanceof Error ? error.message : error);
  }
}

export async function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion();

  if (!app.isPackaged) {
    return { status: "development", currentVersion };
  }

  try {
    configureAutoUpdater();
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo.version;
    if (latestVersion && compareVersion(latestVersion, currentVersion) > 0) {
      return {
        status: "available",
        currentVersion,
        latestVersion,
        releaseDate: result?.updateInfo.releaseDate
      };
    }
    return {
      status: "latest",
      currentVersion,
      latestVersion: latestVersion ?? currentVersion,
      releaseDate: result?.updateInfo.releaseDate
    };
  } catch (error) {
    warn("manual update check failed", error instanceof Error ? error.message : error);
    return { status: "failed", currentVersion };
  }
}
