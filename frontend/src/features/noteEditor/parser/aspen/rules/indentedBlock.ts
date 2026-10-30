import type { BlockContext, Line } from "@lezer/markdown";

import { countIndent } from "../indent";

// A child line belongs to an indented block only when its leading ECMAScript
// whitespace run is longer than the declaration line's run.

export function startsIndentedBlock(line: Line, prefix: string): number | null {
  const indent = countIndent(line.text);
  return line.text.slice(indent).startsWith(prefix) ? indent : null;
}

// Consumes every immediately following line whose indentation is deeper than
// `indent`. The terminating line deliberately remains current so the
// markdown block pipeline can dispatch it as the next Aspen block.
export function consumeIndentedLines(
  cx: BlockContext,
  line: Line,
  indent: number,
  consume: (text: string, from: number) => void,
): void {
  while (cx.nextLine()) {
    if (countIndent(line.text) <= indent) return;
    consume(line.text.slice(indent + 1), cx.lineStart + indent + 1);
  }
}
