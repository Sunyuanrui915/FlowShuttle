import { app, nativeTheme, safeStorage } from "electron";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AiConfig, AiProvider, AppConfig, EffectiveTheme, LanguagePreference, SettingsInfo, ThemePreference } from "../shared/types";

const configFileName = "app-config.json";
const databaseFileName = "flow-shuttle.sqlite";
const defaultAiConfig: AiConfig = {
  enabled: false,
  provider: "openai-compatible",
  baseUrl: "",
  model: "",
  apiKeyEncrypted: "",
  apiKeyPreview: ""
};
const defaultConfig: AppConfig = {
  theme: "system",
  dataDirectory: null,
  language: "zh-CN",
  ai: defaultAiConfig
};

let configCache: AppConfig | null = null;
let fallbackReason: string | null = null;

function isTheme(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isLanguage(value: unknown): value is LanguagePreference {
  return value === "zh-CN" || value === "zh-TW" || value === "en";
}

export function isAiProvider(value: unknown): value is AiProvider {
  return value === "openai-compatible";
}

function normalizeAiConfig(value: unknown): AiConfig {
  if (!value || typeof value !== "object") {
    return { ...defaultAiConfig };
  }

  const raw = value as Partial<AiConfig>;
  const rawProvider = (value as { provider?: unknown }).provider;
  const provider = defaultAiConfig.provider;
  const hasManualAiConfig = Boolean(
    (typeof raw.baseUrl === "string" &&
      raw.baseUrl.trim() &&
      raw.baseUrl.trim() !== "https://ark.cn-beijing.volces.com/api/v3") ||
      (typeof raw.model === "string" && raw.model.trim()) ||
      (typeof raw.apiKeyEncrypted === "string" && raw.apiKeyEncrypted) ||
      (typeof raw.apiKeyPreview === "string" && raw.apiKeyPreview)
  );
  const shouldClearOldVolcengineDefault =
    rawProvider === "volcengine" &&
    raw.baseUrl === "https://ark.cn-beijing.volces.com/api/v3" &&
    !hasManualAiConfig;
  const baseUrl =
    !shouldClearOldVolcengineDefault && typeof raw.baseUrl === "string" && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : "";
  return {
    enabled: raw.enabled === true,
    provider,
    baseUrl,
    model: !shouldClearOldVolcengineDefault && typeof raw.model === "string" ? raw.model.trim() : "",
    apiKeyEncrypted: !shouldClearOldVolcengineDefault && typeof raw.apiKeyEncrypted === "string" ? raw.apiKeyEncrypted : "",
    apiKeyPreview: !shouldClearOldVolcengineDefault && typeof raw.apiKeyPreview === "string" ? raw.apiKeyPreview : ""
  };
}

function hasDecryptableApiKey(ai: AiConfig): boolean {
  if (!ai.apiKeyEncrypted || !safeStorage.isEncryptionAvailable()) {
    return false;
  }
  try {
    const plaintext = safeStorage.decryptString(Buffer.from(ai.apiKeyEncrypted, "base64"));
    return Boolean(plaintext);
  } catch {
    return false;
  }
}

function normalizeConfig(value: unknown): AppConfig {
  if (!value || typeof value !== "object") {
    return { ...defaultConfig, ai: { ...defaultAiConfig } };
  }

  const raw = value as Partial<AppConfig>;
  return {
    theme: isTheme(raw.theme) ? raw.theme : defaultConfig.theme,
    dataDirectory:
      typeof raw.dataDirectory === "string" && raw.dataDirectory.trim()
        ? raw.dataDirectory
        : null,
    language: isLanguage(raw.language) ? raw.language : defaultConfig.language,
    ai: normalizeAiConfig(raw.ai)
  };
}

export function getConfigPath(): string {
  return join(app.getPath("userData"), configFileName);
}

export function getDefaultDataDirectory(): string {
  return app.getPath("userData");
}

export function getDatabaseFileName(): string {
  return databaseFileName;
}

export function loadConfig(): AppConfig {
  if (configCache) {
    return configCache;
  }

  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    configCache = { ...defaultConfig, ai: { ...defaultAiConfig } };
    return configCache;
  }

  try {
    configCache = normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")));
  } catch {
    configCache = { ...defaultConfig, ai: { ...defaultAiConfig } };
  }
  return configCache;
}

export function saveConfig(nextConfig: AppConfig): AppConfig {
  const normalized = normalizeConfig(nextConfig);
  const configPath = getConfigPath();
  mkdirSync(app.getPath("userData"), { recursive: true });
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  renameSync(tempPath, configPath);
  configCache = normalized;
  return normalized;
}

function assertDirectoryAccessible(directory: string): void {
  const stat = statSync(directory);
  if (!stat.isDirectory()) {
    throw new Error("配置的数据目录不是文件夹。");
  }
  accessSyncForDirectory(directory);
}

function accessSyncForDirectory(directory: string): void {
  accessSync(directory, constants.R_OK | constants.W_OK);
}

export function resolveDataDirectory(): {
  configuredDataDirectory: string | null;
  defaultDataDirectory: string;
  dataDirectory: string;
  isCustomDataDirectory: boolean;
  isFallbackDataDirectory: boolean;
  fallbackReason: string | null;
} {
  const config = loadConfig();
  const defaultDataDirectory = getDefaultDataDirectory();
  mkdirSync(defaultDataDirectory, { recursive: true });

  if (!config.dataDirectory) {
    fallbackReason = null;
    return {
      configuredDataDirectory: null,
      defaultDataDirectory,
      dataDirectory: defaultDataDirectory,
      isCustomDataDirectory: false,
      isFallbackDataDirectory: false,
      fallbackReason: null
    };
  }

  try {
    assertDirectoryAccessible(config.dataDirectory);
    fallbackReason = null;
    return {
      configuredDataDirectory: config.dataDirectory,
      defaultDataDirectory,
      dataDirectory: config.dataDirectory,
      isCustomDataDirectory: true,
      isFallbackDataDirectory: false,
      fallbackReason: null
    };
  } catch (error) {
    fallbackReason =
      error instanceof Error
        ? `配置的自定义数据目录不可访问：${error.message}`
        : "配置的自定义数据目录不可访问。";
    return {
      configuredDataDirectory: config.dataDirectory,
      defaultDataDirectory,
      dataDirectory: defaultDataDirectory,
      isCustomDataDirectory: false,
      isFallbackDataDirectory: true,
      fallbackReason
    };
  }
}

export function getDatabasePathForDirectory(directory: string): string {
  return join(directory, databaseFileName);
}

export function getEffectiveTheme(): EffectiveTheme {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

export function applyThemeFromConfig(): void {
  nativeTheme.themeSource = loadConfig().theme;
}

export function getThemePreference(): ThemePreference {
  return loadConfig().theme;
}

export function setThemePreference(theme: ThemePreference): AppConfig {
  if (!isTheme(theme)) {
    throw new Error("无效的主题设置。");
  }
  const config = saveConfig({ ...loadConfig(), theme });
  nativeTheme.themeSource = theme;
  return config;
}

export function setLanguagePreference(language: LanguagePreference): AppConfig {
  if (!isLanguage(language)) {
    throw new Error("无效的语言设置。");
  }
  return saveConfig({ ...loadConfig(), language });
}

export function setAiConfig(ai: AiConfig): AppConfig {
  return saveConfig({ ...loadConfig(), ai });
}

export function getAiConfig(): AiConfig {
  return loadConfig().ai;
}

export async function ensureDirectoryWritable(directory: string): Promise<void> {
  const stat = statSync(directory);
  if (!stat.isDirectory()) {
    throw new Error("所选路径不是文件夹。");
  }
  await access(directory, constants.R_OK | constants.W_OK);
}

export function setDataDirectory(directory: string | null): AppConfig {
  return saveConfig({ ...loadConfig(), dataDirectory: directory });
}

export function pathsEqual(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function isInsideDirectory(child: string, parent: string): boolean {
  const childResolved = resolve(child);
  const parentResolved = resolve(parent);
  const childCompare = process.platform === "win32" ? childResolved.toLowerCase() : childResolved;
  const parentCompare = process.platform === "win32" ? parentResolved.toLowerCase() : parentResolved;
  return childCompare === parentCompare || childCompare.startsWith(`${parentCompare}\\`) || childCompare.startsWith(`${parentCompare}/`);
}

export function buildSettingsInfo(databasePath: string, databaseSize: number): SettingsInfo {
  const resolved = resolveDataDirectory();
  const config = loadConfig();
  return {
    theme: config.theme,
    effectiveTheme: getEffectiveTheme(),
    language: config.language,
    ai: {
      enabled: config.ai.enabled,
      provider: config.ai.provider,
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
      apiKeyConfigured: hasDecryptableApiKey(config.ai),
      apiKeyPreview: config.ai.apiKeyPreview,
      canSecurelyStoreApiKey: safeStorage.isEncryptionAvailable()
    },
    configPath: getConfigPath(),
    defaultDataDirectory: resolved.defaultDataDirectory,
    configuredDataDirectory: resolved.configuredDataDirectory,
    dataDirectory: resolved.dataDirectory,
    databasePath,
    databaseSize,
    isCustomDataDirectory: resolved.isCustomDataDirectory,
    isFallbackDataDirectory: resolved.isFallbackDataDirectory,
    fallbackReason: resolved.fallbackReason
  };
}
