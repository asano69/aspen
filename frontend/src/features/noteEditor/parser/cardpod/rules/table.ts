import type { BlockContext, Line } from "@lezer/markdown";

import { consumeIndentedLines, startsIndentedBlock } from "./indentedBlock";

// A table's rows are indented relative to its `table:` declaration, and
// cells are separated by literal tab characters. Cell contents are parsed by
// Cardpod's normal inline parser, matching Scrapbox's table-node behavior.
export function parseTable(cx: BlockContext, line: Line): boolean {
  const indent = startsIndentedBlock(line, "table:");
  if (indent === null) return false;

  const from = cx.lineStart;
  let to = from + line.text.length;
  const children = [
    ...(indent ? [cx.elt("indent", from, from + indent)] : []),
    cx.elt("TableMark", from + indent, to),
  ];

  consumeIndentedLines(cx, line, indent, (row, rowFrom) => {
    // Only the table's own indent level (declaration indent + 1) is syntax;
    // any deeper whitespace stays in the first cell, as in Scrapbox.
    const rowStart = rowFrom - (indent + 1);
    const rowChildren = [cx.elt("indent", rowStart, rowFrom)];
    let cellFrom = rowFrom;
    for (const cell of row.split("\t")) {
      const cellTo = cellFrom + cell.length;
      rowChildren.push(
        cx.elt(
          "TableCell",
          cellFrom,
          cellTo,
          cx.parser.parseInline(cell, cellFrom),
        ),
      );
      cellFrom = cellTo + 1;
    }
    const rowTo = rowFrom + row.length;
    children.push(cx.elt("TableRow", rowStart, rowTo, rowChildren));
    to = rowTo;
  });

  cx.addElement(cx.elt("Table", from, to, children));
  return true;
}
