import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useDroppable } from "@dnd-kit/solid";
import { useSortable, isSortable } from "@dnd-kit/solid/sortable";
import { TextField } from "@kobalte/core/text-field";

import PodIcon from "@/components/PodIcon";
import { podCoverURL } from "@/lib/api/pods";
import { useDragEnd } from "@/lib/dragEnd";
import { normalizeForSearch } from "@/lib/search/titleSearch";
import { Plus } from "@/lib/icons";
import { addPod, orderedPods, reorderPod } from "@/lib/stores/podsStore";
import type { PodRecord } from "@/lib/models/pod";

interface SidebarPodRowProps {
  pod: PodRecord;
  index: number;
}

// A plain text row: the pod icon followed by its title. No border,
// background or shadow of its own, only a hover/active tint. The open
// pod is marked by the router with .active (see sidebar.css).
function SidebarPodRow(props: SidebarPodRowProps) {
  // Getter syntax (not a plain destructure) so the hook re-reads
  // id/index reactively instead of only once at setup -- see
  // dnd-kit's Solid docs (same as CardItem/PodGridItem).
  // type/accept keep cards (type "card") from reordering the pods.
  const { ref, isDragging } = useSortable({
    get id() {
      return props.pod.id;
    },
    get index() {
      return props.index;
    },
    type: "pod",
    accept: "pod",
  });

  // The row is also where a card can be dropped to move it to this pod (see
  // CardList's handleDragEnd, which reads data.podId). It is a separate
  // droppable on the link, so the row's sortable keeps accepting pods only.
  const { ref: dropRef, isDropTarget } = useDroppable({
    get id() {
      return `pod-drop:${props.pod.id}`;
    },
    get data() {
      return { podId: props.pod.id };
    },
    accept: "card",
  });

  return (
    <li
      ref={ref}
      class="sidebar-pod"
      data-dragging={isDragging() ? "" : undefined}
    >
      <A
        ref={dropRef}
        href={`/${props.pod.name}`}
        class="sidebar-link"
        data-drop-target={isDropTarget() ? "" : undefined}
      >
        <PodIcon src={podCoverURL(props.pod)} />
        <span class="title">{props.pod.title}</span>
      </A>
    </li>
  );
}

export interface SidebarPodListProps {
  // Whether the sidebar is open. The search box takes the focus each time
  // it opens, so typing can start at once.
  open: boolean;
}

// Sidebar-only list of pods: a search box that filters the list, and
// drag-to-reorder. When the search matches no pod, the typed text can be used
// to create one. Renaming/deleting a pod still happens on the pods page. The
// pod that is currently open is listed too, highlighted. Kept as its own
// component (not folded into Sidebar.tsx) since it owns its own
// drag-to-reorder wiring, mirroring PodList.tsx's pattern. Both lists read
// the same pods store (see lib/stores/podsStore.ts), so a reorder or rename
// in one shows up in the other immediately.
export default function SidebarPodList(props: SidebarPodListProps) {
  const [query, setQuery] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal("");
  let input: HTMLInputElement | undefined;

  // preventScroll: the sidebar is still sliding in from off-screen, and
  // focusing it must not scroll the page to reveal it.
  createEffect(() => {
    if (!props.open) return;
    input?.focus({ preventScroll: true });
    input?.select();
  });

  // The pods shown: every pod whose title matches the query.
  const visiblePods = createMemo(() => {
    const needle = normalizeForSearch(query());
    return orderedPods().filter((pod) =>
      normalizeForSearch(pod.title).includes(needle),
    );
  });

  // A pod can be created from the typed text only when nothing matches it.
  const newTitle = () => query().trim();
  const canCreate = () => newTitle() !== "" && visiblePods().length === 0;

  const handleCreate = async (e?: SubmitEvent) => {
    e?.preventDefault();
    if (!canCreate() || creating()) return;
    setError("");
    setCreating(true);
    try {
      await addPod(newTitle());
      setQuery("");
    } catch {
      setError("Failed to add the pod.");
    } finally {
      setCreating(false);
    }
  };

  // reorderPod works on indexes into the full pod list, while the drag
  // reports indexes into the visible one, so both ends are translated
  // through the pods they stand for.
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (source?.type !== "pod" || !isSortable(source)) return;

    const visible = visiblePods();
    const moved = visible[source.initialIndex];
    const target = visible[source.index];
    if (!moved || !target) return;

    const all = orderedPods();
    reorderPod(
      all.findIndex((pod) => pod.id === moved.id),
      all.findIndex((pod) => pod.id === target.id),
    );
  };

  useDragEnd(handleDragEnd);

  return (
    <>
      <form onSubmit={handleCreate}>
        <TextField
          value={query()}
          onChange={(value) => {
            setQuery(value);
            setError("");
          }}
          class="sidebar-search"
        >
          <TextField.Input
            ref={input}
            type="search"
            placeholder="Search or create pods"
            autocomplete="off"
            spellcheck={false}
            class="input"
          />
        </TextField>
      </form>
      <Show when={canCreate()}>
        <div class="sidebar-pod-list">
          <button
            type="button"
            class="sidebar-link sidebar-create"
            disabled={creating()}
            onClick={() => handleCreate()}
          >
            <Plus size={20} />
            <span class="title">
              {creating() ? "Creating…" : `Create "${newTitle()}"`}
            </span>
          </button>
          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>
        </div>
      </Show>
      <ul class="sidebar-pod-list">
        <For each={visiblePods()}>
          {(pod, index) => <SidebarPodRow pod={pod} index={index()} />}
        </For>
      </ul>
    </>
  );
}
