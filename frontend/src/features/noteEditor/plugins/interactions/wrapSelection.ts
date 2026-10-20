import type { Command } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

// Wraps the current selection in `prefix`/`suffix` instead of typing
// the pressed character literally -- e.g. selecting "foo" and
// pressing "`" turns it into "`foo`". Mirrors how closeBrackets
// (@codemirror/autocomplete, see index.tsx) already wraps a selection
// for "[", "(", "{" and quotes; this covers two symbols it doesn't
// handle: backtick (inline code, see rules/inlineCode.ts) and
// asterisk (Cardpod's own "[* text]" bold syntax -- not a paired
// bracket at all, see rules/decoration.ts).
//
// `cursorOffset` is where the (collapsed) cursor lands after
// wrapping, given the wrapped text's length -- relative to the
// selection's original start. Each caller picks the offset that
// matches how that syntax is normally continued (see the two exports
// below).
//
// Falls through (returns false) when the selection is empty, so the
// pressed key still types normally.
function wrapSelection(
  prefix: string,
  suffix: string,
  cursorOffset: (textLength: number) => number,
): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    if (from === to) return false;

    const text = view.state.sliceDoc(from, to);
    const cursor = from + cursorOffset(text.length);
    view.dispatch(
      view.state.update({
        changes: { from, to, insert: `${prefix}${text}${suffix}` },
        selection: EditorSelection.cursor(cursor),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  };
}

// Backtick: cursor lands after the closing backtick, i.e. past the
// whole wrapped word -- so typing continues right after the code span
// rather than inside it.
export const wrapBacktick = wrapSelection(
  "`",
  "`",
  (textLength) => 1 + textLength + 1,
);

// Bold: cursor lands right after the "*" mark itself (before the
// space and the wrapped word), matching decoration.ts's multi-char
// deco marks -- e.g. ready to type another deco char for "[*/ word]".
export const wrapBold = wrapSelection("[* ", "]", () => 2);
