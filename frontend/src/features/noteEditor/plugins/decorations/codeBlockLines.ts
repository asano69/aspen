import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { CodeBlock, CodeBlockMark } from "../../parser/cardpod";

// Full-line background for a `code:` block (see
// parser/cardpod/rules/codeBlock.ts). A plain Decoration.mark only
// colors the actual text runs it covers, so a blank line inside the
// block -- or the gap past the last character of a line, out to the
// edge of the editor -- would show through with no background at all.
// Decoration.line() instead tags every line the block spans with a
// CSS class on the line's own DOM element (".cm-line"), which fills
// that line's full width regardless of how much text it holds -- the
// same technique titleLineHighlight.ts and hangingIndent.ts use for
// their own line-level styling.
//
// The declaration line (e.g. "code: python") additionally gets the
// "start" class, and only its declaration text (the CodeBlockMark, which
// excludes the leading indent) is wrapped in a "code-block-start" mark, so
// editorTheme.ts can highlight just that text instead of the whole line.
const startMark = Decoration.mark({ class: "code-block-start" });

function buildDecorations(view: EditorView): DecorationSet {
  const decorations = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.type === CodeBlockMark) {
        decorations.push(startMark.range(node.from, node.to));
        return;
      }
      if (node.type !== CodeBlock) return;
      const startLine = view.state.doc.lineAt(node.from).number;
      const endLine = view.state.doc.lineAt(node.to).number;
      for (let n = startLine; n <= endLine; n++) {
        const line = view.state.doc.line(n);
        decorations.push(
          Decoration.line({
            class: n === startLine ? "code-block start" : "code-block",
          }).range(line.from),
        );
      }
    },
  });
  return Decoration.set(decorations, true);
}

export const codeBlockLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Code-block ranges come from the syntax tree, which can be
      // extended by a background parse without any document change, so
      // a new tree must also trigger a rebuild. A pure selection or
      // viewport change never needs a new set of ranges.
      if (
        update.docChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
