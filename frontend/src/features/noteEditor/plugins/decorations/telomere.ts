import {
  StateEffect,
  StateField,
  Transaction,
  type ChangeSet,
  type Extension,
  type Text,
} from "@codemirror/state";
import { GutterMarker, gutter, gutters } from "@codemirror/view";
import {
  telomereThickness,
  type TelomereEntry,
} from "@/lib/models/telomere";

// The telomere is a gutter whose only content is a vertical bar per line, so
// no line numbers are shown (lineNumbers() is deliberately not used). The
// gutter itself is moved into the page's left padding by editorTheme.ts.
//
// The editor keeps one entry per line. The entries come from the server once
// (see setTelomereBase) and are then moved along with every edit: a line an
// edit touches becomes "updated", whoever made the edit.

interface TelomereState {
  // One entry per line of the document, or empty while they are not known.
  entries: TelomereEntry[];
  // Entries from the server that wait for the document to have the same
  // number of lines (the card's text arrives after the editor is created).
  pending: TelomereEntry[] | null;
}

// Sent once the server's entries are loaded (see ExistingCardEditor).
export const setTelomereBase = StateEffect.define<TelomereEntry[]>();

// Returns the entries of the document after `changes`. A line no change
// touches keeps its entry at its new position; every other line gets `edit`.
// Entries that do not fit the old document are dropped.
export function mapEntries(
  entries: TelomereEntry[],
  oldDoc: Text,
  newDoc: Text,
  changes: ChangeSet,
  edit: TelomereEntry,
): TelomereEntry[] {
  if (entries.length !== oldDoc.lines) return [];

  const touched: [number, number][] = [];
  changes.iterChanges((fromA, toA) => touched.push([fromA, toA]));

  const next = new Array<TelomereEntry>(newDoc.lines).fill(edit);
  for (let i = 1; i <= oldDoc.lines; i++) {
    const line = oldDoc.line(i);
    if (touched.some(([from, to]) => from <= line.to && to >= line.from)) {
      continue;
    }
    const pos = changes.mapPos(line.from, 1);
    next[newDoc.lineAt(pos).number - 1] = entries[i - 1];
  }
  return next;
}

// `author` returns the name shown for the user's own edits.
export function telomere(author: () => string): Extension {
  const field = StateField.define<TelomereState>({
    create: () => ({ entries: [], pending: null }),
    update(value, tr) {
      let { entries, pending } = value;
      for (const effect of tr.effects) {
        if (effect.is(setTelomereBase)) pending = effect.value;
      }
      if (!tr.docChanged && pending === value.pending) return value;

      if (tr.docChanged) {
        const edit: TelomereEntry = {
          updatedAt: Date.now(),
          // The author of a remote edit is not known here.
          user: tr.annotation(Transaction.remote) ? "" : author(),
          status: "updated",
        };
        entries = mapEntries(
          entries,
          tr.startState.doc,
          tr.state.doc,
          tr.changes,
          edit,
        );
      }
      // An empty document is the text that has not arrived yet.
      const { doc } = tr.state;
      if (pending && doc.length > 0 && pending.length === doc.lines) {
        entries = pending;
        pending = null;
      }
      return { entries, pending };
    },
  });

  return [
    field,
    // Not fixed: a fixed gutter gets an inline "position: sticky", which would
    // override the absolute positioning set in editorTheme.ts.
    gutters({ fixed: false }),
    gutter({
      class: "cm-telomere",
      lineMarker(view, line) {
        const index = view.state.doc.lineAt(line.from).number - 1;
        const entry = view.state.field(field).entries[index];
        return entry ? new TelomereMarker(entry) : null;
      },
      // Document changes already refresh the markers; this covers new data.
      lineMarkerChange: (update) =>
        update.startState.field(field) !== update.state.field(field),
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
    bar.title = this.entry.user;
    return bar;
  }
}
