import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type CachedCard } from "./db";
import { suggestTitles } from "./titleSuggestQuery";

function card(id: string, pod: string, title: string): CachedCard {
  return {
    id,
    pod,
    title: title as CachedCard["title"],
    titleLc: title.toLowerCase().replaceAll(" ", "_"),
    description: [],
    image: "",
    position: 0,
    pin: 0,
    deleted: "",
    created: "",
    updated: "",
  };
}

beforeEach(async () => {
  await db.cards.clear();
});

describe("suggestTitles", () => {
  it("returns titles starting with the prefix, in titleLc order", async () => {
    await db.cards.bulkPut([
      card("1", "p", "Application"),
      card("2", "p", "apple"),
      card("3", "p", "banana"),
    ]);
    expect(await suggestTitles("p", "ap")).toEqual(["apple", "Application"]);
  });

  it("matches the underscore form of a title with spaces", async () => {
    await db.cards.put(card("1", "p", "Foo Bar"));
    expect(await suggestTitles("p", "foo_b")).toEqual(["Foo Bar"]);
  });

  it("returns every title for an empty prefix, up to the limit", async () => {
    await db.cards.bulkPut([
      card("1", "p", "a"),
      card("2", "p", "b"),
      card("3", "p", "c"),
    ]);
    expect(await suggestTitles("p", "", 2)).toEqual(["a", "b"]);
  });

  it("keeps pods apart", async () => {
    await db.cards.put(card("1", "p1", "apple"));
    expect(await suggestTitles("p2", "ap")).toEqual([]);
  });

  it("finds non-ASCII titles", async () => {
    await db.cards.put(card("1", "p", "りんご"));
    expect(await suggestTitles("p", "りん")).toEqual(["りんご"]);
  });
});
