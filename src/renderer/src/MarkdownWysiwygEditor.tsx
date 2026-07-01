import HardBreak from "@tiptap/extension-hard-break";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { LanguagePreference } from "../../shared/types";

type EditorTheme = "light" | "dark";
type EditorFeedbackKind = "success" | "error" | "warning" | "info";
type BlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bullet" | "number" | "check" | "quote" | "code" | "highlight";

export interface MarkdownEditorLabels {
  toolbarLabel: string;
  contextMenuLabel: string;
  paragraph: string;
  heading: string;
  heading1: string;
  heading2: string;
  heading3: string;
  heading4: string;
  heading5: string;
  heading6: string;
  bulletedList: string;
  numberedList: string;
  taskList: string;
  quote: string;
  codeBlock: string;
  highlightBlock: string;
  cut: string;
  copy: string;
  paste: string;
  pasteAsPlainText: string;
  saveImageAs: string;
  saveImageAsUnsupported: string;
  imageSaved: string;
  imageSaveFailed: string;
  clipboardEmpty: string;
  highlightPlaceholder: string;
}

interface MarkdownWysiwygEditorProps {
  value: string;
  language: LanguagePreference;
  theme: EditorTheme;
  placeholder: string;
  height?: string;
  minHeight?: string;
  disabled?: boolean;
  compact?: boolean;
  hideModeSwitch?: boolean;
  labels?: Partial<MarkdownEditorLabels>;
  onFeedback?: (feedback: { kind: EditorFeedbackKind; message: string }) => void;
  onChange: (value: string) => void;
  onImageUpload?: (file: File | Blob) => Promise<string>;
  onImageError?: (error: unknown) => void;
}

interface EditorContextMenu {
  x: number;
  y: number;
  kind: "blank" | "text" | "image";
  imageSrc?: string;
  imageAlt?: string;
}

interface PreviewImage {
  src: string;
  alt: string;
}

const defaultLabels: MarkdownEditorLabels = {
  toolbarLabel: "Editor toolbar",
  contextMenuLabel: "Editor menu",
  paragraph: "Paragraph",
  heading: "Heading",
  heading1: "H1",
  heading2: "H2",
  heading3: "H3",
  heading4: "H4",
  heading5: "H5",
  heading6: "H6",
  bulletedList: "Bulleted list",
  numberedList: "Numbered list",
  taskList: "Task list",
  quote: "Quote",
  codeBlock: "Code block",
  highlightBlock: "Highlight block",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  pasteAsPlainText: "Paste as Plain Text",
  saveImageAs: "Save Image As",
  saveImageAsUnsupported: "Only attachment images can be saved.",
  imageSaved: "Image saved",
  imageSaveFailed: "Failed to save image",
  clipboardEmpty: "Clipboard has no text",
  highlightPlaceholder: "Highlight this note"
};

function normalizePlainText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isMarkdownStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*+]\s\[[ xX]\]\s/.test(trimmed) ||
    /^[-*+]\s/.test(trimmed) ||
    /^\d+[.)]\s/.test(trimmed) ||
    /^(```|~~~)/.test(trimmed) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    /^\|.*\|$/.test(trimmed) ||
    /^(?: {4}|\t)\S/.test(line) ||
    /^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)
  );
}

function normalizeLegacyHardBreaksForImport(value: string): string {
  const lines = value.split("\n");
  const normalizedLines: string[] = [];
  let fenceMarker: "```" | "~~~" | null = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```|~~~)/);
    if (fenceMatch) {
      const marker = fenceMatch[1] as "```" | "~~~";
      fenceMarker = fenceMarker === marker ? null : fenceMarker ?? marker;
      normalizedLines.push(line);
      return;
    }

    if (!fenceMarker && / {2,}$/.test(line)) {
      normalizedLines.push(line.replace(/ {2,}$/, ""));
      normalizedLines.push("");
      return;
    }

    normalizedLines.push(line);
  });

  return normalizedLines.join("\n");
}

function normalizeMarkdownForImport(value: string): string {
  const normalized = normalizeLegacyHardBreaksForImport(normalizePlainText(value));
  if (/\\\n|<br\s*\/?>(?!\n)/i.test(normalized)) {
    return normalized;
  }

  const lines = normalized.split("\n");
  const meaningfulLines = lines.filter((line) => line.trim().length > 0);
  const hasBlankLine = lines.some((line) => line.trim().length === 0);

  // Legacy plain-text records used single newlines for separate visible lines.
  // If blank lines already exist, leave them intact so the Markdown parser can
  // restore empty paragraphs instead of flattening the user's spacing.
  if (!hasBlankLine && meaningfulLines.length > 1 && meaningfulLines.every((line) => !isMarkdownStructuralLine(line))) {
    return lines.join("\n\n");
  }
  return normalized;
}

const FlowShuttleHardBreak = HardBreak.extend({
  renderMarkdown: () => "\\\n"
});

function markdownImage(src: string, altText = "image"): string {
  const safeAlt = altText.replace(/[\[\]\n\r]/g, " ").trim() || "image";
  return `![${safeAlt}](${src})`;
}

function suggestedImageName(src: string, alt?: string): string {
  const fromSrc = decodeURIComponent(src.split(/[/?#]/).filter(Boolean).at(-1) ?? "");
  const fromAlt = alt?.trim();
  return fromSrc || fromAlt || "flow-shuttle-image.png";
}

function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  const menuWidth = 220;
  const menuHeight = 300;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8))
  };
}

function getClipboardImageFiles(event: ClipboardEvent): File[] {
  const files = Array.from(event.clipboardData?.files || []).filter((file): file is File => file.type.startsWith("image/"));
  const itemFiles = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  return files.length > 0 ? files : itemFiles;
}

function clipboardPayloadToBlob(payload: { data: ArrayBuffer; mimeType: string }): Blob {
  return new Blob([payload.data], { type: payload.mimeType || "image/png" });
}

function getEditorMarkdown(editor: TiptapEditor): string {
  const editorWithMarkdown = editor as TiptapEditor & { getMarkdown?: () => string };
  return normalizePlainText(editorWithMarkdown.getMarkdown?.() ?? "").replace(/\n+$/g, "");
}

const pendingSelectionScrollFrames = new WeakMap<TiptapEditor, number>();

function cancelSelectionIntoView(editor: TiptapEditor): void {
  const pendingFrame = pendingSelectionScrollFrames.get(editor);
  if (pendingFrame) {
    window.cancelAnimationFrame(pendingFrame);
    pendingSelectionScrollFrames.delete(editor);
  }
}

function requestSelectionIntoView(editor: TiptapEditor): void {
  if (typeof window === "undefined" || !editor.isFocused || !editor.state.selection.empty) {
    return;
  }

  cancelSelectionIntoView(editor);

  const frame = window.requestAnimationFrame(() => {
    pendingSelectionScrollFrames.delete(editor);
    const { view } = editor;
    const scrollHost = view.dom.closest<HTMLElement>(".markdown-editor-content") ?? view.dom.parentElement;
    if (!scrollHost) {
      return;
    }

    try {
      const cursorRect = view.coordsAtPos(editor.state.selection.head);
      const hostRect = scrollHost.getBoundingClientRect();
      const topPadding = 24;
      const bottomPadding = 56;

      if (cursorRect.bottom > hostRect.bottom - bottomPadding) {
        scrollHost.scrollTop += cursorRect.bottom - hostRect.bottom + bottomPadding;
      } else if (cursorRect.top < hostRect.top + topPadding) {
        scrollHost.scrollTop -= hostRect.top + topPadding - cursorRect.top;
      }
    } catch {
      // coordsAtPos can fail while a transaction is still settling; the next input will retry.
    }
  });

  pendingSelectionScrollFrames.set(editor, frame);
}
function inlinePlainText(node: ProseMirrorNode): string {
  if (node.isText) {
    return node.text ?? "";
  }
  if (node.type.name === "hardBreak") {
    return "\n";
  }
  if (node.type.name === "image") {
    const alt = typeof node.attrs.alt === "string" ? node.attrs.alt.trim() : "";
    return alt ? `[${alt}]` : "[image]";
  }

  const parts: string[] = [];
  node.forEach((child) => {
    parts.push(inlinePlainText(child));
  });
  return parts.join("");
}

function blockPlainText(node: ProseMirrorNode): string[] {
  if (node.type.name === "paragraph" || /^heading$/.test(node.type.name)) {
    return [inlinePlainText(node)];
  }
  if (node.type.name === "blockquote") {
    return nodeToPlainTextLines(node).map((line) => (line ? `> ${line}` : ">"));
  }
  if (node.type.name === "bulletList") {
    const lines: string[] = [];
    node.forEach((child) => {
      lines.push(...blockPlainText(child).map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`)));
    });
    return lines;
  }
  if (node.type.name === "orderedList") {
    const start = Number.parseInt(String(node.attrs.start ?? "1"), 10);
    const firstNumber = Number.isFinite(start) ? start : 1;
    const lines: string[] = [];
    node.forEach((child, _offset, index) => {
      const prefix = `${firstNumber + index}. `;
      lines.push(...blockPlainText(child).map((line, lineIndex) => (lineIndex === 0 ? `${prefix}${line}` : `${" ".repeat(prefix.length)}${line}`)));
    });
    return lines;
  }
  if (node.type.name === "listItem") {
    return nodeToPlainTextLines(node);
  }
  if (node.type.name === "taskList") {
    const lines: string[] = [];
    node.forEach((child) => {
      lines.push(...blockPlainText(child));
    });
    return lines;
  }
  if (node.type.name === "taskItem") {
    const checked = node.attrs.checked ? "x" : " ";
    return nodeToPlainTextLines(node).map((line, index) => (index === 0 ? `- [${checked}] ${line}` : `  ${line}`));
  }
  if (node.type.name === "codeBlock") {
    return [node.textContent];
  }

  return nodeToPlainTextLines(node);
}

function nodeToPlainTextLines(node: ProseMirrorNode): string[] {
  const lines: string[] = [];
  node.forEach((child) => {
    lines.push(...blockPlainText(child));
  });
  return lines.length > 0 ? lines : [inlinePlainText(node)];
}

function clipboardPlainText(slice: Slice): string {
  const lines: string[] = [];
  slice.content.forEach((node) => {
    lines.push(...blockPlainText(node));
  });
  return lines.join("\n");
}
function getActiveBlockType(editor: TiptapEditor | null): BlockType {
  if (!editor) {
    return "paragraph";
  }
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive("heading", { level })) {
      return `h${level}` as BlockType;
    }
  }
  if (editor.isActive("bulletList")) {
    return "bullet";
  }
  if (editor.isActive("orderedList")) {
    return "number";
  }
  if (editor.isActive("taskList")) {
    return "check";
  }
  if (editor.isActive("blockquote")) {
    return "quote";
  }
  if (editor.isActive("codeBlock")) {
    return "code";
  }
  if (editor.isActive("highlight")) {
    return "highlight";
  }
  return "paragraph";
}

function insertPlainText(editor: TiptapEditor, text: string): void {
  const normalized = normalizePlainText(text);
  if (!normalized) {
    return;
  }

  const lines = normalized.split("\n");
  if (lines.length === 1) {
    editor.chain().focus().insertContent({ type: "text", text: normalized }).run();
  } else {
    editor
      .chain()
      .focus()
      .insertContent(lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : undefined })))
      .run();
  }
  requestSelectionIntoView(editor);
}

async function uploadAndInsertImages(editor: TiptapEditor, files: Array<File | Blob>, upload: (file: File | Blob) => Promise<string>): Promise<boolean> {
  if (files.length === 0) {
    return false;
  }

  const urls = await Promise.all(files.map((file) => upload(file)));
  urls.forEach((src, index) => {
    if (src) {
      const source = files[index];
      const alt = source instanceof File && source.name ? source.name : "clipboard-image.png";
      editor.chain().focus().setImage({ src, alt }).run();
    }
  });
  return urls.some(Boolean);
}

async function pasteClipboardImage(editor: TiptapEditor, upload: ((file: File | Blob) => Promise<string>) | undefined): Promise<boolean> {
  if (!upload) {
    return false;
  }

  const payload = await window.workJournal.editor.readClipboardImage();
  if (!payload) {
    return false;
  }

  return uploadAndInsertImages(editor, [clipboardPayloadToBlob(payload)], upload);
}

function removeImageNodeBySrc(editor: TiptapEditor, src: string): void {
  editor.commands.command(({ state, tr }) => {
    let removed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && node.attrs.src === src) {
        tr.delete(pos, pos + node.nodeSize);
        removed = true;
        return false;
      }
      return true;
    });
    return removed;
  });
}

const FlowShuttleKeyboardExtension = Extension.create({
  name: "flowShuttleKeyboardBehavior",

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this;
        if (!editor.isActive("blockquote")) {
          return false;
        }

        const { selection } = editor.state;
        if (!selection.empty) {
          return false;
        }

        const { $from } = selection;
        const isAtTextBlockStart = $from.parentOffset === 0;
        const isEmptyTextBlock = $from.parent.textContent.length === 0;
        if (!isAtTextBlockStart && !isEmptyTextBlock) {
          return false;
        }

        return editor.chain().focus().toggleBlockquote().run();
      }
    };
  }
});

function Toolbar({
  editor,
  labels,
  disabled
}: {
  editor: TiptapEditor | null;
  labels: MarkdownEditorLabels;
  disabled?: boolean;
}): JSX.Element {
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph");
  const toolbarSelectionRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const update = () => setActiveBlock(getActiveBlockType(editor));
    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const captureToolbarSelection = () => {
    if (!editor) {
      toolbarSelectionRef.current = null;
      return;
    }
    const { selection } = editor.state;
    if (!selection.$from.parent.isTextblock || !selection.$to.parent.isTextblock) {
      toolbarSelectionRef.current = null;
      return;
    }
    toolbarSelectionRef.current = {
      from: selection.from,
      to: selection.to
    };
  };

  const restoreToolbarSelection = () => {
    if (!editor || !toolbarSelectionRef.current) {
      return;
    }
    const { from, to } = toolbarSelectionRef.current;
    const docSize = editor.state.doc.content.size;
    if (from <= docSize && to <= docSize) {
      editor.commands.setTextSelection({ from, to });
    }
  };

  const keepSelection = (event: ReactMouseEvent<HTMLButtonElement>) => {
    captureToolbarSelection();
    event.preventDefault();
  };

  const run = (command: () => boolean): void => {
    if (!editor || disabled) {
      return;
    }
    restoreToolbarSelection();
    const didRun = command();
    toolbarSelectionRef.current = null;
    if (didRun) {
      requestSelectionIntoView(editor);
    }
  };

  const button = (
    key: BlockType,
    label: string,
    action: () => boolean,
    title?: string,
    className?: string
  ): JSX.Element => (
    <button
      key={key}
      type="button"
      className={className}
      aria-pressed={activeBlock === key}
      title={title || label}
      disabled={disabled || !editor}
      onMouseDown={keepSelection}
      onClick={() => run(action)}
    >
      {label}
    </button>
  );

  const headings: Array<[BlockType, string, string, () => boolean]> = [
    ["paragraph", "P", labels.paragraph, () => editor?.chain().focus().setParagraph().run() ?? false],
    ["h1", "H1", labels.heading1, () => editor?.chain().focus().toggleHeading({ level: 1 }).run() ?? false],
    ["h2", "H2", labels.heading2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run() ?? false],
    ["h3", "H3", labels.heading3, () => editor?.chain().focus().toggleHeading({ level: 3 }).run() ?? false],
    ["h4", "H4", labels.heading4, () => editor?.chain().focus().toggleHeading({ level: 4 }).run() ?? false],
    ["h5", "H5", labels.heading5, () => editor?.chain().focus().toggleHeading({ level: 5 }).run() ?? false],
    ["h6", "H6", labels.heading6, () => editor?.chain().focus().toggleHeading({ level: 6 }).run() ?? false]
  ];

  return (
    <div className="markdown-editor-toolbar" role="toolbar" aria-label={labels.toolbarLabel}>
      <div className="markdown-editor-heading-group" aria-label={labels.heading}>
        {headings.map(([key, label, title, action]) => button(key, label, action, title))}
      </div>
      <span className="markdown-editor-toolbar-divider" />
      {button("bullet", "\u2022", () => editor?.chain().focus().toggleBulletList().run() ?? false, labels.bulletedList, "markdown-editor-icon-button")}
      {button("number", "1.", () => editor?.chain().focus().toggleOrderedList().run() ?? false, labels.numberedList, "markdown-editor-icon-button")}
      {button("check", "\u2611", () => editor?.chain().focus().toggleTaskList().run() ?? false, labels.taskList, "markdown-editor-icon-button")}
      <span className="markdown-editor-toolbar-divider" />
      {button("quote", "66", () => editor?.chain().focus().toggleBlockquote().run() ?? false, labels.quote, "markdown-editor-icon-button")}
      {button("code", "CB", () => editor?.chain().focus().toggleCodeBlock().run() ?? false, labels.codeBlock, "markdown-editor-icon-button")}
      {button("highlight", "HL", () => editor?.chain().focus().toggleHighlight().run() ?? false, labels.highlightBlock, "markdown-editor-icon-button")}
    </div>
  );
}

export function MarkdownWysiwygEditor({
  value,
  language,
  theme,
  placeholder,
  height,
  minHeight,
  disabled,
  compact,
  hideModeSwitch: _hideModeSwitch,
  labels,
  onFeedback,
  onChange,
  onImageUpload,
  onImageError
}: MarkdownWysiwygEditorProps) {
  const resolvedLabels = useMemo(() => ({ ...defaultLabels, ...labels }), [labels]);
  const uploadRef = useRef(onImageUpload);
  const imageErrorRef = useRef(onImageError);
  const editorRef = useRef<TiptapEditor | null>(null);
  const syncingRef = useRef(false);
  const lastMarkdownRef = useRef(normalizePlainText(value || ""));
  const [contextMenu, setContextMenu] = useState<EditorContextMenu | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    uploadRef.current = onImageUpload;
  }, [onImageUpload]);

  useEffect(() => {
    imageErrorRef.current = onImageError;
  }, [onImageError]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        hardBreak: false,
        link: false
      }),
      FlowShuttleHardBreak,
      FlowShuttleKeyboardExtension,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: {
          class: "markdown-editor-image"
        }
      }),
      Highlight.configure({
        HTMLAttributes: {
          class: "markdown-editor-highlight-inline"
        }
      }),
      Placeholder.configure({
        placeholder
      }),
      Markdown.configure({
        markedOptions: {
          breaks: false,
          gfm: true
        }
      })
    ],
    [placeholder]
  );

  const editor = useEditor({
    extensions,
    content: normalizeMarkdownForImport(value || ""),
    contentType: "markdown",
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "markdown-editor-content",
        spellcheck: "false"
      },
      clipboardTextSerializer: clipboardPlainText,
      handlePaste: (_view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor || disabled) {
          return false;
        }

        const imageFiles = getClipboardImageFiles(event);
        if (imageFiles.length > 0 && uploadRef.current) {
          event.preventDefault();
          void (async () => {
            try {
              await uploadAndInsertImages(currentEditor, imageFiles, uploadRef.current!);
            } catch (error) {
              imageErrorRef.current?.(error);
            }
          })();
          return true;
        }

        const text = normalizePlainText(event.clipboardData?.getData("text/plain") || "");
        if (!text && uploadRef.current) {
          event.preventDefault();
          void (async () => {
            try {
              await pasteClipboardImage(currentEditor, uploadRef.current);
            } catch (error) {
              imageErrorRef.current?.(error);
            }
          })();
          return true;
        }

        return false;
      }
    },
    onCreate: ({ editor: createdEditor }) => {
      editorRef.current = createdEditor;
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (syncingRef.current) {
        return;
      }
      const markdown = getEditorMarkdown(updatedEditor);
      if (markdown !== lastMarkdownRef.current) {
        lastMarkdownRef.current = markdown;
        onChange(markdown);
      }
      requestSelectionIntoView(updatedEditor);
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      editorRef.current = updatedEditor;
    },
    onDestroy: () => {
      if (editorRef.current) {
        cancelSelectionIntoView(editorRef.current);
      }
      editorRef.current = null;
    }
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const next = normalizePlainText(value || "");
    if (next === lastMarkdownRef.current) {
      return;
    }

    syncingRef.current = true;
    try {
      editor.commands.setContent(normalizeMarkdownForImport(next), { contentType: "markdown", emitUpdate: false });
      lastMarkdownRef.current = next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditorError(message);
      onFeedback?.({ kind: "error", message });
    } finally {
      syncingRef.current = false;
    }
  }, [editor, onFeedback, value]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const root = editor.view.dom as HTMLElement;
    const handleContextMenu = (event: MouseEvent) => {
      if (disabled) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const image = target?.closest<HTMLImageElement>("img.markdown-editor-image");
      const selectionText = window.getSelection()?.toString().trim() || "";
      const position = clampMenuPosition(event.clientX, event.clientY);
      event.preventDefault();
      setContextMenu({
        ...position,
        kind: image ? "image" : selectionText ? "text" : "blank",
        imageSrc: image?.getAttribute("src") || undefined,
        imageAlt: image?.getAttribute("alt") || undefined
      });
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const image = target?.closest<HTMLImageElement>("img.markdown-editor-image");
      if (image) {
        setPreviewImage({
          src: image.getAttribute("src") || "",
          alt: image.getAttribute("alt") || resolvedLabels.saveImageAs
        });
      } else {
        setContextMenu(null);
      }
    };

    root.addEventListener("contextmenu", handleContextMenu);
    root.addEventListener("click", handleClick);
    return () => {
      root.removeEventListener("contextmenu", handleContextMenu);
      root.removeEventListener("click", handleClick);
    };
  }, [disabled, editor, resolvedLabels.saveImageAs]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const pastePlainText = async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || disabled) {
      return;
    }
    const text = normalizePlainText(await window.workJournal.editor.readClipboardText());
    if (!text) {
      onFeedback?.({ kind: "warning", message: resolvedLabels.clipboardEmpty });
      return;
    }
    insertPlainText(currentEditor, text);
  };

  const pasteClipboardContent = async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || disabled) {
      return;
    }

    try {
      if (await pasteClipboardImage(currentEditor, uploadRef.current)) {
        return;
      }
    } catch (error) {
      imageErrorRef.current?.(error);
      return;
    }

    await pastePlainText();
  };

  const runNativeEditorAction = async (action: "cut" | "copy" | "paste") => {
    const currentEditor = editorRef.current;
    if (!currentEditor || disabled) {
      return;
    }
    currentEditor.commands.focus();
    if (action === "paste") {
      await pasteClipboardContent();
      return;
    }
    await window.workJournal.editor[action]();
  };

  const saveImageAs = async (menu: EditorContextMenu) => {
    if (!menu.imageSrc) {
      return;
    }
    if (!menu.imageSrc.startsWith("attachment://")) {
      onFeedback?.({ kind: "warning", message: resolvedLabels.saveImageAsUnsupported });
      return;
    }
    try {
      const result = await window.workJournal.attachments.saveImageAs({
        url: menu.imageSrc,
        suggestedName: suggestedImageName(menu.imageSrc, menu.imageAlt)
      });
      if (!result.canceled) {
        onFeedback?.({ kind: "success", message: resolvedLabels.imageSaved });
      }
    } catch (error) {
      onFeedback?.({
        kind: "error",
        message: error instanceof Error ? error.message : resolvedLabels.imageSaveFailed
      });
    }
  };

  const copyImageReference = async (menu: EditorContextMenu, shouldCut: boolean) => {
    const currentEditor = editorRef.current;
    if (!menu.imageSrc) {
      return;
    }
    if (!menu.imageSrc.startsWith("attachment://")) {
      await window.workJournal.editor.writeClipboardText(markdownImage(menu.imageSrc, menu.imageAlt));
      return;
    }
    await window.workJournal.attachments.copyImage({
      url: menu.imageSrc,
      suggestedName: suggestedImageName(menu.imageSrc, menu.imageAlt)
    });
    if (shouldCut && currentEditor) {
      removeImageNodeBySrc(currentEditor, menu.imageSrc);
    }
  };

  const runContextAction = async (
    action: "cut" | "copy" | "paste" | "pastePlain" | "highlight" | "saveImage",
    menu: EditorContextMenu
  ) => {
    setContextMenu(null);
    const currentEditor = editorRef.current;
    if (action === "highlight") {
      currentEditor?.chain().focus().toggleHighlight().run();
      return;
    }
    if (action === "pastePlain") {
      await pastePlainText();
      return;
    }
    if (action === "saveImage") {
      await saveImageAs(menu);
      return;
    }
    if ((action === "cut" || action === "copy") && menu.kind === "image") {
      await copyImageReference(menu, action === "cut");
      return;
    }
    await runNativeEditorAction(action);
  };

  const lightbox = previewImage
    ? createPortal(
        <div
          className="image-lightbox-backdrop"
          role="presentation"
          onClick={() => setPreviewImage(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setPreviewImage(null);
            }
          }}
        >
          <section className="image-lightbox" aria-label={previewImage.alt}>
            <button
              type="button"
              className="button ghost icon-button image-lightbox-close"
              aria-label="Close"
              onClick={() => setPreviewImage(null)}
            >
              <X size={16} />
            </button>
            <img src={previewImage.src} alt={previewImage.alt} />
          </section>
        </div>,
        document.body
      )
    : null;

  const contextMenuPortal = contextMenu
    ? createPortal(
        <div
          className="markdown-editor-context-menu"
          role="menu"
          aria-label={resolvedLabels.contextMenuLabel}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
        >
          {contextMenu.kind !== "blank" && (
            <>
              <button type="button" role="menuitem" onClick={() => void runContextAction("cut", contextMenu)}>
                {resolvedLabels.cut}
              </button>
              <button type="button" role="menuitem" onClick={() => void runContextAction("copy", contextMenu)}>
                {resolvedLabels.copy}
              </button>
              {contextMenu.kind === "text" && (
                <button type="button" role="menuitem" onClick={() => void runContextAction("highlight", contextMenu)}>
                  {resolvedLabels.highlightBlock}
                </button>
              )}
            </>
          )}
          {contextMenu.kind !== "image" && (
            <>
              <button type="button" role="menuitem" onClick={() => void runContextAction("paste", contextMenu)}>
                {resolvedLabels.paste}
              </button>
              <button type="button" role="menuitem" onClick={() => void runContextAction("pastePlain", contextMenu)}>
                {resolvedLabels.pasteAsPlainText}
              </button>
            </>
          )}
          {contextMenu.kind === "image" && (
            <>
              <span className="markdown-editor-context-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={!contextMenu.imageSrc?.startsWith("attachment://")}
                title={!contextMenu.imageSrc?.startsWith("attachment://") ? resolvedLabels.saveImageAsUnsupported : undefined}
                onClick={() => void runContextAction("saveImage", contextMenu)}
              >
                {resolvedLabels.saveImageAs}
              </button>
            </>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div
        className={`markdown-editor-shell ${compact ? "compact" : ""}`}
        data-editor-language={language}
        data-editor-theme={theme}
        style={{ height, minHeight }}
      >
        {editorError ? (
          <div className="markdown-editor-fallback">
            <p>{editorError}</p>
            <textarea
              value={value}
              spellCheck={false}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
        ) : (
          <div className={`markdown-wysiwyg-editor ${compact ? "compact" : ""} ${disabled ? "editor-disabled" : ""}`} spellCheck={false}>
            <Toolbar editor={editor} labels={resolvedLabels} disabled={disabled} />
            <EditorContent className="tiptap-editor-content" editor={editor} />
          </div>
        )}
      </div>
      {contextMenuPortal}
      {lightbox}
    </>
  );
}
