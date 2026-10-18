import type { InlineContext } from "@lezer/markdown";

import { isLinkTitleTooLong } from "./linkTitle";
import { inNested } from "./nested";

// A hashtag starts at the beginning of a line or immediately after whitespace,
// and continues through the next whitespace character. This mirrors Scrapbox's
// `(?:^|\\s)#\\S+` rule while keeping the preceding whitespace outside the
// syntax node. Inside a decoration or a strong it also stops at "]", which
// belongs to the enclosing bracket. Keep in sync with internal/parser/hashtag.go.
export function parseHashTag(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (
    next !== 35 ||
    // Inline contexts used by table cells can start at a non-zero document
    // offset. Their first character is still a valid hashtag boundary.
    (pos > cx.offset && !/\s/.test(cx.slice(pos - 1, pos))) ||
    pos + 1 >= cx.end ||
    /\s/.test(cx.slice(pos + 1, pos + 2))
  ) {
    return -1;
  }

  const nested = inNested();
  let end = pos + 1;
  while (end < cx.end) {
    const ch = cx.slice(end, end + 1);
    if (/\s/.test(ch) || (nested && ch === "]")) break;
    end++;
  }
  if (end === pos + 1 || isLinkTitleTooLong(cx.slice(pos + 1, end))) return -1;
  return cx.addElement(cx.elt("hashTag", pos, end));
}
