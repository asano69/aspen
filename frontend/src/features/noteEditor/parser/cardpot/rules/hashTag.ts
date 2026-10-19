import type { InlineContext } from "@lezer/markdown";

import { bracketStartsNode } from "./bracket";
import { codeSpanClose } from "./inlineCode";
import { isLinkTitleTooLong } from "./linkTitle";
import { inNested } from "./nested";

// A hashtag starts at the beginning of a line or immediately after whitespace,
// and continues until one of these ends it:
// - whitespace;
// - a "[" that opens a node of its own ("#aa[zz]" is the tag "aa" followed by
//   the link "zz"). Any other "[" makes the whole run plain text;
// - a "]". Inside a decoration or a strong it belongs to the enclosing
//   bracket and ends the tag. Anywhere else the whole run is plain text;
// - a "`" that opens a code span. An unclosed one is part of the tag.
// A tag needs at least one character, so "#`a`" is "#" plus a code span.
// The preceding whitespace stays outside the node. Keep in sync with
// internal/parser/hashtag.go.
export function parseHashTag(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (
    next !== 35 ||
    // Inline contexts used by table cells can start at a non-zero document
    // offset. Their first character is still a valid hashtag boundary.
    (pos > cx.offset && !/\s/.test(cx.slice(pos - 1, pos)))
  ) {
    return -1;
  }

  const nested = inNested();
  let end = pos + 1;
  for (; end < cx.end; end++) {
    const ch = cx.char(end);
    if (/\s/.test(cx.slice(end, end + 1))) break;
    if (ch === 93 /* ] */) {
      if (nested) break;
      return -1;
    }
    if (ch === 91 /* [ */) {
      if (bracketStartsNode(cx, end)) break;
      return -1;
    }
    if (ch === 96 /* ` */ && codeSpanClose(cx, end) >= 0) break;
  }
  if (end === pos + 1) return -1;
  // The link's title must fit card_links.target_title.
  if (isLinkTitleTooLong(cx.slice(pos + 1, end))) return -1;
  return cx.addElement(cx.elt("hashTag", pos, end));
}
