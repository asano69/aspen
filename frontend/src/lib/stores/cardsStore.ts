/* eslint-disable solid/reactivity --
   These are imperative store functions called from event handlers and
   async code. Reading the store there is deliberately untracked. */
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  deleteCard,
  fetchCardBySlug,
  moveCards,
  updateCard,
} from "../api/cardApi";
import { subscribeToCollection, type CollectionEvent } from "../api/realtime";
import type { CardRecord, CardSort } from "../models/card";
import { withCardsFlip, registerCardElement } from "../cardFlip";
import {
  cardsReplica,
  countCards,
  queryCardsPage,
} from "../dexie/cardsCollection";
import { syncReplica } from "../dexie/replica";
import { refreshLinkAlive } from "./linkAliveStore";

// Re-exported so CardItem only needs to import from this module
// (cardFlip.ts's registration map is an implementation detail of how
// cards get animated, not something callers need to know about).
export { registerCardElement };

// How many cards one page request loads.
const PAGE_SIZE = 100;

// Cache of the cards the UI currently needs: every card of a loaded
// pot window (see below) plus any card opened by URL. A pot can hold
// ~100k cards, so this is deliberately NOT the whole collection.
// watchCards() keeps these entries live via the shared cards channel;
// events for cards not held here are ignored.
const [cardsById, setCardsById] = createStore<Record<string, CardRecord>>({});

export { cardsById };

const SORT_KEY = "cardSort";

// Falls back to "created" for a missing or unknown stored value.
function readStoredSort(): CardSort {
  return localStorage.getItem(SORT_KEY) === "updated" ? "updated" : "created";
}

// How every card list is ordered. Reactive. Change it with setCardSort. The
// choice is kept in localStorage, so it survives a reload.
const [cardSort, setCardSortSignal] = createSignal<CardSort>(readStoredSort());

export { cardSort };

// The part of one pot's card list loaded so far. `ids` are in load
// order only -- callers sort what they display (see CardList), since a
// realtime or local change can reorder cards inside the window.
export interface PotWindow {
  ids: string[];
  // Number of cards in the pot, counted from this pot's SignalDB
  // cache (see lib/signaldb/cardsCollection.ts's countCards) -- kept
  // fully up to date by the checkpoint pull protocol, independent of
  // how many pages have actually been loaded into `ids`.
  total: number;
  // Whether the first page request has settled, successfully or not.
  loaded: boolean;
  loading: boolean;
}

const [windows, setWindows] = createStore<Record<string, PotWindow>>({});

// Reactive when called inside a tracking scope.
export function potWindow(potId: string | undefined): PotWindow | undefined {
  return potId ? windows[potId] : undefined;
}

// Merges a batch of cards into the store. Existing entries for the same
// id are overwritten, so a stale cached copy never wins over a fresh
// fetch. By default this is wrapped in withCardsFlip so a reorder (e.g.
// another user's drag) animates every affected card into its new grid
// slot instead of snapping there instantly.
//
// `skipFlip` opts out of that animation, for merges that only load cards
// (a page load, a card opened by URL) instead of reordering them.
//
// Every merge also writes through into the IndexedDB replica (see
// lib/dexie/cardsCollection.ts), fire-and-forget: that cache is what
// loadNextCardsPage pages through locally once a pot has synced (see
// queryCardsPage/countCards there), so keeping it current here is what
// keeps local pagination in sync with whatever the Solid store above just
// applied.
export function mergeCards(
  records: CardRecord[],
  options?: { skipFlip?: boolean },
) {
  const apply = () => {
    setCardsById(
      produce((store) => {
        for (const record of records) {
          store[record.id] = record;
        }
      }),
    );
  };

  if (options?.skipFlip) {
    apply();
  } else {
    withCardsFlip(apply);
  }

  void cardsReplica.put(records);
}

// Resolves once potId's SignalDB cache has completed its checkpoint
// sync for the current pot-open session. A second concurrent call
// (e.g. loadNextCardsPage's initial call racing an
// IntersectionObserver firing immediately) resolves against this same
// in-flight promise instead of starting a duplicate pull. Cleared in
// releasePot, so reopening the pot starts a fresh sync.
const potSyncPromises = new Map<string, Promise<void>>();

// Exported so PotLayout can sync a pot as soon as it is opened, whichever
// child route (card list or a card opened by URL) is shown first.
export function ensurePotSynced(potId: string): Promise<void> {
  let promise = potSyncPromises.get(potId);
  if (!promise) {
    promise = syncPotReplica(potId);
    potSyncPromises.set(potId, promise);
  }
  return promise;
}

// Brings potId's SignalDB cache fully up to date, resuming from
// wherever this pot's last pull left off. Awaited by loadNextCardsPage
// (through ensurePotSynced) before the first page is read from the
// cache, so the grid never shows a stale or partial slice of it. A
// failure is only logged; the next pot open (or a future periodic
// retry) tries again from the same checkpoint.
async function syncPotReplica(potId: string): Promise<void> {
  try {
    await syncReplica(cardsReplica, potId);
  } catch (err) {
    console.error("[cards] failed to sync replica:", err);
  }
}

// Loads the next page of a pot's card list (the first page when nothing
// is loaded yet) and appends it to that pot's window. A no-op while a
// request is in flight or once every card is loaded. A failure is only
// logged and leaves the window as it was.
//
// Stage 2 of docs/signaldb-offline-sync.md: pages are read from
// potId's local SignalDB cache (see queryCardsPage/countCards in
// lib/signaldb/cardsCollection.ts), not the server, once the cache has
// finished its checkpoint sync (see ensurePotSynced) -- so opening a
// pot waits for that sync before anything is shown, rather than
// painting a possibly-stale cache first.
//
// The page requested is the one containing the window's end, not "the
// last page + 1": after a card inside the window is deleted, the
// cache's list shifts up by one, and asking for the following page
// would skip the card that slid into the gap. The overlap this causes
// is harmless because ids already in the window are ignored.
export async function loadNextCardsPage(potId: string): Promise<void> {
  if (!windows[potId]) {
    setWindows(potId, { ids: [], total: 0, loaded: false, loading: true });
    await ensurePotSynced(potId);
    if (!windows[potId]) return; // pot was released while syncing
    setWindows(potId, "loading", false);
  }
  const win = windows[potId];
  if (win.loading || (win.loaded && win.ids.length >= win.total)) return;

  setWindows(potId, "loading", true);
  const sort = cardSort();
  let items: CardRecord[] = [];
  try {
    items = await queryCardsPage(potId, win.ids.length, PAGE_SIZE, sort);
  } catch (err) {
    console.error("[cards] failed to load cards page:", err);
  }

  // The user may have left the pot while the query was in flight.
  if (!windows[potId]) return;
  // The order changed meanwhile: setCardSort rebuilt the window, and this
  // page belongs to the old order.
  if (sort !== cardSort()) {
    setWindows(potId, "loading", false);
    return;
  }

  mergeCards(items, { skipFlip: true });
  let added = 0;
  setWindows(
    potId,
    produce((w) => {
      const seen = new Set(w.ids);
      for (const card of items) {
        if (!seen.has(card.id)) {
          w.ids.push(card.id);
          added++;
        }
      }
    }),
  );

  // A page that adds nothing new means the cache's list no longer
  // lines up with the window (e.g. cards were reordered elsewhere).
  // Treat the window as complete so scrolling cannot request the same
  // page forever; a reload fixes it.
  const total =
    added === 0 ? windows[potId].ids.length : await countCards(potId);
  if (!windows[potId]) return; // pot was released while counting
  setWindows(potId, { total, loaded: true, loading: false });
}

// Fetches one card by its URL slug straight from the server and puts
// it into the store, so realtime updates keep the open card live.
// Resolves to undefined when the pot has no such card.
export async function openCardBySlug(
  potId: string,
  slug: string,
): Promise<CardRecord | undefined> {
  const record = await fetchCardBySlug(potId, slug);
  if (record) mergeCards([record], { skipFlip: true });
  return record;
}

// Forgets a pot's window and every card of that pot the store holds
// (window cards and any card opened by URL), so the store only holds
// what the user is looking at. Called when the user leaves the pot
// (see PotLayout). The pot's IndexedDB cache itself is left alone
// (see forgetCache), so it's still there to hydrate from next visit.
export function releasePot(potId: string) {
  setWindows(
    produce((all) => {
      delete all[potId];
    }),
  );
  setCardsById(
    produce((store) => {
      for (const id of Object.keys(store)) {
        if (store[id].pot === potId) delete store[id];
      }
    }),
  );
  potSyncPromises.delete(potId);
}

// Removes a card from the store and, when its pot has a loaded window,
// from that window too. The count only drops if the card was in the
// window, so a repeated delete cannot double-count.
function dropCard(id: string, potId: string | undefined) {
  if (potId && windows[potId]) {
    setWindows(
      potId,
      produce((w) => {
        const index = w.ids.indexOf(id);
        if (index >= 0) {
          w.ids.splice(index, 1);
          w.total -= 1;
        }
      }),
    );
  }
  setCardsById(
    produce((store) => {
      delete store[id];
    }),
  );
  void cardsReplica.remove(id);
}

// A created card only matters here if its pot's window is loaded;
// otherwise the next page load will bring it in from the server.
function addCreatedCard(record: CardRecord) {
  if (!windows[record.pot]?.loaded) return;
  setCardsById(record.id, record);
  void cardsReplica.put([record]);
  setWindows(
    record.pot,
    produce((w) => {
      if (!w.ids.includes(record.id)) {
        w.ids.push(record.id);
        w.total += 1;
      }
    }),
  );
}

// Under the "updated" sort an edited card moves to the top of the list, so
// one the window does not hold yet belongs in it. The card count does not
// change: the card was already counted, it just was not loaded.
function bringIntoWindow(record: CardRecord) {
  if (!windows[record.pot]?.loaded) return;
  setCardsById(record.id, record);
  setWindows(
    record.pot,
    produce((w) => {
      if (!w.ids.includes(record.id)) w.ids.push(record.id);
    }),
  );
}

// Applies one realtime event to the store. Wrapped in withCardsFlip so
// a position change from another user's drag animates smoothly into
// place instead of every card instantly snapping to its new grid slot.
function handleCardEvent(e: CollectionEvent<CardRecord>) {
  withCardsFlip(() => {
    // A soft-deleted card leaves the store like a removed one, whichever
    // action reports it (deleting sends an "update" carrying `deleted`).
    if (e.action === "delete" || e.record.deleted) {
      dropCard(e.record.id, e.record.pot);
    } else if (e.action === "create") {
      addCreatedCard(e.record);
    } else {
      // The store ignores a card it does not hold (except under the
      // "updated" sort, see bringIntoWindow), so it never grows beyond what
      // the UI actually loaded. The replica is written regardless: the card
      // may sit on a page of the open pot that is not loaded yet, and that
      // page is read from the replica.
      if (cardsById[e.record.id]) setCardsById(e.record.id, e.record);
      else if (cardSort() === "updated") bringIntoWindow(e.record);
      void cardsReplica.put([e.record]);
    }
  });
  // A created, renamed or deleted card changes which links are alive.
  refreshLinkAlive();
}

// Reloads the part of a pot's card list the window currently covers, for
// when realtime events may have been missed and could not be replayed (see
// subscribeToCards). Rather than re-fetching pages from the server, this
// pulls only what changed since the pot's stored checkpoint (see
// syncReplica in lib/dexie/replica.ts), applies that diff to the replica, and
// re-reads the window from it -- the same source loadNextCardsPage already
// reads from (see queryCardsPage/countCards in
// lib/signaldb/cardsCollection.ts). The window is re-read in one query
// instead of paging through it, since the replica already holds every
// card of the pot locally.
//
// A page load still in flight while this runs may append a page fetched
// before the resync; ids already in the window are ignored, so at worst
// that page is slightly stale.
export async function resyncPot(potId: string): Promise<void> {
  const win = windows[potId];
  // Nothing loaded yet: the first page load starts a fresh sync anyway.
  if (!win?.loaded) return;
  const windowSize = win.ids.length;

  try {
    await syncReplica(cardsReplica, potId);
  } catch (err) {
    console.error("[cards] failed to resync pot:", err);
    return;
  }

  // The user may have left the pot while the pull was in flight.
  if (!windows[potId]) return;

  let items: CardRecord[];
  let total: number;
  try {
    items = await queryCardsPage(potId, 0, windowSize, cardSort());
    total = await countCards(potId);
  } catch (err) {
    console.error("[cards] failed to reload cards after resync:", err);
    return;
  }

  // The user may have left the pot while the reload was in flight.
  if (!windows[potId]) return;

  replaceWindow(potId, items, total);
  refreshLinkAlive();
}

// Replaces a pot's window with `items` and its card count with `total`.
function replaceWindow(potId: string, items: CardRecord[], total: number) {
  const fresh = new Set(items.map((card) => card.id));
  const vanished = windows[potId].ids.filter((id) => !fresh.has(id));
  mergeCards(items, { skipFlip: true });
  setWindows(
    potId,
    produce((w) => {
      w.ids = items.map((card) => card.id);
      w.total = total;
    }),
  );
  // A card that fell out of the window (or was actually deleted --
  // a pull already handled that in the replica itself)
  // is no longer displayed, so it has no reason to still live in the UI
  // store. Nothing here touches the replica: a card that was
  // merely reordered out of the window is still a live card there.
  setCardsById(
    produce((store) => {
      for (const id of vanished) delete store[id];
    }),
  );
}

// Rebuilds a pot's window from the replica's first page in the current
// order. The ids of the old window follow the previous order, so they cannot
// be reused.
async function resortPot(potId: string): Promise<void> {
  if (!windows[potId]?.loaded) return;
  const sort = cardSort();
  let items: CardRecord[];
  try {
    items = await queryCardsPage(potId, 0, PAGE_SIZE, sort);
  } catch (err) {
    console.error("[cards] failed to reorder cards:", err);
    return;
  }
  // The user may have left the pot, or switched the order again.
  if (!windows[potId] || sort !== cardSort()) return;
  replaceWindow(potId, items, windows[potId].total);
}

// Switches how the card lists are ordered. Every loaded window is rebuilt
// in the new order.
export function setCardSort(sort: CardSort): void {
  if (sort === cardSort()) return;
  localStorage.setItem(SORT_KEY, sort);
  setCardSortSignal(sort);
  for (const potId of Object.keys(windows)) void resortPot(potId);
}

// Keeps every loaded pot window live through the shared cards channel and
// returns a function that stops watching. Called once by AppShell for as
// long as the app is open. A gap in the channel's history resyncs every
// window that is currently loaded.
export function watchCards(): () => void {
  return subscribeToCollection<CardRecord>("cards", handleCardEvent, () => {
    for (const potId of Object.keys(windows)) void resyncPot(potId);
  });
}

// Saves a card's datalog query text. Rejects on failure, leaving the
// store unchanged.
export async function setCardQuery(id: string, query: string): Promise<void> {
  mergeCards([await updateCard(id, { query })]);
}

// Moves cards to another pot. The server deletes each one here and creates a
// copy in the target pot, so they leave the store right away, like a deleted
// card, instead of waiting for the realtime echo. The copies are not added:
// the target pot loads them when it is opened.
export async function moveCardsToPot(
  ids: string[],
  potId: string,
): Promise<void> {
  await moveCards(ids, potId);
  withCardsFlip(() => {
    for (const id of ids) dropCard(id, cardsById[id]?.pot);
  });
}

// Soft-deletes a card and drops it from the store right away, instead of
// waiting for the realtime echo of the update.
export async function removeCard(id: string): Promise<void> {
  const potId = cardsById[id]?.pot;
  await deleteCard(id);
  withCardsFlip(() => dropCard(id, potId));
}
