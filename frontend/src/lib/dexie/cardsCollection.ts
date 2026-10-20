import Dexie from "dexie";
import type { CardRecord, CardSort } from "../models/card";
import { db } from "./db";
import type { Replica } from "./replica";
import { indexCards, unindexCard } from "./titleIndex";

// Cards-specific reads and writes on the IndexedDB replica (see db.ts),
// which is kept fully up to date via the checkpoint pull protocol (see
// replica.ts and cardsStore.ts's ensurePotSynced/syncPotReplica). Once a pot
// has synced, cardsStore.ts's loadNextCardsPage pages through this cache
// locally (see queryCardsPage/countCards below) instead of the server.
// The Solid store in cardsStore.ts remains the reactive source the UI
// actually renders from -- this module is written to and read from only
// inside cardsStore.ts's own functions, never bound directly to the UI.
//
// This module deliberately does not use Dexie's liveQuery(): every read here
// is a one-shot query, and cardsStore.ts is responsible for pushing results
// into the Solid store itself (see mergeCards there).

// cards from potId's cache, starting after `skip`
// cards, newest first by `sort` (creation or edit time). The order comes
// straight from the [pot+<sort>] index, so a page request costs
// O(skip + limit).
export function queryCardsPage(
  potId: string,
  skip: number,
  limit: number,
  sort: CardSort = "created",
): Promise<CardRecord[]> {
  return db.cards
    .where(`[pot+${sort}]`)
    .between([potId, Dexie.minKey], [potId, Dexie.maxKey])
    .reverse()
    .offset(skip)
    .limit(limit)
    .toArray();
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
