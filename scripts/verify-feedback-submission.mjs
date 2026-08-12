import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FEEDBACK_MESSAGE_MAX_CHARACTERS,
  FEEDBACK_SCREENSHOT_MAX_COUNT,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  clampFeedbackMessage,
  countFeedbackCharacters,
  normalizeFeedbackEndpoint,
  submitFeedbackToEndpoint,
  validateFeedbackEmail,
  validateFeedbackMessage,
  validateFeedbackScreenshotMetadata
} from "../src/shared/feedback.ts";

const feedbackModalSource = readFileSync(
  new URL("../src/renderer/src/FeedbackModal.tsx", import.meta.url),
  "utf8"
);
const styles = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
const translations = readFileSync(new URL("../src/renderer/src/i18n.ts", import.meta.url), "utf8");

test("feedback fields enforce the confirmed local validation contract", () => {
  assert.equal(validateFeedbackMessage("   "), "required");
  assert.equal(validateFeedbackMessage("可用反馈"), null);
  assert.equal(validateFeedbackMessage("a".repeat(FEEDBACK_MESSAGE_MAX_CHARACTERS + 1)), "tooLong");
  assert.equal(validateFeedbackEmail(""), null);
  assert.equal(validateFeedbackEmail("person@example.com"), null);
  assert.equal(validateFeedbackEmail("not-an-email"), "invalid");
  assert.equal(validateFeedbackScreenshotMetadata({ type: "image/png", size: FEEDBACK_SCREENSHOT_MAX_BYTES }), null);
  assert.equal(validateFeedbackScreenshotMetadata({ type: "image/gif", size: 100 }), "unsupportedType");
  assert.equal(
    validateFeedbackScreenshotMetadata({ type: "image/webp", size: FEEDBACK_SCREENSHOT_MAX_BYTES + 1 }),
    "tooLarge"
  );
});

test("message counting and clamping use visible Unicode characters", () => {
  assert.equal(countFeedbackCharacters("反馈🙂"), 3);
  assert.equal(countFeedbackCharacters(clampFeedbackMessage("🙂".repeat(2001))), 2000);
});

test("feedback endpoints must be credential-free HTTPS URLs", () => {
  assert.equal(normalizeFeedbackEndpoint("http://example.com/api/feedback"), null);
  assert.equal(normalizeFeedbackEndpoint("https://user:pass@example.com/api/feedback"), null);
  assert.equal(normalizeFeedbackEndpoint("https://example.com/api/feedback#debug"), null);
  assert.equal(normalizeFeedbackEndpoint("https://example.com/api/feedback"), "https://example.com/api/feedback");
});

test("submission sends only user-entered fields and normalized screenshot names", async () => {
  let capturedUrl = "";
  let capturedInit;
  const fetchImpl = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(null, { status: 204 });
  };
  const result = await submitFeedbackToEndpoint(
    {
      message: "  需要一个更清晰的反馈入口  ",
      email: "  person@example.com  ",
      screenshots: [
        {
          mimeType: "image/png",
          data: Uint8Array.from([137, 80, 78, 71]).buffer
        },
        {
          mimeType: "image/webp",
          data: Uint8Array.from([82, 73, 70, 70]).buffer
        }
      ],
      editorContent: "must not be sent",
      logs: ["must not be sent"]
    },
    { endpoint: "https://example.com/api/feedback", fetchImpl }
  );

  assert.deepEqual(result, { success: true });
  assert.equal(capturedUrl, "https://example.com/api/feedback");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.credentials, "omit");
  assert.equal(capturedInit?.referrerPolicy, "no-referrer");
  const body = capturedInit?.body;
  assert.ok(body instanceof FormData);
  assert.deepEqual([...body.keys()], ["message", "email", "screenshots", "screenshots"]);
  assert.equal(body.get("message"), "需要一个更清晰的反馈入口");
  assert.equal(body.get("email"), "person@example.com");
  const screenshots = body.getAll("screenshots");
  assert.equal(screenshots.length, 2);
  assert.ok(screenshots[0] instanceof File);
  assert.equal(screenshots[0].name, "feedback-screenshot-1.png");
  assert.equal(screenshots[0].type, "image/png");
  assert.ok(screenshots[1] instanceof File);
  assert.equal(screenshots[1].name, "feedback-screenshot-2.webp");
  assert.equal(screenshots[1].type, "image/webp");
});

test("submission rejects more than five screenshots before any network request", async () => {
  let calls = 0;
  const result = await submitFeedbackToEndpoint(
    {
      message: "截图数量边界",
      screenshots: Array.from({ length: FEEDBACK_SCREENSHOT_MAX_COUNT + 1 }, () => ({
        mimeType: "image/png",
        data: Uint8Array.from([137, 80, 78, 71]).buffer
      }))
    },
    {
      endpoint: "https://example.com/api/feedback",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      }
    }
  );

  assert.deepEqual(result, { success: false, errorCode: "validation" });
  assert.equal(calls, 0);
});

test("submission reports unavailable and rate-limited states without leaking server text", async () => {
  let calls = 0;
  const unavailable = await submitFeedbackToEndpoint(
    { message: "test" },
    {
      endpoint: "",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 200 });
      }
    }
  );
  assert.deepEqual(unavailable, { success: false, errorCode: "unavailable" });
  assert.equal(calls, 0);

  const rateLimited = await submitFeedbackToEndpoint(
    { message: "test" },
    {
      endpoint: "https://example.com/api/feedback",
      fetchImpl: async () => new Response("private backend detail", { status: 429 })
    }
  );
  assert.deepEqual(rateLimited, { success: false, errorCode: "rateLimited" });
});

test("screenshot paste is gated by pointer hover with lightweight UI feedback", () => {
  assert.match(feedbackModalSource, /if \(!isScreenshotPasteHoveredRef\.current\)\s*\{\s*return;/);
  assert.match(feedbackModalSource, /onMouseEnter=\{\(\) => \{\s*isScreenshotPasteHoveredRef\.current = true;/);
  assert.match(feedbackModalSource, /onMouseLeave=\{\(\) => \{\s*isScreenshotPasteHoveredRef\.current = false;/);
  assert.doesNotMatch(feedbackModalSource, /isScreenshotPasteReady|feedbackPasteReadyTitle|ClipboardPaste/);
  assert.match(styles, /\.feedback-drop-zone:hover\s*\{/);
  assert.match(styles, /\.feedback-screenshot-list:hover\s*\{/);
  assert.doesNotMatch(styles, /is-paste-ready/);
  assert.doesNotMatch(translations, /feedbackPasteReadyTitle|已选中，可粘贴截图/);
});
