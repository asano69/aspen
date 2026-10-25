import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { CardLinkRecord } from "../models/cardLink";
import { titleToLowerKey } from "../models/slugify";
import { db, type CachedCard } from "./db";
import { computeRelated } from "./relatedQuery";

// The fixture is shared with the Go test (internal/serve/link_graph_test.go),
// whose links1Hop and links2Hop are the reference. See that file for the
// fixture's rules.
interface GraphCard {
  title: string;
  pod?: string;
  deleted?: boolean;
  links: string[];
}

interface GraphCase {
  name: string;
  cards: GraphCard[];
  open: string;
  oneHop: string[];
  twoHop: { via: string; title: string }[];
}

// Resolved from the working directory, like extractLinks.test.ts.
const fixture: GraphCase[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "../testdata/link-graph.json"), "utf8"),
);

const DEFAULT_POT = "p1";

function cardRow(id: string, pod: string, title: string): CachedCard {
  return {
    id,
    pod,
    title: title as CachedCard["title"],
    titleLc: titleToLowerKey(title),
    description: [],
    image: "",
    deleted: "",
    created: "",
    updated: "",
  };
}

function linkRow(
  id: string,
  source: string,
  pod: string,
  title: string,
  position: number,
): CardLinkRecord {
  return {
    id,
    source,
    target_pod: pod,
    target_title: title,
    target_titleLc: titleToLowerKey(title),
    position,
    deleted: "",
    created: "",
    updated: "",
  };
}

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.card_links.clear()]);
});

describe("computeRelated: link graph fixture", () => {
  for (const c of fixture) {
    it(c.name, async () => {
      const cards: CachedCard[] = [];
      const links: CardLinkRecord[] = [];
      c.cards.forEach((card, i) => {
        // A replica holds neither a deleted card nor its links.
        if (card.deleted) return;
        const pod = card.pod ?? DEFAULT_POT;
        cards.push(cardRow(`card${i}`, pod, card.title));
        card.links.forEach((target, position) =>
          links.push(
            linkRow(`link${i}-${position}`, `card${i}`, pod, target, position),
          ),
        );
      });
      await db.cards.bulkPut(cards);
      await db.card_links.bulkPut(links);

      const open = cards.find(
        (card) => card.pod === DEFAULT_POT && card.title === c.open,
      );
      const openLinks =
        c.cards.find(
          (card) =>
            !card.deleted &&
            (card.pod ?? DEFAULT_POT) === DEFAULT_POT &&
            card.title === c.open,
        )?.links ?? [];

      const result = await computeRelated({
        pod: DEFAULT_POT,
        selfId: open?.id,
        selfTitleLc: titleToLowerKey(c.open),
        ownTargets: openLinks.map((title) => ({
          title,
          titleLc: titleToLowerKey(title),
        })),
      });

      expect(result.oneHop.map((card) => card.title)).toEqual(c.oneHop);
      expect(
        result.twoHop.map((row) => ({ via: row.via_title, title: row.title })),
      ).toEqual(c.twoHop);
    });
  }
});

describe("computeRelated", () => {
  it("uses ownTargets, not the replica's rows of the open card", async () => {
    // The replica has no link from A: A's live text is the only source.
    await db.cards.bulkPut([cardRow("a", "p", "A"), cardRow("b", "p", "B")]);

    const result = await computeRelated({
      pod: "p",
      selfId: "a",
      selfTitleLc: "a",
      ownTargets: [{ title: "B", titleLc: "b" }],
    });

    expect(result.oneHop.map((card) => card.id)).toEqual(["b"]);
  });

  it("maps a card to the shape the grid draws", async () => {
    await db.cards.bulkPut([
      cardRow("a", "p", "A"),
      { ...cardRow("b", "p", "B"), description: ["line"], image: "i.png" },
    ]);

    const result = await computeRelated({
      pod: "p",
      selfId: "a",
      selfTitleLc: "a",
      ownTargets: [{ title: "B", titleLc: "b" }],
    });

    expect(result.oneHop).toEqual([
      { id: "b", title: "B", description: ["line"], image: "i.png" },
    ]);
  });

  it("ignores a link whose source card is gone from the replica", async () => {
    await db.cards.bulkPut([cardRow("a", "p", "A")]);
    await db.card_links.bulkPut([linkRow("l", "gone", "p", "A", 0)]);

    const result = await computeRelated({
      pod: "p",
      selfId: "a",
      selfTitleLc: "a",
      ownTargets: [],
    });

    expect(result.oneHop).toEqual([]);
  });
});
