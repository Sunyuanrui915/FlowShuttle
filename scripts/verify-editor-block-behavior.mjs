import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { history, undo } from "@tiptap/pm/history";
import { AllSelection, EditorState, TextSelection } from "@tiptap/pm/state";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import {
  FlowShuttleHardBreak,
  plainTextClipboardSlice,
  serializeMarkdownWithPersistentEmptyParagraphs,
  toggleUnifiedCodeBlock
} from "../src/renderer/src/editorBlockBehavior.ts";
import { FlowShuttleOrderedList } from "../src/renderer/src/editorListBehavior.ts";

const extensions = [
  StarterKit.configure({ hardBreak: false, orderedList: false }),
  FlowShuttleHardBreak,
  FlowShuttleOrderedList,
  TaskList,
  TaskItem.configure({ nested: true })
];
const schema = getSchema(extensions);
const markdownManager = new MarkdownManager({ extensions });
const editorSource = readFileSync(
  new URL("../src/renderer/src/MarkdownWysiwygEditor.tsx", import.meta.url),
  "utf8"
);

function documentFromJSON(content) {
  return schema.nodeFromJSON({ type: "doc", content });
}

function textPosition(document, text, occurrence = 0) {
  let seen = 0;
  let position = null;
  document.descendants((node, nodePosition) => {
    if (!node.isText || !node.text?.includes(text)) {
      return position === null;
    }
    if (seen === occurrence) {
      position = nodePosition + node.text.indexOf(text);
      return false;
    }
    seen += 1;
    return true;
  });
  assert.notEqual(position, null, `Could not find text: ${text}`);
  return position;
}

function editorHarness(document, from, to = from, plugins = [], selectAll = false) {
  let state = EditorState.create({
    schema,
    doc: document,
    selection: selectAll
      ? new AllSelection(document)
      : TextSelection.create(document, from, to),
    plugins
  });
  const editor = {
    get state() {
      return state;
    },
    view: {
      dispatch(transaction) {
        state = state.apply(transaction);
      }
    },
    commands: {
      focus() {
        return true;
      }
    }
  };
  return {
    editor,
    get state() {
      return state;
    }
  };
}

function serializeDocument(document) {
  return serializeMarkdownWithPersistentEmptyParagraphs({
    getJSON() {
      return document.toJSON();
    },
    markdown: markdownManager
  });
}

test("multi-paragraph selections become one code block", () => {
  const document = documentFromJSON([
    { type: "paragraph", content: [{ type: "text", text: "A" }] },
    { type: "paragraph", content: [{ type: "text", text: "B" }] },
    { type: "paragraph", content: [{ type: "text", text: "C" }] }
  ]);
  const harness = editorHarness(
    document,
    textPosition(document, "A"),
    textPosition(document, "C") + 1
  );

  assert.equal(toggleUnifiedCodeBlock(harness.editor), true);
  assert.equal(harness.state.doc.childCount, 1);
  assert.equal(harness.state.doc.firstChild.type.name, "codeBlock");
  assert.equal(harness.state.doc.firstChild.textContent, "A\nB\nC");
});

test("mixed selections convert supported groups, keep atomic boundaries, and undo in one step", () => {
  const paragraphType = schema.nodes.paragraph;
  const paragraph = (text) => paragraphType.create(
    null,
    text ? schema.text(text) : undefined
  );
  const listItem = (text) => schema.nodes.listItem.create(null, paragraph(text));
  const taskItem = (text, checked) => schema.nodes.taskItem.create(
    { checked },
    paragraph(text)
  );
  const document = schema.nodes.doc.create(null, [
    schema.nodes.blockquote.create(null, [paragraph("Quote A"), paragraph("Quote B")]),
    paragraph("Normal C"),
    schema.nodes.horizontalRule.create(),
    schema.nodes.orderedList.create(
      { start: 7, sequenceMode: "custom" },
      [listItem("Ordered A"), listItem("Ordered B")]
    ),
    schema.nodes.taskList.create(
      null,
      [taskItem("Task done", true), taskItem("Task open", false)]
    ),
    paragraph("")
  ]);
  const originalJSON = document.toJSON();
  const harness = editorHarness(
    document,
    textPosition(document, "Quote A"),
    textPosition(document, "Task open") + "Task open".length,
    [history()],
    true
  );

  assert.equal(toggleUnifiedCodeBlock(harness.editor), true);
  assert.deepEqual(
    Array.from({ length: harness.state.doc.childCount }, (_, index) =>
      harness.state.doc.child(index).type.name
    ),
    ["codeBlock", "horizontalRule", "codeBlock", "paragraph"]
  );
  assert.equal(harness.state.doc.child(0).textContent, "Quote A\nQuote B\nNormal C");
  assert.equal(
    harness.state.doc.child(2).textContent,
    "Ordered A\nOrdered B\nTask done\nTask open"
  );

  assert.equal(undo(harness.state, (transaction) => harness.editor.view.dispatch(transaction)), true);
  assert.deepEqual(harness.state.doc.toJSON(), originalJSON);
});

test("immediate paste and code-block conversion remain separate undo steps", () => {
  const initialDocument = documentFromJSON([
    { type: "paragraph", content: [{ type: "text", text: "Seed" }] }
  ]);
  const pastedDocument = documentFromJSON([
    { type: "paragraph", content: [{ type: "text", text: "A" }] },
    { type: "paragraph", content: [{ type: "text", text: "B" }] }
  ]);
  const harness = editorHarness(
    initialDocument,
    0,
    0,
    [history()],
    true
  );

  const pasteTransaction = harness.state.tr
    .replaceWith(0, harness.state.doc.content.size, pastedDocument.content);
  pasteTransaction
    .setSelection(new AllSelection(pasteTransaction.doc))
    .setMeta("uiEvent", "paste");
  harness.editor.view.dispatch(pasteTransaction);

  assert.equal(toggleUnifiedCodeBlock(harness.editor), true);
  assert.equal(harness.state.doc.firstChild.type.name, "codeBlock");
  assert.equal(harness.state.doc.firstChild.textContent, "A\nB");

  assert.equal(undo(harness.state, (transaction) => harness.editor.view.dispatch(transaction)), true);
  assert.deepEqual(harness.state.doc.toJSON(), pastedDocument.toJSON());

  assert.equal(undo(harness.state, (transaction) => harness.editor.view.dispatch(transaction)), true);
  assert.deepEqual(harness.state.doc.toJSON(), initialDocument.toJSON());
});

test("legacy hard breaks and empty paragraphs keep their visible lines in one code block", () => {
  const hardBreakDocument = documentFromJSON([
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A" },
        { type: "hardBreak" },
        { type: "text", text: "B" }
      ]
    }
  ]);
  const hardBreakHarness = editorHarness(
    hardBreakDocument,
    textPosition(hardBreakDocument, "A"),
    textPosition(hardBreakDocument, "B") + 1
  );
  assert.equal(toggleUnifiedCodeBlock(hardBreakHarness.editor), true);
  assert.equal(hardBreakHarness.state.doc.firstChild.textContent, "A\nB");

  const emptyParagraphDocument = documentFromJSON([
    { type: "paragraph", content: [{ type: "text", text: "A" }] },
    { type: "paragraph" },
    { type: "paragraph", content: [{ type: "text", text: "C" }] }
  ]);
  const emptyParagraphHarness = editorHarness(
    emptyParagraphDocument,
    textPosition(emptyParagraphDocument, "A"),
    textPosition(emptyParagraphDocument, "C") + 1
  );
  assert.equal(toggleUnifiedCodeBlock(emptyParagraphHarness.editor), true);
  assert.equal(emptyParagraphHarness.state.doc.firstChild.textContent, "A\n\nC");
});

test("turning a unified code block off restores one paragraph per code line", () => {
  const document = documentFromJSON([
    { type: "codeBlock", content: [{ type: "text", text: "A\n\nC" }] }
  ]);
  const harness = editorHarness(document, textPosition(document, "A") + 1);

  assert.equal(toggleUnifiedCodeBlock(harness.editor), true);
  assert.deepEqual(
    harness.state.doc.toJSON().content,
    [
      { type: "paragraph", content: [{ type: "text", text: "A" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "C" }] }
    ]
  );
});

test("legacy hard breaks remain compatible but no longer own keyboard shortcuts", () => {
  const parsed = markdownManager.parse("A\\\nB");
  assert.equal(parsed.content[0].content[1].type, "hardBreak");
  assert.equal(markdownManager.serialize(parsed), "A\\\nB");
  assert.deepEqual(FlowShuttleHardBreak.config.addKeyboardShortcuts?.call({}), {});
  assert.match(editorSource, /"Shift-Enter": \(\) => this\.editor\.commands\.enter\(\)/);
  assert.match(editorSource, /toggleUnifiedCodeBlock\(editor\)/);
});

test("empty paragraphs persist between text and list blocks without storing trailing editor space", () => {
  const paragraphType = schema.nodes.paragraph;
  const taskItemType = schema.nodes.taskItem;
  const taskListType = schema.nodes.taskList;
  const paragraph = (text) => paragraphType.create(
    null,
    text ? schema.text(text) : undefined
  );
  const taskList = (text) => taskListType.create(
    null,
    taskItemType.create({ checked: false }, paragraph(text))
  );

  const textDocument = schema.nodes.doc.create(null, [
    paragraph("A"),
    paragraph(""),
    paragraph("C")
  ]);
  const textMarkdown = serializeDocument(textDocument);
  assert.equal(textMarkdown, "A\n\n&nbsp;\n\nC");
  assert.deepEqual(
    schema.nodeFromJSON(markdownManager.parse(textMarkdown)).toJSON(),
    textDocument.toJSON()
  );

  const separatedListsDocument = schema.nodes.doc.create(null, [
    taskList("A"),
    paragraph(""),
    taskList("C")
  ]);
  const separatedListsMarkdown = serializeDocument(separatedListsDocument);
  assert.match(separatedListsMarkdown, /- \[ \] A\n\n&nbsp;\n\n- \[ \] C/);
  assert.deepEqual(
    schema.nodeFromJSON(markdownManager.parse(separatedListsMarkdown)).toJSON(),
    separatedListsDocument.toJSON()
  );

  const trailingEditorParagraphDocument = schema.nodes.doc.create(null, [
    taskList("A"),
    paragraph("")
  ]);
  const trailingMarkdown = serializeDocument(trailingEditorParagraphDocument);
  assert.doesNotMatch(trailingMarkdown, /&nbsp;/);
  assert.equal(trailingMarkdown.replace(/\n+$/g, ""), "- [ ] A");
});

test("plain-text clipboard parsing preserves internal blank lines without inventing a trailing paragraph", () => {
  const withBlankLine = plainTextClipboardSlice("A\r\n\r\nC", schema);
  assert.deepEqual(
    Array.from({ length: withBlankLine.content.childCount }, (_, index) =>
      withBlankLine.content.child(index).textContent
    ),
    ["A", "", "C"]
  );

  const oneTrailingNewline = plainTextClipboardSlice("A\n", schema);
  assert.equal(oneTrailingNewline.content.childCount, 1);
  assert.equal(oneTrailingNewline.content.firstChild.textContent, "A");
});
