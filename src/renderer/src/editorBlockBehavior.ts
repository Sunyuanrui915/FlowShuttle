import type { Editor, JSONContent } from "@tiptap/core";
import HardBreak from "@tiptap/extension-hard-break";
import {
  Fragment,
  Slice,
  type Mark,
  type Node as ProseMirrorNode,
  type Schema
} from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";

interface SelectedTopLevelBlock {
  node: ProseMirrorNode;
  from: number;
  to: number;
  codeLines: string[] | null;
}

interface CodeBlockConversionGroup {
  from: number;
  to: number;
  lines: string[];
}

interface CodeBlockReplacement {
  from: number;
  to: number;
  content: ProseMirrorNode | Fragment;
}

const emptyParagraphSerializationMarker = "FLOWSHUTTLEEMPTYPARAGRAPH7C6E7F";
const emptyParagraphMarkdown = "&nbsp;";

export const FlowShuttleHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return {};
  },

  renderMarkdown: () => "\\\n"
});

function prepareEmptyParagraphsForMarkdown(
  node: JSONContent,
  parentType: string | null = null,
  index = 0,
  siblingCount = 1
): JSONContent {
  const content = Array.isArray(node.content) ? node.content : [];
  const isEmptyParagraph = node.type === "paragraph" && content.length === 0;
  const isListItemParagraph = parentType === "listItem" || parentType === "taskItem";
  const isSoleListItemParagraph = isListItemParagraph && siblingCount === 1;
  const isAutomaticTrailingParagraph = parentType === "doc" && index === siblingCount - 1;

  if (isEmptyParagraph && !isSoleListItemParagraph && !isAutomaticTrailingParagraph) {
    return {
      ...node,
      content: [{ type: "text", text: emptyParagraphSerializationMarker }]
    };
  }

  if (content.length === 0) {
    return { ...node };
  }

  return {
    ...node,
    content: content.map((child, childIndex) =>
      prepareEmptyParagraphsForMarkdown(child, node.type ?? null, childIndex, content.length)
    )
  };
}

export function serializeMarkdownWithPersistentEmptyParagraphs(editor: Editor): string {
  const markdownEditor = editor as Editor & {
    getMarkdown?: () => string;
    markdown?: { serialize: (content: JSONContent) => string };
  };
  const prepared = prepareEmptyParagraphsForMarkdown(editor.getJSON());
  const serialized = markdownEditor.markdown?.serialize(prepared)
    ?? markdownEditor.getMarkdown?.()
    ?? "";
  return serialized.replaceAll(emptyParagraphSerializationMarker, emptyParagraphMarkdown);
}

export function plainTextClipboardSlice(
  value: string,
  schema: Schema,
  marks: readonly Mark[] = []
): Slice {
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }
  const paragraphType = schema.nodes.paragraph;
  const paragraphs = lines.map((line) => paragraphType.create(
    null,
    line ? schema.text(line, [...marks]) : undefined
  ));
  return new Slice(Fragment.fromArray(paragraphs), 0, 0);
}

function textBlockContent(node: ProseMirrorNode): string | null {
  let unsupported = false;
  node.descendants((child) => {
    if (child.isLeaf && !child.isText && child.type.name !== "hardBreak") {
      unsupported = true;
      return false;
    }
    return !unsupported;
  });
  return unsupported
    ? null
    : node.textBetween(0, node.content.size, "\n", "\n");
}

function convertibleNodeLines(node: ProseMirrorNode, listDepth = 0): string[] | null {
  if (node.type.name === "paragraph" || node.type.name === "heading" || node.type.name === "codeBlock") {
    const content = textBlockContent(node);
    if (content === null) {
      return null;
    }
    const indentation = listDepth > 0 ? "  ".repeat(listDepth) : "";
    return content.split("\n").map((line) => `${indentation}${line}`);
  }

  const isContainer = node.type.name === "blockquote"
    || node.type.name === "bulletList"
    || node.type.name === "orderedList"
    || node.type.name === "taskList"
    || node.type.name === "listItem"
    || node.type.name === "taskItem";
  if (!isContainer) {
    return null;
  }

  const lines: string[] = [];
  let unsupported = false;
  node.forEach((child) => {
    if (unsupported) {
      return;
    }
    const childIsNestedList = child.type.name === "bulletList"
      || child.type.name === "orderedList"
      || child.type.name === "taskList";
    const childLines = convertibleNodeLines(
      child,
      childIsNestedList && (node.type.name === "listItem" || node.type.name === "taskItem")
        ? listDepth + 1
        : listDepth
    );
    if (childLines === null) {
      unsupported = true;
      return;
    }
    lines.push(...childLines);
  });
  return unsupported ? null : lines;
}

function selectedTopLevelBlocks(editor: Editor): SelectedTopLevelBlock[] {
  const { doc, selection } = editor.state;
  const selected: SelectedTopLevelBlock[] = [];

  doc.forEach((node, offset, index) => {
    const nodeEnd = offset + node.nodeSize;
    const overlapsSelection = selection.empty
      ? selection.from > offset && selection.from < nodeEnd
      : selection.from < nodeEnd && selection.to > offset;
    const isAutomaticTrailingParagraph = doc.childCount > 1
      && index === doc.childCount - 1
      && node.type.name === "paragraph"
      && node.content.size === 0;
    if (overlapsSelection && !isAutomaticTrailingParagraph) {
      selected.push({
        node,
        from: offset,
        to: nodeEnd,
        codeLines: convertibleNodeLines(node)
      });
    }
  });
  return selected;
}

function conversionGroups(blocks: SelectedTopLevelBlock[]): CodeBlockConversionGroup[] {
  const groups: CodeBlockConversionGroup[] = [];
  let current: CodeBlockConversionGroup | null = null;

  blocks.forEach((block) => {
    if (block.codeLines === null) {
      current = null;
      return;
    }
    if (!current) {
      current = { from: block.from, to: block.to, lines: [...block.codeLines] };
      groups.push(current);
      return;
    }
    current.to = block.to;
    current.lines.push(...block.codeLines);
  });
  return groups;
}

function paragraphNodesFromCodeBlock(
  editor: Editor,
  node: ProseMirrorNode
): ProseMirrorNode[] {
  const paragraphType = editor.state.schema.nodes.paragraph;
  const textType = editor.state.schema.text.bind(editor.state.schema);
  return node.textContent.split("\n").map((line) =>
    paragraphType.create(null, line ? textType(line) : undefined)
  );
}

export function toggleUnifiedCodeBlock(editor: Editor): boolean {
  const blocks = selectedTopLevelBlocks(editor);
  const convertibleBlocks = blocks.filter((block) => block.codeLines !== null);
  if (convertibleBlocks.length === 0) {
    return false;
  }

  const allConvertibleBlocksAreCode = convertibleBlocks.every(
    ({ node }) => node.type.name === "codeBlock"
  );
  const replacements: CodeBlockReplacement[] = [];
  if (allConvertibleBlocksAreCode) {
    convertibleBlocks.forEach((block) => {
      replacements.push({
        from: block.from,
        to: block.to,
        content: Fragment.fromArray(paragraphNodesFromCodeBlock(editor, block.node))
      });
    });
  } else {
    const codeBlockType = editor.state.schema.nodes.codeBlock;
    conversionGroups(blocks).forEach((group) => {
      const codeText = group.lines.join("\n");
      replacements.push({
        from: group.from,
        to: group.to,
        content: codeBlockType.create(
          null,
          codeText ? editor.state.schema.text(codeText) : undefined
        )
      });
    });
  }
  if (replacements.length === 0) {
    return false;
  }

  const transaction = closeHistory(editor.state.tr);
  [...replacements]
    .sort((left, right) => right.from - left.from)
    .forEach((replacement) => {
      transaction.replaceWith(replacement.from, replacement.to, replacement.content);
    });

  const firstReplacementStart = transaction.mapping.map(replacements[0].from, -1);
  const selectionPosition = Math.min(
    transaction.doc.content.size,
    Math.max(0, firstReplacementStart + 1)
  );
  transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(selectionPosition), 1)
  );

  editor.view.dispatch(transaction.scrollIntoView());
  editor.commands.focus();
  return true;
}
