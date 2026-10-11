import {
  EditorView,
  Decoration,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { CodeBlock } from "../../parser/cardpot";
import { indentRangeForLine } from "../../parser/cardpot/indent";
import { decorationPlugin } from "./decorationPlugin";

// Width of one indent level's mark element, in pixels (see
// IndentMarkWidget below). Also used by editorTheme.ts to size the
// ".pad" element itself, so the two stay in sync.
export const INDENT_WIDTH_PX = 22.5;

// Diameter of the bullet dot drawn inside the last mark of a line's
// leading indent (see IndentMarkWidget below and editorTheme.ts's
// ".pad .dot" rule).
export const DOT_SIZE_PX = 6;

// Renders one indent level as a fixed-width "pad" box,
// replacing the underlying whitespace character 1:1 via
// Decoration.replace() (see buildDecorations). Because each mark
// stands in for exactly one document character, deleting it (e.g.
// Backspace right after it) behaves exactly like deleting any other
// single character -- no separate outdent command or atomic-range
// plumbing is needed for that anymore.
//
// Only the last mark in a line's leading run draws the bullet dot;
// every other mark is empty and only reserves horizontal space. The
// actual line-width reservation (so wrapped continuation rows line up
// under the first row's text) is handled separately by the ".indent"
// line class below (margin-left/text-indent) -- these marks only
// reserve space within the first visual row itself.
class IndentMarkWidget extends WidgetType {
  constructor(private readonly hasDot: boolean) {
    super();
  }

  eq(other: IndentMarkWidget) {
    return other.hasDot === this.hasDot;
  }

  toDOM() {
    const mark = document.createElement("span");
    mark.className = "pad";
    // Without this, the browser treats the widget as ordinary
    // editable content and can place a native caret or click target
    // inside it.
    mark.contentEditable = "false";

    if (this.hasDot) {
      const dot = document.createElement("span");
      dot.className = "dot";
      mark.appendChild(dot);
    }

    return mark;
  }
}

// Builds, for each visible line with a leading indent run:
//   - one Decoration.replace() range per indent character, each
//     rendered as an "pad" box (see IndentMarkWidget) -- this
//     is what makes the indent visible and lets a single Backspace
//     remove one level.
//   - a line-level ".indent" class carrying the total indent width as
//     a CSS variable (see editorTheme.ts's ".cm-line.indent" rule,
//     which turns this into margin-left/text-indent), so a wrapped
//     continuation row of the same line lines up under the first
//     row's real text. margin-left alone would double-indent the
//     first row, since the pad elements already occupy that
//     width themselves there; the matching negative text-indent
//     cancels margin-left back out for exactly the first row, leaving
//     continuation rows indented by margin-left alone. Unlike the
//     previous font-size:0 + padding approach, this doesn't depend on
//     a native tab character's browser-dependent tab-stop width,
//     since each pad is a plain, fixed-width element under
//     our own control.
export function buildDecorations(view: EditorView): DecorationSet {
  const decorations = [];

  // `code:` block body ranges (see codeBlockLines.ts for the same
  // pattern): inside one of these, the parser's Indent node is the
  // block's own indent level, not a bullet, so its pads get no dot.
  // Any whitespace deeper than that Indent node is raw code and is
  // left untouched. The declaration line is not part of the body: it
  // is an ordinary bullet line, so it keeps its dot.
  const codeBlockRanges: { from: number; to: number }[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.type !== CodeBlock) return;
      const bodyFrom = view.state.doc.lineAt(node.from).to + 1;
      codeBlockRanges.push({ from: bodyFrom, to: node.to });
    },
  });
  const inCodeBlock = (pos: number) =>
    codeBlockRanges.some((range) => pos >= range.from && pos < range.to);

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const inCode = inCodeBlock(line.from);
      const indent = indentRangeForLine(
        syntaxTree(view.state),
        line.from,
        line.text,
      );
      if (indent) {
        const depth = indent.to - indent.from;
        const width = depth * INDENT_WIDTH_PX;
        decorations.push(
          Decoration.line({
            class: "indent",
            attributes: { style: `--indent-width: ${width}px;` },
          }).range(line.from),
        );

        for (let i = 0; i < depth; i++) {
          decorations.push(
            Decoration.replace({
              widget: new IndentMarkWidget(!inCode && i === depth - 1),
            }).range(indent.from + i, indent.from + i + 1),
          );
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

export const hangingIndent = decorationPlugin({
  build: buildDecorations,
  // Indent ranges come from the syntax tree, which the language parses
  // incrementally and can extend without any document change (e.g. once
  // a long document finishes its background parse), so a new tree must
  // also trigger a rebuild.
  shouldRebuild: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    syntaxTree(update.startState) !== syntaxTree(update.state),
});
