import HardBreak from "@tiptap/extension-hard-break";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  type Node as ProseMirrorNode,
  type Slice
} from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  Baseline,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  Eraser,
  Frame,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Layers,
  List,
  ListOrdered,
  ListRestart,
  ListStart,
  Maximize2,
  PaintRoller,
  PencilLine,
  Quote,
  RemoveFormatting,
  RotateCcw,
  Sparkles,
  Square,
  SquareCheckBig,
  SquareCode,
  SquareDashed,
  Strikethrough,
  Underline,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { assertAttachmentSizeBytes } from "../../shared/attachmentLimits";
import type { LanguagePreference } from "../../shared/types";
import { useAiSelectionPolish } from "./AiSelectionPolish";
import {
  FlowShuttleImage,
  sanitizeImagePresentation,
  type ImagePresentation
} from "./editorImagePresentation";
import {
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
  textColorFallback,
  type HighlightColor,
  type TextColor
} from "./editorInlineFormatting";
import {
  FlowShuttleListBehavior,
  FlowShuttleOrderedList,
  MAX_ORDERED_LIST_VALUE,
  canContinueOrderedList,
  canIndentListItem,
  canOutdentListItem,
  getActiveListType,
  getActiveListItemType,
  getCurrentOrderedListNumber,
  formatOrderedListMarker,
  indentListItem,
  outdentListItem,
  setCurrentOrderedListSequence,
  type OrderedListMarkerLevel
} from "./editorListBehavior";

type EditorTheme = "light" | "dark";
type EditorFeedbackKind = "success" | "error" | "warning" | "info";
type ParagraphType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type BlockType = ParagraphType | "bullet" | "number" | "check" | "quote" | "code";
type ToolbarMenuKind = "paragraph" | "textColor" | "highlightColor" | "more";

interface InlineFormattingSnapshot {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textColor: TextColor | null;
  highlightColor: HighlightColor | null;
}

interface FormatPainterState {
  sourceFrom: number;
  sourceTo: number;
  snapshot: InlineFormattingSnapshot;
}

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
  bold: string;
  italic: string;
  underline: string;
  strikethrough: string;
  textColor: string;
  highlightColor: string;
  defaultColor: string;
  noBackground: string;
  more: string;
  formatPainter: string;
  clearFormatting: string;
  colorBlack: string;
  colorYellow: string;
  colorGray: string;
  colorRed: string;
  colorOrange: string;
  colorGreen: string;
  colorBlue: string;
  colorPink: string;
  colorPurple: string;
  characterUnit: string;
  bulletedList: string;
  numberedList: string;
  numberingOptions: string;
  continuePreviousNumbering: string;
  startNewList: string;
  changeNumberValue: string;
  numberValue: string;
  applyNumberValue: string;
  increaseIndent: string;
  decreaseIndent: string;
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
  imageTooLarge: string;
  imageAppearance: string;
  imageNoBorder: string;
  imageLightBorder: string;
  imageDarkBorder: string;
  imageShadow: string;
  imageFrame: string;
  imageResizeHint: string;
  imagePreview: string;
  imagePrevious: string;
  imageNext: string;
  imageZoomIn: string;
  imageZoomOut: string;
  imageResetView: string;
  imageRotateLeft: string;
  imageCopy: string;
  imageDownload: string;
  imageClosePreview: string;
  clipboardEmpty: string;
  highlightPlaceholder: string;
  aiSelectionPolishToggle: string;
  aiSelectionPolishOn: string;
  aiSelectionPolishOff: string;
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
  showFormatActionsInline?: boolean;
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

interface OrderedListNumberingMenu {
  anchorX: number;
  anchorY: number;
  currentNumber: number;
  canContinue: boolean;
  markerFontFamily: string;
  markerFontSize: string;
  markerFontWeight: string;
  markerLabel: string;
  markerLineHeight: string;
  markerRight: number;
  markerTop: number;
}

interface PreviewImage {
  src: string;
  alt: string;
}

interface ImagePreviewState {
  images: PreviewImage[];
  index: number;
  zoom: number;
  rotation: number;
}

interface SelectedImageControls {
  position: number;
  presentation: ImagePresentation;
  rect: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
}

interface AiPolishTextSegment {
  from: number;
  to: number;
  text: string;
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
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  textColor: "Text color",
  highlightColor: "Highlight color",
  defaultColor: "Default",
  noBackground: "No background",
  more: "More",
  formatPainter: "Format painter",
  clearFormatting: "Clear formatting",
  colorBlack: "Black",
  colorYellow: "Yellow",
  colorGray: "Gray",
  colorRed: "Red",
  colorOrange: "Orange",
  colorGreen: "Green",
  colorBlue: "Blue",
  colorPink: "Pink",
  colorPurple: "Purple",
  characterUnit: " chars",
  bulletedList: "Bulleted list",
  numberedList: "Numbered list",
  numberingOptions: "Set numbering",
  continuePreviousNumbering: "Continue previous numbering",
  startNewList: "Start new list",
  changeNumberValue: "Change number value",
  numberValue: "Number value",
  applyNumberValue: "Apply",
  increaseIndent: "Increase indent",
  decreaseIndent: "Decrease indent",
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
  imageTooLarge: "Images must be 50 MB or smaller",
  imageAppearance: "Image background",
  imageNoBorder: "No border",
  imageLightBorder: "Light border",
  imageDarkBorder: "Dark border",
  imageShadow: "Shadow",
  imageFrame: "Frame",
  imageResizeHint: "Drag a corner handle to resize proportionally",
  imagePreview: "Image preview",
  imagePrevious: "Previous image",
  imageNext: "Next image",
  imageZoomIn: "Zoom in",
  imageZoomOut: "Zoom out",
  imageResetView: "Fit to window",
  imageRotateLeft: "Rotate left",
  imageCopy: "Copy image",
  imageDownload: "Download image",
  imageClosePreview: "Close preview",
  clipboardEmpty: "Clipboard has no text",
  highlightPlaceholder: "Highlight this note",
  aiSelectionPolishToggle: "AI Polish",
  aiSelectionPolishOn: "On",
  aiSelectionPolishOff: "Off"
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
  const normalized = normalizeLegacyHardBreaksForImport(
    normalizeControlledInlineFormattingMarkdown(normalizePlainText(value))
  );
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

function orderedListItemContent(listItem: HTMLLIElement): HTMLElement | null {
  return (
    Array.from(listItem.children).find(
      (child) => child.tagName !== "OL" && child.tagName !== "UL"
    ) as HTMLElement | undefined
  ) ?? null;
}

function orderedListMarkerLevel(listItem: HTMLLIElement): OrderedListMarkerLevel {
  let level = 1;
  let ancestor = listItem.parentElement?.parentElement ?? null;
  while (ancestor) {
    if (ancestor.tagName === "LI") {
      level += 1;
    }
    ancestor = ancestor.parentElement;
  }
  return Math.min(level, 3) as OrderedListMarkerLevel;
}

function orderedListItemAtMarkerPoint(root: HTMLElement, x: number, y: number): HTMLLIElement | null {
  const listItems = Array.from(root.querySelectorAll<HTMLLIElement>("ol > li"));
  for (let index = listItems.length - 1; index >= 0; index -= 1) {
    const listItem = listItems[index];
    const content = orderedListItemContent(listItem);
    if (!content) {
      continue;
    }

    const rect = content.getBoundingClientRect();
    const parsedLineHeight = Number.parseFloat(window.getComputedStyle(content).lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 24;
    const markerBandBottom = Math.min(rect.bottom, rect.top + Math.max(lineHeight, 18));
    if (
      x >= rect.left - 36 &&
      x <= rect.left - 2 &&
      y >= rect.top - 3 &&
      y <= markerBandBottom + 3
    ) {
      return listItem;
    }
  }
  return null;
}

function selectOrderedListItem(editor: TiptapEditor, listItem: HTMLLIElement): boolean {
  const content = orderedListItemContent(listItem);
  if (!content) {
    return false;
  }

  try {
    const position = editor.view.posAtDOM(content, 0);
    const safePosition = Math.max(0, Math.min(position, editor.state.doc.content.size));
    const selection = TextSelection.near(editor.state.doc.resolve(safePosition), 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
    return getCurrentOrderedListNumber(editor) !== null;
  } catch {
    return false;
  }
}

function numberingMenuPosition(
  menu: OrderedListNumberingMenu,
  editingNumberValue: boolean
): { left: number; top: number } {
  const menuWidth = 232;
  const menuHeight = editingNumberValue ? 190 : 116;
  const left = Math.max(8, Math.min(menu.anchorX - 8, window.innerWidth - menuWidth - 8));
  const top = menu.anchorY + menuHeight + 8 <= window.innerHeight
    ? menu.anchorY + 6
    : Math.max(8, menu.anchorY - menuHeight - 10);
  return { left, top };
}

function selectedImageControls(editor: TiptapEditor, disabled: boolean): SelectedImageControls | null {
  const { selection } = editor.state;
  if (
    disabled ||
    !editor.isEditable ||
    !(selection instanceof NodeSelection) ||
    selection.node.type.name !== "image"
  ) {
    return null;
  }

  const nodeDom = editor.view.nodeDOM(selection.from);
  if (!(nodeDom instanceof HTMLElement)) {
    return null;
  }
  const wrapper = nodeDom.matches("[data-resize-wrapper]")
    ? nodeDom
    : nodeDom.querySelector<HTMLElement>("[data-resize-wrapper]") ?? nodeDom;
  const rect = wrapper.getBoundingClientRect();

  return {
    position: selection.from,
    presentation: sanitizeImagePresentation(selection.node.attrs.presentation),
    rect: {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height
    }
  };
}

function imageToolbarPosition(controls: SelectedImageControls): { left: number; top: number } {
  const toolbarWidth = 202;
  const toolbarHeight = 42;
  const preferredLeft = controls.rect.left + controls.rect.width / 2 - toolbarWidth / 2;
  const left = Math.max(8, Math.min(preferredLeft, window.innerWidth - toolbarWidth - 8));
  const top = controls.rect.top - toolbarHeight - 8 >= 8
    ? controls.rect.top - toolbarHeight - 8
    : Math.min(window.innerHeight - toolbarHeight - 8, controls.rect.bottom + 8);
  return { left, top };
}

export const MIN_IMAGE_PREVIEW_ZOOM = 0.5;
export const MAX_IMAGE_PREVIEW_ZOOM = 3;
export const IMAGE_PREVIEW_ZOOM_STEP = 0.1;

export function clampImagePreviewZoom(value: number): number {
  const bounded = Math.min(MAX_IMAGE_PREVIEW_ZOOM, Math.max(MIN_IMAGE_PREVIEW_ZOOM, value));
  return Math.round(bounded * 10) / 10;
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
  return normalizeControlledInlineFormattingMarkdown(
    normalizePlainText(editorWithMarkdown.getMarkdown?.() ?? "")
  ).replace(/\n+$/g, "");
}

function getEditorCharacterCount(editor: TiptapEditor): number {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "");
  return countEditorCharacters(text);
}

function aiPolishTextSegments(doc: ProseMirrorNode, from: number, to: number): AiPolishTextSegment[] | null {
  const segments: AiPolishTextSegment[] = [];
  let unsupported = false;

  doc.nodesBetween(from, to, (node, position) => {
    if (unsupported) {
      return false;
    }
    if (node.isTextblock) {
      if (node.type.spec.code) {
        unsupported = true;
        return false;
      }

      const contentStart = position + 1;
      const segmentFrom = Math.max(from, contentStart);
      const segmentTo = Math.min(to, contentStart + node.content.size);
      const localFrom = segmentFrom - contentStart;
      const localTo = segmentTo - contentStart;

      if (localFrom < localTo) {
        node.nodesBetween(localFrom, localTo, (child) => {
          if (child.isLeaf && !child.isText) {
            unsupported = true;
          }
          return !unsupported;
        });
      }

      const text = node.textBetween(localFrom, localTo, "", "\n");
      if (text.includes("\n")) {
        unsupported = true;
        return false;
      }
      segments.push({ from: segmentFrom, to: segmentTo, text });
      return false;
    }
    if (node.isLeaf && !node.isText) {
      unsupported = true;
      return false;
    }
    return true;
  });

  return unsupported || segments.length === 0 ? null : segments;
}

function replaceAiPolishSelectionWithPlainText(
  editor: TiptapEditor,
  from: number,
  to: number,
  replacement: string
): boolean {
  try {
    const { doc, schema } = editor.state;
    const context = doc.resolve(from);
    const serializer = DOMSerializer.fromSchema(schema);
    const container = document.createElement("div");
    const marks = context.marks();

    normalizePlainText(replacement)
      .split(/\n+/)
      .forEach((block) => {
        const paragraph = document.createElement("p");
        if (block) {
          paragraph.appendChild(serializer.serializeNode(schema.text(block, marks)));
        }
        container.appendChild(paragraph);
      });

    const slice = ProseMirrorDOMParser.fromSchema(schema).parseSlice(container, {
      preserveWhitespace: true,
      context
    });
    const transaction = editor.state.tr
      .setSelection(TextSelection.create(doc, from, to))
      .replaceSelection(slice)
      .scrollIntoView();
    editor.view.dispatch(transaction);
    editor.commands.focus();
    return true;
  } catch {
    return false;
  }
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
  const activeListType = getActiveListType(editor);
  if (activeListType === "bulletList") {
    return "bullet";
  }
  if (activeListType === "orderedList") {
    return "number";
  }
  if (activeListType === "taskList") {
    return "check";
  }
  if (editor.isActive("blockquote")) {
    return "quote";
  }
  if (editor.isActive("codeBlock")) {
    return "code";
  }
  return "paragraph";
}

function activeParagraphType(editor: TiptapEditor | null): ParagraphType {
  if (!editor) {
    return "paragraph";
  }
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive("heading", { level })) {
      return `h${level}` as ParagraphType;
    }
  }
  return "paragraph";
}

function toolbarMenuPosition(
  anchor: DOMRect,
  width: number,
  height: number
): { left: number; top: number } {
  const margin = 8;
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
  const top = anchor.bottom + height + margin <= window.innerHeight
    ? anchor.bottom + 6
    : Math.max(margin, anchor.top - height - 6);
  return { left, top };
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

async function uploadAndInsertImages(
  editor: TiptapEditor,
  files: Array<File | Blob>,
  upload: (file: File | Blob) => Promise<string>,
  imageTooLargeMessage: string
): Promise<boolean> {
  if (files.length === 0) {
    return false;
  }

  files.forEach((file) => assertAttachmentSizeBytes(file.size, imageTooLargeMessage));
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

async function pasteClipboardImage(
  editor: TiptapEditor,
  upload: ((file: File | Blob) => Promise<string>) | undefined,
  imageTooLargeMessage: string
): Promise<boolean> {
  if (!upload) {
    return false;
  }

  const payload = await window.workJournal.editor.readClipboardImage();
  if (!payload) {
    return false;
  }

  return uploadAndInsertImages(editor, [clipboardPayloadToBlob(payload)], upload, imageTooLargeMessage);
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
  priority: 110,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this;
        if (!getActiveListItemType(editor)) {
          return false;
        }
        return canIndentListItem(editor) ? indentListItem(editor) : true;
      },
      "Shift-Tab": () => {
        const { editor } = this;
        if (!getActiveListItemType(editor)) {
          return false;
        }
        return canOutdentListItem(editor) ? outdentListItem(editor) : true;
      },
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

function readInlineFormattingSnapshot(editor: TiptapEditor): InlineFormattingSnapshot {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    textColor: sanitizeTextColor(editor.getAttributes("flowShuttleTextColor").color),
    highlightColor: sanitizeHighlightColor(editor.getAttributes("highlight").color)
  };
}

function applyInlineFormattingSnapshot(
  editor: TiptapEditor,
  snapshot: InlineFormattingSnapshot
): boolean {
  const chain = editor.chain().focus()
    .unsetMark("bold")
    .unsetMark("italic")
    .unsetMark("underline")
    .unsetMark("strike")
    .unsetMark("flowShuttleTextColor")
    .unsetMark("highlight");

  if (snapshot.bold) {
    chain.setMark("bold");
  }
  if (snapshot.italic) {
    chain.setMark("italic");
  }
  if (snapshot.underline) {
    chain.setMark("underline");
  }
  if (snapshot.strike) {
    chain.setMark("strike");
  }
  if (snapshot.textColor) {
    chain.setMark("flowShuttleTextColor", { color: snapshot.textColor });
  }
  if (snapshot.highlightColor) {
    chain.setMark("highlight", { color: snapshot.highlightColor });
  }

  return chain.run();
}

function Toolbar({
  editor,
  labels,
  disabled,
  showFormatActionsInline,
  aiSelectionPolishEnabled,
  onToggleAiSelectionPolish
}: {
  editor: TiptapEditor | null;
  labels: MarkdownEditorLabels;
  disabled?: boolean;
  showFormatActionsInline?: boolean;
  aiSelectionPolishEnabled: boolean;
  onToggleAiSelectionPolish: () => void;
}): JSX.Element {
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph");
  const [toolbarMenu, setToolbarMenu] = useState<{
    kind: ToolbarMenuKind;
    left: number;
    top: number;
  } | null>(null);
  const [, setToolbarRevision] = useState(0);
  const [rememberedTextColor, setRememberedTextColor] = useState<TextColor>(DEFAULT_TEXT_COLOR);
  const [rememberedHighlightColor, setRememberedHighlightColor] = useState<HighlightColor | null>(
    DEFAULT_HIGHLIGHT_TOOL_COLOR
  );
  const [formatPainterState, setFormatPainterState] = useState<FormatPainterState | null>(null);
  const toolbarSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const toolbarMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const update = () => {
      setActiveBlock(getActiveBlockType(editor));
      setToolbarRevision((current) => current + 1);
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  useEffect(() => {
    if (!toolbarMenu) {
      return;
    }
    const closeToolbarMenu = () => {
      toolbarSelectionRef.current = null;
      setToolbarMenu(null);
    };
    const closeFromOutside = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-markdown-toolbar-menu-trigger]")
      ) {
        return;
      }
      if (!toolbarMenuRef.current?.contains(event.target as Node)) {
        closeToolbarMenu();
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeToolbarMenu();
        editor?.commands.focus();
      }
    };
    const close = () => closeToolbarMenu();
    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [editor, toolbarMenu]);

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

  const activateFormatPainter = (): void => {
    if (!editor || disabled) {
      return;
    }
    if (formatPainterState) {
      setFormatPainterState(null);
      toolbarSelectionRef.current = null;
      editor.commands.focus();
      return;
    }

    restoreToolbarSelection();
    const { selection } = editor.state;
    if (!selection.$from.parent.isTextblock || !selection.$to.parent.isTextblock) {
      toolbarSelectionRef.current = null;
      return;
    }
    setFormatPainterState({
      sourceFrom: selection.from,
      sourceTo: selection.to,
      snapshot: readInlineFormattingSnapshot(editor)
    });
    toolbarSelectionRef.current = null;
    editor.commands.focus();
  };

  const clearFormatting = (): void => {
    setFormatPainterState(null);
    run(() => editor?.chain().focus().unsetAllMarks().run() ?? false);
  };

  useEffect(() => {
    if (!editor || disabled) {
      return;
    }
    const handleShortcut = (event: KeyboardEvent) => {
      if (!editor.isFocused) {
        return;
      }
      const usesModKey = event.ctrlKey || event.metaKey;
      if (usesModKey && event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        activateFormatPainter();
        return;
      }
      if (usesModKey && !event.altKey && (event.key === "\\" || event.code === "Backslash")) {
        event.preventDefault();
        clearFormatting();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [disabled, editor, formatPainterState]);

  useEffect(() => {
    if (!editor || !formatPainterState) {
      return;
    }

    const editorElement = editor.view.dom;
    editorElement.classList.add("is-format-painter-active");

    const applyToCurrentSelection = () => {
      if (editor.isDestroyed) {
        return;
      }
      const { selection } = editor.state;
      const isSourceSelection = selection.from === formatPainterState.sourceFrom
        && selection.to === formatPainterState.sourceTo;
      if (!(selection instanceof TextSelection) || selection.empty || isSourceSelection) {
        return;
      }
      if (applyInlineFormattingSnapshot(editor, formatPainterState.snapshot)) {
        requestSelectionIntoView(editor);
      }
      setFormatPainterState(null);
    };

    const applyAfterMouseSelection = (event: MouseEvent) => {
      if (event.target instanceof Node && editorElement.contains(event.target)) {
        window.requestAnimationFrame(applyToCurrentSelection);
      }
    };
    const applyAfterKeyboardSelection = () => {
      if (editor.isFocused) {
        window.requestAnimationFrame(applyToCurrentSelection);
      }
    };
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFormatPainterState(null);
      }
    };

    document.addEventListener("mouseup", applyAfterMouseSelection, true);
    document.addEventListener("keyup", applyAfterKeyboardSelection);
    document.addEventListener("keydown", cancelFromKeyboard);
    return () => {
      editorElement.classList.remove("is-format-painter-active");
      document.removeEventListener("mouseup", applyAfterMouseSelection, true);
      document.removeEventListener("keyup", applyAfterKeyboardSelection);
      document.removeEventListener("keydown", cancelFromKeyboard);
    };
  }, [editor, formatPainterState]);

  const button = (
    key: BlockType,
    content: ReactNode,
    action: () => boolean,
    title: string,
    className?: string
  ): JSX.Element => (
    <button
      key={key}
      type="button"
      className={className}
      aria-pressed={activeBlock === key}
      aria-label={title}
      title={title}
      disabled={disabled || !editor}
      onMouseDown={keepSelection}
      onClick={() => run(action)}
    >
      {content}
    </button>
  );

  const headings: Array<[ParagraphType, string, string, () => boolean]> = [
    ["paragraph", "P", labels.paragraph, () => editor?.chain().focus().setParagraph().run() ?? false],
    ["h1", "H1", labels.heading1, () => editor?.chain().focus().toggleHeading({ level: 1 }).run() ?? false],
    ["h2", "H2", labels.heading2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run() ?? false],
    ["h3", "H3", labels.heading3, () => editor?.chain().focus().toggleHeading({ level: 3 }).run() ?? false],
    ["h4", "H4", labels.heading4, () => editor?.chain().focus().toggleHeading({ level: 4 }).run() ?? false],
    ["h5", "H5", labels.heading5, () => editor?.chain().focus().toggleHeading({ level: 5 }).run() ?? false],
    ["h6", "H6", labels.heading6, () => editor?.chain().focus().toggleHeading({ level: 6 }).run() ?? false]
  ];

  const currentParagraph = activeParagraphType(editor);
  const currentParagraphLabel = headings.find(([key]) => key === currentParagraph)?.[2] ?? labels.paragraph;
  const textColorIsActive = Boolean(editor?.isActive("flowShuttleTextColor"));
  const highlightIsActive = Boolean(editor?.isActive("highlight"));
  const textColorLabels: Record<TextColor, string> = {
    black: labels.colorBlack,
    gray: labels.colorGray,
    blue: labels.colorBlue,
    green: labels.colorGreen,
    red: labels.colorRed,
    orange: labels.colorOrange,
    yellow: labels.colorYellow,
    purple: labels.colorPurple,
    pink: labels.colorPink
  };
  const highlightColorLabels: Record<HighlightColor, string> = {
    black: labels.colorBlack,
    gray: labels.colorGray,
    blue: labels.colorBlue,
    green: labels.colorGreen,
    red: labels.colorRed,
    orange: labels.colorOrange,
    yellow: labels.colorYellow,
    purple: labels.colorPurple,
    pink: labels.colorPink
  };

  const openToolbarMenu = (
    kind: ToolbarMenuKind,
    anchor: HTMLButtonElement
  ) => {
    if (!editor || disabled) {
      return;
    }
    const dimensions = kind === "paragraph"
      ? { width: 176, height: 246 }
      : kind === "more"
        ? { width: 218, height: 84 }
        : kind === "highlightColor"
          ? { width: 206, height: 116 }
          : { width: 206, height: 78 };
    const position = toolbarMenuPosition(anchor.getBoundingClientRect(), dimensions.width, dimensions.height);
    setToolbarMenu((current) => {
      if (current?.kind === kind) {
        toolbarSelectionRef.current = null;
        return null;
      }
      return { kind, ...position };
    });
  };

  const formatButton = (
    key: string,
    content: ReactNode,
    active: boolean,
    action: () => boolean,
    title: string
  ) => (
    <button
      key={key}
      type="button"
      className="markdown-editor-icon-button"
      aria-pressed={active}
      aria-label={title}
      title={title}
      disabled={disabled || !editor}
      onMouseDown={keepSelection}
      onClick={() => run(action)}
    >
      {content}
    </button>
  );

  const toolbarMenuPortal = toolbarMenu && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={toolbarMenuRef}
          className={`markdown-editor-toolbar-menu is-${toolbarMenu.kind}`}
          role="menu"
          aria-label={
            toolbarMenu.kind === "paragraph"
              ? labels.heading
              : toolbarMenu.kind === "textColor"
                ? labels.textColor
                : toolbarMenu.kind === "highlightColor"
                  ? labels.highlightColor
                  : labels.more
          }
          style={{ left: toolbarMenu.left, top: toolbarMenu.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
        >
          {toolbarMenu.kind === "paragraph" && headings.map(([key, prefix, title, action]) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={currentParagraph === key}
              onClick={() => {
                run(action);
                setToolbarMenu(null);
              }}
            >
              <span className="markdown-editor-paragraph-prefix">{prefix}</span>
              <span>{title}</span>
              {currentParagraph === key && <Check size={15} strokeWidth={1.9} aria-hidden="true" />}
            </button>
          ))}
          {toolbarMenu.kind === "textColor" && (
            <div className="markdown-editor-color-grid" role="group" aria-label={labels.textColor}>
              {TEXT_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="markdown-editor-color-choice"
                  role="menuitemradio"
                  aria-checked={rememberedTextColor === option.value}
                  aria-label={textColorLabels[option.value]}
                  title={textColorLabels[option.value]}
                  onClick={() => {
                    setRememberedTextColor(option.value);
                    run(() => editor?.chain().focus().setMark("flowShuttleTextColor", { color: option.value }).run() ?? false);
                    setToolbarMenu(null);
                  }}
                >
                  <span style={{ backgroundColor: option.fallback }} />
                  {rememberedTextColor === option.value && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
          {toolbarMenu.kind === "highlightColor" && (
            <>
              <button
                type="button"
                className="markdown-editor-color-reset"
                role="menuitemradio"
                aria-checked={rememberedHighlightColor === null}
                onClick={() => {
                  setRememberedHighlightColor(null);
                  run(() => editor?.chain().focus().unsetMark("highlight").run() ?? false);
                  setToolbarMenu(null);
                }}
              >
                <Eraser size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{labels.noBackground}</span>
                {rememberedHighlightColor === null && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
              </button>
              <div className="markdown-editor-color-grid is-highlight" role="group" aria-label={labels.highlightColor}>
                {HIGHLIGHT_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="markdown-editor-color-choice"
                    role="menuitemradio"
                    aria-checked={rememberedHighlightColor === option.value}
                    aria-label={highlightColorLabels[option.value]}
                    title={highlightColorLabels[option.value]}
                    onClick={() => {
                      setRememberedHighlightColor(option.value);
                      run(() => editor?.chain().focus().setMark("highlight", { color: option.value }).run() ?? false);
                      setToolbarMenu(null);
                    }}
                  >
                    <span style={{ backgroundColor: option.fallback }} />
                    {rememberedHighlightColor === option.value && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </>
          )}
          {toolbarMenu.kind === "more" && !showFormatActionsInline && (
            <>
              <button
                type="button"
                className={`markdown-editor-more-menu-item${formatPainterState ? " is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={Boolean(formatPainterState)}
                aria-keyshortcuts="Control+Alt+C"
                onClick={() => {
                  activateFormatPainter();
                  setToolbarMenu(null);
                }}
              >
                <PaintRoller size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{labels.formatPainter}</span>
                <span className="markdown-editor-menu-shortcut" aria-hidden="true">
                  <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>C</kbd>
                </span>
              </button>
              <button
                type="button"
                className="markdown-editor-more-menu-item"
                role="menuitem"
                aria-keyshortcuts={"Control+\\"}
                onClick={() => {
                  clearFormatting();
                  setToolbarMenu(null);
                }}
              >
                <RemoveFormatting size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{labels.clearFormatting}</span>
                <span className="markdown-editor-menu-shortcut" aria-hidden="true">
                  <kbd>Ctrl</kbd><kbd>{"\\"}</kbd>
                </span>
              </button>
            </>
          )}
        </div>,
        document.body
      )
    : null;

  const increaseIndentAvailable = Boolean(editor && canIndentListItem(editor));
  const decreaseIndentAvailable = Boolean(editor && canOutdentListItem(editor));

  return (
    <>
      <div className="markdown-editor-toolbar" role="toolbar" aria-label={labels.toolbarLabel}>
        <button
          type="button"
          className="markdown-editor-paragraph-trigger"
          data-markdown-toolbar-menu-trigger
          aria-label={labels.heading}
          aria-expanded={toolbarMenu?.kind === "paragraph"}
          title={labels.heading}
          disabled={disabled || !editor}
          onMouseDown={keepSelection}
          onClick={(event) => openToolbarMenu("paragraph", event.currentTarget)}
        >
          <span>{currentParagraphLabel}</span>
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <span className="markdown-editor-toolbar-divider" />
        <div className="markdown-editor-format-group">
          {formatButton(
            "bold",
            <Bold size={16} strokeWidth={1.8} aria-hidden="true" />,
            Boolean(editor?.isActive("bold")),
            () => editor?.chain().focus().toggleBold().run() ?? false,
            labels.bold
          )}
          {formatButton(
            "italic",
            <Italic size={16} strokeWidth={1.8} aria-hidden="true" />,
            Boolean(editor?.isActive("italic")),
            () => editor?.chain().focus().toggleItalic().run() ?? false,
            labels.italic
          )}
          {formatButton(
            "underline",
            <Underline size={16} strokeWidth={1.8} aria-hidden="true" />,
            Boolean(editor?.isActive("underline")),
            () => editor?.chain().focus().toggleMark("underline").run() ?? false,
            labels.underline
          )}
          {formatButton(
            "strike",
            <Strikethrough size={16} strokeWidth={1.8} aria-hidden="true" />,
            Boolean(editor?.isActive("strike")),
            () => editor?.chain().focus().toggleStrike().run() ?? false,
            labels.strikethrough
          )}
          <div className="markdown-editor-color-control" role="group" aria-label={labels.textColor}>
            <button
              type="button"
              className="markdown-editor-color-apply"
              aria-pressed={textColorIsActive}
              aria-label={labels.textColor}
              title={`${labels.textColor}: ${textColorLabels[rememberedTextColor]}`}
              disabled={disabled || !editor}
              onMouseDown={keepSelection}
              onClick={() => run(() => {
                const color = resolveTextColorToggle(textColorIsActive, rememberedTextColor);
                return color
                  ? editor?.chain().focus().setMark("flowShuttleTextColor", { color }).run() ?? false
                  : editor?.chain().focus().unsetMark("flowShuttleTextColor").run() ?? false;
              })}
            >
              <Baseline
                size={16}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{
                  color: rememberedTextColor === "black"
                    ? "var(--text-primary)"
                    : textColorFallback(rememberedTextColor) ?? undefined
                }}
              />
            </button>
            <button
              type="button"
              className="markdown-editor-color-menu-trigger"
              data-markdown-toolbar-menu-trigger
              aria-label={labels.textColor}
              aria-haspopup="menu"
              aria-expanded={toolbarMenu?.kind === "textColor"}
              title={labels.textColor}
              disabled={disabled || !editor}
              onMouseDown={keepSelection}
              onClick={(event) => openToolbarMenu("textColor", event.currentTarget)}
            >
              <ChevronDown size={10} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <div className="markdown-editor-color-control" role="group" aria-label={labels.highlightColor}>
            <button
              type="button"
              className="markdown-editor-color-apply"
              aria-pressed={highlightIsActive}
              aria-label={labels.highlightColor}
              title={`${labels.highlightColor}: ${
                rememberedHighlightColor
                  ? highlightColorLabels[rememberedHighlightColor]
                  : labels.noBackground
              }`}
              disabled={disabled || !editor}
              onMouseDown={keepSelection}
              onClick={() => run(() => {
                const color = resolveHighlightColorToggle(highlightIsActive, rememberedHighlightColor);
                return color
                  ? editor?.chain().focus().setMark("highlight", { color }).run() ?? false
                  : editor?.chain().focus().unsetMark("highlight").run() ?? false;
              })}
            >
              <Highlighter
                size={16}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{
                  color: rememberedHighlightColor === "black"
                    ? "var(--text-primary)"
                    : highlightColorIndicator(rememberedHighlightColor) ?? undefined
                }}
              />
            </button>
            <button
              type="button"
              className="markdown-editor-color-menu-trigger"
              data-markdown-toolbar-menu-trigger
              aria-label={labels.highlightColor}
              aria-haspopup="menu"
              aria-expanded={toolbarMenu?.kind === "highlightColor"}
              title={labels.highlightColor}
              disabled={disabled || !editor}
              onMouseDown={keepSelection}
              onClick={(event) => openToolbarMenu("highlightColor", event.currentTarget)}
            >
              <ChevronDown size={10} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>
        <span className="markdown-editor-toolbar-divider" />
        {button(
          "number",
          <ListOrdered size={16} strokeWidth={1.8} aria-hidden="true" />,
          () => editor?.chain().focus().toggleOrderedList().run() ?? false,
          labels.numberedList,
          "markdown-editor-icon-button"
        )}
        {button(
          "bullet",
          <List size={16} strokeWidth={1.8} aria-hidden="true" />,
          () => editor?.chain().focus().toggleBulletList().run() ?? false,
          labels.bulletedList,
          "markdown-editor-icon-button"
        )}
        {button(
          "check",
          <SquareCheckBig size={16} strokeWidth={1.8} aria-hidden="true" />,
          () => editor?.chain().focus().toggleTaskList().run() ?? false,
          labels.taskList,
          "markdown-editor-icon-button"
        )}
        <button
          type="button"
          className="markdown-editor-icon-button"
          aria-label={labels.increaseIndent}
          title={labels.increaseIndent}
          disabled={disabled || !editor || !increaseIndentAvailable}
          onMouseDown={keepSelection}
          onClick={() => run(() => editor ? indentListItem(editor) : false)}
        >
          <IndentIncrease size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="markdown-editor-icon-button"
          aria-label={labels.decreaseIndent}
          title={labels.decreaseIndent}
          disabled={disabled || !editor || !decreaseIndentAvailable}
          onMouseDown={keepSelection}
          onClick={() => run(() => editor ? outdentListItem(editor) : false)}
        >
          <IndentDecrease size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <span className="markdown-editor-toolbar-divider" />
        {button(
          "quote",
          <Quote size={16} strokeWidth={1.8} aria-hidden="true" />,
          () => editor?.chain().focus().toggleBlockquote().run() ?? false,
          labels.quote,
          "markdown-editor-icon-button"
        )}
        {button(
          "code",
          <SquareCode size={16} strokeWidth={1.8} aria-hidden="true" />,
          () => editor?.chain().focus().toggleCodeBlock().run() ?? false,
          labels.codeBlock,
          "markdown-editor-icon-button"
        )}
        <span className="markdown-editor-toolbar-divider" />
        {showFormatActionsInline ? (
          <>
            <button
              type="button"
              className={`markdown-editor-icon-button${formatPainterState ? " is-active" : ""}`}
              aria-pressed={Boolean(formatPainterState)}
              aria-label={labels.formatPainter}
              aria-keyshortcuts="Control+Alt+C"
              title={labels.formatPainter}
              disabled={disabled || !editor}
              onMouseDown={keepSelection}
              onClick={activateFormatPainter}
            >
              <PaintRoller size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="markdown-editor-icon-button"
              aria-label={labels.clearFormatting}
              aria-keyshortcuts={"Control+\\"}
              title={labels.clearFormatting}
              disabled={disabled || !editor}
              onMouseDown={keepSelection}
              onClick={clearFormatting}
            >
              <RemoveFormatting size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="markdown-editor-icon-button markdown-editor-more-trigger"
            data-markdown-toolbar-menu-trigger
            aria-label={labels.more}
            aria-haspopup="menu"
            aria-expanded={toolbarMenu?.kind === "more"}
            aria-pressed={Boolean(formatPainterState)}
            title={labels.more}
            disabled={disabled || !editor}
            onMouseDown={keepSelection}
            onClick={(event) => openToolbarMenu("more", event.currentTarget)}
          >
            <Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
        {!disabled && (
          <>
            <span className="markdown-editor-toolbar-spacer" />
            <button
              className={`markdown-editor-ai-polish-toggle${aiSelectionPolishEnabled ? " is-on" : ""}`}
              type="button"
              aria-pressed={aiSelectionPolishEnabled}
              aria-label={`${labels.aiSelectionPolishToggle}: ${
                aiSelectionPolishEnabled ? labels.aiSelectionPolishOn : labels.aiSelectionPolishOff
              }`}
              title={`${labels.aiSelectionPolishToggle}: ${
                aiSelectionPolishEnabled ? labels.aiSelectionPolishOn : labels.aiSelectionPolishOff
              }`}
              disabled={!editor}
              onMouseDown={keepSelection}
              onClick={() => {
                if (!editor) {
                  return;
                }
                restoreToolbarSelection();
                onToggleAiSelectionPolish();
                toolbarSelectionRef.current = null;
                editor.commands.focus();
              }}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>{labels.aiSelectionPolishToggle}</span>
              <small>{aiSelectionPolishEnabled ? labels.aiSelectionPolishOn : labels.aiSelectionPolishOff}</small>
            </button>
          </>
        )}
      </div>
      {toolbarMenuPortal}
    </>
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
  showFormatActionsInline,
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
  const aiSelectionPolish = useAiSelectionPolish();
  const aiSelectionPolishRef = useRef(aiSelectionPolish);
  const aiSelectionPolishOwner = useId();
  const syncingRef = useRef(false);
  const lastMarkdownRef = useRef(normalizePlainText(value || ""));
  const [contextMenu, setContextMenu] = useState<EditorContextMenu | null>(null);
  const [numberingMenu, setNumberingMenu] = useState<OrderedListNumberingMenu | null>(null);
  const [editingNumberValue, setEditingNumberValue] = useState(false);
  const [numberValue, setNumberValue] = useState("1");
  const [selectedImage, setSelectedImage] = useState<SelectedImageControls | null>(null);
  const [previewImage, setPreviewImage] = useState<ImagePreviewState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [characterCount, setCharacterCount] = useState(() => countEditorCharacters(value || ""));
  const [aiSelectionPolishEnabled, setAiSelectionPolishEnabled] = useState(false);
  const numberingMenuRef = useRef<HTMLDivElement | null>(null);
  const numberInputRef = useRef<HTMLInputElement | null>(null);
  const isImagePreviewOpen = previewImage !== null;

  const closeNumberingMenu = useCallback((focusEditor = false) => {
    setNumberingMenu(null);
    setEditingNumberValue(false);
    if (focusEditor) {
      editorRef.current?.commands.focus();
    }
  }, []);

  useEffect(() => {
    uploadRef.current = onImageUpload;
  }, [onImageUpload]);

  useEffect(() => {
    imageErrorRef.current = onImageError;
  }, [onImageError]);

  useEffect(() => {
    aiSelectionPolishRef.current = aiSelectionPolish;
  }, [aiSelectionPolish]);

  useEffect(() => {
    if (!isImagePreviewOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewImage(null);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        setPreviewImage((current) => {
          if (!current) {
            return null;
          }
          const nextIndex = Math.min(
            current.images.length - 1,
            Math.max(0, current.index + direction)
          );
          return nextIndex === current.index
            ? current
            : { ...current, index: nextIndex, zoom: 1, rotation: 0 };
        });
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setPreviewImage((current) => current
          ? { ...current, zoom: clampImagePreviewZoom(current.zoom + IMAGE_PREVIEW_ZOOM_STEP) }
          : null);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        setPreviewImage((current) => current
          ? { ...current, zoom: clampImagePreviewZoom(current.zoom - IMAGE_PREVIEW_ZOOM_STEP) }
          : null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isImagePreviewOpen]);

  const updateAiSelectionPolishCandidate = useCallback(
    (currentEditor: TiptapEditor) => {
      const controller = aiSelectionPolishRef.current;
      const { selection, doc } = currentEditor.state;
      const { from, to, head } = selection;
      if (
        !aiSelectionPolishEnabled ||
        disabled ||
        !currentEditor.isFocused ||
        selection.empty
      ) {
        controller.clearCandidate(aiSelectionPolishOwner);
        return;
      }

      const segments = aiPolishTextSegments(doc, from, to);
      if (!segments) {
        controller.clearCandidate(aiSelectionPolishOwner);
        return;
      }
      const sourceText = segments.map((segment) => segment.text).join("\n");
      if (!sourceText.trim()) {
        controller.clearCandidate(aiSelectionPolishOwner);
        return;
      }

      let focus: { top: number; right: number; bottom: number; left: number };
      try {
        focus = currentEditor.view.coordsAtPos(head);
      } catch {
        controller.clearCandidate(aiSelectionPolishOwner);
        return;
      }
      const isCurrent = () => {
        const editorAtReplacement = editorRef.current;
        if (!editorAtReplacement || from < 0 || to > editorAtReplacement.state.doc.content.size) {
          return false;
        }
        const currentSegments = aiPolishTextSegments(editorAtReplacement.state.doc, from, to);
        return Boolean(
          currentSegments &&
          currentSegments.length === segments.length &&
          currentSegments.every(
            (segment, index) =>
              segment.from === segments[index].from &&
              segment.to === segments[index].to &&
              segment.text === segments[index].text
          )
        );
      };

      controller.setCandidate(aiSelectionPolishOwner, {
        sourceText,
        anchor: {
          top: focus.top,
          right: focus.right,
          bottom: focus.bottom,
          left: focus.left
        },
        isCurrent,
        replace: (replacement) => {
          const editorAtReplacement = editorRef.current;
          if (!editorAtReplacement || !isCurrent()) {
            return "selection-changed";
          }
          const replacementSegments = normalizePlainText(replacement).split("\n");
          if (replacementSegments.length !== segments.length) {
            return replaceAiPolishSelectionWithPlainText(editorAtReplacement, from, to, replacement)
              ? "ok"
              : "replace-failed";
          }
          const transaction = editorAtReplacement.state.tr;
          for (let index = segments.length - 1; index >= 0; index -= 1) {
            const segment = segments[index];
            transaction.insertText(replacementSegments[index], segment.from, segment.to);
          }
          editorAtReplacement.view.dispatch(transaction);
          editorAtReplacement.commands.focus();
          return "ok";
        }
      });
    },
    [aiSelectionPolishEnabled, aiSelectionPolishOwner, disabled]
  );

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        hardBreak: false,
        link: false,
        orderedList: false,
        underline: false
      }),
      FlowShuttleOrderedList,
      FlowShuttleListBehavior,
      FlowShuttleHardBreak,
      FlowShuttleKeyboardExtension,
      FlowShuttleUnderline,
      FlowShuttleTextColor,
      TaskList,
      TaskItem.configure({ nested: true }),
      FlowShuttleImage.configure({
        allowBase64: false,
        HTMLAttributes: {
          class: "markdown-editor-image"
        }
      }),
      FlowShuttleHighlight,
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
              await uploadAndInsertImages(currentEditor, imageFiles, uploadRef.current!, resolvedLabels.imageTooLarge);
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
              await pasteClipboardImage(currentEditor, uploadRef.current, resolvedLabels.imageTooLarge);
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
      setCharacterCount(getEditorCharacterCount(createdEditor));
    },
    onUpdate: ({ editor: updatedEditor }) => {
      setCharacterCount(getEditorCharacterCount(updatedEditor));
      if (syncingRef.current) {
        return;
      }
      const markdown = getEditorMarkdown(updatedEditor);
      if (markdown !== lastMarkdownRef.current) {
        lastMarkdownRef.current = markdown;
        onChange(markdown);
      }
      requestSelectionIntoView(updatedEditor);
      updateAiSelectionPolishCandidate(updatedEditor);
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      editorRef.current = updatedEditor;
      updateAiSelectionPolishCandidate(updatedEditor);
    },
    onFocus: ({ editor: focusedEditor }) => {
      updateAiSelectionPolishCandidate(focusedEditor);
    },
    onBlur: () => {
      aiSelectionPolishRef.current.clearCandidate(aiSelectionPolishOwner);
    },
    onDestroy: () => {
      if (editorRef.current) {
        cancelSelectionIntoView(editorRef.current);
      }
      aiSelectionPolishRef.current.clearCandidate(aiSelectionPolishOwner);
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
    if (!editor) {
      setSelectedImage(null);
      return;
    }

    const root = editor.view.dom as HTMLElement;
    let frame: number | null = null;
    const refresh = () => {
      frame = null;
      setSelectedImage(selectedImageControls(editor, Boolean(disabled)));
    };
    const scheduleRefresh = () => {
      if (frame === null) {
        frame = window.requestAnimationFrame(refresh);
      }
    };

    refresh();
    editor.on("selectionUpdate", scheduleRefresh);
    editor.on("transaction", scheduleRefresh);
    root.addEventListener("flow-shuttle-image-resize", scheduleRefresh);
    document.addEventListener("scroll", scheduleRefresh, true);
    window.addEventListener("resize", scheduleRefresh);

    return () => {
      editor.off("selectionUpdate", scheduleRefresh);
      editor.off("transaction", scheduleRefresh);
      root.removeEventListener("flow-shuttle-image-resize", scheduleRefresh);
      document.removeEventListener("scroll", scheduleRefresh, true);
      window.removeEventListener("resize", scheduleRefresh);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [disabled, editor]);

  useEffect(() => {
    if (!editingNumberValue || !numberingMenu) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingNumberValue, numberingMenu]);

  useEffect(() => {
    if (!numberingMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!numberingMenuRef.current?.contains(event.target as Node)) {
        closeNumberingMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNumberingMenu(true);
      }
    };
    const close = () => closeNumberingMenu();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [closeNumberingMenu, numberingMenu]);

  useEffect(() => {
    if (disabled) {
      closeNumberingMenu();
    }
  }, [closeNumberingMenu, disabled]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (aiSelectionPolishEnabled) {
      updateAiSelectionPolishCandidate(editor);
    } else {
      aiSelectionPolish.clearCandidate(aiSelectionPolishOwner);
    }
  }, [aiSelectionPolish, aiSelectionPolishEnabled, aiSelectionPolishOwner, editor, updateAiSelectionPolishCandidate]);

  useEffect(() => {
    if (!editor || !aiSelectionPolishEnabled || disabled) {
      return;
    }

    let frame: number | null = null;
    const scheduleCandidatePositionUpdate = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateAiSelectionPolishCandidate(editor);
      });
    };

    document.addEventListener("scroll", scheduleCandidatePositionUpdate, { capture: true, passive: true });
    window.addEventListener("resize", scheduleCandidatePositionUpdate);
    return () => {
      document.removeEventListener("scroll", scheduleCandidatePositionUpdate, true);
      window.removeEventListener("resize", scheduleCandidatePositionUpdate);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [aiSelectionPolishEnabled, disabled, editor, updateAiSelectionPolishCandidate]);

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
      setCharacterCount(getEditorCharacterCount(editor));
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
      closeNumberingMenu();
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
    const openNumberingMenuAtPoint = (event: MouseEvent): boolean => {
      if (!disabled) {
        const listItem = orderedListItemAtMarkerPoint(root, event.clientX, event.clientY);
        if (listItem) {
          event.preventDefault();
          setContextMenu(null);
          if (selectOrderedListItem(editor, listItem)) {
            const currentNumber = getCurrentOrderedListNumber(editor);
            const content = orderedListItemContent(listItem);
            if (currentNumber !== null && content) {
              const rect = content.getBoundingClientRect();
              const contentStyle = window.getComputedStyle(content);
              setNumberValue(String(currentNumber));
              setEditingNumberValue(false);
              setNumberingMenu({
                anchorX: event.clientX,
                anchorY: rect.top + Math.min(rect.height, 24),
                currentNumber,
                canContinue: canContinueOrderedList(editor),
                markerFontFamily: contentStyle.fontFamily,
                markerFontSize: contentStyle.fontSize,
                markerFontWeight: contentStyle.fontWeight,
                markerLabel: formatOrderedListMarker(
                  currentNumber,
                  orderedListMarkerLevel(listItem)
                ),
                markerLineHeight: contentStyle.lineHeight,
                markerRight: rect.left - 7,
                markerTop: rect.top
              });
              return true;
            }
          }
        }
      }

      return false;
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0 && openNumberingMenuAtPoint(event)) {
        event.stopPropagation();
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const image = target?.closest<HTMLImageElement>("img.markdown-editor-image");
      if (image) {
        closeNumberingMenu();
        setContextMenu(null);
      } else {
        setContextMenu(null);
      }
    };
    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const image = target?.closest<HTMLImageElement>("img.markdown-editor-image");
      if (!image) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const images = Array.from(root.querySelectorAll<HTMLImageElement>("img.markdown-editor-image"));
      const imageIndex = Math.max(0, images.indexOf(image));
      setPreviewImage({
        images: images.map((candidate) => ({
          src: candidate.getAttribute("src") || "",
          alt: candidate.getAttribute("alt") || resolvedLabels.imagePreview
        })),
        index: imageIndex,
        zoom: 1,
        rotation: 0
      });
    };

    root.addEventListener("contextmenu", handleContextMenu);
    root.addEventListener("mousedown", handleMouseDown, true);
    root.addEventListener("click", handleClick);
    root.addEventListener("dblclick", handleDoubleClick);
    return () => {
      root.removeEventListener("contextmenu", handleContextMenu);
      root.removeEventListener("mousedown", handleMouseDown, true);
      root.removeEventListener("click", handleClick);
      root.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [closeNumberingMenu, disabled, editor, resolvedLabels.imagePreview]);

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
      if (await pasteClipboardImage(currentEditor, uploadRef.current, resolvedLabels.imageTooLarge)) {
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

  const parsedNumberValue = Number.parseInt(numberValue, 10);
  const numberValueIsValid = /^\d+$/.test(numberValue.trim())
    && parsedNumberValue >= 1
    && parsedNumberValue <= MAX_ORDERED_LIST_VALUE;

  const runNumberingAction = (
    mode: "new" | "continue" | "custom",
    customStart?: number
  ) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || disabled) {
      return;
    }
    if (setCurrentOrderedListSequence(currentEditor, mode, customStart)) {
      closeNumberingMenu();
    }
  };

  const applyImagePresentation = (presentation: ImagePresentation) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !selectedImage || disabled) {
      return;
    }
    const targetNode = currentEditor.state.doc.nodeAt(selectedImage.position);
    if (targetNode?.type.name !== "image") {
      setSelectedImage(null);
      return;
    }
    currentEditor
      .chain()
      .focus()
      .setNodeSelection(selectedImage.position)
      .updateAttributes("image", { presentation })
      .run();
  };

  const imagePresentationOptions: Array<{
    value: ImagePresentation;
    label: string;
    icon: ReactNode;
  }> = [
    {
      value: "none",
      label: resolvedLabels.imageNoBorder,
      icon: <SquareDashed size={18} strokeWidth={1.7} aria-hidden="true" />
    },
    {
      value: "light",
      label: resolvedLabels.imageLightBorder,
      icon: <Square size={18} strokeWidth={1.35} aria-hidden="true" />
    },
    {
      value: "dark",
      label: resolvedLabels.imageDarkBorder,
      icon: <Square size={18} strokeWidth={2.55} aria-hidden="true" />
    },
    {
      value: "shadow",
      label: resolvedLabels.imageShadow,
      icon: <Layers size={18} strokeWidth={1.75} aria-hidden="true" />
    },
    {
      value: "frame",
      label: resolvedLabels.imageFrame,
      icon: <Frame size={18} strokeWidth={1.75} aria-hidden="true" />
    }
  ];

  const imageStyleToolbarPortal = selectedImage && !disabled
    ? createPortal(
        <div
          className="markdown-editor-image-toolbar"
          role="toolbar"
          aria-label={resolvedLabels.imageAppearance}
          title={resolvedLabels.imageResizeHint}
          style={imageToolbarPosition(selectedImage)}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="sr-only">{resolvedLabels.imageResizeHint}</span>
          {imagePresentationOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              aria-pressed={selectedImage.presentation === option.value}
              title={option.label}
              onClick={() => applyImagePresentation(option.value)}
            >
              {option.icon}
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  const activePreviewImage = previewImage?.images[previewImage.index] ?? null;
  const lightbox = previewImage && activePreviewImage
    ? createPortal(
        <div
          className="image-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={resolvedLabels.imagePreview}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewImage(null);
            }
          }}
        >
          <section className="image-lightbox" aria-label={activePreviewImage.alt}>
            <button
              type="button"
              className="button ghost icon-button image-lightbox-close"
              aria-label={resolvedLabels.imageClosePreview}
              title={resolvedLabels.imageClosePreview}
              onClick={() => setPreviewImage(null)}
            >
              <X size={22} strokeWidth={1.7} />
            </button>
            <div
              className="image-lightbox-stage"
              onWheel={(event) => {
                event.preventDefault();
                const direction = event.deltaY < 0 ? 1 : -1;
                setPreviewImage((current) => current
                  ? {
                      ...current,
                      zoom: clampImagePreviewZoom(
                        current.zoom + direction * IMAGE_PREVIEW_ZOOM_STEP
                      )
                    }
                  : null);
              }}
            >
              <img
                src={activePreviewImage.src}
                alt={activePreviewImage.alt}
                draggable={false}
                style={{
                  transform: `scale(${previewImage.zoom}) rotate(${previewImage.rotation}deg)`
                }}
              />
            </div>
            <div className="image-lightbox-toolbar" role="toolbar" aria-label={resolvedLabels.imagePreview}>
              <span className="image-lightbox-count">
                {previewImage.index + 1}/{previewImage.images.length}
              </span>
              <span className="image-lightbox-divider" aria-hidden="true" />
              <button
                type="button"
                aria-label={resolvedLabels.imagePrevious}
                title={resolvedLabels.imagePrevious}
                disabled={previewImage.index === 0}
                onClick={() => setPreviewImage((current) => current
                  ? {
                      ...current,
                      index: Math.max(0, current.index - 1),
                      zoom: 1,
                      rotation: 0
                    }
                  : null)}
              >
                <ChevronLeft size={21} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label={resolvedLabels.imageNext}
                title={resolvedLabels.imageNext}
                disabled={previewImage.index >= previewImage.images.length - 1}
                onClick={() => setPreviewImage((current) => current
                  ? {
                      ...current,
                      index: Math.min(current.images.length - 1, current.index + 1),
                      zoom: 1,
                      rotation: 0
                    }
                  : null)}
              >
                <ChevronRight size={21} strokeWidth={1.8} />
              </button>
              <span className="image-lightbox-divider" aria-hidden="true" />
              <button
                type="button"
                aria-label={resolvedLabels.imageZoomIn}
                title={resolvedLabels.imageZoomIn}
                disabled={previewImage.zoom >= MAX_IMAGE_PREVIEW_ZOOM}
                onClick={() => setPreviewImage((current) => current
                  ? { ...current, zoom: clampImagePreviewZoom(current.zoom + IMAGE_PREVIEW_ZOOM_STEP) }
                  : null)}
              >
                <ZoomIn size={20} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label={resolvedLabels.imageZoomOut}
                title={resolvedLabels.imageZoomOut}
                disabled={previewImage.zoom <= MIN_IMAGE_PREVIEW_ZOOM}
                onClick={() => setPreviewImage((current) => current
                  ? { ...current, zoom: clampImagePreviewZoom(current.zoom - IMAGE_PREVIEW_ZOOM_STEP) }
                  : null)}
              >
                <ZoomOut size={20} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="image-lightbox-zoom-value"
                aria-label={resolvedLabels.imageResetView}
                title={resolvedLabels.imageResetView}
                onClick={() => setPreviewImage((current) => current
                  ? { ...current, zoom: 1, rotation: 0 }
                  : null)}
              >
                {Math.round(previewImage.zoom * 100)}%
              </button>
              <span className="image-lightbox-divider" aria-hidden="true" />
              <button
                type="button"
                aria-label={resolvedLabels.imageRotateLeft}
                title={resolvedLabels.imageRotateLeft}
                onClick={() => setPreviewImage((current) => current
                  ? { ...current, rotation: (current.rotation - 90) % 360 }
                  : null)}
              >
                <RotateCcw size={20} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label={resolvedLabels.imageResetView}
                title={resolvedLabels.imageResetView}
                onClick={() => setPreviewImage((current) => current
                  ? { ...current, zoom: 1, rotation: 0 }
                  : null)}
              >
                <Maximize2 size={19} strokeWidth={1.8} />
              </button>
              <span className="image-lightbox-divider" aria-hidden="true" />
              <button
                type="button"
                aria-label={resolvedLabels.imageCopy}
                title={resolvedLabels.imageCopy}
                onClick={() => void runContextAction("copy", {
                  x: 0,
                  y: 0,
                  kind: "image",
                  imageSrc: activePreviewImage.src,
                  imageAlt: activePreviewImage.alt
                })}
              >
                <Copy size={19} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label={resolvedLabels.imageDownload}
                title={resolvedLabels.imageDownload}
                onClick={() => void runContextAction("saveImage", {
                  x: 0,
                  y: 0,
                  kind: "image",
                  imageSrc: activePreviewImage.src,
                  imageAlt: activePreviewImage.alt
                })}
              >
                <Download size={20} strokeWidth={1.8} />
              </button>
            </div>
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

  const numberingMenuPortal = numberingMenu
    ? createPortal(
        <div
          ref={numberingMenuRef}
          className="markdown-editor-numbering-menu"
          role="menu"
          aria-label={resolvedLabels.numberingOptions}
          style={numberingMenuPosition(numberingMenu, editingNumberValue)}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!numberingMenu.canContinue}
            onClick={() => runNumberingAction("continue")}
          >
            <ListRestart size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{resolvedLabels.continuePreviousNumbering}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runNumberingAction("new")}>
            <ListStart size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{resolvedLabels.startNewList}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-expanded={editingNumberValue}
            onClick={() => {
              setNumberValue(String(numberingMenu.currentNumber));
              setEditingNumberValue(true);
            }}
          >
            <PencilLine size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{resolvedLabels.changeNumberValue}</span>
          </button>
          {editingNumberValue && (
            <div className="markdown-editor-numbering-input-row">
              <label>
                <span>{resolvedLabels.numberValue}</span>
                <input
                  ref={numberInputRef}
                  type="number"
                  min={1}
                  max={MAX_ORDERED_LIST_VALUE}
                  step={1}
                  inputMode="numeric"
                  value={numberValue}
                  onChange={(event) => setNumberValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && numberValueIsValid) {
                      event.preventDefault();
                      runNumberingAction("custom", parsedNumberValue);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!numberValueIsValid}
                onClick={() => runNumberingAction("custom", parsedNumberValue)}
              >
                {resolvedLabels.applyNumberValue}
              </button>
            </div>
          )}
        </div>,
        document.body
      )
    : null;

  const numberingMarkerPortal = numberingMenu
    ? createPortal(
        <span
          className="markdown-editor-number-marker-selection"
          aria-hidden="true"
          style={{
            fontFamily: numberingMenu.markerFontFamily,
            fontSize: numberingMenu.markerFontSize,
            fontWeight: numberingMenu.markerFontWeight,
            left: numberingMenu.markerRight,
            lineHeight: numberingMenu.markerLineHeight,
            top: numberingMenu.markerTop
          }}
        >
          {numberingMenu.markerLabel}
        </span>,
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
            <Toolbar
              editor={editor}
              labels={resolvedLabels}
              disabled={disabled}
              showFormatActionsInline={showFormatActionsInline}
              aiSelectionPolishEnabled={aiSelectionPolishEnabled}
              onToggleAiSelectionPolish={() => setAiSelectionPolishEnabled((current) => !current)}
            />
            <EditorContent className="tiptap-editor-content" editor={editor} />
            {!disabled && (
              <span className="markdown-editor-character-count" aria-live="polite">
                {characterCount}{resolvedLabels.characterUnit}
              </span>
            )}
          </div>
        )}
      </div>
      {contextMenuPortal}
      {numberingMarkerPortal}
      {numberingMenuPortal}
      {imageStyleToolbarPortal}
      {lightbox}
    </>
  );
}
