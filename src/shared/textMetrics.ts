const markdownImagePattern = /!\[([^\]]*)\]\((?:\\.|[^)])*\)/g;
const markdownLinkPattern = /\[([^\]]+)\]\((?:\\.|[^)])*\)/g;
const htmlImagePattern = /<img\b[^>]*>/gi;
const htmlAltPattern = /\balt=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const bareDataImagePattern = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
const bareAttachmentUrlPattern = /attachment:\/\/\S+/gi;
const markdownLinePattern = /(^|\n)\s{0,3}(?:#{1,6}|[-*+>]|\d+\.)\s+/g;
const markdownInlinePattern = /[`*_~]/g;
const htmlTagPattern = /<[^>]+>/g;

function htmlImageAltText(tag: string): string {
  const match = tag.match(htmlAltPattern);
  return ` ${match?.[1] ?? match?.[2] ?? match?.[3] ?? ""} `;
}

export function normalizeTextForMetrics(value: string | null | undefined): string {
  return (value ?? "")
    .replace(htmlImagePattern, htmlImageAltText)
    .replace(markdownImagePattern, (_match, altText: string) => ` ${altText} `)
    .replace(markdownLinkPattern, "$1")
    .replace(bareDataImagePattern, " ")
    .replace(bareAttachmentUrlPattern, " ")
    .replace(markdownLinePattern, "$1")
    .replace(markdownInlinePattern, "")
    .replace(htmlTagPattern, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function countTextMetricCharacters(...values: Array<string | null | undefined>): number {
  return Array.from(normalizeTextForMetrics(values.join("\n"))).length;
}
