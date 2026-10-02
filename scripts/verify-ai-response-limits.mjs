import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { requestAiCompletion } from "../src/main/aiResponse.ts";
import { aiResponseLimits } from "../src/shared/aiResponseLimits.ts";

const encoder = new TextEncoder();
const event = (content, finish_reason) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
const json = (content, finish_reason = "stop") => JSON.stringify({ choices: [{ message: { content }, finish_reason }] });
const fullEvent = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: "chatcmpl-example", object: "chat.completion.chunk", created: 1800000000,
  model: "example-model", choices: [{ index: 0, delta, finish_reason }]
})}\n\n`;

async function run(body, { limits = {}, stream = false, status = 200, headers = {}, signal, onProgress } = {}) {
  const originalFetch = globalThis.fetch;
  let fetchSignal;
  let canceled = false;
  globalThis.fetch = async (_url, options) => {
    fetchSignal = options.signal;
    assert.equal(options.redirect, "error");
    return new Response(typeof body === "string" ? body : body(() => { canceled = true; }), {
      status, headers: { "content-type": stream ? "text/event-stream" : "application/json", ...headers }
    });
  };
  try {
    const output = await requestAiCompletion("https://ai.example.test/v1/chat/completions", "model", "test-key", [],
      { ...aiResponseLimits, ...limits }, { stream, signal, onProgress, timeoutMs: null });
    return { output, canceled, fetchSignal };
  } catch (error) {
    assert.equal(fetchSignal.aborted, true, "failed response must abort its request");
    error.readerCanceled = canceled;
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function openStream(chunks) {
  return (cancel) => new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk); },
    cancel
  });
}

test("complete long JSON and streaming Markdown are preserved", async () => {
  const markdown = ("## 完整报告\n\n事项、风险、计划🙂\n").repeat(10_000);
  assert.equal((await run(json(markdown))).output, markdown.trim());
  const progress = [];
  const result = await run(event(markdown, "stop") + "data: [DONE]\n\n", { stream: true, onProgress: (p) => progress.push(p) });
  assert.equal(result.output, markdown.trim());
  assert.equal(progress.map((p) => p.delta ?? "").join(""), markdown);
});

test("Unicode-escaped output at the character ceiling fits one valid SSE event", async () => {
  const expected = "汉".repeat(aiResponseLimits.outputCharacters);
  const escaped = "\\u6c49".repeat(aiResponseLimits.outputCharacters);
  const body = `data: {"choices":[{"delta":{"content":"${escaped}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`;
  assert.ok(encoder.encode(body).byteLength < 32 * 1024 * 1024);
  assert.equal((await run(body, { stream: true })).output, expected);
});

test("long reasoning plus finely segmented output fits the coordinated streaming budgets", async () => {
  const reasoningEvent = fullEvent({ reasoning_content: "思" });
  const writingEvent = fullEvent({ content: "文" });
  const tail = fullEvent({}, "stop") + "data: [DONE]\n\n";
  const bodyBytes = 110_000 * encoder.encode(reasoningEvent).byteLength
    + 5_000 * encoder.encode(writingEvent).byteLength + encoder.encode(tail).byteLength;
  assert.ok(bodyBytes > 16 * 1024 * 1024 && bodyBytes < 32 * 1024 * 1024);
  const progress = [];
  const result = await run((cancel) => {
    let reasoning = 110_000;
    let writing = 5_000;
    return new ReadableStream({
      pull(controller) {
        if (reasoning) {
          const count = Math.min(100, reasoning);
          reasoning -= count;
          controller.enqueue(encoder.encode(reasoningEvent.repeat(count)));
        } else if (writing) {
          const count = Math.min(100, writing);
          writing -= count;
          controller.enqueue(encoder.encode(writingEvent.repeat(count)));
        } else {
          controller.enqueue(encoder.encode(tail));
          controller.close();
        }
      }, cancel
    });
  }, { stream: true, onProgress: (p) => progress.push(p) });
  assert.equal(result.output, "文".repeat(5_000));
  assert.equal(progress.map((p) => p.delta ?? "").join(""), result.output);
  assert.ok(progress.some((p) => p.phase === "thinking"));
});

test("streaming UTF-8 survives every byte boundary", async () => {
  const bytes = encoder.encode(event("中文🙂\n尾段", "stop") + "data: [DONE]\n\n");
  let index = 0;
  const result = await run((cancel) => new ReadableStream({
    pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); else controller.close(); }, cancel
  }), { stream: true });
  assert.equal(result.output, "中文🙂\n尾段");
});

test("actual body bytes are capped despite missing or misleading Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    await assert.rejects(run(openStream(["x".repeat(101)]), { limits: { responseBytes: 100 }, headers }), (error) => {
      assert.match(error.message, /safe size limit/);
      assert.equal(error.readerCanceled, true);
      return true;
    });
  }
});

test("native fetch limits decompressed bytes rather than the compressed Content-Length", async () => {
  const compressed = gzipSync(json("x".repeat(10_000)));
  assert.ok(compressed.length < 1000);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": compressed.length });
    response.end(compressed);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(requestAiCompletion(`http://127.0.0.1:${server.address().port}/completion`, "model", "test-key", [],
      { ...aiResponseLimits, responseBytes: 1000 }), /safe size limit/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("non-2xx error bodies have a smaller read ceiling", async () => {
  await assert.rejects(run(openStream(["private error".repeat(100)]), { status: 500, limits: { errorBytes: 100 } }), /safe size limit/);
  await assert.rejects(run(JSON.stringify({ error: "ordinary failure" }), { status: 400 }), /ordinary failure/);
});

test("JSON fallback and streaming output ceilings fail without successful truncation", async () => {
  await assert.rejects(run(json("a".repeat(101)), { stream: true, headers: { "content-type": "application/json" }, limits: { outputCharacters: 100 } }), /safe character limit/);
  const progress = [];
  await assert.rejects(run(event("a".repeat(60)) + event("b".repeat(60), "stop") + "data: [DONE]\n\n", {
    stream: true, limits: { outputCharacters: 100 }, onProgress: (p) => progress.push(p)
  }), /safe character limit/);
  assert.ok(progress.map((p) => p.delta ?? "").join("").length <= 100);
});

test("unterminated events, reasoning-only streams and comment churn are bounded", async () => {
  await assert.rejects(run(openStream(["data: " + "x".repeat(101)]), { stream: true, limits: { eventCharacters: 100 } }), /safe event limit/);
  const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "x".repeat(120) } }] })}\n\n`;
  await assert.rejects(run(openStream([reasoning, reasoning]), { stream: true, limits: { responseBytes: encoder.encode(reasoning).length + 1 } }), /safe size limit/);
  await assert.rejects(run(openStream([": keepalive\n\n".repeat(4)]), { stream: true, limits: { events: 3 } }), /safe event limit/);
});

test("idle and absolute deadlines cancel stalled bodies and preserve their reason", async () => {
  await assert.rejects(run(openStream([]), { stream: true, limits: { idleTimeoutMs: 20, durationMs: 1000 } }), (error) => {
    assert.match(error.message, /stopped responding/);
    assert.equal(error.readerCanceled, true);
    return true;
  });
  await assert.rejects(run(openStream([]), { stream: true, limits: { idleTimeoutMs: 1000, durationMs: 20 } }), /timed out/);
});

test("a valid long stream survives 61 seconds of virtual time without the old cutoff", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let writer;
  const promise = run((cancel) => new ReadableStream({ start(controller) { writer = controller; }, cancel }), { stream: true });
  await new Promise(setImmediate);
  context.mock.timers.tick(61_000);
  writer.enqueue(encoder.encode(event("完整长文本", "stop") + "data: [DONE]\n\n"));
  assert.equal((await promise).output, "完整长文本");
});

test("ongoing reasoning without final text survives 24 virtual minutes and then completes", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let writer;
  const promise = run((cancel) => new ReadableStream({ start(controller) { writer = controller; }, cancel }), { stream: true });
  await new Promise(setImmediate);
  for (let index = 0; index < 6; index++) {
    context.mock.timers.tick(4 * 60_000);
    writer.enqueue(encoder.encode(fullEvent({ reasoning_content: "继续思考" })));
    await new Promise(setImmediate);
  }
  writer.enqueue(encoder.encode(event("完整结果", "stop") + "data: [DONE]\n\n"));
  assert.equal((await promise).output, "完整结果");
});

test("active reasoning does not reset the absolute 30-minute deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let writer;
  const promise = run((cancel) => new ReadableStream({ start(controller) { writer = controller; }, cancel }), { stream: true });
  await new Promise(setImmediate);
  for (let index = 0; index < 7; index++) {
    context.mock.timers.tick(4 * 60_000);
    writer.enqueue(encoder.encode(fullEvent({ reasoning_content: "持续思考" })));
    await new Promise(setImmediate);
  }
  context.mock.timers.tick(2 * 60_000 + 1);
  await assert.rejects(promise, /timed out/);
});

test("user cancellation stops a stalled stream", async () => {
  const caller = new AbortController();
  const promise = run(openStream([]), { stream: true, signal: caller.signal });
  setTimeout(() => caller.abort(), 10);
  await assert.rejects(promise, /canceled/);
});

test("provider truncation and malformed streaming fail, and DONE cancels remaining bytes", async () => {
  await assert.rejects(run(json("partial", "length")), /truncated/);
  await assert.rejects(run(event("partial", "length") + "data: [DONE]\n\n", { stream: true }), /truncated/);
  await assert.rejects(run(openStream(["data: invalid-json\n\n"]), { stream: true }), /invalid streaming response/);
  const result = await run(openStream([event("complete", "stop") + "data: [DONE]\n\n"]), { stream: true });
  assert.equal(result.output, "complete");
  assert.equal(result.canceled, true);
});
