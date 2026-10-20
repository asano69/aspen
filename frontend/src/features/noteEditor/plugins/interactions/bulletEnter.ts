import type { Command } from "@codemirror/view";
import {
  EditorSelection,
  type EditorState,
  type Line,
} from "@codemirror/state";
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { CodeBlock } from "../../parser/cardpod";
import { countIndent, indentRangeForLine } from "../../parser/cardpod/indent";

// Returns the `code:` block containing `pos`, or null (see
// codeBlockLines.ts / hangingIndent.ts for the same CodeBlock
// lookup). Leading whitespace there is raw code, not a bullet to
// release.
export function enclosingCodeBlock(
  state: EditorState,
  pos: number,
): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.type === CodeBlock) return node;
    node = node.parent;
  }
  return null;
}

// How many leading characters of `line` count as its indentation.
//
// Inside a `code:` block that is the whole leading whitespace run: the
// parser's Indent node only covers the block's own level, but any
// deeper whitespace is code indentation that should be carried over
// as well. Elsewhere the parser's Indent node is authoritative, so a
// title line (which has none) never counts as indented.
function indentLength(
  state: EditorState,
  line: Line,
  inCodeBlock: boolean,
): number {
  if (inCodeBlock) return countIndent(line.text);
  const indent = indentRangeForLine(syntaxTree(state), line.from, line.text);
  return indent ? indent.to - indent.from : 0;
}

// Enter behavior for indented (bulleted) lines, mirroring common
// outliner UX (Workflowy/Scrapbox-style):
//
// - The new line starts with a verbatim copy of the current line's own
//   indentation characters (tabs, half-width or full-width spaces, in
//   the same order), so the list continues at the same depth without
//   normalizing the indentation to tabs. Only the indentation left of
//   the cursor is copied: whitespace to its right travels down with
//   the rest of the text, so pressing Enter in the middle of the
//   indentation never doubles it.
// - A bulleted line with nothing typed yet (just its indentation) is
//   "released" instead: its indentation is stripped in place and a
//   plain newline follows, exiting bullet mode rather than nesting an
//   empty bullet under another empty bullet.
// - Inside a `code:` block the same copy applies, but nothing is ever
//   released: a code line holding only whitespace is still part of
//   the block, and flattening it would end the block. The new line
//   therefore always stays deeper than the `code:` declaration.
export const insertNewlineKeepingBullet: Command = (view) => {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const codeBlock = enclosingCodeBlock(state, range.from);
    const depth = indentLength(state, line, codeBlock !== null);
    const column = range.from - line.from;

    if (!codeBlock && depth > 0 && line.text.slice(depth).trim() === "") {
      // Empty bullet: release bullet mode and still insert a newline,
      // so the cursor moves down to a fresh, unindented line rather
      // than staying on the now-flattened one. The whole line (not
      // just its indentation) is replaced, since the remainder may
      // still hold trailing whitespace that must not survive into the
      // new line either.
      return {
        changes: { from: line.from, to: line.to, insert: "\n" },
        range: EditorSelection.cursor(line.from + 1),
      };
    }

    let indent = line.text.slice(0, Math.min(depth, column));

    // The `code:` declaration line is the one place a plain copy is not
    // enough: a new line at the declaration's own depth would fall
    // outside the block, so the first body line gets one more indent
    // unit. Not applied while the cursor is still before the `code:`
    // text, where Enter just moves the declaration itself down.
    if (
      codeBlock &&
      column > depth &&
      state.doc.lineAt(codeBlock.from).number === line.number
    ) {
      indent += state.facet(indentUnit);
    }

    const insert = "\n" + indent;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });

  view.dispatch(
    state.update(changes, { scrollIntoView: true, userEvent: "input" }),
  );
  return true;
};
