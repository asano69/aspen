import {
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { parseDescription } from "@/features/cardDescription/parseDescription";

// Text with its notation removed (decorations, brackets, images), as the card
// grid shows a description.
function plainText(raw: string): string {
  return parseDescription(raw)
    .map((segment) => segment.text)
    .join("");
}

function button(label: string, disabled: boolean, onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.disabled = disabled;
  // Keeps the editor's selection: a mousedown on a button would clear it.
  el.addEventListener("mousedown", (event) => event.preventDefault());
  el.addEventListener("click", onClick);
  return el;
}

function menuTooltip(
  state: EditorState,
  onMerge?: (text: string) => void,
): Tooltip | null {
  const { from, to, head } = state.selection.main;
  if (from === to) return null;

  return {
    pos: head,
    above: true,
    strictSide: true,
    create(view) {
      // Read at click time, so the menu always acts on the current selection.
      const selected = () => {
        const range = view.state.selection.main;
        return view.state.sliceDoc(range.from, range.to);
      };
      const collapse = () =>
        view.dispatch({
          selection: { anchor: view.state.selection.main.to },
        });

      const dom = document.createElement("div");
      dom.className = "selection-menu";
      dom.append(
        button("Merge into existing page", !onMerge, () => {
          onMerge?.(selected());
          collapse();
        }),
        button("Copy plain", false, () => {
          navigator.clipboard
            .writeText(plainText(selected()))
            .then(collapse)
            .catch((err) =>
              console.error("[selection-menu] failed to copy:", err),
            );
        }),
      );
      return { dom };
    },
  };
}

// Shows a small menu above a non-empty selection. `onMerge` receives the
// selected raw text; without it the merge button is disabled.
export function selectionMenu(onMerge?: (text: string) => void): Extension {
  return StateField.define<Tooltip | null>({
    create: (state) => menuTooltip(state, onMerge),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? menuTooltip(tr.state, onMerge) : value,
    provide: (field) => showTooltip.from(field),
  });
}
