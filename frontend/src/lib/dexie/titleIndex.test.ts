import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CardRecord } from "../models/card";
import { cardsReplica } from "./cardsCollection";
import { db } from "./db";
import { releaseTitleIndex, suggestTitles } from "./titleIndex";

function card(id: string, pot: string, title: string): CardRecord {
  return {
    id,
    title: title as CardRecord["title"],
    titleLc: title.toLowerCase().replaceAll(" ", "_"),
    description: [],
    image: "",
    pot,
    position: 0,
    pin: false,
    deleted: "",
    created: "",
    updated: "",
  };
}

beforeEach(async () => {
  await db.cards.clear();
  for (const pot of ["p", "p2"]) releaseTitleIndex(pot);
});

describe("suggestTitles", () => {
  it("reads the titles stored in the replica", async () => {
    await cardsReplica.put([
      card("1", "p", "Application"),
      card("2", "p", "apple"),
      card("3", "p", "banana"),
    ]);
    expect(await suggestTitles("p", "ppl")).toEqual(["apple", "Application"]);
  });

  it("finds non-ASCII titles by any part", async () => {
    await cardsReplica.put([card("1", "p", "日本語入力")]);
    expect(await suggestTitles("p", "語入")).toEqual(["日本語入力"]);
  });

  it("keeps pots apart", async () => {
    await cardsReplica.put([card("1", "p", "apple")]);
    expect(await suggestTitles("p2", "ap")).toEqual([]);
  });

  it("follows later writes to the replica", async () => {
    await cardsReplica.put([card("1", "p", "apple")]);
    expect(await suggestTitles("p", "app")).toEqual(["apple"]);

    await cardsReplica.put([
      card("1", "p", "banana"),
      card("2", "p", "apricot"),
    ]);
    expect(await suggestTitles("p", "app")).toEqual([]);
    expect(await suggestTitles("p", "ap")).toEqual(["apricot"]);

    await cardsReplica.remove("2");
    expect(await suggestTitles("p", "ap")).toEqual([]);
  });
});
