import { For, Show } from "solid-js";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/solid/sortable";
import { PointerSensor, KeyboardSensor } from "@dnd-kit/dom";

import Loading from "@/components/Loading";
import { useFooterSlot } from "@/lib/footerSlot";
import { orderedPots, potsLoaded, reorderPot } from "@/lib/stores/potsStore";
import CardGrid from "../cards/CardGrid";
import PotItem from "./PotItem";

// Same override as MainLayout's sensors: without it, PointerSensor's default
// preventActivation refuses to start a drag from inside an interactive
// element (the card's <a>, or its actions menu trigger).
const sensors = [
  PointerSensor.configure({
    preventActivation: () => false,
  }),
  KeyboardSensor,
];

// The root page: every pot as a card, in the same grid as a pot's card list
// (see CardList). It has its own provider, so its sortable ids stay apart
// from the sidebar's pot rows, which use the same pot ids.
export default function PotCards() {
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source)) return;

    reorderPot(source.initialIndex, source.index);
  };

  // Footer's status-bar slot, like CardList's page count.
  useFooterSlot(() => (
    <div class="page-list-status">
      <span class="item">{orderedPots().length} pots</span>
    </div>
  ));

  return (
    <Show when={potsLoaded()} fallback={<Loading />}>
      <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
        <CardGrid>
          <For each={orderedPots()}>
            {(pot, index) => <PotItem pot={pot} index={index()} />}
          </For>
        </CardGrid>
      </DragDropProvider>
    </Show>
  );
}
