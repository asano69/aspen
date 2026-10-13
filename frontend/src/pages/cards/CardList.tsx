import {
  createEffect,
  createMemo,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { useParams } from "@solidjs/router";
import { isSortable } from "@dnd-kit/solid/sortable";

import Loading from "@/components/Loading";
import CardItem from "./CardItem";
import CardGrid from "./CardGrid";
import {
  cardsById,
  loadNextCardsPage,
  moveCard,
  moveCardsToPot,
  potWindow,
} from "@/lib/stores/cardsStore";
import { computePosition } from "@/lib/position";
import { useDragEnd } from "@/lib/dragEnd";
import { useTitle } from "@/lib/useTitle";
import { useFooterSlot } from "@/lib/footerSlot";
import { usePot } from "../pots/PotContext";
// Detail page for a single pot, reached via the folder-open button on
// PotItem: the pot's title, an add-card button, and every card
// belonging to it laid out as a Scrapbox/Cosense-style card grid (see
// CardItem).

export default function CardList() {
  const params = useParams();
  // Fetched once by the parent PotLayout route and shared via
  // PotContext, instead of fetching it again here -- a second
  // identical fetchPotBySlug request used to get auto-cancelled by
  // PocketBase's SDK when navigating right after CardList mounted.
  const pot = usePot();
  // Browser tab title: the pot's own name (see useTitle.ts). CardForm
  // one level down uses "<card> - <pot>" for the same `pot` shape.
  useTitle(() => pot()?.title);
  // TopBar's pot-name link (and the "add card" button next to it) is
  // now registered once by the parent PotLayout route, not here -- see
  // lib/router.tsx and pages/pots/PotLayout.tsx.

  // Only a window of this pot's cards is held in the store (see
  // lib/stores/cardsStore.ts): the first page loads here on first
  // visit, later pages load as the sentinel below scrolls into view.
  createEffect(() => {
    const potId = pot()?.id;
    if (potId && !untrack(() => potWindow(potId))) {
      void loadNextCardsPage(potId);
    }
  });

  // Sorted descending by the fractional-indexing "position" column
  // (see lib/position.ts), with id as a tie-breaker for equal
  // positions -- new cards get the highest position (see CardForm),
  // so this puts the newest card first. Only the loaded window is
  // sorted, and the store keeps it live through realtime
  // create/update/delete events.
  const cards = createMemo(() =>
    (potWindow(pot()?.id)?.ids ?? [])
      .map((id) => cardsById[id])
      .filter((card) => card !== undefined)
      // Pinned cards always sort before unpinned ones; within each
      // group the existing position/id ordering is unchanged.
      .sort((a, b) => {
        if (a.pin !== b.pin) return a.pin ? -1 : 1;
        return b.position - a.position || a.id.localeCompare(b.id);
      }),
  );

  // Footer's status-bar slot: this pot's total card count as reported
  // by the server, not just what has been loaded so far.
  useFooterSlot(() => (
    <div class="page-list-status">
      <span class="item">{potWindow(pot()?.id)?.total ?? 0} pages</span>
    </div>
  ));

  // Loads the next page whenever the sentinel at the end of the grid
  // is in view. An observer only reports changes, so a page that still
  // leaves the sentinel in view (a tall screen, or a request that
  // finished while the sentinel was already visible) would stall the
  // scroll; the effect below therefore re-observes the sentinel
  // whenever the number of loaded cards changes, to get a fresh report.
  const observer = new IntersectionObserver((entries) => {
    const potId = pot()?.id;
    if (entries[0].isIntersecting && potId) void loadNextCardsPage(potId);
  });
  onCleanup(() => observer.disconnect());

  // The sentinel only exists once the first page has loaded, so it is
  // registered from its own ref callback.
  let sentinel: HTMLLIElement | undefined;
  const observeSentinel = (el: HTMLLIElement) => {
    sentinel = el;
    observer.observe(el);
  };

  createEffect(() => {
    void potWindow(pot()?.id)?.ids.length;
    if (sentinel) {
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    }
  });

  // The cards leave this list at once; a failure leaves the list as it was.
  const moveToPot = async (ids: string[], destPot: string) => {
    try {
      await moveCardsToPot(ids, destPot);
    } catch (err) {
      console.error("[cards] failed to move cards:", err);
      window.alert("Failed to move the cards.");
    }
  };

  // Persists a drag-to-reorder drop: only the moved card's own
  // position changes (see lib/position.ts), computed from whichever
  // two cards now sit on either side of it -- this works the same way
  // whether `cards()` holds all 10 cards an pot has or one page of a
  // filtered, paginated view of 3000.
  //
  // dnd-kit reports the drop via event.operation.source rather than
  // SortableJS's oldIndex/newIndex; isSortable narrows that source so
  // its initialIndex/index can be read instead.
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (source?.type !== "card") return;

    // Dropped on a pot of the sidebar (see SidebarPotList's droppable):
    // move instead of reorder. Moving several cards later only needs more
    // ids here.
    const destPot = target?.data?.potId;
    if (destPot) {
      if (destPot !== pot()?.id) void moveToPot([String(source.id)], destPot);
      return;
    }

    if (!isSortable(source)) return;

    const { initialIndex, index: newIndex } = source;
    if (initialIndex === newIndex) return;

    const ordered = cards();
    const moved = ordered[initialIndex];
    if (!moved) return;

    // Pinned cards always sort before unpinned ones (see `cards`
    // above), but their positions are on a completely separate scale
    // from unpinned ones (each new pin gets half of the lowest
    // existing pinned position -- see nextPinnedPosition in
    // cardsStore.ts). So neighbor lookups below must never cross into
    // the other pin group: averaging a pinned card's (tiny) position
    // with an unpinned card's (much larger) one could produce a value
    // that isn't actually above every other unpinned card, landing
    // the dragged card second or later instead of first.
    const group = ordered.filter((card) => card.pin === moved.pin);
    const groupStart = moved.pin ? 0 : ordered.length - group.length;
    // While more cards remain unloaded, the card that would sit below
    // the window's last card is unknown, so a drop cannot go past that
    // last card: there is no neighbor position to place it against.
    const win = potWindow(pot()?.id);
    const moreUnloaded = win !== undefined && win.ids.length < win.total;
    const isWindowTail = groupStart + group.length === ordered.length;
    const groupEnd = Math.max(
      groupStart,
      groupStart + group.length - 1 - (moreUnloaded && isWindowTail ? 1 : 0),
    );
    const clampedIndex = Math.min(Math.max(newIndex, groupStart), groupEnd);
    if (initialIndex === clampedIndex) return;

    // Index of the drop target within its own group, and that group's
    // cards with `moved` removed -- restricting computePosition's
    // neighbors to this same-group list is what keeps the boundary
    // case above from mixing in the other group's positions.
    const indexInGroup = clampedIndex - groupStart;
    const restInGroup = group.filter((card) => card.id !== moved.id);
    // The grid is sorted by descending position (see `cards` above),
    // so the card displayed above has the larger position and the
    // card displayed below has the smaller one -- the opposite of
    // computePosition's (prev, next) argument order, so they're
    // swapped here.
    const position = computePosition(
      restInGroup[indexInGroup]?.position,
      restInGroup[indexInGroup - 1]?.position,
    );

    // The optimistic update and the delayed persist both live in the
    // store (see moveCard in lib/stores/cardsStore.ts).
    moveCard(moved, position);
  };

  useDragEnd(handleDragEnd);

  return (
    <Show when={potWindow(pot()?.id)?.loaded} fallback={<Loading />}>
      <CardGrid>
        <For each={cards()}>
          {(card, index) => (
            <CardItem card={card} index={index()} potSlug={params.slug} />
          )}
        </For>
        {/* Invisible row-spanning marker: loading the next page when
              this scrolls into view is what drives the infinite
              scroll above. */}
        <li
          ref={observeSentinel}
          aria-hidden="true"
          class="card-grid-sentinel"
        />
      </CardGrid>
    </Show>
  );
}
