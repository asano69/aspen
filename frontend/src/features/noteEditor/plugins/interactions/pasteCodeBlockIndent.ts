import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { countIndent } from "../../parser/aspen/indent";
import { enclosingCodeBlock } from "./bulletEnter";

// A `code:` block only lasts while its lines are indented deeper than
// the declaration (see parser/aspen/rules/indentedBlock.ts), and a
// truly empty line has indent 0, so it ends the block too. Pasted code
// carries its own indentation (usually starting at column 0), which
// would therefore cut the block short. This prefixes every line after
// the first -- blank ones included, so they stay whitespace-only lines
// inside the block -- with the block's own indent. The code's relative
// indentation is kept as is.
//
// `linePrefix` is the text before the caret on the current line: when
// it is only whitespace shorter than the block indent, the missing part
// is added to the first line as well, so it does not fall out either.
export function reindentForCodeBlock(
  text: string,
  base: string,
  linePrefix: string,
): string {
  const [first, ...rest] = text.replace(/\r\n?/g, "\n").split("\n");
  const missing = linePrefix.trim() === "" ? base.slice(linePrefix.length) : "";
  return [missing + first, ...rest.map((line) => base + line)].join("\n");
}

// The block's own indent: the declaration's indentation plus one
// indent unit (the parser counts one whitespace character per level).
function codeBlockBase(state: EditorState, block: SyntaxNode): string {
  const declaration = state.doc.lineAt(block.from).text;
  return (
    declaration.slice(0, countIndent(declaration)) + state.facet(indentUnit)
  );
}

// Re-indents a multi-line paste made inside a `code:` block's body.
// Single-line pastes, pastes outside a code block and pastes on the
// declaration line itself fall through to the default behavior.
export function pasteCodeBlockIndent() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData("text/plain");
      if (!text || !/[\r\n]/.test(text)) return false;

      const { state } = view;
      const { from, to } = state.selection.main;
      const block = enclosingCodeBlock(state, from);
      if (!block) return false;

      const line = state.doc.lineAt(from);
      if (line.number === state.doc.lineAt(block.from).number) return false;

      const insert = reindentForCodeBlock(
        text,
        codeBlockBase(state, block),
        state.sliceDoc(line.from, from),
      );
      event.preventDefault();
      view.dispatch(
        state.update({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          scrollIntoView: true,
          userEvent: "input.paste",
        }),
      );
      return true;
    },
  });
}
