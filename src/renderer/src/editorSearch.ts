import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface EditorSearchMatch {
  from: number;
  to: number;
}

export interface EditorSearchState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  matches: EditorSearchMatch[];
  activeIndex: number;
  decorations: DecorationSet;
}

interface SearchUpdate {
  open?: boolean;
  query?: string;
  caseSensitive?: boolean;
  activeIndex?: number;
  preferredFrom?: number;
}

export const emptyEditorSearch: EditorSearchState = {
  open: false,
  query: "",
  caseSensitive: false,
  matches: [],
  activeIndex: -1,
  decorations: DecorationSet.empty
};

export const editorSearchKey = new PluginKey<EditorSearchState>("flowShuttleSearch");

// Search visible text, joining adjacent marks but never crossing a block, image,
// or hard break. Offsets come from the original string, including for Unicode.
export function findEditorMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive = false
): EditorSearchMatch[] {
  if (!query) {
    return [];
  }
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "gu" : "giu");
  const matches: EditorSearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    let text = "";
    let start = pos + 1;
    const flush = () => {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        matches.push({ from: start + match.index, to: start + match.index + match[0].length });
      }
      text = "";
    };
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) {
          start = pos + 1 + offset;
        }
        text += child.text;
      } else {
        flush();
      }
    });
    flush();
    return false;
  });
  return matches;
}

export function createEditorSearchPlugin(): Plugin<EditorSearchState> {
  return new Plugin<EditorSearchState>({
    key: editorSearchKey,
    state: {
      init: () => emptyEditorSearch,
      apply(transaction, previous, _oldState, nextState) {
        const update = transaction.getMeta(editorSearchKey) as SearchUpdate | undefined;
        if (!update && !transaction.docChanged) {
          return previous;
        }
        const open = update?.open ?? previous.open;
        const query = update?.query ?? previous.query;
        const caseSensitive = update?.caseSensitive ?? previous.caseSensitive;
        if (!open) {
          return previous.open || update
            ? { ...emptyEditorSearch, query, caseSensitive }
            : previous;
        }
        const queryChanged = query !== previous.query || caseSensitive !== previous.caseSensitive || !previous.open;
        const matches = queryChanged || transaction.docChanged
          ? findEditorMatches(nextState.doc, query, caseSensitive)
          : previous.matches;
        let activeIndex = update?.activeIndex ?? previous.activeIndex;
        const previousMatch = previous.matches[previous.activeIndex];
        const preferredFrom = update?.preferredFrom ?? (queryChanged
          ? nextState.selection.from
          : transaction.docChanged && previousMatch
            ? transaction.mapping.map(previousMatch.from, 1)
            : undefined);
        if (preferredFrom !== undefined) {
          activeIndex = matches.findIndex((match) => match.from >= preferredFrom);
        }
        activeIndex = matches.length ? Math.max(0, Math.min(activeIndex, matches.length - 1)) : -1;
        const decorations = DecorationSet.create(nextState.doc, matches.map((match, index) =>
          Decoration.inline(match.from, match.to, {
            class: `markdown-editor-search-match${index === activeIndex ? " is-current" : ""}`
          })
        ));
        return { open, query, caseSensitive, matches, activeIndex, decorations };
      }
    },
    props: {
      decorations: (state) => editorSearchKey.getState(state)?.decorations ?? DecorationSet.empty
    }
  });
}

export const FlowShuttleSearch = Extension.create({
  name: "flowShuttleSearch",
  addProseMirrorPlugins: () => [createEditorSearchPlugin()]
});

export function getEditorSearch(editor: Editor): EditorSearchState {
  return editorSearchKey.getState(editor.state) ?? emptyEditorSearch;
}

export function updateEditorSearch(editor: Editor, update: SearchUpdate): void {
  editor.view.dispatch(editor.state.tr.setMeta(editorSearchKey, update).setMeta("addToHistory", false));
}

export function closeEditorSearch(editor: Editor): void {
  const search = getEditorSearch(editor);
  const position = search.matches[search.activeIndex]?.to ?? editor.state.selection.to;
  // Keep the internal selection collapsed; the UI returns focus to the toolbar.
  editor.view.dispatch(editor.state.tr
    .setSelection(TextSelection.near(editor.state.doc.resolve(position)))
    .setMeta(editorSearchKey, { open: false, query: "" } satisfies SearchUpdate)
    .setMeta("addToHistory", false));
}

export function moveEditorSearch(editor: Editor, direction: 1 | -1): void {
  const { activeIndex, matches } = getEditorSearch(editor);
  if (matches.length) {
    updateEditorSearch(editor, { activeIndex: (activeIndex + direction + matches.length) % matches.length });
  }
}

export function replaceEditorMatches(editor: Editor, replacement: string, all = false): number {
  const search = getEditorSearch(editor);
  if (!editor.isEditable || !search.open || !search.matches.length) {
    return 0;
  }
  const matches = all ? search.matches : [search.matches[search.activeIndex]];
  if (!matches[0]) {
    return 0;
  }
  const transaction = closeHistory(editor.state.tr);
  for (const match of [...matches].reverse()) {
    // Use literal text and the first matched character's marks. Never interpret
    // replacement text as Markdown/HTML or rewrite the surrounding document.
    const marks = editor.state.doc.resolve(match.from).nodeAfter?.marks ?? [];
    if (replacement) {
      transaction.replaceWith(match.from, match.to, editor.state.schema.text(replacement, marks));
    } else {
      transaction.delete(match.from, match.to);
    }
  }
  transaction.setMeta(editorSearchKey, {
    preferredFrom: transaction.mapping.map(matches[0].to, 1)
  } satisfies SearchUpdate);
  editor.view.dispatch(transaction);
  // Keep both preceding and subsequent typing outside this undo event.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  return matches.length;
}
