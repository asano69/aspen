import type { InlineContext } from "@lezer/markdown";

// An inline code span enclosed in a pair of backticks. The content
// may be empty and must not contain a backtick or a newline, so a
// code span never spans multiple lines.
// Returns the position of the backtick that closes the code span opening at
// `pos`, or -1 when there is none on this line. Shared with bracketCode.ts.
export function codeSpanClose(cx: InlineContext, pos: number): number {
  let i = pos + 1;
  while (i < cx.end && cx.char(i) !== 96 && cx.char(i) !== 10) {
    i++;
  }
  return cx.char(i) === 96 ? i : -1;
}

export function parseInlineCode(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 96) return -1;
  const close = codeSpanClose(cx, pos);
  if (close < 0) return -1;
  return cx.addElement(
    cx.elt("code", pos, close + 1, [
      cx.elt("codeMark", pos, pos + 1),
      cx.elt("codeMark", close, close + 1),
    ]),
  );
}
