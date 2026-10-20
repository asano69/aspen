import type { BlockContext, Line } from "@lezer/markdown";

import { consumeIndentedLines, startsIndentedBlock } from "./indentedBlock";

// Cosense/Scrapbox code blocks start with `code:` and continue through the
// following more-deeply-indented lines. Unlike the removed ``` syntax, a closing fence
// is neither expected nor accepted: returning to the prefix line's indent
// terminates the block.
export function parseCodeBlock(cx: BlockContext, line: Line): boolean {
  const indent = startsIndentedBlock(line, "code:");
  if (indent === null) return false;

  const from = cx.lineStart;
  let to = from + line.text.length;
  const children = [
    ...(indent ? [cx.elt("indent", from, from + indent)] : []),
    cx.elt("CodeBlockMark", from + indent, to),
  ];
  consumeIndentedLines(cx, line, indent, (text, lineFrom) => {
    // Code is deliberately raw text. Record no inline children, but extend
    // the block through every body line so the editor can style it as code.
    void text;
    // Only the block's own indent level (declaration indent + 1) is syntax;
    // any deeper whitespace is part of the raw code.
    children.push(cx.elt("indent", lineFrom - (indent + 1), lineFrom));
    to = lineFrom + text.length;
  });
  cx.addElement(cx.elt("CodeBlock", from, to, children));
  return true;
}
