import { For, Show } from "solid-js";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/solid/sortable";
import { PointerSensor, KeyboardSensor } from "@dnd-kit/dom";

import Loading from "@/components/Loading";
import { useFooterSlot } from "@/lib/footerSlot";
import { orderedPods, podsLoaded, reorderPod } from "@/lib/stores/podsStore";
import { podsDisplayMode } from "@/lib/stores/displayModeStore";
import QuickLaunch from "../cards/QuickLaunch";
import PodGraph from "./PodGraph";
import PodItem from "./PodItem";

// Same override as MainLayout's sensors: without it, PointerSensor's default
// preventActivation refuses to start a drag from inside an interactive
// element (the card's <a>, or its actions menu trigger).
const sensors = [
  PointerSensor.configure({
    preventActivation: () => false,
  }),
  KeyboardSensor,
];

// The root page: every pod as a card, in the same grid as a pod's card list
// (see CardList). It has its own provider, so its sortable ids stay apart
// from the sidebar's pod rows, which use the same pod ids.
export default function PodCards() {
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source)) return;

    reorderPod(source.initialIndex, source.index);
  };

  // Footer's status-bar slot, like CardList's page count.
  useFooterSlot(() => (
    <div class="page-list-status">
      <span class="item">{orderedPods().length} pods</span>
    </div>
  ));

  return (
    <Show when={podsLoaded()} fallback={<Loading />}>
      {/* The quick launch bar stays in both views, so the user can switch back. */}
      <QuickLaunch />
      <Show
        when={podsDisplayMode() === "Graph"}
        fallback={
          <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
            <ul class="card-grid">
              <For each={orderedPods()}>
                {(pod, index) => <PodItem pod={pod} index={index()} />}
              </For>
            </ul>
          </DragDropProvider>
        }
      >
        <PodGraph />
      </Show>
    </Show>
  );
}
