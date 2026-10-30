import { StateEffect, type Extension } from "@codemirror/state";
import {
  GutterMarker,
  gutter,
  gutters,
  type EditorView,
} from "@codemirror/view";
import { telomereThickness, type TelomereEntry } from "@/lib/models/telomere";

// The telomere is a gutter whose only content is a vertical bar per line, so
// no line numbers are shown (lineNumbers() is deliberately not used). The
// gutter itself is moved into the page's left padding by editorTheme.ts.
//
// It holds no state of its own: the entries come from the server (see
// lib/stores/lineMeta.ts) and are read through a getter. The editor sends
// refreshTelomere when they change, and every edit redraws the gutter anyway.

// Sent whenever the entries changed, so the gutter draws its markers again.
export const refreshTelomere = StateEffect.define<null>();

// `entries` returns one entry per line. `onSelect` is called with a line's
// entry and its bar element when the bar is clicked.
export function telomere(
  entries: () => TelomereEntry[],
  onSelect: (entry: TelomereEntry, anchor: HTMLElement) => void,
): Extension {
  // The entry of the line at `pos`. The text moves before the server's
  // message follows, so while they disagree on the number of lines nothing is
  // drawn.
  const entryAt = (view: EditorView, pos: number) => {
    const list = entries();
    if (list.length !== view.state.doc.lines) return undefined;
    return list[view.state.doc.lineAt(pos).number - 1];
  };

  return [
    // Not fixed: a fixed gutter gets an inline "position: sticky", which would
    // override the absolute positioning set in editorTheme.ts.
    gutters({ fixed: false }),
    gutter({
      class: "cm-telomere",
      lineMarker(view, line) {
        const entry = entryAt(view, line.from);
        return entry ? new TelomereMarker(entry) : null;
      },
      // Document changes already refresh the markers; this covers new data.
      lineMarkerChange: (update) =>
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(refreshTelomere)),
        ),
      domEventHandlers: {
        click(view, line, event) {
          const entry = entryAt(view, line.from);
          if (!entry) return false;
          const target = event.target as HTMLElement;
          onSelect(
            entry,
            target.closest<HTMLElement>(".telomere-border") ?? target,
          );
          return true;
        },
      },
    }),
  ];
}

class TelomereMarker extends GutterMarker {
  private readonly thickness: number;

  constructor(private readonly entry: TelomereEntry) {
    super();
    this.thickness = telomereThickness(Date.now() - entry.updatedAt);
  }

  // Equal markers keep their DOM.
  eq(other: TelomereMarker) {
    return (
      other.thickness === this.thickness &&
      other.entry.status === this.entry.status &&
      other.entry.user === this.entry.user
    );
  }

  toDOM() {
    const bar = document.createElement("div");
    bar.className = `telomere-border ${this.entry.status}`;
    bar.style.borderLeftWidth = `${this.thickness}px`;
    return bar;
  }
}
