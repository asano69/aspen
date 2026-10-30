import { batch, createMemo, createSignal, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { TelomereLine, TelomereResponse } from "../api/generated";
import type { Message } from "../collab";
import { telomereEntries, type TelomereEntry } from "../models/telomere";

// The "lines" message of the collab stream: the metadata of every line of the
// card, in order (see room.Message in internal/serve/rooms.go).
export interface LinesMessage extends Message {
  type: "lines";
  lines: TelomereLine[];
}

export interface LineMeta {
  // One entry per line of the card, in order. Empty until the server's first
  // message arrives. Anything that needs per-line data (the telomere gutter,
  // and later e.g. a scrollbar heat map) can read it from a memo.
  entries: Accessor<TelomereEntry[]>;
  apply(message: LinesMessage): void;
  setReader(reader: TelomereResponse): void;
}

// The line metadata of one open card. It lives and dies with the editor that
// creates it, so data of a closed card can never show up under another one.
export function createLineMeta(): LineMeta {
  const [lines, setLines] = createStore<TelomereLine[]>([]);
  // The update time of every line when the card was opened, from the first
  // message (see lineStatus in models/telomere.ts).
  const [opened, setOpened] = createSignal<ReadonlyMap<string, number>>();
  // Until the reader is known no line is unread.
  const [reader, setReaderSignal] = createSignal<TelomereResponse>({
    me: "",
    left: Infinity,
  });

  const entries = createMemo(() => {
    const base = opened();
    return base ? telomereEntries(lines, base, reader()) : [];
  });

  return {
    entries,
    apply(message) {
      batch(() => {
        if (!opened()) {
          setOpened(new Map(message.lines.map((l) => [l.id, l.updated])));
        }
        // Keyed by id, so an unchanged line keeps its object.
        setLines(reconcile(message.lines, { key: "id" }));
      });
    },
    setReader(value) {
      setReaderSignal(value);
    },
  };
}
