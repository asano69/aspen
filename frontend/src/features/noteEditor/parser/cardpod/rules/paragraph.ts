import type { BlockContext, Line } from "@lezer/markdown";

import { countIndent, isBlankLine } from "../indent";

// Markdown's built-in Paragraph leaf block coalesces adjacent lines. Cardpod
// treats every source line as an outline row, so claim one non-blank line at a
// time and make its indentation an explicit syntax child.
export function parseParagraph(cx: BlockContext, line: Line): boolean {
  // Lezer only treats ASCII whitespace as blank, so lines such as a lone
  // full-width space reach this rule. Consume them here so they never fall
  // back to Lezer's multi-line paragraph accumulation.
  if (isBlankLine(line.text)) {
    cx.nextLine();
    return true;
  }

  const from = cx.lineStart;
  const indent = countIndent(line.text);
  const contentFrom = from + indent;
  const children = [
    ...(indent ? [cx.elt("indent", from, contentFrom)] : []),
    ...cx.parser.parseInline(line.text.slice(indent), contentFrom),
  ];
  cx.addElement(cx.elt("Paragraph", from, from + line.text.length, children));
  cx.nextLine();
  return true;
}
