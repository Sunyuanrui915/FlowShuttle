export type MarkdownFence = {
  marker: "`" | "~";
  length: number;
};

export function parseMarkdownFenceOpening(line: string): MarkdownFence | null {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  const marker = match[1][0] as MarkdownFence["marker"];
  if (marker === "`" && match[2].includes("`")) {
    return null;
  }

  return { marker, length: match[1].length };
}

export function isMarkdownFenceClosing(line: string, fence: MarkdownFence): boolean {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

export function normalizeReferenceMarkdownSpacing(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const normalizedLines: string[] = [];
  let pendingBlankLines = 0;
  let activeFence: MarkdownFence | null = null;

  const flushBlankLines = () => {
    // Tiptap uses one blank source line between blocks; extra pairs represent visible empty rows.
    const visibleBlankLines = Math.floor(pendingBlankLines / 2);
    for (let index = 0; index < visibleBlankLines; index += 1) {
      normalizedLines.push("");
    }
    pendingBlankLines = 0;
  };

  lines.forEach((line) => {
    if (activeFence) {
      normalizedLines.push(line);
      if (isMarkdownFenceClosing(line, activeFence)) {
        activeFence = null;
      }
      return;
    }

    const openingFence = parseMarkdownFenceOpening(line);
    if (openingFence) {
      flushBlankLines();
      normalizedLines.push(line);
      activeFence = openingFence;
      return;
    }

    const trimmed = line.trim();
    const isExplicitEmptyParagraph =
      trimmed === "&nbsp;" || (line.includes("\u00a0") && line.replace(/\u00a0/g, "").trim() === "");
    if (isExplicitEmptyParagraph) {
      flushBlankLines();
      normalizedLines.push("");
      return;
    }

    if (!trimmed) {
      pendingBlankLines += 1;
      return;
    }

    flushBlankLines();
    normalizedLines.push(line.replace(/(?:\\| {2,})$/, ""));
  });

  return normalizedLines.join("\n");
}
