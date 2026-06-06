import { safeStorage } from "electron";
import { getPeriodReportForAi, saveAiReportRefinement } from "./database";
import { getAiConfig, setAiConfig } from "./settings";
import type {
  AiConfig,
  AiDraftDailyChangeInput,
  AiDraftDailyChangeResult,
  AiOperationResult,
  AiRefineReportInput,
  AiRefineReportResult,
  AiSaveSettingsInput,
  AiSettingsInfo
} from "../shared/types";

const aiRequestTimeoutMs = 60_000;

function canSecurelyStoreApiKey(): boolean {
  return safeStorage.isEncryptionAvailable();
}

function sanitizeErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || "AI request failed.");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer ****")
    .replace(/sk-[A-Za-z0-9._\-]+/gi, "sk-****")
    .replace(/(api[-_]?key["'\s:=]+)[^"',\s]+/gi, "$1****")
    .slice(0, 500);
}

function apiKeyPreview(apiKey: string): string {
  const clean = apiKey.trim();
  if (!clean) {
    return "";
  }
  const tail = clean.slice(-4);
  const head = clean.length > 8 ? clean.slice(0, 3) : "";
  return head ? `${head}****${tail}` : `****${tail}`;
}

function decryptApiKey(config: AiConfig): string {
  if (!config.apiKeyEncrypted) {
    throw new Error("API Key is not configured.");
  }
  if (!canSecurelyStoreApiKey()) {
    throw new Error("This environment cannot securely read a saved API Key.");
  }
  try {
    return safeStorage.decryptString(Buffer.from(config.apiKeyEncrypted, "base64"));
  } catch {
    throw new Error("Saved API Key could not be decrypted. Please clear it and save a new key.");
  }
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) {
    throw new Error("Base URL is required.");
  }
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }
  return `${clean}/chat/completions`;
}

function aiSettingsInfo(config = getAiConfig()): AiSettingsInfo {
  let apiKeyConfigured = false;
  if (config.apiKeyEncrypted && canSecurelyStoreApiKey()) {
    try {
      apiKeyConfigured = Boolean(safeStorage.decryptString(Buffer.from(config.apiKeyEncrypted, "base64")));
    } catch {
      apiKeyConfigured = false;
    }
  }
  return {
    enabled: config.enabled,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured,
    apiKeyPreview: config.apiKeyPreview,
    canSecurelyStoreApiKey: canSecurelyStoreApiKey()
  };
}

export function getAiSettings(): AiSettingsInfo {
  return aiSettingsInfo();
}

export function saveAiSettings(input: AiSaveSettingsInput): AiSettingsInfo {
  const current = getAiConfig();
  const next: AiConfig = {
    ...current,
    enabled: input.enabled === true,
    provider: "openai-compatible",
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim()
  };

  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    if (canSecurelyStoreApiKey()) {
      const apiKey = input.apiKey.trim();
      next.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString("base64");
      next.apiKeyPreview = apiKeyPreview(apiKey);
    } else {
      next.apiKeyEncrypted = "";
      next.apiKeyPreview = "";
    }
  }

  return aiSettingsInfo(setAiConfig(next).ai);
}

export function clearAiApiKey(): AiSettingsInfo {
  const current = getAiConfig();
  return aiSettingsInfo(setAiConfig({ ...current, apiKeyEncrypted: "", apiKeyPreview: "" }).ai);
}

function assertConfigured(config: AiConfig, requireEnabled: boolean): string {
  if (requireEnabled && !config.enabled) {
    throw new Error("AI report refinement is disabled.");
  }
  if (!config.baseUrl.trim()) {
    throw new Error("Base URL is required.");
  }
  if (!config.model.trim()) {
    throw new Error("Model is required.");
  }
  return decryptApiKey(config);
}

async function chatCompletion(config: AiConfig, apiKey: string, messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiRequestTimeoutMs);
  try {
    const response = await fetch(chatCompletionsEndpoint(config.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2
      })
    });

    const bodyText = await response.text();
    let data: unknown = null;
    try {
      data = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data
          ? JSON.stringify((data as { error: unknown }).error)
          : bodyText || response.statusText;
      throw new Error(`AI service returned ${response.status}: ${message}`);
    }

    const content = (data as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      throw new Error("AI service returned an empty response.");
    }
    return content.trim();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testAiConnection(): Promise<AiOperationResult> {
  try {
    const config = getAiConfig();
    const apiKey = assertConfigured(config, false);
    const result = await chatCompletion(config, apiKey, [
      {
        role: "system",
        content: "You are a connectivity test endpoint. Reply with OK only."
      },
      {
        role: "user",
        content: "Please reply OK."
      }
    ]);
    return { success: Boolean(result.trim()) };
  } catch (error) {
    return { success: false, error: sanitizeErrorMessage(error) };
  }
}

export async function draftDailyChange(input: AiDraftDailyChangeInput): Promise<AiDraftDailyChangeResult> {
  try {
    const localDraft = input.localDraft.trim();
    if (!localDraft) {
      throw new Error("Local draft is empty.");
    }
    const config = getAiConfig();
    const apiKey = assertConfigured(config, true);
    const draft = await chatCompletion(config, apiKey, [
      {
        role: "system",
        content: [
          "你是一个谨慎的工作日志编辑助手。",
          "你只基于用户提供的本地差异草稿做润色，不新增事实，不推断未出现的工作内容。",
          "输出一段适合填写到“今日变更摘要”的 Markdown，保持简洁、具体、可核对。",
          "不要输出解释过程。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `项目：${input.projectName}`,
          `工作项：${input.workItemTitle}`,
          "",
          "本地差异草稿如下：",
          "",
          "```md",
          localDraft,
          "```"
        ].join("\n")
      }
    ]);
    return { success: true, draft };
  } catch (error) {
    return { success: false, draft: input.localDraft, error: sanitizeErrorMessage(error) };
  }
}

function buildSystemPrompt(): string {
  return [
    "你是一个严谨的工作报告编辑助手。你的任务是基于用户提供的周报或月报草稿，整理成更清晰、更像人工总结过的 Markdown 报告。",
    "你必须遵守：",
    "1. 不新增事实。",
    "2. 不编造项目、日期、工作项或结果。",
    "3. 不删除重要风险、阻碍、完成事项和下周或下月计划。",
    "4. 不改变用户输入的项目名、工作项名和原始事实。",
    "5. 输出语言优先跟随原始报告内容语言，不要因为软件界面语言而翻译报告。",
    "6. 保留关键日期，但可以把重复日期合并表达。",
    "7. 输出 Markdown。",
    "8. 不输出解释过程。",
    "9. 如果内容不足，就保持简洁，不要强行扩写。"
  ].join("\n");
}

function buildUserPrompt(reportType: "weekly" | "monthly", sourceMarkdown: string): string {
  const label = reportType === "weekly" ? "周报" : "月报";
  return [
    `请提炼下面这份${label}草稿，使它更适合阅读和复盘。`,
    "",
    "要求：",
    "- 保留原有事实。",
    "- 按项目归纳主要进展。",
    "- 合并重复表述。",
    "- 精简过长的逐日流水账。",
    "- 保留关键日期。",
    "- 保留完成事项。",
    "- 保留阻碍与风险。",
    "- 保留下周 / 下月计划。",
    "- 输出语言跟随原始报告，不要翻译用户输入内容。",
    "- 输出 Markdown。",
    "",
    "原始报告如下：",
    "",
    "```md",
    sourceMarkdown,
    "```"
  ].join("\n");
}

export async function refineAiReport(input: AiRefineReportInput): Promise<AiRefineReportResult> {
  try {
    if (input.reportType !== "weekly" && input.reportType !== "monthly") {
      throw new Error("AI refinement only supports weekly and monthly reports.");
    }
    const config = getAiConfig();
    const apiKey = assertConfigured(config, true);
    const periodReport = getPeriodReportForAi(input.reportId, input.reportType);
    if (!periodReport) {
      throw new Error("Report was not found.");
    }
    const refinedMarkdown = await chatCompletion(config, apiKey, [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input.reportType, periodReport.markdown) }
    ]);
    const saved = saveAiReportRefinement({
      periodReport,
      refinedMarkdown,
      provider: config.provider,
      model: config.model
    });
    return { success: true, refinedMarkdown, generatedAt: saved.generatedAt };
  } catch (error) {
    return { success: false, error: sanitizeErrorMessage(error) };
  }
}
