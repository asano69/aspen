import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Code } from "../../../parser/cardpod";
import { enclosingCodeBlock } from "../bulletEnter";

// Places where a paste is never converted: the text is inserted as it is.
// Add an entry to skip another place.
export interface SkipContext {
  name: string;
  test: (state: EditorState) => boolean;
}

function insideInlineCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    // Strictly inside: right before or after the backticks is outside.
    if (node.type === Code) return pos > node.from && pos < node.to;
    node = node.parent;
  }
  return false;
}

export const skipContexts: SkipContext[] = [
  // The first line is the card's title: plain text, no notation.
  {
    name: "title line",
    test: (state) => state.doc.lineAt(state.selection.main.from).number === 1,
  },
  // Code is raw text (pasteCodeBlockIndent handles its indentation).
  {
    name: "code block",
    test: (state) =>
      enclosingCodeBlock(state, state.selection.main.from) !== null,
  },
  {
    name: "inline code",
    test: (state) => insideInlineCode(state, state.selection.main.from),
  },
];
