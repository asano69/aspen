// Polyfills window.indexedDB / IDBKeyRange so Dexie can run against a
// real (in-memory) IndexedDB implementation under vitest, matching
// what a browser provides.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CardRecord } from "../models/card";
import { cardsReplica, countCards, queryCardsPage } from "./cardsCollection";

function card(id: string, pot: string, created: string): CardRecord {
  return {
    id,
    title: id as CardRecord["title"],
    titleLc: id,
    description: [],
    image: "",
    pot,
    deleted: "",
    created,
    updated: "",
  };
}

const ids = (cards: CardRecord[]) => cards.map((c) => c.id);

describe("Dexie cards cache", () => {
  it("writes, pages, counts, and deletes cards", async () => {
    await cardsReplica.put([
      card("a", "pot-1", "2026-01-01"),
      card("b", "pot-1", "2026-01-02"),
    ]);

    expect(await countCards("pot-1")).toBe(2);
    // Newest first.
    expect(ids(await queryCardsPage("pot-1", 0, 10))).toEqual(["b", "a"]);

    await cardsReplica.remove("a");
    expect(await countCards("pot-1")).toBe(1);
    expect(ids(await queryCardsPage("pot-1", 0, 10))).toEqual(["b"]);
  });

  it("keeps pots apart", async () => {
    await cardsReplica.put([
      card("x", "pot-2", "2026-01-01"),
      card("y", "pot-3", "2026-01-02"),
    ]);

    expect(ids(await queryCardsPage("pot-2", 0, 10))).toEqual(["x"]);
  });

  it("pages without gaps or duplicates", async () => {
    await cardsReplica.put(
      Array.from({ length: 5 }, (_, i) =>
        card(`c${i}`, "pot-4", `2026-01-0${i + 1}`),
      ),
    );

    const pages = [
      await queryCardsPage("pot-4", 0, 2),
      await queryCardsPage("pot-4", 2, 2),
      await queryCardsPage("pot-4", 4, 2),
    ];
    expect(pages.flatMap(ids)).toEqual(["c4", "c3", "c2", "c1", "c0"]);
  });
});
