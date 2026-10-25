// Polyfills window.indexedDB / IDBKeyRange so Dexie can run against a
// real (in-memory) IndexedDB implementation under vitest, matching
// what a browser provides.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CardRecord } from "../models/card";
import { cardsReplica, countCards, queryCardsPage } from "./cardsCollection";

function card(id: string, pod: string, created: string): CardRecord {
  return {
    id,
    title: id as CardRecord["title"],
    titleLc: id,
    description: [],
    image: "",
    pod,
    deleted: "",
    created,
    updated: "",
  };
}

const ids = (cards: CardRecord[]) => cards.map((c) => c.id);

describe("Dexie cards cache", () => {
  it("writes, pages, counts, and deletes cards", async () => {
    await cardsReplica.put([
      card("a", "pod-1", "2026-01-01"),
      card("b", "pod-1", "2026-01-02"),
    ]);

    expect(await countCards("pod-1")).toBe(2);
    // Newest first.
    expect(ids(await queryCardsPage("pod-1", 0, 10))).toEqual(["b", "a"]);

    await cardsReplica.remove("a");
    expect(await countCards("pod-1")).toBe(1);
    expect(ids(await queryCardsPage("pod-1", 0, 10))).toEqual(["b"]);
  });

  it("orders by edit time when asked to", async () => {
    await cardsReplica.put([
      { ...card("u1", "pod-5", "2026-01-01"), updated: "2026-03-01" },
      { ...card("u2", "pod-5", "2026-01-02"), updated: "2026-02-01" },
    ]);

    expect(ids(await queryCardsPage("pod-5", 0, 10, "created"))).toEqual([
      "u2",
      "u1",
    ]);
    expect(ids(await queryCardsPage("pod-5", 0, 10, "updated"))).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("keeps pods apart", async () => {
    await cardsReplica.put([
      card("x", "pod-2", "2026-01-01"),
      card("y", "pod-3", "2026-01-02"),
    ]);

    expect(ids(await queryCardsPage("pod-2", 0, 10))).toEqual(["x"]);
  });

  it("pages without gaps or duplicates", async () => {
    await cardsReplica.put(
      Array.from({ length: 5 }, (_, i) =>
        card(`c${i}`, "pod-4", `2026-01-0${i + 1}`),
      ),
    );

    const pages = [
      await queryCardsPage("pod-4", 0, 2),
      await queryCardsPage("pod-4", 2, 2),
      await queryCardsPage("pod-4", 4, 2),
    ];
    expect(pages.flatMap(ids)).toEqual(["c4", "c3", "c2", "c1", "c0"]);
  });
});
