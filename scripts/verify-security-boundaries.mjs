import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertSafeDirectoryRemoval,
  chatCompletionsEndpoint,
  hasAiEndpointOriginChanged,
  prepareAttachmentDirectory,
  validateAiBaseUrl
} from "../src/main/securityBoundaries.ts";
import {
  assertAttachmentSizeBytes,
  maxAttachmentSizeBytes
} from "../src/shared/attachmentLimits.ts";

test("LM Studio loopback endpoints and remote HTTPS endpoints remain supported", () => {
  assert.equal(
    chatCompletionsEndpoint("http://localhost:1234/v1"),
    "http://localhost:1234/v1/chat/completions"
  );
  assert.equal(
    chatCompletionsEndpoint("http://127.0.0.1:1234/v1"),
    "http://127.0.0.1:1234/v1/chat/completions"
  );
  assert.equal(
    chatCompletionsEndpoint("http://[::1]:1234/v1"),
    "http://[::1]:1234/v1/chat/completions"
  );
  assert.equal(
    chatCompletionsEndpoint("https://api.example.com/v1"),
    "https://api.example.com/v1/chat/completions"
  );
  assert.equal(
    chatCompletionsEndpoint("https://api.example.com/v1/chat/completions?api-version=1"),
    "https://api.example.com/v1/chat/completions?api-version=1"
  );
});

test("attachment creation builds normal directories and rejects existing Windows junctions", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "flow-shuttle-creation-"));
  try {
    const dataDirectory = join(testRoot, "data");
    mkdirSync(dataDirectory);
    const root = join(dataDirectory, "attachments");
    for (const child of ["project-memos/project", "daily-entries/2026-10-03/item", "work-item-notes/item"]) {
      const directory = prepareAttachmentDirectory(root, join(root, child));
      writeFileSync(join(directory, "control.png"), "image", { flag: "wx" });
    }
    const outside = join(testRoot, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "keep.txt");
    writeFileSync(sentinel, "keep");
    for (const linked of [join(root, "linked-category"), join(root, "project-memos", "linked-project"), join(root, "daily-entries", "linked-date"), join(root, "work-item-notes", "linked-item")]) {
      symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
      assert.throws(() => prepareAttachmentDirectory(root, join(linked, "new-child")), /symbolic link or junction/);
      assert.equal(existsSync(join(outside, "new-child")), false);
    }
    const linkedRoot = join(dataDirectory, "linked-attachments");
    symlinkSync(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => prepareAttachmentDirectory(linkedRoot, join(linkedRoot, "new-child")), /symbolic link or junction/);
    assert.throws(() => prepareAttachmentDirectory(root, outside), /outside the attachment root/);
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
    const dangling = join(root, "dangling");
    symlinkSync(join(testRoot, "missing-target"), dangling, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => prepareAttachmentDirectory(root, join(dangling, "new-child")), /symbolic link or junction/);
    // A deliberate alias of the selected data directory remains supported.
    const alias = join(testRoot, "data-alias");
    symlinkSync(dataDirectory, alias, process.platform === "win32" ? "junction" : "dir");
    assert.doesNotThrow(() => prepareAttachmentDirectory(join(alias, "attachments"), join(alias, "attachments", "work-item-notes", "alias-item")));
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test("remote plaintext and malformed AI endpoints are rejected", () => {
  assert.throws(() => validateAiBaseUrl("http://api.example.com/v1"), /must use HTTPS/);
  assert.throws(() => validateAiBaseUrl("http://192.168.1.10:1234/v1"), /must use HTTPS/);
  assert.throws(() => validateAiBaseUrl("http://localhost.example.com:1234/v1"), /must use HTTPS/);
  assert.throws(() => validateAiBaseUrl("http://127.0.0.1.example.com:1234/v1"), /must use HTTPS/);
  assert.throws(() => validateAiBaseUrl("https://user:secret@api.example.com/v1"), /embedded credentials/);
  assert.throws(() => validateAiBaseUrl("https://api.example.com/v1#fragment"), /fragment/);
  assert.throws(() => validateAiBaseUrl("file:///tmp/model"), /must use HTTPS/);
});

test("stored AI credentials stay bound to the canonical endpoint origin", () => {
  assert.equal(
    hasAiEndpointOriginChanged("https://api.example.com/v1", "https://api.example.com/alternate"),
    false
  );
  assert.equal(
    hasAiEndpointOriginChanged("https://api.example.com", "https://api.example.com:443/v1"),
    false
  );
  assert.equal(
    hasAiEndpointOriginChanged("http://localhost:1234/v1", "http://localhost:1234/alternate"),
    false
  );
  assert.equal(
    hasAiEndpointOriginChanged("http://localhost:1234/v1", "http://localhost:2345/v1"),
    true
  );
  assert.equal(
    hasAiEndpointOriginChanged("http://localhost:1234/v1", "http://127.0.0.1:1234/v1"),
    true
  );
  assert.equal(hasAiEndpointOriginChanged("https://api.example.com/v1", ""), true);
  assert.equal(hasAiEndpointOriginChanged("not-a-valid-url", ""), true);
});

test("the per-image limit accepts 50 MB and rejects larger payloads", () => {
  assert.doesNotThrow(() => assertAttachmentSizeBytes(maxAttachmentSizeBytes));
  assert.throws(() => assertAttachmentSizeBytes(maxAttachmentSizeBytes + 1), /50 MB/);
  assert.throws(() => assertAttachmentSizeBytes(-1), /Invalid image size/);
});

test("attachment deletion rejects lexical escapes and intermediate directory links", () => {
  const testRoot = mkdtempSync(join(tmpdir(), "flow-shuttle-security-"));
  try {
    const attachmentRoot = join(testRoot, "data", "attachments");
    const normalTarget = join(attachmentRoot, "daily-entries", "2026-08-09", "work-item");
    mkdirSync(normalTarget, { recursive: true });
    assert.doesNotThrow(() => assertSafeDirectoryRemoval(attachmentRoot, normalTarget));

    const outsideRoot = join(testRoot, "outside");
    const externalTarget = join(outsideRoot, "2026-08-09", "work-item");
    mkdirSync(externalTarget, { recursive: true });
    const sentinel = join(externalTarget, "keep.txt");
    writeFileSync(sentinel, "keep");

    assert.throws(
      () => assertSafeDirectoryRemoval(attachmentRoot, externalTarget),
      /outside the attachment root/
    );

    const linkedDirectory = join(attachmentRoot, "linked-entries");
    symlinkSync(outsideRoot, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => assertSafeDirectoryRemoval(attachmentRoot, join(linkedDirectory, "2026-08-09", "work-item")),
      /symbolic link or junction/
    );
    assert.equal(existsSync(sentinel), true);

    const linkedAttachmentRoot = join(testRoot, "linked-attachment-root");
    symlinkSync(attachmentRoot, linkedAttachmentRoot, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => assertSafeDirectoryRemoval(linkedAttachmentRoot, join(linkedAttachmentRoot, "daily-entries", "2026-08-09", "work-item")),
      /must be a real directory/
    );
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
