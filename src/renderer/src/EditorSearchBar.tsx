import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  closeEditorSearch,
  emptyEditorSearch,
  getEditorSearch,
  moveEditorSearch,
  replaceEditorMatches,
  updateEditorSearch
} from "./editorSearch";

export interface EditorSearchLabels {
  find: string;
  findPlaceholder: string;
  replacePlaceholder: string;
  matchCase: string;
  previousMatch: string;
  nextMatch: string;
  toggleReplace: string;
  replace: string;
  replaceAll: string;
  closeFind: string;
  noMatches: string;
  matchCount: string;
  replacedCount: string;
}

export function useEditorSearch(editor: Editor | null, disabled = false) {
  const [state, setState] = useState(emptyEditorSearch);
  const [showReplace, setShowReplace] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const revealRequestedRef = useRef(false);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const refresh = ({ transaction }: { transaction: Transaction }) => {
      setState(getEditorSearch(editor));
      if (transaction.docChanged) {
        setReplacedCount(null);
      }
    };
    setState(getEditorSearch(editor));
    editor.on("transaction", refresh);
    return () => { editor.off("transaction", refresh); };
  }, [editor]);

  useEffect(() => {
    if (!state.open || !focusRequest) {
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [state.open, focusRequest]);

  useEffect(() => {
    if (!editor || !state.open || state.activeIndex < 0) {
      return;
    }
    // Editing elsewhere with search left open must not jump back to an old hit.
    if (editor.isFocused && !revealRequestedRef.current) {
      return;
    }
    revealRequestedRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      // Decorations span mark boundaries; scroll the first fragment into view.
      editor.view.dom.querySelector(".markdown-editor-search-match.is-current")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, state]);

  const open = (withReplace = false) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const { selection, doc } = editor.state;
    const selectedText = editor.isFocused && !selection.empty && selection.$from.sameParent(selection.$to)
      ? doc.textBetween(selection.from, selection.to, "\n", "\uFFFC")
      : "";
    const query = selectedText && !/[\r\n\uFFFC]/u.test(selectedText)
      ? selectedText
      : getEditorSearch(editor).query;
    updateEditorSearch(editor, { open: true, query, preferredFrom: selection.from });
    if (withReplace && !disabled) {
      setShowReplace(true);
    }
    setReplacedCount(null);
    setFocusRequest((request) => request + 1);
  };

  const close = () => {
    if (!editor) {
      return;
    }
    closeEditorSearch(editor);
    setReplacement("");
    setReplacedCount(null);
    setShowReplace(false);
    revealRequestedRef.current = false;
    editor.view.dom.blur();
    triggerRef.current?.focus({ preventScroll: true });
    // A blurred contenteditable can retain its native caret/range in Chromium.
    // Include the search inputs before they unmount, but not other editors.
    const selection = editor.view.dom.ownerDocument.getSelection();
    const selectionRoot = editor.view.dom.closest(".markdown-editor-shell") ?? editor.view.dom;
    if (selection && (selectionRoot.contains(selection.anchorNode) || selectionRoot.contains(selection.focusNode))) {
      selection.removeAllRanges();
    }
  };

  const navigate = (direction: 1 | -1) => {
    if (editor) {
      revealRequestedRef.current = getEditorSearch(editor).matches.length > 0;
      moveEditorSearch(editor, direction);
      setReplacedCount(null);
    }
  };

  const replace = (all = false) => {
    if (editor && !disabled) {
      const count = replaceEditorMatches(editor, replacement, all);
      if (count) {
        setReplacedCount(count);
        // The clicked action may become disabled when the last match is gone.
        // Keep keyboard focus in the panel so Escape still returns to editing.
        replacementInputRef.current?.focus({ preventScroll: true });
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && !event.shiftKey && (key === "f" || key === "h")) {
      event.preventDefault();
      event.stopPropagation();
      open(key === "h");
    } else if (state.open && key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (state.open && key === "f3" && !mod && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      navigate(event.shiftKey ? -1 : 1);
    }
  };

  return {
    state, inputRef, replacementInputRef, triggerRef, open, close, navigate, replace, onKeyDown,
    showReplace, setShowReplace, replacement, setReplacement, replacedCount,
    setQuery(query: string) {
      if (editor) {
        updateEditorSearch(editor, { query });
        setReplacedCount(null);
      }
    },
    toggleCase() {
      if (editor) {
        updateEditorSearch(editor, { caseSensitive: !state.caseSensitive });
        setReplacedCount(null);
      }
    }
  };
}

export function EditorSearchBar({
  search,
  labels,
  disabled = false
}: {
  search: ReturnType<typeof useEditorSearch>;
  labels: EditorSearchLabels;
  disabled?: boolean;
}) {
  const replacementId = useId();
  const statusId = useId();
  if (!search.state.open) {
    return null;
  }
  const { state } = search;
  const hasMatches = state.matches.length > 0;
  const countLabel = labels.matchCount
    .replace("{current}", String(state.activeIndex + 1))
    .replace("{total}", String(state.matches.length));
  const shortcut = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div className="markdown-editor-search" role="search" aria-label={labels.find}>
      <div className="markdown-editor-search-row">
        {!disabled && (
          <button type="button" className="editor-search-icon" aria-label={labels.toggleReplace}
            title={`${labels.toggleReplace} (${shortcut}H)`} aria-expanded={search.showReplace}
            aria-controls={replacementId} onClick={() => search.setShowReplace(!search.showReplace)}>
            {search.showReplace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        <div className={`editor-search-field${state.query && !hasMatches ? " has-no-matches" : ""}`}>
          <Search size={15} aria-hidden="true" />
          <input ref={search.inputRef} type="text" value={state.query} autoComplete="off" spellCheck={false}
            aria-label={labels.findPlaceholder} placeholder={labels.findPlaceholder} aria-describedby={statusId}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                event.stopPropagation();
                search.navigate(event.shiftKey ? -1 : 1);
              }
            }} />
          <span id={statusId} className="editor-search-count" role="status" aria-live="polite" aria-atomic="true"
            aria-label={state.query && !hasMatches ? labels.noMatches : countLabel}>
            {state.query && !hasMatches ? labels.noMatches : `${state.activeIndex + 1} / ${state.matches.length}`}
          </span>
          <button type="button" className="editor-search-icon" aria-label={labels.matchCase}
            title={labels.matchCase} aria-pressed={state.caseSensitive} onClick={search.toggleCase}>
            <CaseSensitive size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="editor-search-actions">
          <button type="button" className="editor-search-icon" aria-label={labels.previousMatch}
            title={`${labels.previousMatch} (Shift+Enter)`} disabled={!hasMatches} onClick={() => search.navigate(-1)}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button type="button" className="editor-search-icon" aria-label={labels.nextMatch}
            title={`${labels.nextMatch} (Enter)`} disabled={!hasMatches} onClick={() => search.navigate(1)}>
            <ArrowDown size={16} aria-hidden="true" />
          </button>
          <button type="button" className="editor-search-icon" aria-label={labels.closeFind}
            title={`${labels.closeFind} (Esc)`} onClick={search.close}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {search.showReplace && !disabled && (
        <div className="markdown-editor-search-row editor-replace-row" id={replacementId}>
          <div className="editor-search-field">
            <input ref={search.replacementInputRef} type="text" value={search.replacement} autoComplete="off" spellCheck={false}
              aria-label={labels.replacePlaceholder} placeholder={labels.replacePlaceholder}
              onChange={(event) => search.setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  event.stopPropagation();
                  search.replace();
                }
              }} />
          </div>
          <div className="editor-search-actions">
            <button type="button" disabled={!hasMatches} onClick={() => search.replace()}>{labels.replace}</button>
            <button type="button" disabled={!hasMatches} onClick={() => search.replace(true)}>{labels.replaceAll}</button>
          </div>
        </div>
      )}
      {search.replacedCount !== null && (
        <div className="editor-search-feedback" role="status">
          {labels.replacedCount.replace("{count}", String(search.replacedCount)).replace("{shortcut}", `${shortcut}Z`)}
        </div>
      )}
    </div>
  );
}
