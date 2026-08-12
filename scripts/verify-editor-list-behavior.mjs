import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  FlowShuttleListBehavior,
  FlowShuttleOrderedList,
  canIndentListItem,
  formatOrderedListMarker,
  getActiveListType,
  getCurrentOrderedListNumber,
  setCurrentOrderedListSequence
} from "../src/renderer/src/editorListBehavior.ts";

const extensions = [
  StarterKit.configure({ orderedList: false }),
  FlowShuttleOrderedList
];
const markdownManager = new MarkdownManager({ extensions });
const schema = getSchema(extensions);
const editorStyles = readFileSync(
  new URL("../src/renderer/src/styles.css", import.meta.url),
  "utf8"
);

function markdownDocument(markdown) {
  return schema.nodeFromJSON(markdownManager.parse(markdown));
}

function positionInsideText(document, text) {
  let position = null;
  document.descendants((node, nodePosition) => {
    if (position === null && node.isText && node.text?.includes(text)) {
      position = nodePosition + Math.min(1, node.nodeSize);
      return false;
    }
    return position === null;
  });
  assert.notEqual(position, null, `Could not find text: ${text}`);
  return position;
}

function editorHarness(markdown, selectedText) {
  const document = markdownDocument(markdown);
  let state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, positionInsideText(document, selectedText))
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

test("ordered-list sequence metadata survives Markdown round trips", () => {
  const source = [
    "1. one",
    "2. two",
    "",
    "1. restart",
    "",
    "04. continued",
    "",
    "007. custom",
    "8. next",
    "",
    "1. parent",
    "  1. nested one",
    "  004. nested custom"
  ].join("\n");

  const first = markdownManager.parse(source);
  const serialized = markdownManager.serialize(first);
  const second = markdownManager.parse(serialized);

  assert.equal(serialized, source);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.content.filter((node) => node.type === "orderedList").map((node) => node.attrs),
    [
      { start: 1, sequenceMode: "new" },
      { start: 1, sequenceMode: "new" },
      { start: 4, sequenceMode: "continue" },
      { start: 7, sequenceMode: "custom" },
      { start: 1, sequenceMode: "new" }
    ]
  );
});

test("ordinary repeated Markdown markers remain one ordered list", () => {
  const parsed = markdownManager.parse("1. first\n1. second");
  assert.equal(parsed.content.length, 1);
  assert.equal(parsed.content[0].content.length, 2);
  assert.equal(markdownManager.serialize(parsed), "1. first\n2. second");
});

test("numbering actions split at the current item without changing previous items", () => {
  const startNew = editorHarness("1. one\n2. two\n3. three", "two");
  assert.equal(setCurrentOrderedListSequence(startNew.editor, "new"), true);
  assert.equal(markdownManager.serialize(startNew.state.doc.toJSON()), "1. one\n\n1. two\n2. three");

  const continueList = editorHarness("1. one\n2. two\n3. three", "two");
  assert.equal(setCurrentOrderedListSequence(continueList.editor, "continue"), true);
  assert.equal(markdownManager.serialize(continueList.state.doc.toJSON()), "1. one\n\n02. two\n3. three");

  const customValue = editorHarness("1. one\n2. two\n3. three", "two");
  assert.equal(setCurrentOrderedListSequence(customValue.editor, "custom", 7), true);
  assert.equal(markdownManager.serialize(customValue.state.doc.toJSON()), "1. one\n\n007. two\n8. three");
});

test("numbering actions work at alphabetic and Roman display levels", () => {
  const source = [
    "1. parent",
    "  1. alpha one",
    "  2. alpha two",
    "    1. roman one",
    "    2. roman two"
  ].join("\n");

  const alphabetic = editorHarness(source, "alpha two");
  assert.equal(getCurrentOrderedListNumber(alphabetic.editor), 2);
  assert.equal(setCurrentOrderedListSequence(alphabetic.editor, "custom", 4), true);
  assert.match(markdownManager.serialize(alphabetic.state.doc.toJSON()), /004\. alpha two/);

  const romanContinued = editorHarness(source, "roman two");
  assert.equal(getCurrentOrderedListNumber(romanContinued.editor), 2);
  assert.equal(setCurrentOrderedListSequence(romanContinued.editor, "continue"), true);
  assert.match(markdownManager.serialize(romanContinued.state.doc.toJSON()), /02\. roman two/);

  const romanRestarted = editorHarness(source, "roman two");
  assert.equal(setCurrentOrderedListSequence(romanRestarted.editor, "new"), true);
  assert.match(markdownManager.serialize(romanRestarted.state.doc.toJSON()), /1\. roman two/);
});

test("number marker labels match all three visible list levels", () => {
  assert.equal(formatOrderedListMarker(12, 1), "12.");
  assert.equal(formatOrderedListMarker(1, 2), "a.");
  assert.equal(formatOrderedListMarker(27, 2), "aa.");
  assert.equal(formatOrderedListMarker(4, 3), "iv.");
  assert.equal(formatOrderedListMarker(3_999, 3), "mmmcmxcix.");
  assert.equal(formatOrderedListMarker(4_000, 3), "4000.");
});

test("number marker selection overlay is layout neutral", () => {
  const markerRule = editorStyles.match(
    /\.markdown-editor-number-marker-selection\s*\{([^}]*)\}/
  );
  assert.ok(markerRule, "Expected a selected ordered-list marker overlay rule");
  assert.match(markerRule[1], /position:\s*fixed/);
  assert.match(markerRule[1], /pointer-events:\s*none/);
  assert.doesNotMatch(markerRule[1], /margin/);
});

test("split numbering keeps the normal item-to-item vertical rhythm", () => {
  assert.match(
    editorStyles,
    /\.markdown-editor-content ol \+ ol\s*\{[^}]*margin-top:\s*-9px;/s
  );
});

test("continuation lists recalculate when the preceding list changes", () => {
  const document = markdownDocument("1. one\n\n02. two");
  const addPlugins = FlowShuttleListBehavior.config.addProseMirrorPlugins;
  assert.ok(addPlugins);
  const plugins = addPlugins.call(FlowShuttleListBehavior);
  let state = EditorState.create({ schema, doc: document, plugins });
  const firstList = state.doc.child(0);
  const result = state.applyTransaction(
    state.tr.setNodeMarkup(0, undefined, { ...firstList.attrs, start: 4 })
  );
  state = result.state;

  assert.equal(state.doc.child(1).attrs.start, 5);
  assert.equal(state.doc.child(1).attrs.sequenceMode, "continue");
});

test("indent creation is blocked at the third list level", () => {
  const document = markdownDocument([
    "1. level one",
    "  1. level two",
    "    1. level three",
    "  2. level two sibling"
  ].join("\n"));
  let state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, positionInsideText(document, "level three"))
  });
  const editor = {
    get state() {
      return state;
    },
    isActive(name) {
      return name === "listItem";
    },
    can() {
      return {
        sinkListItem() {
          return true;
        }
      };
    }
  };

  assert.equal(canIndentListItem(editor), false);

  state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, positionInsideText(document, "level two sibling"))
  });
  assert.equal(canIndentListItem(editor), true);

  state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, positionInsideText(document, "level one"))
  });
  assert.equal(canIndentListItem(editor), false);
});

test("numbering actions target the nearest list level only", () => {
  const document = markdownDocument([
    "1. ordered parent",
    "  - bullet child"
  ].join("\n"));
  const state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, positionInsideText(document, "bullet child"))
  });
  const editor = { state };

  assert.equal(getActiveListType(editor), "bulletList");
  assert.equal(getCurrentOrderedListNumber(editor), null);
});
