import type { InlineContext } from "@lezer/markdown";

// A URL written directly in text, without brackets. Mirrors
// scrapbox-parser's httpRegExp (ExternalLinkNode.ts), except that it
// also stops at "]" so a URL inside "[* see https://e.com]" never
// swallows the closing bracket.
export const BARE_URL_RE = /^https?:\/\/[^\s\]]+/;

export function parseBareUrl(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 104 /* h */) return -1;
  const match = BARE_URL_RE.exec(cx.slice(pos, cx.end));
  if (!match) return -1;
  return cx.addElement(cx.elt("url", pos, pos + match[0].length));
}
