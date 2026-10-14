import type { InlineContext } from "@lezer/markdown";

// A Blank is a pair of brackets containing one or more whitespace characters.
// It must be recognized before the general bracket rules so that `[ ]` never
// becomes a WikiLink.
// Any bracket that contains a Blank is plain text (see bracketCode.ts), so
// "[[ ]]" is "[" + Blank + "]".
//
// Returns the position right after the Blank opening at `pos`, or -1 when
// there is none. Shared with bracketCode.ts.
export function blankEnd(cx: InlineContext, pos: number): number {
  if (cx.char(pos) !== 91) return -1;

  let end = pos + 1;
  while (end < cx.end && cx.char(end) !== 93 && cx.char(end) !== 10) end++;
  if (end >= cx.end || cx.char(end) !== 93) return -1;

  const content = cx.slice(pos + 1, end);
  return content !== "" && /^\s+$/u.test(content) ? end + 1 : -1;
}

export function parseBlank(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 91) return -1;
  const to = blankEnd(cx, pos);
  if (to < 0) return -1;
  // The marks are the brackets: syntaxReveal hides them while the cursor is
  // away, leaving only the whitespace.
  return cx.addElement(
    cx.elt("blank", pos, to, [
      cx.elt("blankMark", pos, pos + 1),
      cx.elt("blankMark", to - 1, to),
    ]),
  );
}
