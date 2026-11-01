import { EditorSelection, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Direction, type EditorView, type KeyBinding } from "@codemirror/view";
import { Deco } from "../../parser/aspen";

function decorationAtBoundary(
  state: EditorState,
  pos: number,
): { from: number; to: number } | undefined {
  let boundary: { from: number; to: number } | undefined;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.type !== Deco) return;
      if (pos === node.from || pos === node.to) {
        boundary = { from: node.from, to: node.to };
        return false;
      }
    },
  });
  return boundary;
}

function moveToDecorationBoundary(visualRight: boolean) {
  return (view: EditorView): boolean => {
    const { selection } = view.state;
    if (selection.ranges.length !== 1 || !selection.main.empty) return false;

    // Match CodeMirror's visual ArrowLeft/ArrowRight behavior, including RTL.
    const ltr = view.textDirectionAt(selection.main.head) === Direction.LTR;
    const forward = visualRight === ltr;

    // The outer position is represented by a preview widget while the cursor
    // is outside. Step into its source explicitly so the widget's atomic range
    // doesn't make the user skip the entire decoration.
    const currentBoundary = decorationAtBoundary(view.state, selection.main.head);
    if (currentBoundary) {
      const atOpen = selection.main.head === currentBoundary.from;
      const outside = atOpen ? selection.main.assoc < 0 : selection.main.assoc > 0;
      if (outside && (atOpen ? forward : !forward)) {
        const head = atOpen ? currentBoundary.from + 1 : currentBoundary.to - 1;
        view.dispatch({
          selection: EditorSelection.cursor(head, atOpen ? 1 : -1),
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      }
    }

    const next = view.moveByChar(selection.main, forward);
    const boundary = decorationAtBoundary(view.state, next.head);
    if (!boundary) return false;
    const assoc = next.head === boundary.from ? -1 : 1;

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
