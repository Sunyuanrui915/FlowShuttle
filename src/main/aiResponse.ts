import type { AiResponseLimits } from "../shared/aiResponseLimits";
import type { AiPolishSelectionProgress } from "../shared/types";

export interface ChatCompletionOptions {
  timeoutMs?: number | null;
  signal?: AbortSignal;
  stream?: boolean;
  onProgress?: (progress: Omit<AiPolishSelectionProgress, "requestId">) => void;
}

interface Choice {
  finish_reason?: string | null;
  message?: { content?: string | null; reasoning_content?: string | null };
  delta?: { content?: string | null; reasoning_content?: string | null };
}

interface Payload {
  choices?: Choice[];
  error?: unknown;
}

function parseJsonBody(text: string): Payload | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as Payload : null;
  } catch {
    return null;
  }
}

function assertComplete(finishReason: string | null | undefined): void {
  if (finishReason === "length") {
    throw new Error("AI response was truncated because the service reached its output limit.");
  }
}

async function* responseChunks(
  response: Response,
  byteLimit: number,
  signal: AbortSignal,
  onChunk: () => void
): AsyncGenerator<Uint8Array> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) {
        break;
      }
      bytes += result.value.byteLength;
      if (bytes > byteLimit) {
        throw new Error("AI response exceeded the safe size limit.");
      }
      onChunk();
      yield result.value;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readText(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

async function readStream(
  chunks: AsyncIterable<Uint8Array>,
  limits: Readonly<AiResponseLimits>,
  onProgress: ChatCompletionOptions["onProgress"]
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const eventParts: string[] = [];
  let pendingEventPart = "";
  let eventCharacters = 0;
  let content = "";
  let pendingDelta = "";
  let finishReason: string | null | undefined;
  let eventCount = 0;
  let done = false;
  let thinkingReported = false;
  let lastProgress = 0;

  const retainEventPart = (part: string) => {
    eventCharacters += part.length;
    pendingEventPart += part;
    if (pendingEventPart.length >= 16 * 1024) {
      eventParts.push(pendingEventPart);
      pendingEventPart = "";
    }
  };
  const completeEvent = (tail: string): string => {
    const text = eventParts.join("") + pendingEventPart + tail;
    eventParts.length = 0;
    pendingEventPart = "";
    eventCharacters = 0;
    return text;
  };

  const flushProgress = (force = false) => {
    if (pendingDelta && (force || performance.now() - lastProgress >= limits.progressIntervalMs)) {
      onProgress?.({ phase: "writing", delta: pendingDelta, receivedCharacters: content.length });
      pendingDelta = "";
      lastProgress = performance.now();
    }
  };
  const consume = (eventText: string) => {
    if (++eventCount > limits.events || eventText.length > limits.eventCharacters) {
      throw new Error("AI streaming response exceeded the safe event limit.");
    }
    const dataLines = eventText.split(/\r\n|\r|\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    const fallback = eventText.trim();
    const dataText = dataLines.length ? dataLines.join("\n") : fallback.startsWith("{") ? fallback : "";
    if (!dataText || dataText.startsWith(":")) {
      return;
    }
    if (dataText === "[DONE]") {
      done = true;
      return;
    }
    const payload = parseJsonBody(dataText);
    if (!payload) {
      throw new Error("AI service returned an invalid streaming response.");
    }
    if ("error" in payload) {
      throw new Error(`AI service stream failed: ${JSON.stringify(payload.error)}`);
    }
    const choice = payload.choices?.[0];
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }
    const delta = typeof choice?.delta?.content === "string" ? choice.delta.content
      : typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (content.length + delta.length > limits.outputCharacters) {
      throw new Error("AI output exceeded the safe character limit.");
    }
    content += delta;
    pendingDelta += delta;
    const reasoning = choice?.delta?.reasoning_content ?? choice?.message?.reasoning_content;
    if (!content && reasoning && !thinkingReported) {
      thinkingReported = true;
      onProgress?.({ phase: "thinking", receivedCharacters: 0 });
    }
    flushProgress();
  };
  const consumeBuffer = (final = false) => {
    while (buffer && !done) {
      const boundary = buffer.match(/\r\n\r\n|\n\n|\r\r/);
      if (boundary?.index === undefined) {
        if (eventCharacters + buffer.length > limits.eventCharacters) {
          throw new Error("AI streaming response exceeded the safe event limit.");
        }
        if (final) {
          consume(completeEvent(buffer));
          buffer = "";
        } else if (buffer.length > 3) {
          // Only the last three characters can begin a split delimiter. Keep
          // older text in bounded blocks instead of rescanning it each read.
          retainEventPart(buffer.slice(0, -3));
          buffer = buffer.slice(-3);
        }
        return;
      }
      if (eventCharacters + boundary.index > limits.eventCharacters) {
        throw new Error("AI streaming response exceeded the safe event limit.");
      }
      const event = completeEvent(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
      consume(event);
    }
  };
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    consumeBuffer();
    if (done) {
      break;
    }
  }
  if (!done) {
    buffer += decoder.decode();
    consumeBuffer(true);
  }
  assertComplete(finishReason);
  if (!content.trim()) {
    throw new Error("AI service returned an empty response.");
  }
  flushProgress(true);
  return content.trim();
}

export async function requestAiCompletion(
  endpoint: string,
  model: string,
  apiKey: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
  limits: Readonly<AiResponseLimits>,
  options: ChatCompletionOptions = {}
): Promise<string> {
  const controller = new AbortController();
  let abortError: Error | undefined;
  let idleTimer: ReturnType<typeof setTimeout>;
  const abortWith = (message: string) => {
    abortError ??= new Error(message);
    controller.abort(abortError);
  };
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abortWith("AI service stopped responding."), limits.idleTimeoutMs);
  };
  const cancelFromCaller = () => abortWith("AI request canceled.");
  options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
  if (options.signal?.aborted) {
    cancelFromCaller();
  }
  const duration = Math.min(options.timeoutMs ?? limits.durationMs, limits.durationMs);
  const durationTimer = setTimeout(() => abortWith("AI request timed out."), duration);
  resetIdle();
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, ...(options.stream ? { stream: true } : {}) })
    });
    const chunks = responseChunks(response, response.ok ? limits.responseBytes : limits.errorBytes, controller.signal, resetIdle);
    if (!response.ok) {
      const text = await readText(chunks);
      const payload = parseJsonBody(text);
      const detail = payload && "error" in payload ? JSON.stringify(payload.error) : text || response.statusText;
      throw new Error(`AI service returned ${response.status}: ${detail}`);
    }
    if (options.stream && response.body && !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return await readStream(chunks, limits, options.onProgress);
    }
    const text = await readText(chunks);
    const choice = parseJsonBody(text)?.choices?.[0];
    assertComplete(choice?.finish_reason);
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI service returned an empty response.");
    }
    if (content.length > limits.outputCharacters) {
      throw new Error("AI output exceeded the safe character limit.");
    }
    if (options.stream) {
      options.onProgress?.({ phase: "writing", delta: content, receivedCharacters: content.length });
    }
    return content.trim();
  } catch (error) {
    controller.abort(error);
    throw abortError ?? error;
  } finally {
    clearTimeout(idleTimer!);
    clearTimeout(durationTimer);
    options.signal?.removeEventListener("abort", cancelFromCaller);
  }
}
