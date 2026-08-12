import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_TOOL_COLOR,
  DEFAULT_TEXT_COLOR,
  FlowShuttleHighlight,
  FlowShuttleTextColor,
  FlowShuttleUnderline,
  HIGHLIGHT_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
  countEditorCharacters,
  highlightColorIndicator,
  normalizeControlledInlineFormattingMarkdown,
  resolveHighlightColorToggle,
  resolveTextColorToggle,
  sanitizeHighlightColor,
  sanitizeTextColor,
  serializeHighlightMarkdown,
  serializeTextColorMarkdown,
  serializeUnderlineMarkdown
} from "../src/renderer/src/editorInlineFormatting.ts";

const extensions = [
  StarterKit.configure({ underline: false }),
  FlowShuttleUnderline,
  FlowShuttleTextColor,
  FlowShuttleHighlight
];
const markdownManager = new MarkdownManager({ extensions });
const schema = getSchema(extensions);
const styles = readFileSync(
  new URL("../src/renderer/src/styles.css", import.meta.url),
  "utf8"
);
const editorSource = readFileSync(
  new URL("../src/renderer/src/MarkdownWysiwygEditor.tsx", import.meta.url),
  "utf8"
);

test("standard inline formatting stays standard Markdown", () => {
  const source = "**bold** *italic* ~~strike~~ ==highlight==";
  const parsed = markdownManager.parse(source);
  assert.equal(markdownManager.serialize(parsed), source);
  const normalized = schema.nodeFromJSON(parsed).toJSON();
  const highlighted = normalized.content[0].content.find((node) =>
    node.marks?.some((mark) => mark.type === "highlight")
  );
  const highlightMark = highlighted?.marks?.find((mark) => mark.type === "highlight");
  assert.equal(highlightMark?.attrs.color, DEFAULT_HIGHLIGHT_COLOR);
});

test("underline and non-default colors serialize to the controlled HTML subset", () => {
  const serialized = markdownManager.serialize({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "under", marks: [{ type: "underline" }] },
          { type: "text", text: " red", marks: [{ type: "flowShuttleTextColor", attrs: { color: "red" } }] },
          { type: "text", text: " blue", marks: [{ type: "highlight", attrs: { color: "blue" } }] }
        ]
      }
    ]
  });

  assert.equal(
    serialized,
    '<u>under</u> <span data-flow-shuttle-text-color="red" style="color: #d64545;">red</span> <mark data-flow-shuttle-highlight="blue" style="background-color: #ddebff; color: inherit;">blue</mark>'
  );
  assert.doesNotMatch(serialized, /on\w+=|javascript:|url\(/i);
});

test("text color and highlight coexist through a Markdown round trip", () => {
  const rawSerialized = markdownManager.serialize({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "red on green",
            marks: [
              { type: "flowShuttleTextColor", attrs: { color: "red" } },
              { type: "highlight", attrs: { color: "green" } }
            ]
          }
        ]
      }
    ]
  });

  const serialized = normalizeControlledInlineFormattingMarkdown(rawSerialized);
  assert.match(serialized, /data-flow-shuttle-text-color="red"/);
  assert.match(serialized, /data-flow-shuttle-highlight="green"/);
  assert.doesNotMatch(serialized, /<span[^>]*><mark/);
  const reparsed = schema.nodeFromJSON(markdownManager.parse(serialized)).toJSON();
  const combinedText = reparsed.content[0].content.find((node) => node.text === "red on green");
  assert.deepEqual(
    combinedText?.marks?.map((mark) => ({ type: mark.type, color: mark.attrs?.color })),
    [
      { type: "flowShuttleTextColor", color: "red" },
      { type: "highlight", color: "green" }
    ]
  );
  assert.equal(
    normalizeControlledInlineFormattingMarkdown(markdownManager.serialize(reparsed)),
    serialized
  );
});

test("format serializers reject arbitrary color values", () => {
  assert.equal(serializeUnderlineMarkdown("safe"), "<u>safe</u>");
  assert.equal(serializeTextColorMarkdown("red", "safe"), '<span data-flow-shuttle-text-color="red" style="color: #d64545;">safe</span>');
  assert.equal(serializeTextColorMarkdown("black", "safe"), '<span data-flow-shuttle-text-color="black" style="color: #111827;">safe</span>');
  assert.equal(serializeTextColorMarkdown("url(javascript:alert(1))", "safe"), "safe");
  assert.equal(serializeHighlightMarkdown("yellow", "safe"), "==safe==");
  assert.equal(serializeHighlightMarkdown("black", "safe"), '<mark data-flow-shuttle-highlight="black" style="background-color: #1f2937; color: inherit;">safe</mark>');
  assert.equal(serializeHighlightMarkdown("purple", "safe"), '<mark data-flow-shuttle-highlight="purple" style="background-color: #eadfff; color: inherit;">safe</mark>');
  assert.equal(sanitizeTextColor("#ff0000"), null);
  assert.equal(sanitizeHighlightColor("expression(alert(1))"), null);
});

test("remembered colors toggle between apply and clear", () => {
  assert.equal(DEFAULT_TEXT_COLOR, "black");
  assert.equal(DEFAULT_HIGHLIGHT_COLOR, "yellow");
  assert.equal(DEFAULT_HIGHLIGHT_TOOL_COLOR, null);
  assert.equal(resolveTextColorToggle(false, "blue"), "blue");
  assert.equal(resolveTextColorToggle(true, "blue"), null);
  assert.equal(resolveTextColorToggle(false, "not-allowed"), DEFAULT_TEXT_COLOR);
  assert.equal(resolveHighlightColorToggle(false, "pink"), "pink");
  assert.equal(resolveHighlightColorToggle(true, "pink"), null);
  assert.equal(resolveHighlightColorToggle(false, "not-allowed"), null);
  assert.equal(resolveHighlightColorToggle(false, null), null);
});

test("the controlled palettes expose black plus eight reviewed values", () => {
  assert.deepEqual(
    TEXT_COLOR_OPTIONS.map((option) => option.value),
    ["black", "gray", "blue", "green", "red", "orange", "yellow", "purple", "pink"]
  );
  assert.deepEqual(
    HIGHLIGHT_COLOR_OPTIONS.map((option) => option.value),
    ["black", "gray", "blue", "green", "red", "orange", "yellow", "purple", "pink"]
  );
  assert.equal(sanitizeTextColor("black"), "black");
  assert.equal(sanitizeTextColor("yellow"), "yellow");
  assert.equal(sanitizeTextColor("pink"), "pink");
  assert.equal(sanitizeHighlightColor("gray"), "gray");
  assert.equal(sanitizeHighlightColor("orange"), "orange");
  assert.equal(highlightColorIndicator("orange"), "#d9772f");
});

test("the schema only accepts the controlled color attributes", () => {
  const colorMark = schema.marks.flowShuttleTextColor.create({ color: "blue" });
  const highlightMark = schema.marks.highlight.create({ color: "pink" });
  assert.deepEqual({ ...colorMark.attrs }, { color: "blue" });
  assert.deepEqual({ ...highlightMark.attrs }, { color: "pink" });
});

test("character count ignores whitespace and counts Unicode code points", () => {
  assert.equal(countEditorCharacters(" 流梭 A😊\n"), 4);
  assert.equal(countEditorCharacters("\t\r\n"), 0);
  assert.equal(countEditorCharacters("标点，算字。"), 6);
});

test("toolbar, palette, theme, and word-count styles keep the visual contract", () => {
  assert.match(styles, /\.markdown-editor-paragraph-trigger\s*\{[^}]*width:\s*104px;/s);
  assert.match(styles, /\.markdown-editor-format-group\s*\{[^}]*gap:\s*2px;/s);
  assert.match(styles, /\.markdown-editor-toolbar-menu\.is-paragraph\s*\{[^}]*width:\s*176px;/s);
  assert.match(styles, /\.markdown-editor-color-control\s*\{[^}]*display:\s*inline-flex;/s);
  assert.match(styles, /\.markdown-editor-color-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5, 28px\);/s);
  assert.match(styles, /data-flow-shuttle-text-color="black"/s);
  assert.match(styles, /data-flow-shuttle-text-color="yellow"/s);
  assert.match(styles, /data-flow-shuttle-text-color="pink"/s);
  assert.match(styles, /data-flow-shuttle-highlight="gray"/s);
  assert.match(styles, /data-flow-shuttle-highlight="orange"/s);
  assert.match(styles, /data-flow-shuttle-highlight="black"/s);
  assert.match(styles, /\.markdown-editor-toolbar-menu\.is-more\s*\{[^}]*width:\s*184px;/s);
  assert.match(
    styles,
    /\[data-flow-shuttle-text-color\][\s\S]*mark\[data-flow-shuttle-highlight\][\s\S]*color:\s*inherit\s*!important;/s
  );
  assert.match(styles, /\.markdown-editor-character-count\s*\{[^}]*position:\s*absolute;[^}]*right:\s*14px;[^}]*bottom:\s*9px;/s);
  assert.match(styles, /data-editor-theme="dark"[\s\S]*data-flow-shuttle-highlight="yellow"/s);
});

test("more menu exposes a one-shot format painter and clear-format command", () => {
  assert.match(editorSource, /toolbarMenu\.kind === "more"/);
  assert.match(editorSource, /<PaintRoller[\s\S]*labels\.formatPainter/);
  assert.match(editorSource, /<RemoveFormatting[\s\S]*labels\.clearFormatting/);
  assert.match(editorSource, /aria-keyshortcuts="Control\+Alt\+C"/);
  assert.match(editorSource, /unsetAllMarks\(\)/);
  assert.match(editorSource, /applyInlineFormattingSnapshot/);
  assert.match(editorSource, /classList\.add\("is-format-painter-active"\)/);
});
