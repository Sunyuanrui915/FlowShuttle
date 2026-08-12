import {
  Extension,
  type Editor,
  type JSONContent,
  type MarkdownParseHelpers,
  type MarkdownRendererHelpers,
  type MarkdownToken
} from "@tiptap/core";
import { OrderedList } from "@tiptap/extension-list";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const MAX_LIST_LEVEL = 3;
export const MAX_ORDERED_LIST_VALUE = 9_999_999;

export type OrderedListSequenceMode = "new" | "continue" | "custom";
export type OrderedListMarkerLevel = 1 | 2 | 3;
export type ActiveListType = "bulletList" | "orderedList" | "taskList";

interface OrderedListMarker {
  value: number;
  mode: OrderedListSequenceMode | null;
}

interface OrderedListItemGroup {
  items: MarkdownToken[];
  start: number;
  mode: OrderedListSequenceMode;
}

interface OrderedListContext {
  listDepth: number;
  listIndex: number;
  listItemIndex: number;
  listNode: ProseMirrorNode;
  listPosition: number;
  parentNode: ProseMirrorNode;
}

interface ContinueListUpdate {
  node: ProseMirrorNode;
  position: number;
  start: number;
}

const continueListPluginKey = new PluginKey("flowShuttleOrderedListContinuation");
const listNodeNames = new Set(["bulletList", "orderedList", "taskList"]);
const baseOrderedListParseMarkdown = OrderedList.config.parseMarkdown;

function positiveInteger(value: unknown, fallback = 1): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function alphabeticMarker(value: number): string {
  let remaining = value;
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(97 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function romanMarker(value: number): string {
  if (value > 3_999) {
    return String(value);
  }

  const numerals: Array<[number, string]> = [
    [1_000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  let remaining = value;
  let result = "";
  numerals.forEach(([amount, numeral]) => {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  });
  return result;
}

export function formatOrderedListMarker(
  value: number,
  level: OrderedListMarkerLevel
): string {
  const safeValue = positiveInteger(value);
  const marker = level === 2
    ? alphabeticMarker(safeValue)
    : level === 3
      ? romanMarker(safeValue)
      : String(safeValue);
  return `${marker}.`;
}

function sanitizeSequenceMode(value: unknown): OrderedListSequenceMode {
  return value === "continue" || value === "custom" ? value : "new";
}

function orderedListMarker(item: MarkdownToken): OrderedListMarker | null {
  const firstLine = String(item.raw ?? "").split("\n", 1)[0] ?? "";
  const match = firstLine.match(/^\s*(\d+)\.\s+/);
  if (!match) {
    return null;
  }

  const rawNumber = match[1];
  const leadingZeroCount = rawNumber.match(/^0+/)?.[0].length ?? 0;
  const value = positiveInteger(Number.parseInt(rawNumber, 10));
  const mode = leadingZeroCount >= 2 ? "custom" : leadingZeroCount === 1 ? "continue" : null;
  return { value, mode };
}

function hasBlankLineAfterItem(item: MarkdownToken | undefined): boolean {
  return /\n\s*$/.test(String(item?.raw ?? ""));
}

function splitOrderedListToken(token: MarkdownToken): OrderedListItemGroup[] {
  const items = token.items ?? [];
  if (items.length === 0) {
    return [];
  }

  const groups: OrderedListItemGroup[] = [];
  let currentGroup: OrderedListItemGroup | null = null;
  let previousMarkerValue: number | null = null;

  items.forEach((item, index) => {
    const marker = orderedListMarker(item);
    const fallbackValue = index === 0
      ? positiveInteger(token.start)
      : positiveInteger((previousMarkerValue ?? index) + 1);
    const markerValue = marker?.value ?? fallbackValue;
    const isExplicitBoundary = marker?.mode !== null && marker?.mode !== undefined;
    const isSeparatedDiscontinuity =
      index > 0 &&
      markerValue !== (previousMarkerValue ?? markerValue - 1) + 1 &&
      hasBlankLineAfterItem(items[index - 1]);

    if (!currentGroup || isExplicitBoundary || isSeparatedDiscontinuity) {
      currentGroup = {
        items: [],
        start: markerValue,
        mode: marker?.mode ?? "new"
      };
      groups.push(currentGroup);
    }

    currentGroup.items.push(item);
    previousMarkerValue = markerValue;
  });

  return groups;
}

function parseOrderedListGroup(
  token: MarkdownToken,
  group: OrderedListItemGroup,
  helpers: MarkdownParseHelpers
): JSONContent[] {
  if (!baseOrderedListParseMarkdown) {
    return [];
  }

  const parsed = baseOrderedListParseMarkdown(
    {
      ...token,
      start: group.start,
      items: group.items
    },
    helpers
  );
  const parsedNodes = (Array.isArray(parsed) ? parsed : [parsed]) as JSONContent[];

  return parsedNodes.map((node) => {
    if (node.type !== "orderedList") {
      return node;
    }
    return {
      ...node,
      attrs: {
        ...node.attrs,
        start: group.start,
        sequenceMode: group.mode
      }
    };
  });
}

/**
 * Flow Shuttle keeps normal ordered lists as standard Markdown. A continuation
 * adds one leading zero to the first marker; a custom value adds two. Markdown
 * renderers still display the same positive integer, while Flow Shuttle can
 * restore the sequence behavior after a save/reopen round trip.
 */
export const FlowShuttleOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => positiveInteger(element.getAttribute("start"))
      },
      type: {
        default: null,
        parseHTML: (element) => element.getAttribute("type")
      },
      sequenceMode: {
        default: "new",
        parseHTML: (element) => sanitizeSequenceMode(element.getAttribute("data-flow-shuttle-list-sequence")),
        renderHTML: (attributes) => {
          const mode = sanitizeSequenceMode(attributes.sequenceMode);
          return mode === "new" ? {} : { "data-flow-shuttle-list-sequence": mode };
        }
      }
    };
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    if (token.type !== "list" || !token.ordered) {
      return [];
    }

    const groups = splitOrderedListToken(token);
    if (groups.length === 0) {
      return baseOrderedListParseMarkdown?.(token, helpers) ?? [];
    }
    return groups.flatMap((group) => parseOrderedListGroup(token, group, helpers));
  },

  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
    if (!node.content) {
      return "";
    }

    const rendered = helpers.renderChildren(node.content, "\n");
    const mode = sanitizeSequenceMode(node.attrs?.sequenceMode);
    if (mode === "new") {
      return rendered;
    }

    const metadataPrefix = mode === "continue" ? "0" : "00";
    return rendered.replace(/^(\s*)(\d+)(\.\s)/, `$1${metadataPrefix}$2$3`);
  }
});

function collectContinueListUpdates(
  parentNode: ProseMirrorNode,
  contentStart: number,
  updates: ContinueListUpdate[]
): void {
  let childOffset = 0;
  let previousOrderedListEnd: number | null = null;

  parentNode.forEach((child) => {
    const position = contentStart + childOffset;

    if (child.type.name === "orderedList") {
      const storedStart = positiveInteger(child.attrs.start);
      const mode = sanitizeSequenceMode(child.attrs.sequenceMode);
      const effectiveStart = mode === "continue" && previousOrderedListEnd !== null
        ? previousOrderedListEnd
        : storedStart;

      if (mode === "continue" && previousOrderedListEnd !== null && storedStart !== effectiveStart) {
        updates.push({ node: child, position, start: effectiveStart });
      }
      previousOrderedListEnd = effectiveStart + child.childCount;
    }

    if (child.childCount > 0) {
      collectContinueListUpdates(child, position + 1, updates);
    }
    childOffset += child.nodeSize;
  });
}

export const FlowShuttleListBehavior = Extension.create({
  name: "flowShuttleListBehavior",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: continueListPluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }
          if (transactions.some((transaction) => transaction.getMeta(continueListPluginKey))) {
            return null;
          }

          const updates: ContinueListUpdate[] = [];
          collectContinueListUpdates(newState.doc, 0, updates);
          if (updates.length === 0) {
            return null;
          }

          const transaction = newState.tr;
          updates.forEach(({ node, position, start }) => {
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, start });
          });
          transaction.setMeta(continueListPluginKey, true);
          transaction.setMeta("addToHistory", false);
          return transaction;
        }
      })
    ];
  }
});

function findOrderedListContext(editor: Editor): OrderedListContext | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!listNodeNames.has(node.type.name)) {
      continue;
    }
    if (node.type.name !== "orderedList") {
      return null;
    }

    return {
      listDepth: depth,
      listIndex: $from.index(depth - 1),
      listItemIndex: $from.index(depth),
      listNode: node,
      listPosition: $from.before(depth),
      parentNode: $from.node(depth - 1)
    };
  }
  return null;
}

export function getActiveListType(editor: Editor): ActiveListType | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name;
    if (listNodeNames.has(nodeName)) {
      return nodeName as ActiveListType;
    }
  }
  return null;
}

function previousOrderedListEnd(context: OrderedListContext): number | null {
  if (context.listItemIndex > 0) {
    return positiveInteger(context.listNode.attrs.start) + context.listItemIndex;
  }

  for (let index = context.listIndex - 1; index >= 0; index -= 1) {
    const sibling = context.parentNode.child(index);
    if (sibling.type.name === "orderedList") {
      return positiveInteger(sibling.attrs.start) + sibling.childCount;
    }
  }
  return null;
}

export function getCurrentOrderedListNumber(editor: Editor): number | null {
  const context = findOrderedListContext(editor);
  return context
    ? positiveInteger(context.listNode.attrs.start) + context.listItemIndex
    : null;
}

export function canContinueOrderedList(editor: Editor): boolean {
  const context = findOrderedListContext(editor);
  return context !== null && previousOrderedListEnd(context) !== null;
}

export function setCurrentOrderedListSequence(
  editor: Editor,
  mode: OrderedListSequenceMode,
  customStart?: number
): boolean {
  const context = findOrderedListContext(editor);
  if (!context) {
    return false;
  }

  const nextStart = mode === "continue"
    ? previousOrderedListEnd(context)
    : mode === "custom"
      ? customStart
      : 1;
  if (
    nextStart === null ||
    nextStart === undefined ||
    !Number.isInteger(nextStart) ||
    nextStart < 1 ||
    nextStart > MAX_ORDERED_LIST_VALUE
  ) {
    return false;
  }

  const nextAttributes = {
    ...context.listNode.attrs,
    start: nextStart,
    sequenceMode: mode
  };
  const transaction = editor.state.tr;

  if (context.listItemIndex === 0) {
    transaction.setNodeMarkup(context.listPosition, undefined, nextAttributes);
  } else {
    let splitOffset = 0;
    for (let index = 0; index < context.listItemIndex; index += 1) {
      splitOffset += context.listNode.child(index).nodeSize;
    }

    const beforeList = context.listNode.type.create(
      context.listNode.attrs,
      context.listNode.content.cut(0, splitOffset)
    );
    const afterList = context.listNode.type.create(
      nextAttributes,
      context.listNode.content.cut(splitOffset)
    );
    transaction.replaceWith(
      context.listPosition,
      context.listPosition + context.listNode.nodeSize,
      Fragment.fromArray([beforeList, afterList])
    );
  }

  editor.view.dispatch(transaction.scrollIntoView());
  editor.commands.focus();
  return true;
}

export function getActiveListItemType(editor: Editor): "listItem" | "taskItem" | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === "listItem" || nodeName === "taskItem") {
      return nodeName;
    }
  }
  return null;
}

function activeListItemNode(editor: Editor): ProseMirrorNode | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      return node;
    }
  }
  return null;
}

function nestedListDepth(node: ProseMirrorNode, depth = 0): number {
  let maximumDepth = depth;
  node.forEach((child) => {
    const childDepth = depth + (listNodeNames.has(child.type.name) ? 1 : 0);
    maximumDepth = Math.max(maximumDepth, nestedListDepth(child, childDepth));
  });
  return maximumDepth;
}

function currentListDepth(editor: Editor): number {
  const { $from } = editor.state.selection;
  let depth = 0;
  for (let index = 1; index <= $from.depth; index += 1) {
    if (listNodeNames.has($from.node(index).type.name)) {
      depth += 1;
    }
  }
  return depth;
}

export function canIndentListItem(editor: Editor): boolean {
  const itemType = getActiveListItemType(editor);
  const itemNode = activeListItemNode(editor);
  const deepestAffectedLevel = itemNode
    ? currentListDepth(editor) + nestedListDepth(itemNode)
    : MAX_LIST_LEVEL;
  return Boolean(
    itemType &&
    deepestAffectedLevel < MAX_LIST_LEVEL &&
    editor.can().sinkListItem(itemType)
  );
}

export function canOutdentListItem(editor: Editor): boolean {
  const itemType = getActiveListItemType(editor);
  return Boolean(itemType && editor.can().liftListItem(itemType));
}

export function indentListItem(editor: Editor): boolean {
  const itemType = getActiveListItemType(editor);
  if (!itemType || !canIndentListItem(editor)) {
    return false;
  }
  return editor.chain().focus().sinkListItem(itemType).run();
}

export function outdentListItem(editor: Editor): boolean {
  const itemType = getActiveListItemType(editor);
  if (!itemType || !canOutdentListItem(editor)) {
    return false;
  }
  return editor.chain().focus().liftListItem(itemType).run();
}
