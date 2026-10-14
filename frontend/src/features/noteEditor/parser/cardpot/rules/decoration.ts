import type { InlineContext } from "@lezer/markdown";

import { bracketContainsCode } from "./bracketCode";
import { inNested, parseNested } from "./nested";

// The characters Scrapbox accepts as decoration marks. The parser only
// recognizes the notation; what each character means (bold, italic, ...) is
// decided by decoClasses (plugins/decorations/decoClasses.ts). Keep in sync
// with internal/parser/bracket.go.
export const DECO_CHARS = `!"#%&'()*+,-./{|}<>_~`;

const DECO_CODES = new Set([...DECO_CHARS].map((c) => c.charCodeAt(0)));

// Returns the position right after the "<deco chars>+ " that follows the "["
// at `pos`, or -1 when `pos` does not open a decoration.
export function decoContentStart(cx: InlineContext, pos: number): number {
  let i = pos + 1;
  while (DECO_CODES.has(cx.char(i))) i++;
  return i > pos + 1 && cx.char(i) === 32 ? i + 1 : -1;
}

// True when `text` starts with "<deco chars>+ " followed by at least one
// character, i.e. "[" + text + "]" would open a decoration. An empty body
// ("[* ]") is not a decoration, so it must not stop a strong either.
export function startsWithDeco(text: string): boolean {
  let i = 0;
  while (i < text.length && DECO_CODES.has(text.charCodeAt(i))) i++;
  return i > 0 && text.charCodeAt(i) === 32 && i + 1 < text.length;
}

// Returns the "]" that closes a decoration whose content starts at `from`, or
// -1. The content is parsed as inline text, so a "]" that belongs to a nested
// notation does not close it: the first "]" outside every nested notation
// does. When there is none, the "]" of the last nested notation closes
// instead ("[* a [b]" is the decoration "a [b"). Keep in sync with
// internal/parser/bracket.go.
function decoClose(cx: InlineContext, from: number): number {
  const nodes = parseNested(cx, cx.slice(from, cx.end), from);

  let next = 0;
  for (let i = from; i < cx.end; i++) {
    while (next < nodes.length && nodes[next].to <= i) next++;
    if (next < nodes.length && nodes[next].from <= i) continue; // nested
    if (cx.char(i) === 93) return i;
  }
  for (let k = nodes.length - 1; k >= 0; k--) {
    if (cx.char(nodes[k].to - 1) === 93) return nodes[k].to - 1;
  }
  return -1;
}

// "[<deco chars>+ text]": an opening "[", one or more decoration characters
// (any mix), a space, then content (parsed as inline, so nested links, URLs
// and so on still resolve), then a closing "]" (see decoClose).
//
// The result is one flat "deco" node: its marks are "[<chars> " and "]".
export function parseDecoration(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  // A bracket containing a code span is plain text (see bracketCode.ts).
  if (next !== 91 /* [ */ || inNested() || bracketContainsCode(cx, pos)) {
    return -1;
  }

  const contentFrom = decoContentStart(cx, pos);
  if (contentFrom < 0) return -1;
  const close = decoClose(cx, contentFrom);
  if (close <= contentFrom) return -1;

  const children = parseNested(
    cx,
    cx.slice(contentFrom, close),
    contentFrom,
  );
  return cx.addElement(
    cx.elt("deco", pos, close + 1, [
      cx.elt("decoMark", pos, contentFrom),
      ...children,
      cx.elt("decoMark", close, close + 1),
    ]),
  );
}
