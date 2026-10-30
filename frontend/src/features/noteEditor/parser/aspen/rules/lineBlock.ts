import type { BlockContext, Line } from "@lezer/markdown";

import { countIndent } from "../indent";

// Keep this ordered list aligned with cosy's parser/block.rs dispatch. Entries
// without a parser deliberately fall through to Paragraph until their phase is
// implemented, rather than claiming a line prematurely.
export type LineBlockKind =
  "code" | "table" | "quote" | "helpfeel" | "commandLine";

interface LineBlockMatch {
  kind: LineBlockKind;
  prefix: string;
}

const blockPrefixes: readonly LineBlockMatch[] = [
  { kind: "code", prefix: "code:" },
  { kind: "table", prefix: "table:" },
  { kind: "quote", prefix: ">" },
  { kind: "helpfeel", prefix: "? " },
];

function matchLineBlock(text: string): LineBlockMatch | null {
  // Measure indentation before testing prefixes so every block shares the
  // parser's character-count based indentation model.
  const indent = countIndent(text);
  const content = text.slice(indent);

  for (const match of blockPrefixes) {
    if (content.startsWith(match.prefix)) return match;
  }
  if (content.startsWith("$ ") || content.startsWith("% ")) {
    return { kind: "commandLine", prefix: content.slice(0, 2) };
  }
  return null;
}

export interface LineBlockDefinition {
  kind: LineBlockKind;
  node: string;
  mark: string;
  /** Removes the conventional space immediately following a prefix. */
  trimFollowingSpace?: boolean;
}

// Parse a single-line block and explicitly parse its remaining text with this
// parser's inline rules. Future line-scoped blocks only need a definition and
// a small rule file that calls this helper.
export function parseLineBlock(
  cx: BlockContext,
  line: Line,
  definition: LineBlockDefinition,
): boolean {
  const match = matchLineBlock(line.text);
  if (!match || match.kind !== definition.kind) return false;

  const indent = countIndent(line.text);
  const prefixFrom = cx.lineStart + indent;
  const prefixTo = prefixFrom + match.prefix.length;
  let contentFrom = prefixTo;
  if (
    definition.trimFollowingSpace &&
    line.text[contentFrom - cx.lineStart] === " "
  ) {
    contentFrom++;
  }

  const content = line.text.slice(contentFrom - cx.lineStart);
  const children = [
    ...(indent ? [cx.elt("indent", cx.lineStart, prefixFrom)] : []),
    cx.elt(definition.mark, prefixFrom, prefixTo),
    ...cx.parser.parseInline(content, contentFrom),
  ];
  cx.addElement(
    cx.elt(
      definition.node,
      cx.lineStart,
      cx.lineStart + line.text.length,
      children,
    ),
  );
  cx.nextLine();
  return true;
}
