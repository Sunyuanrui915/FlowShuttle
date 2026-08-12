export const FEEDBACK_MESSAGE_MAX_CHARACTERS = 2000;
export const FEEDBACK_EMAIL_MAX_CHARACTERS = 254;
export const FEEDBACK_SCREENSHOT_MAX_COUNT = 5;
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_SCREENSHOT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;

export type FeedbackScreenshotMimeType = (typeof FEEDBACK_SCREENSHOT_MIME_TYPES)[number];

export type FeedbackMessageIssue = "required" | "tooLong";
export type FeedbackEmailIssue = "tooLong" | "invalid";
export type FeedbackScreenshotIssue = "unsupportedType" | "tooLarge" | "tooMany";

export interface FeedbackScreenshotPayload {
  mimeType: string;
  data: ArrayBuffer;
}

export interface FeedbackSubmitInput {
  message: string;
  email?: string;
  screenshots?: FeedbackScreenshotPayload[];
}

export type FeedbackSubmitErrorCode =
  | "validation"
  | "unavailable"
  | "network"
  | "timeout"
  | "rateLimited"
  | "rejected"
  | "server";

export type FeedbackSubmitResult =
  | { success: true }
  | { success: false; errorCode: FeedbackSubmitErrorCode };

interface ValidatedFeedbackSubmitInput {
  message: string;
  email?: string;
  screenshots?: Array<{
    mimeType: FeedbackScreenshotMimeType;
    data: ArrayBuffer;
  }>;
}

export function countFeedbackCharacters(value: string): number {
  return Array.from(value).length;
}

export function clampFeedbackMessage(value: string): string {
  return Array.from(value).slice(0, FEEDBACK_MESSAGE_MAX_CHARACTERS).join("");
}

export function validateFeedbackMessage(value: unknown): FeedbackMessageIssue | null {
  if (typeof value !== "string" || !value.trim()) {
    return "required";
  }
  return countFeedbackCharacters(value) > FEEDBACK_MESSAGE_MAX_CHARACTERS ? "tooLong" : null;
}

export function validateFeedbackEmail(value: unknown): FeedbackEmailIssue | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > FEEDBACK_EMAIL_MAX_CHARACTERS) {
    return "tooLong";
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? null : "invalid";
}

export function sanitizeFeedbackScreenshotMimeType(value: unknown): FeedbackScreenshotMimeType | null {
  return typeof value === "string"
    && FEEDBACK_SCREENSHOT_MIME_TYPES.includes(value as FeedbackScreenshotMimeType)
    ? value as FeedbackScreenshotMimeType
    : null;
}

export function validateFeedbackScreenshotMetadata(input: {
  type: unknown;
  size: unknown;
}): FeedbackScreenshotIssue | null {
  if (!sanitizeFeedbackScreenshotMimeType(input.type)) {
    return "unsupportedType";
  }
  return typeof input.size !== "number"
    || !Number.isSafeInteger(input.size)
    || input.size < 0
    || input.size > FEEDBACK_SCREENSHOT_MAX_BYTES
    ? "tooLarge"
    : null;
}

export function normalizeFeedbackEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const endpoint = new URL(value.trim());
    if (
      endpoint.protocol !== "https:"
      || !endpoint.hostname
      || endpoint.username
      || endpoint.password
      || endpoint.hash
    ) {
      return null;
    }
    return endpoint.toString();
  } catch {
    return null;
  }
}

function validateFeedbackSubmitInput(input: unknown): ValidatedFeedbackSubmitInput | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<FeedbackSubmitInput>;
  if (validateFeedbackMessage(candidate.message) || validateFeedbackEmail(candidate.email)) {
    return null;
  }

  let screenshots: ValidatedFeedbackSubmitInput["screenshots"];
  if (candidate.screenshots !== undefined) {
    if (
      !Array.isArray(candidate.screenshots)
      || candidate.screenshots.length > FEEDBACK_SCREENSHOT_MAX_COUNT
    ) {
      return null;
    }
    screenshots = [];
    for (const screenshot of candidate.screenshots) {
      if (!screenshot || typeof screenshot !== "object") {
        return null;
      }
      const mimeType = sanitizeFeedbackScreenshotMimeType(screenshot.mimeType);
      const data = screenshot.data;
      if (
        !mimeType
        || !(data instanceof ArrayBuffer)
        || validateFeedbackScreenshotMetadata({ type: mimeType, size: data.byteLength })
      ) {
        return null;
      }
      screenshots.push({ mimeType, data });
    }
  }

  const message = (candidate.message as string).trim();
  const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
  return {
    message,
    ...(email ? { email } : {}),
    ...(screenshots?.length ? { screenshots } : {})
  };
}

function feedbackScreenshotFileName(
  mimeType: FeedbackScreenshotMimeType,
  index: number
): string {
  const baseName = `feedback-screenshot-${index + 1}`;
  if (mimeType === "image/jpeg") {
    return `${baseName}.jpg`;
  }
  if (mimeType === "image/webp") {
    return `${baseName}.webp`;
  }
  return `${baseName}.png`;
}

export async function submitFeedbackToEndpoint(
  input: unknown,
  options: {
    endpoint: unknown;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }
): Promise<FeedbackSubmitResult> {
  const validated = validateFeedbackSubmitInput(input);
  if (!validated) {
    return { success: false, errorCode: "validation" };
  }

  const endpoint = normalizeFeedbackEndpoint(options.endpoint);
  if (!endpoint || typeof (options.fetchImpl ?? globalThis.fetch) !== "function") {
    return { success: false, errorCode: "unavailable" };
  }

  const formData = new FormData();
  formData.set("message", validated.message);
  if (validated.email) {
    formData.set("email", validated.email);
  }
  for (const [index, screenshot] of (validated.screenshots ?? []).entries()) {
    const bytes = new Uint8Array(screenshot.data);
    formData.append(
      "screenshots",
      new Blob([bytes], { type: screenshot.mimeType }),
      feedbackScreenshotFileName(screenshot.mimeType, index)
    );
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 20_000, 60_000));
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? globalThis.fetch)(endpoint, {
      method: "POST",
      body: formData,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (response.ok) {
      return { success: true };
    }
    if (response.status === 429) {
      return { success: false, errorCode: "rateLimited" };
    }
    if (response.status >= 500) {
      return { success: false, errorCode: "server" };
    }
    return { success: false, errorCode: "rejected" };
  } catch (error) {
    return {
      success: false,
      errorCode: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network"
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
