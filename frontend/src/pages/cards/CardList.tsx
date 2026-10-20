import {
  createEffect,
  createMemo,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { useParams } from "@solidjs/router";

import Loading from "@/components/Loading";
import CardItem from "./CardItem";
import CardGrid from "./CardGrid";
import {
  cardSort,
  cardsById,
  loadNextCardsPage,
  moveCardsToPot,
  potWindow,
} from "@/lib/stores/cardsStore";
import { compareCards } from "@/lib/models/card";
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

  // Newest card first by the chosen timestamp (see compareCards, which
  // orders like the replica's [pot+<sort>] index). Only the loaded window is
  // sorted, and the store keeps it live through realtime
  // create/update/delete events.
  const cards = createMemo(() =>
    (potWindow(pot()?.id)?.ids ?? [])
      .map((id) => cardsById[id])
      .filter((card) => card !== undefined)
      .sort(compareCards(cardSort())),
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

  // A card dropped on a pot of the sidebar (see SidebarPotList's droppable)
  // is moved there. Moving several cards later only needs more ids here.
  // Reordering inside the grid is not implemented yet.
  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (source?.type !== "card") return;

    const destPot = target?.data?.potId;
    if (destPot && destPot !== pot()?.id) {
      void moveToPot([String(source.id)], destPot);
    }
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
