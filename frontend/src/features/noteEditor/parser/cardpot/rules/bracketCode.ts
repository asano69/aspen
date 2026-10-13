import type { InlineContext } from "@lezer/markdown";

import { codeSpanClose } from "./inlineCode";

// True when a code span starts before the bracket opening at `pos` closes
// (nested brackets are counted). Such a bracket is plain text: the decoration
// and bracket rules decline it, so only the code span becomes a node. The
// span may itself contain "]", e.g. "[* `]`" is plain "[* " plus a code span.
export function bracketContainsCode(cx: InlineContext, pos: number): boolean {
  let depth = 0;
  for (let i = pos + 1; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === 10) return false;
    if (ch === 91) depth++;
    else if (ch === 93) {
      if (depth === 0) return false;
      depth--;
    } else if (ch === 96 && codeSpanClose(cx, i) >= 0) return true;
  }
  return false;
}
