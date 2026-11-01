import { EditorSelection, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Direction, type EditorView, type KeyBinding } from "@codemirror/view";
import { Deco } from "../../parser/aspen";

function outsideAssoc(
  state: EditorState,
  pos: number,
): -1 | 1 | undefined {
  let assoc: -1 | 1 | undefined;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.type !== Deco) return;
      if (pos === node.from) {
        assoc = -1;
        return false;
      }
      if (pos === node.to) {
        assoc = 1;
        return false;
      }
    },
  });
  return assoc;
}

function moveToDecorationBoundary(visualRight: boolean) {
  return (view: EditorView): boolean => {
    const { selection } = view.state;
    if (selection.ranges.length !== 1 || !selection.main.empty) return false;

    // Match CodeMirror's visual ArrowLeft/ArrowRight behavior, including RTL.
    const ltr = view.textDirectionAt(selection.main.head) === Direction.LTR;
    const forward = visualRight === ltr;
    const next = view.moveByChar(selection.main, forward);
    const assoc = outsideAssoc(view.state, next.head);
    if (assoc === undefined) return false;

    view.dispatch({
      selection: EditorSelection.cursor(next.head, assoc, next.bidiLevel),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

// Only take over an arrow press when it lands immediately outside a
// decoration. All other cursor movement stays on CodeMirror's default keymap.
export const decorationBoundaryKeymap: readonly KeyBinding[] = [
  { key: "ArrowLeft", run: moveToDecorationBoundary(false) },
  { key: "ArrowRight", run: moveToDecorationBoundary(true) },
];
