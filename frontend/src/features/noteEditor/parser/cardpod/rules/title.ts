import type { BlockContext, Line } from "@lezer/markdown";

import { isBlankLine } from "../indent";

// The first line of a card is its title (see titleCandidatePlugin.ts and the
// server's firstLine). It is plain text: no block prefix, indentation or
// inline notation is interpreted, so the parser always agrees with the title
// the server resolves from the raw line. A blank first line produces no node
// and is left to the paragraph rule, which consumes it.
export function parseTitle(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || isBlankLine(line.text)) return false;
  cx.addElement(cx.elt("Title", cx.lineStart, cx.lineStart + line.text.length));
  cx.nextLine();
  return true;
}
