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
  movePinnedCard,
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

  // Pinned cards come first, by descending pin (an unpinned card has pin 0,
  // so it falls behind them). Unpinned cards follow by descending position
  // (see lib/position.ts): new cards get the highest position, so the newest
  // card is first. id is the final tie-breaker. Only the loaded window is
  // sorted, and the store keeps it live through realtime create/update/delete
  // events.
  const cards = createMemo(() =>
    (potWindow(pot()?.id)?.ids ?? [])
      .map((id) => cardsById[id])
      .filter((card) => card !== undefined)
      .sort(
        (a, b) =>
          b.pin - a.pin ||
          b.position - a.position ||
          a.id.localeCompare(b.id),
      ),
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

  // Persists a drag-to-reorder drop. Only a pinned card can be reordered, and
  // only its own pin changes (see lib/position.ts), computed from whichever
  // two pinned cards now sit on either side of it.
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

    // Pinned cards sort first, so an index into the pinned cards is also an
    // index into `cards()`.
    const ordered = cards();
    const pinned = ordered.filter((card) => card.pin > 0);
    const moved = ordered[source.initialIndex];
    if (!moved || moved.pin <= 0) return;

    // A pinned card cannot be dropped among the unpinned ones.
    const newIndex = Math.min(source.index, pinned.length - 1);
    if (source.initialIndex === newIndex) return;

    // The grid is sorted by descending pin, so the card displayed above has
    // the larger pin and the card displayed below has the smaller one -- the
    // opposite of computePosition's (prev, next) argument order, so they're
    // swapped here.
    const rest = pinned.filter((card) => card.id !== moved.id);
    const pin = computePosition(rest[newIndex]?.pin, rest[newIndex - 1]?.pin);

    // The optimistic update and the delayed persist both live in the
    // store (see movePinnedCard in lib/stores/cardsStore.ts).
    movePinnedCard(moved, pin);
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
