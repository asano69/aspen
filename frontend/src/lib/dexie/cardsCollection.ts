import Dexie from "dexie";
import type { CardRecord } from "../models/card";
import { db } from "./db";
import type { Replica } from "./replica";
import { indexCards, unindexCard } from "./titleIndex";

// Cards-specific reads and writes on the IndexedDB replica (see db.ts),
// which is kept fully up to date via the checkpoint pull protocol (see
// replica.ts and cardsStore.ts's ensurePotSynced/syncPotReplica). Once a pot
// has synced, cardsStore.ts's loadNextCardsPage pages through this cache
// locally (see queryCardsPage/countCards below) instead of the server, so
// windowed pagination for large pots stays fast without re-fetching
// everything on scroll. The Solid store in cardsStore.ts remains the
// reactive source the UI actually renders from -- this module is written to
// and read from only inside cardsStore.ts's own functions, never bound
// directly to the UI.
//
// This module deliberately does not use Dexie's liveQuery(): every read here
// is a one-shot query, and cardsStore.ts is responsible for pushing results
// into the Solid store itself (see mergeCards there).

// Returns the cards of potId that are pinned (pin > 0) or unpinned (pin = 0),
// read straight from the [pot+pin+position] compound index instead of
// scanning the whole table. Dexie.minKey/Dexie.maxKey open the last index
// field on both ends, so the range covers every stored position. For the
// pinned range the lower bound is exclusive, which leaves out pin = 0.
function pinRange(potId: string, pinned: boolean) {
  const cards = db.cards.where("[pot+pin+position]");
  return pinned
    ? cards.between(
        [potId, 0, Dexie.maxKey],
        [potId, Infinity, Dexie.maxKey],
        false,
        true,
      )
    : cards.between([potId, 0, Dexie.minKey], [potId, 0, Dexie.maxKey]);
}

// Reads one range in the order the grid displays it: .reverse() flips the
// index's ascending order into descending pin (pinned cards) or descending
// position (unpinned cards, which all have pin = 0).
function queryRange(
  potId: string,
  pinned: boolean,
  offset: number,
  limit: number,
): Promise<CardRecord[]> {
  if (limit <= 0) return Promise.resolve([]);
  return pinRange(potId, pinned)
    .reverse()
    .offset(offset)
    .limit(limit)
    .toArray();
}

// Returns up to `limit` cards from potId's cache, starting after `skip`
// cards, sorted the same way the UI grid displays them (pinned cards first by
// descending pin, then unpinned cards by descending position). Used by
// cardsStore.ts's loadNextCardsPage to page through the cache locally instead
// of over the network.
//
// Pinned and unpinned cards live on separate ranges of the
// [pot+pin+position] compound index (see pinRange above). A requested page is
// split across those two ranges instead of sorting the pot's full row set in
// JS: the pinned range's count decides how much of `skip`/`limit` falls on
// each side, then each side is read with its own offset/limit straight from
// the index. This makes a page request O(skip + limit) instead of
// O(M log M) in the pot's total row count M.
export async function queryCardsPage(
  potId: string,
  skip: number,
  limit: number,
): Promise<CardRecord[]> {
  const pinnedCount = await pinRange(potId, true).count();

  if (skip >= pinnedCount) {
    return queryRange(potId, false, skip - pinnedCount, limit);
  }

  const pinned = await queryRange(potId, true, skip, limit);
  const unpinned = await queryRange(potId, false, 0, limit - pinned.length);
  return [...pinned, ...unpinned];
}

// Total number of cards currently cached for potId.
export async function countCards(potId: string): Promise<number> {
  return db.cards.where("pot").equals(potId).count();
}

// The write side of the cards replica. Used by the generic sync code (see
// replica.ts) and by cardsStore.ts's write-through of realtime events and
// local changes. Fire-and-forget from the store's point of view -- a failure
// here must never block whoever called this.
// Every write also updates the title index (see titleIndex.ts), which is why
// all writes must go through here.
export const cardsReplica: Replica<CardRecord> = {
  name: "cards",
  put: async (records) => {
    await db.cards.bulkPut(records);
    indexCards(records);
  },
  remove: async (id) => {
    await db.cards.delete(id);
    unindexCard(id);
  },
};
