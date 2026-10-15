import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CardLinkRecord } from "../models/cardLink";
import { db, type CachedCard } from "./db";
import { computeAlive } from "./linkAliveQuery";

function card(id: string, pot: string, titleLc: string): CachedCard {
  return {
    id,
    pot,
    titleLc,
    title: titleLc as CachedCard["title"],
    description: [],
    image: "",
    position: 0,
    deleted: "",
    created: "",
    updated: "",
  };
}

function link(id: string, pot: string, titleLc: string): CardLinkRecord {
  return {
    id,
    source: `src-${id}`,
    target_pot: pot,
    target_title: titleLc,
    target_titleLc: titleLc,
    position: 0,
    deleted: "",
    created: "",
    updated: "",
  };
}

describe("computeAlive", () => {
  it("is alive when the target card exists", async () => {
    await db.cards.put(card("c1", "pot-a", "foo"));
    expect(await computeAlive("pot-a", "foo")).toBe(true);
  });

  it("is dead when only one card links to a missing target", async () => {
    await db.card_links.put(link("l1", "pot-b", "ghost"));
    expect(await computeAlive("pot-b", "ghost")).toBe(false);
  });

  it("is alive when two cards link to a missing target", async () => {
    await db.card_links.bulkPut([
      link("l2", "pot-c", "ghost"),
      link("l3", "pot-c", "ghost"),
    ]);
    expect(await computeAlive("pot-c", "ghost")).toBe(true);
  });

  it("keeps pots apart", async () => {
    await db.cards.put(card("c2", "pot-d", "foo"));
    expect(await computeAlive("pot-e", "foo")).toBe(false);
  });
});
