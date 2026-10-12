import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useDroppable } from "@dnd-kit/solid";
import { useSortable, isSortable } from "@dnd-kit/solid/sortable";
import { TextField } from "@kobalte/core/text-field";

import PotIcon from "@/components/PotIcon";
import { potCoverURL } from "@/lib/api/pots";
import { useDragEnd } from "@/lib/dragEnd";
import { normalizeForSearch } from "@/lib/search/titleSearch";
import { Plus } from "@/lib/icons";
import { addPot, orderedPots, reorderPot } from "@/lib/stores/potsStore";
import type { PotRecord } from "@/lib/models/pot";


interface SidebarPotRowProps {
  pot: PotRecord;
  index: number;
}

// A plain text row: the pot icon followed by its title. No border,
// background or shadow of its own, only a hover/active tint. The open
// pot is marked by the router with .active (see sidebar.css).
function SidebarPotRow(props: SidebarPotRowProps) {
  // Getter syntax (not a plain destructure) so the hook re-reads
  // id/index reactively instead of only once at setup -- see
  // dnd-kit's Solid docs (same as CardItem/PotGridItem).
  // type/accept keep cards (type "card") from reordering the pots.
  const { ref, isDragging } = useSortable({
    get id() {
      return props.pot.id;
    },
    get index() {
      return props.index;
    },
    type: "pot",
    accept: "pot",
  });

  // The row is also where a card can be dropped to move it to this pot (see
  // CardList's handleDragEnd, which reads data.potId). It is a separate
  // droppable on the link, so the row's sortable keeps accepting pots only.
  const { ref: dropRef, isDropTarget } = useDroppable({
    get id() {
      return `pot-drop:${props.pot.id}`;
    },
    get data() {
      return { potId: props.pot.id };
    },
    accept: "card",
  });

  return (
    <li
      ref={ref}
      class="sidebar-pot"
      data-dragging={isDragging() ? "" : undefined}
    >
      <A
        ref={dropRef}
        href={`/${props.pot.name}`}
        class="sidebar-link"
        data-drop-target={isDropTarget() ? "" : undefined}
      >
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
// drag-to-reorder. When the search matches no pot, the typed text can be used
// to create one. Renaming/deleting a pot still happens on the pots page. The
// pot that is currently open is listed too, highlighted. Kept as its own
// component (not folded into Sidebar.tsx) since it owns its own
// drag-to-reorder wiring, mirroring PotList.tsx's pattern. Both lists read
// the same pots store (see lib/stores/potsStore.ts), so a reorder or rename
// in one shows up in the other immediately.
export default function SidebarPotList(props: SidebarPotListProps) {
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

  // The pots shown: every pot whose title matches the query.
  const visiblePots = createMemo(() => {
    const needle = normalizeForSearch(query());
    return orderedPots().filter((pot) =>
      normalizeForSearch(pot.title).includes(needle),
    );
  });

  // A pot can be created from the typed text only when nothing matches it.
  const newTitle = () => query().trim();
  const canCreate = () => newTitle() !== "" && visiblePots().length === 0;

  const handleCreate = async (e?: SubmitEvent) => {
    e?.preventDefault();
    if (!canCreate() || creating()) return;
    setError("");
    setCreating(true);
    try {
      await addPot(newTitle());
      setQuery("");
    } catch {
      setError("Failed to add the pot.");
    } finally {
      setCreating(false);
    }
  };

  // reorderPot works on indexes into the full pot list, while the drag
  // reports indexes into the visible one, so both ends are translated
  // through the pots they stand for.
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (source?.type !== "pot" || !isSortable(source)) return;

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
            placeholder="Search or create pots"
            autocomplete="off"
            spellcheck={false}
            class="input"
          />
        </TextField>
      </form>
      <Show when={canCreate()}>
        <div class="sidebar-pot-list">
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
      <ul class="sidebar-pot-list">
        <For each={visiblePots()}>
          {(pot, index) => <SidebarPotRow pot={pot} index={index()} />}
        </For>
      </ul>
    </>
  );
}
