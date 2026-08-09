import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  return isIP(normalized) === 4 && normalized.split(".")[0] === "127";
}

export function validateAiBaseUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) {
    throw new Error("Base URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error("Base URL must be a valid absolute URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Base URL must not contain embedded credentials.");
  }
  if (parsed.hash) {
    throw new Error("Base URL must not contain a fragment.");
  }
  if (parsed.protocol === "https:") {
    return clean;
  }
  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return clean;
  }
  if (parsed.protocol === "http:") {
    throw new Error("Remote AI Base URLs must use HTTPS. Localhost HTTP remains supported.");
  }
  throw new Error("Base URL must use HTTPS, or HTTP for a localhost model service.");
}

export function chatCompletionsEndpoint(baseUrl: string): string {
  const parsed = new URL(validateAiBaseUrl(baseUrl));
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = cleanPath.endsWith("/chat/completions")
    ? cleanPath
    : `${cleanPath}/chat/completions`;
  return parsed.toString();
}

function aiEndpointOrigin(baseUrl: string): string | null {
  const clean = baseUrl.trim();
  if (!clean) {
    return null;
  }
  try {
    return new URL(validateAiBaseUrl(clean)).origin;
  } catch {
    return null;
  }
}

export function hasAiEndpointOriginChanged(currentBaseUrl: string, nextBaseUrl: string): boolean {
  const currentClean = currentBaseUrl.trim();
  const nextClean = nextBaseUrl.trim();
  if (!currentClean || !nextClean) {
    return currentClean !== nextClean;
  }
  const currentOrigin = aiEndpointOrigin(currentClean);
  const nextOrigin = aiEndpointOrigin(nextClean);
  return currentOrigin === null || nextOrigin === null || currentOrigin !== nextOrigin;
}

function assertContainedPath(baseDirectory: string, targetPath: string): string {
  const relativePath = relative(baseDirectory, targetPath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)) {
    throw new Error("Refusing to delete outside the attachment root.");
  }
  return relativePath;
}

export function assertSafeDirectoryRemoval(baseDirectory: string, targetPath: string): void {
  const base = resolve(baseDirectory);
  const target = resolve(targetPath);
  const relativeTarget = assertContainedPath(base, target);
  if (!existsSync(target)) {
    return;
  }
  if (!existsSync(base)) {
    throw new Error("Attachment root is missing.");
  }

  const baseInfo = lstatSync(base);
  if (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) {
    throw new Error("Attachment root must be a real directory.");
  }

  let current = base;
  for (const segment of relativeTarget.split(/[\\/]+/)) {
    current = resolve(current, segment);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) {
      throw new Error("Refusing to delete attachments through a symbolic link or junction.");
    }
    if (!info.isDirectory()) {
      throw new Error("Attachment cleanup target must be a directory.");
    }
  }

  const realBase = realpathSync.native(base);
  const realTarget = realpathSync.native(target);
  assertContainedPath(realBase, realTarget);
}
