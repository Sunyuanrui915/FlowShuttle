import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { history, undo, redo } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { FlowShuttleImage } from "../src/renderer/src/editorImagePresentation.ts";
import { FlowShuttleOrderedList } from "../src/renderer/src/editorListBehavior.ts";
import { FlowShuttleHardBreak, serializeMarkdownWithPersistentEmptyParagraphs } from "../src/renderer/src/editorBlockBehavior.ts";
import { FlowShuttleHighlight, FlowShuttleTextColor, FlowShuttleUnderline } from "../src/renderer/src/editorInlineFormatting.ts";
import {
  closeEditorSearch,
  createEditorSearchPlugin,
  findEditorMatches,
  getEditorSearch,
  moveEditorSearch,
  replaceEditorMatches,
  updateEditorSearch
} from "../src/renderer/src/editorSearch.ts";

const extensions = [
  StarterKit.configure({ hardBreak: false, orderedList: false, underline: false }),
  FlowShuttleHardBreak, FlowShuttleOrderedList, FlowShuttleImage,
  FlowShuttleHighlight, FlowShuttleTextColor, FlowShuttleUnderline,
  TaskList, TaskItem.configure({ nested: true })
];
const schema = getSchema(extensions);
const markdown = new MarkdownManager({ extensions });
const text = (value, marks) => schema.text(value, marks);
const paragraph = (...content) => schema.nodes.paragraph.create(null, content);
const document = (...content) => schema.nodes.doc.create(null, content);
const serialize = (doc) => serializeMarkdownWithPersistentEmptyParagraphs({
  getJSON: () => doc.toJSON(), markdown
});

function harness(doc, editable = true) {
  let state = EditorState.create({ doc, plugins: [history(), createEditorSearchPlugin()] });
  let documentChanges = 0;
  const editor = {
    isEditable: editable,
    get state() { return state; },
    view: {
      dispatch(transaction) {
        if (transaction.docChanged) documentChanges += 1;
        state = state.apply(transaction);
      }
    }
  };
  return {
    editor,
    get changes() { return documentChanges; },
    find(query, options = {}) { updateEditorSearch(editor, { open: true, query, ...options }); },
    undo() { return undo(state, editor.view.dispatch); },
    redo() { return redo(state, editor.view.dispatch); }
  };
}

test("literal search handles Chinese, whitespace, case, punctuation, and non-overlapping matches", () => {
  const doc = document(paragraph(text("流梭 流梭 Flow flow FLOW a.b [x] $& \\ aaaa")));
  assert.equal(findEditorMatches(doc, "流梭").length, 2);
  assert.equal(findEditorMatches(doc, "Flow").length, 3);
  assert.equal(findEditorMatches(doc, "Flow", true).length, 1);
  for (const query of ["a.b", "[x]", "$&", "\\", " "]) {
    const matches = findEditorMatches(doc, query);
    assert.ok(matches.length > 0);
    assert.ok(matches.every(({ from, to }) => doc.textBetween(from, to) === query));
  }
  assert.equal(findEditorMatches(doc, "aa").length, 2);
  assert.deepEqual(findEditorMatches(doc, ""), []);
  assert.deepEqual(findEditorMatches(doc, "missing"), []);
});

test("Unicode case handling preserves original offsets after expanding lowercase and emoji", () => {
  const doc = document(paragraph(text("İ 👩🏽‍💻 FLOW 流梭 𐐀 𐐨")));
  for (const query of ["flow", "流梭", "👩🏽‍💻", "𐐀"]) {
    const matches = findEditorMatches(doc, query);
    assert.ok(matches.length);
    const expression = new RegExp(`^(?:${query})$`, "iu");
    assert.ok(matches.every(({ from, to }) => expression.test(doc.textBetween(from, to))));
  }
  assert.equal(findEditorMatches(doc, "𐐀").length, 2);
});

test("matches span inline formatting but never cross blocks, hard breaks, or images", () => {
  const doc = document(
    paragraph(text("流", [schema.marks.bold.create()]), text("梭")),
    paragraph(text("流")), paragraph(text("梭")),
    paragraph(text("流"), schema.nodes.hardBreak.create(), text("梭")),
    schema.nodes.image.create({ src: "attachment://流梭.png", alt: "流梭" }),
    schema.nodes.codeBlock.create(null, text("流梭"))
  );
  const matches = findEditorMatches(doc, "流梭");
  assert.equal(matches.length, 2);
  assert.equal(doc.textBetween(matches[0].from, matches[0].to), "流梭");
  assert.equal(findEditorMatches(doc, "流梭.png").length, 0);
});

test("finding, navigating, case toggling and closing never change Markdown or history", () => {
  const doc = document(paragraph(text("Alpha alpha")));
  const h = harness(doc);
  const before = serialize(doc);
  h.find("alpha");
  assert.equal(getEditorSearch(h.editor).decorations.find().length, 2);
  moveEditorSearch(h.editor, -1);
  assert.equal(getEditorSearch(h.editor).activeIndex, 1);
  moveEditorSearch(h.editor, 1);
  assert.equal(getEditorSearch(h.editor).activeIndex, 0);
  updateEditorSearch(h.editor, { caseSensitive: true });
  assert.equal(getEditorSearch(h.editor).matches.length, 1);
  updateEditorSearch(h.editor, { open: false });
  assert.equal(getEditorSearch(h.editor).decorations.find().length, 0);
  assert.equal(serialize(h.editor.state.doc), before);
  assert.equal(h.changes, 0);
  assert.equal(h.undo(), false);
});

test("opening chooses the next match at the caret and wraps at the document end", () => {
  const h = harness(document(paragraph(text("a a a"))));
  h.editor.view.dispatch(h.editor.state.tr.setSelection(TextSelection.create(h.editor.state.doc, 3)));
  h.find("a");
  assert.equal(getEditorSearch(h.editor).activeIndex, 1);
  updateEditorSearch(h.editor, { preferredFrom: 6 });
  assert.equal(getEditorSearch(h.editor).activeIndex, 0);
});

test("closing clears the query and highlights, preserves case preference, and collapses the internal selection", () => {
  const doc = document(paragraph(text("Flow Flow")));
  const h = harness(doc);
  h.find("Flow", { caseSensitive: true });
  moveEditorSearch(h.editor, 1);
  const matchEnd = getEditorSearch(h.editor).matches[1].to;
  closeEditorSearch(h.editor);
  const search = getEditorSearch(h.editor);
  assert.equal(search.open, false);
  assert.equal(search.query, "");
  assert.equal(search.caseSensitive, true);
  assert.deepEqual(search.matches, []);
  assert.equal(search.decorations.find().length, 0);
  assert.equal(h.editor.state.selection.empty, true);
  assert.equal(h.editor.state.selection.from, matchEnd);
  assert.deepEqual(h.editor.state.doc.toJSON(), doc.toJSON());
  assert.equal(h.changes, 0);
  assert.equal(h.undo(), false);
  updateEditorSearch(h.editor, { open: true });
  assert.equal(getEditorSearch(h.editor).query, "");
  assert.equal(getEditorSearch(h.editor).matches.length, 0);
  closeEditorSearch(h.editor);
  h.editor.view.dispatch(h.editor.state.tr.insertText("!"));
  assert.equal(h.editor.state.doc.textContent, "Flow Flow!");
});

test("closing a no-result search also collapses a pre-existing text selection", () => {
  const h = harness(document(paragraph(text("保持原文"))));
  h.editor.view.dispatch(h.editor.state.tr.setSelection(TextSelection.create(h.editor.state.doc, 1, 5)));
  h.find("没有匹配");
  closeEditorSearch(h.editor);
  assert.equal(h.editor.state.selection.empty, true);
  assert.equal(h.editor.state.selection.from, 5);
  h.editor.view.dispatch(h.editor.state.tr.insertText("!"));
  assert.equal(h.editor.state.doc.textContent, "保持原文!");
});

test("closing after replace all leaves its undo event intact", () => {
  const doc = document(paragraph(text("a a")));
  const h = harness(doc);
  h.find("a");
  replaceEditorMatches(h.editor, "b", true);
  closeEditorSearch(h.editor);
  assert.equal(h.editor.state.selection.empty, true);
  assert.equal(h.undo(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), doc.toJSON());
  assert.equal(getEditorSearch(h.editor).open, false);
  assert.equal(getEditorSearch(h.editor).query, "");
});

test("replacement is literal, inherits the first character's marks, and preserves surrounding formats", () => {
  const bold = schema.marks.bold.create();
  const italic = schema.marks.italic.create();
  const h = harness(document(paragraph(text("前 "), text("流", [bold]), text("梭", [italic]), text(" 后", [italic]))));
  h.find("流梭");
  const replacement = "$& <b>普通</b> **文本**";
  assert.equal(replaceEditorMatches(h.editor, replacement), 1);
  assert.equal(h.editor.state.doc.textContent, `前 ${replacement} 后`);
  assert.deepEqual(h.editor.state.doc.firstChild.child(1).marks.map((mark) => mark.type.name), ["bold"]);
  assert.deepEqual(h.editor.state.doc.firstChild.lastChild.marks.map((mark) => mark.type.name), ["italic"]);
});

test("replace all preserves lists, task state, colors, images and empty paragraphs through save/reopen", () => {
  const doc = document(
    schema.nodes.heading.create({ level: 2 }, text("标题 流梭")),
    paragraph(),
    schema.nodes.orderedList.create({ start: 7, sequenceMode: "custom" }, [
      schema.nodes.listItem.create(null, paragraph(text("流梭")))
    ]),
    schema.nodes.taskList.create(null, [
      schema.nodes.taskItem.create({ checked: true }, paragraph(text("流梭")))
    ]),
    schema.nodes.blockquote.create(null, paragraph(text("流梭", [schema.marks.highlight.create({ color: "green" })]))),
    paragraph(text("流梭", [schema.marks.flowShuttleTextColor.create({ color: "red" })])),
    schema.nodes.image.create({ src: "attachment://example.png", alt: "流梭" }),
    schema.nodes.codeBlock.create(null, text("流梭"))
  );
  const h = harness(doc);
  h.find("流梭");
  assert.equal(replaceEditorMatches(h.editor, "新名称", true), 6);
  const after = h.editor.state.doc;
  assert.equal(after.childCount, doc.childCount);
  assert.equal(after.child(1).content.size, 0);
  assert.deepEqual(after.child(2).attrs, doc.child(2).attrs);
  assert.equal(after.child(3).firstChild.attrs.checked, true);
  assert.deepEqual(after.child(6).toJSON(), doc.child(6).toJSON());
  const saved = serialize(after);
  assert.doesNotMatch(saved, /markdown-editor-search-match/);
  assert.equal(serialize(schema.nodeFromJSON(markdown.parse(saved))), saved);
  assert.equal(h.undo(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), doc.toJSON());
  assert.equal(h.redo(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), after.toJSON());
});

test("an empty replacement deletes only the matched text and leaves block structure intact", () => {
  const h = harness(document(paragraph(text("a")), paragraph(text("a tail"))));
  h.find("a");
  assert.equal(replaceEditorMatches(h.editor, "", true), 3);
  assert.equal(h.editor.state.doc.childCount, 2);
  assert.equal(h.editor.state.doc.firstChild.content.size, 0);
  assert.equal(h.editor.state.doc.lastChild.textContent, " til");
});

test("single replacement advances past newly inserted self-matches; replace all uses a fixed match set", () => {
  const h = harness(document(paragraph(text("a a"))));
  h.find("a");
  replaceEditorMatches(h.editor, "aa");
  const search = getEditorSearch(h.editor);
  assert.equal(search.matches[search.activeIndex].from, 4);
  assert.equal(replaceEditorMatches(h.editor, "aa", true), 3);
  assert.equal(h.editor.state.doc.textContent, "aaaa aa");
});

test("the replacement undo event is separated from preceding and subsequent typing", () => {
  const original = document(paragraph(text("a a")));
  const h = harness(original);
  h.editor.view.dispatch(h.editor.state.tr.insertText("prefix ", 1));
  const beforeReplace = h.editor.state.doc.toJSON();
  h.find("a");
  replaceEditorMatches(h.editor, "x", true);
  const afterReplace = h.editor.state.doc.toJSON();
  h.editor.view.dispatch(h.editor.state.tr.insertText("suffix", h.editor.state.doc.content.size - 1));
  assert.equal(h.undo(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), afterReplace);
  assert.equal(h.undo(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), beforeReplace);
  assert.equal(h.undo(), true);
  assert.deepEqual(h.editor.state.doc.toJSON(), original.toJSON());
});

test("open search recomputes after edits, undo, and external content replacement", () => {
  const h = harness(document(paragraph(text("a a"))));
  h.find("a");
  moveEditorSearch(h.editor, 1);
  h.editor.view.dispatch(h.editor.state.tr.insertText("pre ", 1));
  assert.equal(getEditorSearch(h.editor).matches[getEditorSearch(h.editor).activeIndex].from, 7);
  replaceEditorMatches(h.editor, "x");
  assert.equal(getEditorSearch(h.editor).matches.length, 1);
  h.undo();
  assert.equal(getEditorSearch(h.editor).matches.length, 2);
  h.editor.view.dispatch(h.editor.state.tr.replaceWith(0, h.editor.state.doc.content.size, paragraph(text("none"))));
  assert.equal(getEditorSearch(h.editor).matches.length, 0);
  assert.equal(getEditorSearch(h.editor).activeIndex, -1);
});

test("read-only editors can find but cannot replace; instances keep search state isolated", () => {
  const h = harness(document(paragraph(text("a a"))), false);
  const other = harness(document(paragraph(text("a"))));
  h.find("a");
  assert.equal(getEditorSearch(h.editor).matches.length, 2);
  assert.equal(replaceEditorMatches(h.editor, "b", true), 0);
  assert.equal(h.changes, 0);
  assert.equal(getEditorSearch(other.editor).open, false);
  assert.equal(getEditorSearch(other.editor).query, "");
});
