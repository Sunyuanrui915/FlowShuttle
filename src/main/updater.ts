import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import type { AppUpdateErrorCode, AppUpdateStatus } from "../shared/types";

const releasesPageUrl = "https://github.com/Sunyuanrui915/FlowShuttle/releases";
const releasesLatestUrl = "https://github.com/Sunyuanrui915/FlowShuttle/releases/latest";
const backgroundUpdateCheckDelayMs = 15_000;
let updaterInitialized = false;
let updateDownloaded = false;
let backgroundUpdateCheckTimer: ReturnType<typeof setTimeout> | null = null;
let currentStatus: AppUpdateStatus = {
  status: "idle",
  currentVersion: app.getVersion(),
  releaseUrl: releasesLatestUrl
};

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

function releaseUrlForVersion(version?: string): string {
  return version ? `${releasesPageUrl}/tag/v${version}` : releasesPageUrl;
}

function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (typeof notes === "string") {
    return notes.trim() || undefined;
  }
  if (Array.isArray(notes)) {
    return notes
      .map((note) => {
        if (typeof note === "string") {
          return note;
        }
        if (note && typeof note === "object" && "note" in note) {
          return String((note as { note?: unknown }).note ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim() || undefined;
  }
  return undefined;
}

function statusFromInfo(status: AppUpdateStatus["status"], info: UpdateInfo): AppUpdateStatus {
  return {
    status,
    currentVersion: app.getVersion(),
    latestVersion: info.version,
    releaseDate: info.releaseDate,
    releaseName: info.releaseName ?? undefined,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseUrl: releaseUrlForVersion(info.version)
  };
}

function classifyUpdateError(error: unknown): AppUpdateErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (normalized.includes("404") || normalized.includes("not found") || normalized.includes("no published versions")) {
    return "no-release";
  }
  if (normalized.includes("latest.yml") || normalized.includes("latest.yaml") || normalized.includes("metadata")) {
    return "no-update-metadata";
  }
  if (
    normalized.includes("no suitable update") ||
    normalized.includes("differential download") ||
    normalized.includes("blockmap") ||
    normalized.includes("no files provided") ||
    normalized.includes("cannot find")
  ) {
    return "no-compatible-artifact";
  }
  if (
    normalized.includes("sha512") ||
    normalized.includes("checksum") ||
    normalized.includes("signature") ||
    normalized.includes("code signature")
  ) {
    return "signature";
  }
  if (
    normalized.includes("enotfound") ||
    normalized.includes("econn") ||
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("net::") ||
    normalized.includes("unable to verify")
  ) {
    return "network";
  }
  return "unknown";
}

function setStatus(status: AppUpdateStatus): AppUpdateStatus {
  const releaseContext = {
    latestVersion: status.latestVersion ?? currentStatus.latestVersion,
    releaseDate: status.releaseDate ?? currentStatus.releaseDate,
    releaseName: status.releaseName ?? currentStatus.releaseName,
    releaseNotes: status.releaseNotes ?? currentStatus.releaseNotes,
    releaseUrl: status.releaseUrl ?? currentStatus.releaseUrl ?? releasesLatestUrl
  };

  currentStatus = {
    ...releaseContext,
    ...status,
    currentVersion: app.getVersion()
  };

  if (status.status !== "error") {
    delete currentStatus.errorCode;
    delete currentStatus.errorMessage;
  }
  if (status.status !== "download-progress") {
    delete currentStatus.progress;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("updates:status", currentStatus);
  }

  return currentStatus;
}

function setErrorStatus(error: unknown): AppUpdateStatus {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown update error.");
  const errorCode = classifyUpdateError(error);
  warn("update failed", { errorCode, message });
  return setStatus({
    status: "error",
    currentVersion: app.getVersion(),
    errorCode,
    errorMessage: message,
    releaseUrl: currentStatus.releaseUrl ?? releasesLatestUrl
  });
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
    updateDownloaded = false;
    setStatus({
      status: "checking",
      currentVersion: app.getVersion(),
      releaseUrl: releasesLatestUrl
    });
  });

  autoUpdater.on("update-available", (info) => {
    log("update available", describeUpdate(info));
    updateDownloaded = false;
    setStatus(statusFromInfo("update-available", info));
  });

  autoUpdater.on("update-not-available", (info) => {
    log("update not available", describeUpdate(info));
    updateDownloaded = false;
    setStatus(statusFromInfo("update-not-available", info));
  });

  autoUpdater.on("error", (error) => {
    setErrorStatus(error);
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    log("download progress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    });
    setStatus({
      status: "download-progress",
      currentVersion: app.getVersion(),
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      }
    });
  });

  autoUpdater.on("update-downloaded", (event: UpdateDownloadedEvent) => {
    log("update downloaded", {
      ...describeUpdate(event),
      downloadedFile: event.downloadedFile
    });
    updateDownloaded = true;
    setStatus(statusFromInfo("update-downloaded", event));
  });
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
    currentStatus = {
      status: "development",
      currentVersion: app.getVersion(),
      errorCode: "development",
      releaseUrl: releasesLatestUrl
    };
    return;
  }

  try {
    configureAutoUpdater();
  } catch (error) {
    setErrorStatus(error);
  }
}

export function scheduleBackgroundUpdateCheck(): void {
  if (!app.isPackaged || backgroundUpdateCheckTimer) {
    return;
  }

  backgroundUpdateCheckTimer = setTimeout(() => {
    backgroundUpdateCheckTimer = null;
    checkForAppUpdates().catch((error: unknown) => {
      setErrorStatus(error);
    });
  }, backgroundUpdateCheckDelayMs);
}

export function getUpdateStatus(): AppUpdateStatus {
  return currentStatus;
}

export function getReleaseDetailsUrl(): string {
  return currentStatus.releaseUrl ?? releaseUrlForVersion(currentStatus.latestVersion);
}

export async function checkForAppUpdates(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    return setStatus({
      status: "development",
      currentVersion: app.getVersion(),
      errorCode: "development",
      releaseUrl: releasesLatestUrl
    });
  }

  try {
    configureAutoUpdater();
    setStatus({
      status: "checking",
      currentVersion: app.getVersion(),
      releaseUrl: releasesLatestUrl
    });
    const result = await autoUpdater.checkForUpdates();
    return currentStatus.status === "checking" && result?.updateInfo
      ? setStatus(statusFromInfo("update-not-available", result.updateInfo))
      : currentStatus;
  } catch (error) {
    return setErrorStatus(error);
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    return setStatus({
      status: "development",
      currentVersion: app.getVersion(),
      errorCode: "development",
      releaseUrl: releasesLatestUrl
    });
  }

  if (currentStatus.status !== "update-available") {
    return currentStatus;
  }

  try {
    configureAutoUpdater();
    await autoUpdater.downloadUpdate();
    return currentStatus;
  } catch (error) {
    return setErrorStatus(error);
  }
}

export function quitAndInstallAppUpdate(): AppUpdateStatus {
  if (!app.isPackaged) {
    return setStatus({
      status: "development",
      currentVersion: app.getVersion(),
      errorCode: "development",
      releaseUrl: releasesLatestUrl
    });
  }

  if (!updateDownloaded || currentStatus.status !== "update-downloaded") {
    return currentStatus;
  }

  autoUpdater.quitAndInstall(false, true);
  return currentStatus;
}
