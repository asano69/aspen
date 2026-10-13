import type { InlineContext } from "@lezer/markdown";

// The characters Scrapbox accepts as decoration marks. The parser only
// recognizes the notation; what each character means (bold, italic, ...) is
// decided by decoClasses (plugins/decorations/decoClasses.ts). Keep in sync
// with internal/parser/bracket.go.
export const DECO_CHARS = `!"#%&'()*+,-./{|}<>_~`;

const DECO_CODES = new Set([...DECO_CHARS].map((c) => c.charCodeAt(0)));

// "[<deco chars>+ text]": an opening "[", one or more decoration characters
// (any mix), a space, then content (parsed as inline, so nested links, URLs
// and so on still resolve), then a closing "]". Bracket depth is tracked
// while scanning for the closing "]", so nested brackets in the content
// (e.g. "[Link]") do not end the decoration early.
//
// The result is one flat "deco" node: its marks are "[<chars> " and "]".
export function parseDecoration(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 91 /* [ */) return -1;

  let i = pos + 1;
  while (i < cx.end && DECO_CODES.has(cx.char(i))) i++;
  if (i === pos + 1 || cx.char(i) !== 32 /* space */) return -1;

  const contentFrom = i + 1;

  let depth = 0;
  let end = contentFrom;
  while (end < cx.end) {
    const ch = cx.char(end);
    if (ch === 10 /* newline */) return -1;
    if (ch === 91 /* [ */) depth++;
    else if (ch === 93 /* ] */) {
      if (depth === 0) break;
      depth--;
    }
    end++;
  }
  if (end === contentFrom || cx.char(end) !== 93) return -1;

  const children = cx.parser.parseInline(cx.slice(contentFrom, end), contentFrom);
  return cx.addElement(
    cx.elt("deco", pos, end + 1, [
      cx.elt("decoMark", pos, contentFrom),
      ...children,
      cx.elt("decoMark", end, end + 1),
    ]),
  );
}
