import "fake-indexeddb/auto";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRelatedCards } from "../api/cardApi";
import { db } from "../dexie/db";
import type { CardLinkRecord } from "../models/cardLink";
import type { CardRecord } from "../models/card";
import {
  clearQuery,
  closeOwnLinks,
  closeRelated,
  createOwnLinks,
  openRelated,
  queryCardsOf,
  setOwnLinks,
} from "./relatedStore";

vi.mock("../api/cardApi", () => ({ fetchRelatedCards: vi.fn() }));

function card(id: string): CardRecord {
  return { id, title: id } as CardRecord;
}

function link(id: string, source: string, titleLc: string): CardLinkRecord {
  return {
    id,
    source,
    target_pod: "p",
    target_title: titleLc,
    target_titleLc: titleLc,
    position: 0,
    deleted: "",
    created: "",
    updated: "",
  };
}

beforeEach(async () => {
  closeRelated();
  vi.mocked(fetchRelatedCards).mockReset();
  await db.card_links.clear();
});

describe("openRelated", () => {
  it("stores the matched cards", async () => {
    vi.mocked(fetchRelatedCards).mockResolvedValueOnce([card("a")]);
    await openRelated("c1");
    expect(queryCardsOf("c1").map((c) => c.id)).toEqual(["a"]);
  });

  it("drops a stale response that arrives after a newer load", async () => {
    let resolveFirst!: (cards: CardRecord[]) => void;
    vi.mocked(fetchRelatedCards)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([card("b")]);

    const first = openRelated("c1");
    await openRelated("c2");
    resolveFirst([card("a")]);
    await first;

    expect(queryCardsOf("c2").map((c) => c.id)).toEqual(["b"]);
  });

  it("empties on close and ignores a load still in flight", async () => {
    let resolve!: (cards: CardRecord[]) => void;
    vi.mocked(fetchRelatedCards).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const loading = openRelated("c1");
    closeRelated();
    resolve([card("a")]);
    await loading;

    expect(queryCardsOf("c1")).toEqual([]);
  });

  it("keeps an array when the response has no cards", async () => {
    vi.mocked(fetchRelatedCards).mockResolvedValueOnce(
      undefined as unknown as [],
    );
    await openRelated("c1");
    expect(queryCardsOf("c1")).toEqual([]);
  });

  it("logs a failure and shows no cards", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchRelatedCards).mockRejectedValueOnce(new Error("offline"));
    await openRelated("c1");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(queryCardsOf("c1")).toEqual([]);
  });

  it("never returns the query cards of another card", async () => {
    // Regression test: the result of the card that was open before must not
    // show up under a draft or under the next card.
    vi.mocked(fetchRelatedCards).mockResolvedValueOnce([card("a")]);
    await openRelated("c1");

    expect(queryCardsOf(undefined)).toEqual([]);
    expect(queryCardsOf("c2")).toEqual([]);
  });

  it("clears only the owner's result, so a late cleanup cannot cancel the next load", async () => {
    let resolve!: (cards: CardRecord[]) => void;
    vi.mocked(fetchRelatedCards).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const loading = openRelated("c2");
    clearQuery("c1"); // the previous card's cleanup runs after c2 started
    resolve([card("b")]);
    await loading;

    expect(queryCardsOf("c2").map((c) => c.id)).toEqual(["b"]);

    clearQuery("c2");
    expect(queryCardsOf("c2")).toEqual([]);
  });
});

describe("createOwnLinks", () => {
  const titleLcs = (links: { target_titleLc: string }[]) =>
    links.map((l) => l.target_titleLc);

  function mount(cardId: string | undefined) {
    let dispose!: () => void;
    const links = createRoot((d) => {
      dispose = d;
      return createOwnLinks(() => cardId);
    });
    return { links, dispose };
  }

  it("reads the replica's rows until the editor reports the live text", async () => {
    await db.card_links.put(link("l1", "c1", "old"));
    const { links, dispose } = mount("c1");
    await vi.waitFor(() => expect(titleLcs(links())).toEqual(["old"]));

    setOwnLinks("c1", "p", [{ title: "New", titleLc: "new" }]);
    expect(titleLcs(links())).toEqual(["new"]);

    // A later replica change does not override the live text.
    await db.card_links.put(link("l2", "c1", "later"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(titleLcs(links())).toEqual(["new"]);
    dispose();
  });

  it("goes back to the replica after the card is closed", async () => {
    await db.card_links.put(link("l1", "c1", "old"));
    const { links, dispose } = mount("c1");
    await vi.waitFor(() => expect(titleLcs(links())).toEqual(["old"]));

    setOwnLinks("c1", "p", []);
    expect(links()).toEqual([]);
    closeRelated();
    expect(titleLcs(links())).toEqual(["old"]);
    dispose();
  });

  it("is empty for a card that does not exist yet", () => {
    const { links, dispose } = mount(undefined);
    expect(links()).toEqual([]);
    dispose();
  });

  it("never shows the live links of another card", () => {
    // Regression test: the live links of the card that was open before used
    // to show up under a draft ("/new") or under the next card opened.
    setOwnLinks("c1", "p", [{ title: "Old", titleLc: "old" }]);

    const draft = mount(undefined);
    expect(draft.links()).toEqual([]);
    draft.dispose();

    const other = mount("c2");
    expect(other.links()).toEqual([]);
    other.dispose();
  });

  it("drops live links only when their owner closes", () => {
    setOwnLinks("c1", "p", [{ title: "Old", titleLc: "old" }]);
    const { links, dispose } = mount("c1");

    closeOwnLinks("c2"); // another card closing must not touch them
    expect(titleLcs(links())).toEqual(["old"]);

    closeOwnLinks("c1");
    expect(links()).toEqual([]);
    dispose();
  });
});
