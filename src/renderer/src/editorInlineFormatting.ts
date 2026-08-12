import Highlight from "@tiptap/extension-highlight";
import { Mark, type JSONContent } from "@tiptap/core";

export const TEXT_COLOR_OPTIONS = [
  { value: "black", fallback: "#111827" },
  { value: "gray", fallback: "#667085" },
  { value: "blue", fallback: "#2563eb" },
  { value: "green", fallback: "#228b55" },
  { value: "red", fallback: "#d64545" },
  { value: "orange", fallback: "#c96a18" },
  { value: "yellow", fallback: "#9a6700" },
  { value: "purple", fallback: "#7c3aed" },
  { value: "pink", fallback: "#c43d72" }
] as const;

export const HIGHLIGHT_COLOR_OPTIONS = [
  { value: "black", fallback: "#1f2937", indicator: "#111827" },
  { value: "gray", fallback: "#e9edf3", indicator: "#7b8799" },
  { value: "blue", fallback: "#ddebff", indicator: "#4b7ed9" },
  { value: "green", fallback: "#d8f3dc", indicator: "#3f9f66" },
  { value: "red", fallback: "#fde2e1", indicator: "#d95c57" },
  { value: "orange", fallback: "#fee8cf", indicator: "#d9772f" },
  { value: "yellow", fallback: "#fff1a8", indicator: "#d7a800" },
  { value: "purple", fallback: "#eadfff", indicator: "#8a63d2" },
  { value: "pink", fallback: "#f9dbe5", indicator: "#d45b86" }
] as const;

export type TextColor = (typeof TEXT_COLOR_OPTIONS)[number]["value"];
export type HighlightColor = (typeof HIGHLIGHT_COLOR_OPTIONS)[number]["value"];

export const DEFAULT_TEXT_COLOR: TextColor = "black";
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";
export const DEFAULT_HIGHLIGHT_TOOL_COLOR: HighlightColor | null = null;

const textColorFallbacks = new Map<TextColor, string>(
  TEXT_COLOR_OPTIONS.map((option) => [option.value, option.fallback])
);
const highlightColorFallbacks = new Map<HighlightColor, string>(
  HIGHLIGHT_COLOR_OPTIONS.map((option) => [option.value, option.fallback])
);
const highlightColorIndicators = new Map<HighlightColor, string>(
  HIGHLIGHT_COLOR_OPTIONS.map((option) => [option.value, option.indicator])
);

export function sanitizeTextColor(value: unknown): TextColor | null {
  return typeof value === "string" && textColorFallbacks.has(value as TextColor)
    ? value as TextColor
    : null;
}

export function sanitizeHighlightColor(value: unknown): HighlightColor | null {
  return typeof value === "string" && highlightColorFallbacks.has(value as HighlightColor)
    ? value as HighlightColor
    : null;
}

export function textColorFallback(value: unknown): string | null {
  const color = sanitizeTextColor(value);
  return color ? textColorFallbacks.get(color) ?? null : null;
}

export function highlightColorFallback(value: unknown): string | null {
  const color = sanitizeHighlightColor(value);
  return color ? highlightColorFallbacks.get(color) ?? null : null;
}

export function highlightColorIndicator(value: unknown): string | null {
  const color = sanitizeHighlightColor(value);
  return color ? highlightColorIndicators.get(color) ?? null : null;
}

function applyControlledInlineMarks(
  content: JSONContent[],
  marks: Array<{ type: string; attrs: Record<string, string> }>
): JSONContent[] {
  return content.map((node) => {
    if (node.type === "text") {
      return {
        ...node,
        marks: [...(node.marks ?? []), ...marks]
      };
    }
    return node.content
      ? { ...node, content: applyControlledInlineMarks(node.content, marks) }
      : node;
  });
}

export function resolveTextColorToggle(
  isActive: boolean,
  rememberedColor: unknown
): TextColor | null {
  return isActive
    ? null
    : sanitizeTextColor(rememberedColor) ?? DEFAULT_TEXT_COLOR;
}

export function resolveHighlightColorToggle(
  isActive: boolean,
  rememberedColor: unknown
): HighlightColor | null {
  return isActive
    ? null
    : sanitizeHighlightColor(rememberedColor);
}

export function serializeUnderlineMarkdown(content: string): string {
  return `<u>${content}</u>`;
}

export function serializeTextColorMarkdown(colorValue: unknown, content: string): string {
  const color = sanitizeTextColor(colorValue);
  const fallback = textColorFallback(color);
  if (!color || !fallback) {
    return content;
  }

  const defaultHighlightMatch = /^==([\s\S]*)==$/.exec(content);
  if (defaultHighlightMatch) {
    return serializeCombinedColorHighlightMarkdown(
      color,
      DEFAULT_HIGHLIGHT_COLOR,
      defaultHighlightMatch[1]
    );
  }

  const controlledHighlightMatch = /^<mark data-flow-shuttle-highlight="([^"]+)" style="background-color: ([^;"]+); color: inherit;">([\s\S]*)<\/mark>$/.exec(content);
  if (controlledHighlightMatch) {
    const highlightColor = sanitizeHighlightColor(controlledHighlightMatch[1]);
    if (
      highlightColor
      && controlledHighlightMatch[2] === highlightColorFallback(highlightColor)
    ) {
      return serializeCombinedColorHighlightMarkdown(
        color,
        highlightColor,
        controlledHighlightMatch[3]
      );
    }
  }

  return `<span data-flow-shuttle-text-color="${color}" style="color: ${fallback};">${content}</span>`;
}

function serializeCombinedColorHighlightMarkdown(
  textColorValue: unknown,
  highlightColorValue: unknown,
  content: string
): string {
  const textColor = sanitizeTextColor(textColorValue);
  const highlightColor = sanitizeHighlightColor(highlightColorValue);
  const textFallback = textColorFallback(textColor);
  const highlightFallback = highlightColorFallback(highlightColor);
  if (!textColor || !highlightColor || !textFallback || !highlightFallback) {
    return content;
  }
  return `<mark data-flow-shuttle-highlight="${highlightColor}" data-flow-shuttle-text-color="${textColor}" style="background-color: ${highlightFallback}; color: ${textFallback};">${content}</mark>`;
}

export function normalizeControlledInlineFormattingMarkdown(value: string): string {
  const nestedColorHighlight = /<span data-flow-shuttle-text-color="([^"]+)" style="color: ([^;"]+);"><mark data-flow-shuttle-highlight="([^"]+)" style="background-color: ([^;"]+); color: inherit;">([\s\S]*?)<\/mark><\/span>/g;
  const colorWithDefaultHighlight = /<span data-flow-shuttle-text-color="([^"]+)" style="color: ([^;"]+);">==([\s\S]*?)==<\/span>/g;

  return value
    .replace(
      nestedColorHighlight,
      (original, rawTextColor, rawTextFallback, rawHighlightColor, rawHighlightFallback, content) => {
        const textColor = sanitizeTextColor(rawTextColor);
        const highlightColor = sanitizeHighlightColor(rawHighlightColor);
        if (
          !textColor
          || !highlightColor
          || rawTextFallback !== textColorFallback(textColor)
          || rawHighlightFallback !== highlightColorFallback(highlightColor)
        ) {
          return original;
        }
        return serializeCombinedColorHighlightMarkdown(textColor, highlightColor, content);
      }
    )
    .replace(
      colorWithDefaultHighlight,
      (original, rawTextColor, rawTextFallback, content) => {
        const textColor = sanitizeTextColor(rawTextColor);
        if (!textColor || rawTextFallback !== textColorFallback(textColor)) {
          return original;
        }
        return serializeCombinedColorHighlightMarkdown(
          textColor,
          DEFAULT_HIGHLIGHT_COLOR,
          content
        );
      }
    );
}

export function serializeHighlightMarkdown(colorValue: unknown, content: string): string {
  const color = sanitizeHighlightColor(colorValue) ?? DEFAULT_HIGHLIGHT_COLOR;
  if (color === DEFAULT_HIGHLIGHT_COLOR) {
    return `==${content}==`;
  }
  const fallback = highlightColorFallback(color);
  return `<mark data-flow-shuttle-highlight="${color}" style="background-color: ${fallback}; color: inherit;">${content}</mark>`;
}

export function countEditorCharacters(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

export const FlowShuttleUnderline = Mark.create({
  name: "underline",

  parseHTML() {
    return [
      { tag: "u" },
      { tag: "span[data-flow-shuttle-underline='1']" }
    ];
  },

  renderHTML() {
    return ["u", 0];
  },

  renderMarkdown(node: JSONContent, helpers) {
    return serializeUnderlineMarkdown(helpers.renderChildren(node));
  },

  addKeyboardShortcuts() {
    return {
      "Mod-u": () => this.editor.commands.toggleMark(this.name),
      "Mod-U": () => this.editor.commands.toggleMark(this.name)
    };
  }
});

export const FlowShuttleTextColor = Mark.create({
  name: "flowShuttleTextColor",

  addAttributes() {
    return {
      color: {
        default: null
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-flow-shuttle-text-color]",
        consuming: false,
        getAttrs: (element) => {
          const color = sanitizeTextColor(
            (element as HTMLElement).getAttribute("data-flow-shuttle-text-color")
          );
          return color ? { color } : false;
        }
      },
      {
        tag: "mark[data-flow-shuttle-text-color]",
        consuming: false,
        getAttrs: (element) => {
          const color = sanitizeTextColor(
            (element as HTMLElement).getAttribute("data-flow-shuttle-text-color")
          );
          return color ? { color } : false;
        }
      }
    ];
  },

  renderHTML({ mark }) {
    const color = sanitizeTextColor(mark.attrs.color);
    const fallback = textColorFallback(color);
    return color && fallback
      ? [
          "span",
          {
            "data-flow-shuttle-text-color": color,
            style: `color: ${fallback};`
          },
          0
        ]
      : ["span", 0];
  },

  renderMarkdown(node: JSONContent, helpers) {
    return serializeTextColorMarkdown(node.attrs?.color, helpers.renderChildren(node));
  },

  parseMarkdown(token, helpers) {
    const controlledToken = token as typeof token & {
      flowShuttleTextColor?: unknown;
      flowShuttleHighlight?: unknown;
    };
    const textColor = sanitizeTextColor(controlledToken.flowShuttleTextColor);
    if (!textColor) {
      return helpers.parseInline(token.tokens || []);
    }
    const marks = [
      { type: "flowShuttleTextColor", attrs: { color: textColor } }
    ];
    const highlightColor = sanitizeHighlightColor(controlledToken.flowShuttleHighlight);
    if (highlightColor) {
      marks.push({ type: "highlight", attrs: { color: highlightColor } });
    }
    return applyControlledInlineMarks(helpers.parseInline(token.tokens || []), marks);
  },

  markdownTokenizer: {
    name: "flowShuttleTextColor",
    level: "inline",
    start(src) {
      const spanStart = src.indexOf('<span data-flow-shuttle-text-color="');
      const combinedStart = src.indexOf('<mark data-flow-shuttle-highlight="');
      if (spanStart < 0) {
        return combinedStart;
      }
      if (combinedStart < 0) {
        return spanStart;
      }
      return Math.min(spanStart, combinedStart);
    },
    tokenize(src, _tokens, lexer) {
      const combinedRule = /^<mark data-flow-shuttle-highlight="([^"]+)" data-flow-shuttle-text-color="([^"]+)" style="background-color: ([^;"]+); color: ([^;"]+);">([\s\S]+?)<\/mark>/;
      const combinedMatch = combinedRule.exec(src);
      if (combinedMatch) {
        const highlightColor = sanitizeHighlightColor(combinedMatch[1]);
        const textColor = sanitizeTextColor(combinedMatch[2]);
        if (
          highlightColor
          && textColor
          && combinedMatch[3] === highlightColorFallback(highlightColor)
          && combinedMatch[4] === textColorFallback(textColor)
        ) {
          return {
            type: "flowShuttleTextColor",
            raw: combinedMatch[0],
            text: combinedMatch[5],
            tokens: lexer.inlineTokens(combinedMatch[5]),
            flowShuttleTextColor: textColor,
            flowShuttleHighlight: highlightColor
          };
        }
      }

      const textColorRule = /^<span data-flow-shuttle-text-color="([^"]+)" style="color: ([^;"]+);">([\s\S]+?)<\/span>/;
      const textColorMatch = textColorRule.exec(src);
      if (!textColorMatch) {
        return undefined;
      }
      const textColor = sanitizeTextColor(textColorMatch[1]);
      if (!textColor || textColorMatch[2] !== textColorFallback(textColor)) {
        return undefined;
      }
      return {
        type: "flowShuttleTextColor",
        raw: textColorMatch[0],
        text: textColorMatch[3],
        tokens: lexer.inlineTokens(textColorMatch[3]),
        flowShuttleTextColor: textColor
      };
    }
  }
});

export const FlowShuttleHighlight = Highlight.extend({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      multicolor: true,
      HTMLAttributes: {}
    };
  },

  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT_COLOR
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark",
        consuming: false,
        getAttrs: (element) => {
          const raw = (element as HTMLElement).getAttribute("data-flow-shuttle-highlight");
          if (raw === null) {
            return { color: DEFAULT_HIGHLIGHT_COLOR };
          }
          const color = sanitizeHighlightColor(raw);
          return color ? { color } : false;
        }
      }
    ];
  },

  renderHTML({ mark }) {
    const color = sanitizeHighlightColor(mark.attrs.color) ?? DEFAULT_HIGHLIGHT_COLOR;
    const fallback = highlightColorFallback(color);
    return [
      "mark",
      {
        "data-flow-shuttle-highlight": color,
        style: `background-color: ${fallback}; color: inherit;`
      },
      0
    ];
  },

  renderMarkdown(node: JSONContent, helpers) {
    return serializeHighlightMarkdown(node.attrs?.color, helpers.renderChildren(node));
  },

  parseMarkdown(token, helpers) {
    const controlledToken = token as typeof token & { flowShuttleHighlight?: unknown };
    const color = sanitizeHighlightColor(controlledToken.flowShuttleHighlight)
      ?? DEFAULT_HIGHLIGHT_COLOR;
    return helpers.applyMark(
      "highlight",
      helpers.parseInline(token.tokens || []),
      { color }
    );
  },

  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start(src) {
      const markdownStart = src.indexOf("==");
      const htmlStart = src.indexOf('<mark data-flow-shuttle-highlight="');
      if (markdownStart < 0) {
        return htmlStart;
      }
      if (htmlStart < 0) {
        return markdownStart;
      }
      return Math.min(markdownStart, htmlStart);
    },
    tokenize(src, _tokens, lexer) {
      const htmlRule = /^<mark data-flow-shuttle-highlight="([^"]+)" style="background-color: ([^;"]+); color: inherit;">([\s\S]+?)<\/mark>/;
      const htmlMatch = htmlRule.exec(src);
      if (htmlMatch) {
        const color = sanitizeHighlightColor(htmlMatch[1]);
        if (color && htmlMatch[2] === highlightColorFallback(color)) {
          return {
            type: "highlight",
            raw: htmlMatch[0],
            text: htmlMatch[3],
            tokens: lexer.inlineTokens(htmlMatch[3]),
            flowShuttleHighlight: color
          };
        }
      }

      const markdownRule = /^(==)([^=]+)(==)/;
      const markdownMatch = markdownRule.exec(src);
      if (!markdownMatch) {
        return undefined;
      }
      const innerContent = markdownMatch[2].trim();
      return {
        type: "highlight",
        raw: markdownMatch[0],
        text: innerContent,
        tokens: lexer.inlineTokens(innerContent),
        flowShuttleHighlight: DEFAULT_HIGHLIGHT_COLOR
      };
    }
  }
});
