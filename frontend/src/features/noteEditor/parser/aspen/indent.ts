import type { Tree } from "@lezer/common";

import { isIndent } from "./nodeProps";

/**
 * Aspen indentation is deliberately measured in source characters, rather
 * than display columns. This is the ECMAScript `^\\s+` definition: a tab, a
 * half-width space, and a full-width space therefore each contribute one
 * level.
 */
const leadingIndent = /^\s+/u;

/** Returns the number of leading ECMAScript whitespace characters in a line. */
export function countIndent(text: string): number {
  return leadingIndent.exec(text)?.[0].length ?? 0;
}

/** True when a line has no content other than ECMAScript whitespace. */
export function isBlankLine(text: string): boolean {
  return /^\s*$/u.test(text);
}

/**
 * Returns the parser-recorded leading indentation range for the source line
 * starting at `lineFrom`. Consumers use this rather than reinterpreting the
 * document text, so editor behavior follows the parser's indent definition.
 */
export function leadingIndentRange(
  tree: Tree,
  lineFrom: number,
): { from: number; to: number } | null {
  let indent: { from: number; to: number } | null = null;
  tree.iterate({
    from: lineFrom,
    to: lineFrom + 1,
    enter(node) {
      if (node.from !== lineFrom || node.type.prop(isIndent) !== true) return;
      indent = { from: node.from, to: node.to };
      return false;
    },
  });
  return indent;
}

/**
 * Returns the parser-recorded indentation range, or reconstructs the range
 * for a whitespace-only line. @lezer/markdown omits blank lines from its
 * syntax tree, while Aspen still needs their indentation to display and
 * release an empty bullet.
 */
export function indentRangeForLine(
  tree: Tree,
  lineFrom: number,
  lineText: string,
): { from: number; to: number } | null {
  return (
    leadingIndentRange(tree, lineFrom) ??
    (isBlankLine(lineText) && lineText.length > 0
      ? { from: lineFrom, to: lineFrom + countIndent(lineText) }
      : null)
  );
}
