import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CardLinkRecord } from "../models/cardLink";
import { db, type CachedCard } from "./db";
import { computeAlive } from "./linkAliveQuery";

function card(id: string, pod: string, titleLc: string): CachedCard {
  return {
    id,
    pod,
    titleLc,
    title: titleLc as CachedCard["title"],
    description: [],
    image: "",
    deleted: "",
    created: "",
    updated: "",
  };
}

function link(id: string, pod: string, titleLc: string): CardLinkRecord {
  return {
    id,
    source: `src-${id}`,
    target_pod: pod,
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
    await db.cards.put(card("c1", "pod-a", "foo"));
    expect(await computeAlive("pod-a", "foo")).toBe(true);
  });

  it("is dead when only one card links to a missing target", async () => {
    await db.card_links.put(link("l1", "pod-b", "ghost"));
    expect(await computeAlive("pod-b", "ghost")).toBe(false);
  });

  it("is alive when two cards link to a missing target", async () => {
    await db.card_links.bulkPut([
      link("l2", "pod-c", "ghost"),
      link("l3", "pod-c", "ghost"),
    ]);
    expect(await computeAlive("pod-c", "ghost")).toBe(true);
  });

  it("keeps pods apart", async () => {
    await db.cards.put(card("c2", "pod-d", "foo"));
    expect(await computeAlive("pod-e", "foo")).toBe(false);
  });
});
