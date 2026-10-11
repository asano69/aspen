import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { DragDropProvider } from "@dnd-kit/solid";
import { useSortable, isSortable } from "@dnd-kit/solid/sortable";
import { PointerSensor, KeyboardSensor } from "@dnd-kit/dom";
import { TextField } from "@kobalte/core/text-field";

import PotIcon from "@/components/PotIcon";
import { potCoverURL } from "@/lib/api/pots";
import { normalizeForSearch } from "@/lib/search/titleSearch";
import { orderedPots, reorderPot } from "@/lib/stores/potsStore";
import { topBarPotLink } from "@/lib/topBarSlot";
import type { PotRecord } from "@/lib/models/pot";

// Same override as PotList/CardList's own sensors: without it,
// PointerSensor's default preventActivation refuses to start a drag
// from inside an interactive element (each row's <a>).
const sensors = [
  PointerSensor.configure({
    preventActivation: () => false,
  }),
  KeyboardSensor,
];

interface SidebarPotRowProps {
  pot: PotRecord;
  index: number;
}

// A plain text row: the pot icon followed by its title. No border,
// background or shadow of its own, only a hover/active tint.
function SidebarPotRow(props: SidebarPotRowProps) {
  // Getter syntax (not a plain destructure) so the hook re-reads
  // id/index reactively instead of only once at setup -- see
  // dnd-kit's Solid docs (same as CardItem/PotGridItem).
  const { ref, isDragging } = useSortable({
    get id() {
      return props.pot.id;
    },
    get index() {
      return props.index;
    },
  });

  return (
    <li
      ref={ref}
      class="sidebar-pot"
      data-dragging={isDragging() ? "" : undefined}
    >
      <A href={`/${props.pot.name}`} class="sidebar-link">
        <PotIcon src={potCoverURL(props.pot)} />
        <span class="title">{props.pot.title}</span>
      </A>
    </li>
  );
}

export interface SidebarPotListProps {
  // Whether the sidebar is open. The search box takes the focus each time
  // it opens, so typing can start at once.
  open: boolean;
}

// Sidebar-only list of pots: a search box that filters the list, and
// drag-to-reorder. Adding/renaming/deleting a pot still happens on the pots
// page. The pot that is currently open is not listed. Kept as its own
// component (not folded into Sidebar.tsx) since it owns its own
// drag-to-reorder wiring, mirroring PotList.tsx's pattern. Both lists read
// the same pots store (see lib/stores/potsStore.ts), so a reorder or rename
// in one shows up in the other immediately.
export default function SidebarPotList(props: SidebarPotListProps) {
  const [query, setQuery] = createSignal("");
  let input: HTMLInputElement | undefined;

  // preventScroll: the sidebar is still sliding in from off-screen, and
  // focusing it must not scroll the page to reveal it.
  createEffect(() => {
    if (!props.open) return;
    input?.focus({ preventScroll: true });
    input?.select();
  });

  // The pots shown: every pot but the open one whose title matches the query.
  const visiblePots = createMemo(() => {
    const openId = topBarPotLink()?.id;
    const needle = normalizeForSearch(query());
    return orderedPots().filter(
      (pot) =>
        pot.id !== openId && normalizeForSearch(pot.title).includes(needle),
    );
  });

  // reorderPot works on indexes into the full pot list, while the drag
  // reports indexes into the visible one, so both ends are translated
  // through the pots they stand for.
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source)) return;

    const visible = visiblePots();
    const moved = visible[source.initialIndex];
    const target = visible[source.index];
    if (!moved || !target) return;

    const all = orderedPots();
    reorderPot(
      all.findIndex((pot) => pot.id === moved.id),
      all.findIndex((pot) => pot.id === target.id),
    );
  };

  return (
    <Show when={orderedPots().length > 0}>
      <TextField value={query()} onChange={setQuery} class="sidebar-search">
        <TextField.Input
          ref={input}
          type="search"
          placeholder="Search pots"
          autocomplete="off"
          spellcheck={false}
          class="input"
        />
      </TextField>
      <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
        <ul class="sidebar-pot-list">
          <For each={visiblePots()}>
            {(pot, index) => <SidebarPotRow pot={pot} index={index()} />}
          </For>
        </ul>
      </DragDropProvider>
    </Show>
  );
}
