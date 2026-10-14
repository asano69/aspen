// Polyfills window.indexedDB / IDBKeyRange so Dexie can run against a
// real (in-memory) IndexedDB implementation under vitest, matching
// what a browser provides.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CardRecord } from "../models/card";
import { cardsReplica, countCards, queryCardsPage } from "./cardsCollection";

function card(
  id: string,
  pot: string,
  position: number,
  pin = 0,
): CardRecord {
  return {
    id,
    title: id as CardRecord["title"],
    titleLc: id,
    description: [],
    image: "",
    pot,
    position,
    pin,
    deleted: "",
    created: "",
    updated: "",
  };
}

describe("Dexie cards cache", () => {
  it("writes, pages, counts, and deletes cards", async () => {
    await cardsReplica.put([
      card("a", "pot-1", 1000),
      card("b", "pot-1", 2000),
    ]);

    expect(await countCards("pot-1")).toBe(2);
    // Descending position -- "b" (2000) sorts before "a" (1000).
    expect((await queryCardsPage("pot-1", 0, 10)).map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);

    await cardsReplica.remove("a");
    expect(await countCards("pot-1")).toBe(1);
    expect((await queryCardsPage("pot-1", 0, 10)).map((c) => c.id)).toEqual([
      "b",
    ]);
  });

  it("sorts pinned cards before unpinned ones regardless of position", async () => {
    await cardsReplica.put([
      card("x", "pot-2", 5000, 0),
      card("y", "pot-2", 100, 1),
    ]);

    expect((await queryCardsPage("pot-2", 0, 10)).map((c) => c.id)).toEqual([
      "y",
      "x",
    ]);
  });

  it("sorts pinned cards by descending pin, not by position", async () => {
    await cardsReplica.put([
      card("lo", "pot-5", 9000, 1),
      card("hi", "pot-5", 1, 2),
    ]);

    expect((await queryCardsPage("pot-5", 0, 10)).map((c) => c.id)).toEqual([
      "hi",
      "lo",
    ]);
  });

  it("pages across the pinned/unpinned index-range boundary without gaps or duplicates", async () => {
    // 3 pinned cards (pins 1-3) and 5 unpinned cards (positions 0-4) in the
    // same pot -- large enough that page boundaries fall both inside the
    // pinned range and inside the unpinned range, exercising
    // queryCardsPage's split for both of its branches (skip < pinnedCount
    // and skip >= pinnedCount).
    const pinned = Array.from({ length: 3 }, (_, i) =>
      card(`pin-${i}`, "pot-3", 0, i + 1),
    );
    const unpinned = Array.from({ length: 5 }, (_, i) =>
      card(`unp-${i}`, "pot-3", i, 0),
    );
    await cardsReplica.put([...pinned, ...unpinned]);

    const pageSize = 3;
    const pages: string[][] = [];
    for (let skip = 0; skip < 8; skip += pageSize) {
      const page = await queryCardsPage("pot-3", skip, pageSize);
      pages.push(page.map((c) => c.id));
    }

    const allIds = pages.flat();
    expect(allIds).toHaveLength(8);
    expect(new Set(allIds).size).toBe(8); // no duplicates across pages
    expect(allIds).toEqual([
      "pin-2",
      "pin-1",
      "pin-0",
      "unp-4",
      "unp-3",
      "unp-2",
      "unp-1",
      "unp-0",
    ]);
  });

  it("keeps every pinned card ahead of every unpinned card across a page split", async () => {
    const pinned = [card("p1", "pot-4", 0, 1), card("p2", "pot-4", 0, 2)];
    const unpinned = [card("u1", "pot-4", 100, 0), card("u2", "pot-4", 200, 0)];
    await cardsReplica.put([...pinned, ...unpinned]);

    // A page starting inside the pinned range and ending inside the
    // unpinned one -- the exact split queryCardsPage must get right.
    const page = await queryCardsPage("pot-4", 1, 2);
    expect(page.map((c) => c.id)).toEqual(["p1", "u2"]);
  });
});
