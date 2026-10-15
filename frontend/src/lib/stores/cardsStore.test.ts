import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToCollection, type CollectionEvent } from "../api/realtime";
import { pullAll } from "../api/replication";
import {
  cardsReplica,
  queryCardsPage,
  countCards,
} from "../dexie/cardsCollection";
import type { CardRecord } from "../models/card";

import {
  cardsById,
  ensurePotSynced,
  loadNextCardsPage,
  potWindow,
  releasePot,
  resyncPot,
  watchCards,
} from "./cardsStore";

// The realtime module is replaced wholesale: it wraps the centrifuge SDK,
// which needs a live server. Tests capture the handlers watchPot passes in
// and call them directly (see watch below).
vi.mock("../api/realtime", () => ({
  subscribeToCollection: vi.fn(() => () => {}),
}));

// Stubbed so loadNextCardsPage's initial checkpoint sync (see
// ensurePotSynced in cardsStore.ts) resolves instantly instead of
// making a real HTTP request. Individual tests override this with
// mockReturnValueOnce/mockResolvedValueOnce when they need to control
// the sync's timing or content.
vi.mock("../api/replication", () => ({
  pullAll: vi.fn(async () => ({ records: [], checkpoint: null })),
}));

// The IndexedDB-backed cache (lib/dexie/cardsCollection.ts and
// checkpoints.ts) needs a real IndexedDB implementation that jsdom does not
// provide, so it's stubbed out entirely. queryCardsPage/countCards are what
// loadNextCardsPage now reads from (see nextLocalPage below); the replica's
// put/remove stay no-ops, since the tests never need the write side to
// actually persist anything. The generic syncReplica (lib/dexie/replica.ts)
// stays real, running against these stubs and the mocked pullAll.
vi.mock("../dexie/cardsCollection", () => ({
  queryCardsPage: vi.fn(async () => []),
  countCards: vi.fn(async () => 0),
  cardsReplica: { name: "cards", put: vi.fn(), remove: vi.fn() },
}));
vi.mock("../dexie/checkpoints", () => ({
  readCheckpoint: vi.fn(async () => null),
  writeCheckpoint: vi.fn(),
}));
// linkAliveStore imports the IndexedDB-backed query, which jsdom cannot run.
vi.mock("../dexie/linkAliveQuery", () => ({
  computeAlive: vi.fn(async () => true),
}));

// Each test uses its own pot id: the store is module-level state.

function card(id: string, pot: string, position = 1): CardRecord {
  return {
    id,
    pot,
    position,
    title: id as CardRecord["title"],
    description: [],
    image: "",
    deleted: "",
    created: "",
    updated: "",
  } as CardRecord;
}

// Cards "<pot>-<from>" up to (not including) "<pot>-<to>".
function cards(pot: string, from: number, to: number): CardRecord[] {
  return Array.from({ length: to - from }, (_, i) =>
    card(`${pot}-${from + i}`, pot),
  );
}

// Queues the next page loadNextCardsPage (or resyncPot's own window
// re-read, see resyncPot in cardsStore.ts) will read from the local
// SignalDB cache (see queryCardsPage/countCards there).
function nextLocalPage(items: CardRecord[], total: number) {
  vi.mocked(queryCardsPage).mockResolvedValueOnce(items);
  vi.mocked(countCards).mockResolvedValueOnce(total);
}

// Queues the diff resyncPot will pull and apply to the SignalDB
// replica (see pullAndApplyDiff in cardsStore.ts) before re-reading the
// window from it. The records' content rarely matters to these tests
// -- they only exercise how resyncPot re-reads the window afterward
// (see nextLocalPage) -- so an empty diff is enough unless a test
// needs otherwise.
function nextDiff(records: CardRecord[]) {
  vi.mocked(pullAll).mockResolvedValueOnce({ records, checkpoint: null });
}

// Starts watching and returns functions that deliver a realtime event, or a
// "gap detected" signal, to the store the way the realtime module would.
function watch() {
  let onEvent: (event: CollectionEvent<CardRecord>) => void = () => {};
  let onResync: () => void = () => {};
  vi.mocked(subscribeToCollection).mockImplementationOnce(
    (_name, event, resync) => {
      onEvent = event;
      onResync = resync;
      return () => {};
    },
  );
  watchCards();
  return {
    emit: (action: string, record: CardRecord) => onEvent({ action, record }),
    resync: () => onResync(),
  };
}

// A gap resyncs every loaded window, so pots left loaded by earlier tests
// would consume the pages a test queues for its own pot.
//
// getList is also reset here: mockClear() alone only clears call
// records, not any still-queued mockResolvedValueOnce/
// mockRejectedValueOnce values, so a test that ends up calling
// getList fewer times than it queued values for would leak its
// leftover queued response into the next test's first call(s).
// mockReset() clears that queue too, so every test starts from a
// clean slate regardless of how many calls the previous test made.
beforeEach(() => {
  for (const potId of "abcdefghijklmnopqr") releasePot(potId);
  vi.mocked(queryCardsPage).mockReset();
  vi.mocked(countCards).mockReset();
  vi.mocked(pullAll).mockClear();
  vi.mocked(cardsReplica.put).mockClear();
});

describe("loadNextCardsPage", () => {
  it("requests the page holding the window's end, so a deletion skips no card", async () => {
    const { emit } = watch();
    nextLocalPage(cards("a", 0, 100), 150);
    await loadNextCardsPage("a");

    emit("delete", card("a-5", "a"));
    expect(potWindow("a")?.ids).toHaveLength(99);

    // The cache's list shifted up: a-100 now sits at local index 99,
    // exactly where the next query's skip lands.
    nextLocalPage(cards("a", 6, 101), 149);
    await loadNextCardsPage("a");

    expect(queryCardsPage).toHaveBeenLastCalledWith("a", 99, 100);
    expect(potWindow("a")?.ids).toHaveLength(100);
    expect(cardsById["a-100"]).toBeDefined();
  });

  it("treats the window as complete when a page adds nothing new", async () => {
    nextLocalPage(cards("b", 0, 100), 300);
    await loadNextCardsPage("b");
    nextLocalPage(cards("b", 0, 100), 300);
    await loadNextCardsPage("b");
    expect(potWindow("b")?.total).toBe(100);

    vi.mocked(queryCardsPage).mockReset();
    await loadNextCardsPage("b");
    expect(queryCardsPage).not.toHaveBeenCalled();
  });
});

describe("ensurePotSynced", () => {
  it("syncs a pot before any page is loaded, and loading a page does not pull again", async () => {
    // Regression test: opening a card by URL never mounts CardList, so the
    // replica used to stay unsynced. PotLayout now syncs on open, and the
    // later page load must share that same sync.
    await ensurePotSynced("r");
    expect(pullAll).toHaveBeenCalledTimes(1);

    nextLocalPage(cards("r", 0, 2), 2);
    await loadNextCardsPage("r");

    expect(pullAll).toHaveBeenCalledTimes(1);
    expect(potWindow("r")?.ids).toHaveLength(2);
  });
});

describe("realtime events", () => {
  it("ignores events for cards the store does not hold", () => {
    const { emit } = watch();
    emit("create", card("c-1", "c"));
    emit("update", card("c-2", "c"));
    expect(cardsById["c-1"]).toBeUndefined();
    expect(cardsById["c-2"]).toBeUndefined();
  });

  it("writes an update for a card the store does not hold to the replica only", () => {
    // Regression test: the card may sit on a page of the open pot that is
    // not loaded yet, and that page is read from the replica, so the
    // replica must not keep a stale copy.
    const { emit } = watch();
    const updated = card("c-3", "c", 5);
    emit("update", updated);
    expect(cardsById["c-3"]).toBeUndefined();
    expect(cardsReplica.put).toHaveBeenCalledWith([updated]);
  });

  it("counts a created and a deleted card once", async () => {
    const { emit } = watch();
    nextLocalPage(cards("d", 0, 2), 2);
    await loadNextCardsPage("d");

    emit("create", card("d-new", "d"));
    emit("create", card("d-new", "d"));
    expect(potWindow("d")?.total).toBe(3);

    emit("delete", card("d-new", "d"));
    emit("delete", card("d-new", "d"));
    expect(potWindow("d")?.total).toBe(2);
    expect(cardsById["d-new"]).toBeUndefined();
  });

  it("applies an update to a held card", async () => {
    const { emit } = watch();
    nextLocalPage(cards("e", 0, 1), 1);
    await loadNextCardsPage("e");

    emit("update", card("e-0", "e", 5));
    expect(cardsById["e-0"].position).toBe(5);
  });

  it("drops a card once an update event marks it deleted", async () => {
    const { emit } = watch();
    nextLocalPage(cards("m", 0, 2), 2);
    await loadNextCardsPage("m");

    emit("update", {
      ...card("m-0", "m"),
      deleted: "2026-09-24 00:00:00.000Z",
    });
    expect(cardsById["m-0"]).toBeUndefined();
    expect(potWindow("m")?.ids).toEqual(["m-1"]);
    expect(potWindow("m")?.total).toBe(1);
  });

  it("ignores a created card that is already deleted", async () => {
    const { emit } = watch();
    nextLocalPage(cards("o", 0, 1), 1);
    await loadNextCardsPage("o");

    emit("create", {
      ...card("o-new", "o"),
      deleted: "2026-09-24 00:00:00.000Z",
    });
    expect(cardsById["o-new"]).toBeUndefined();
    expect(potWindow("o")?.total).toBe(1);
  });
});

describe("releasePot", () => {
  it("drops the window and every card of the pot", async () => {
    nextLocalPage(cards("f", 0, 3), 3);
    await loadNextCardsPage("f");
    expect(cardsById["f-0"]).toBeDefined();

    releasePot("f");
    expect(potWindow("f")).toBeUndefined();
    expect(cardsById["f-0"]).toBeUndefined();
  });

  it("is not undone by a sync that resolves after the release", async () => {
    let resolve!: (value: { records: CardRecord[]; checkpoint: null }) => void;
    vi.mocked(pullAll).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const loading = loadNextCardsPage("g");
    releasePot("g");
    resolve({ records: cards("g", 0, 2), checkpoint: null });
    await loading;

    expect(potWindow("g")).toBeUndefined();
    expect(cardsById["g-0"]).toBeUndefined();
  });
});

describe("resyncPot", () => {
  it("replaces the window with fresh data and drops vanished cards", async () => {
    nextLocalPage(cards("h", 0, 3), 3);
    await loadNextCardsPage("h");

    // Simulates h-0 having been deleted and h-3 created while events
    // were missed: the pulled diff itself is irrelevant here, only
    // what the cache looks like once resyncPot re-reads the window.
    nextDiff([]);
    nextLocalPage(cards("h", 1, 4), 3);
    await resyncPot("h");

    expect(potWindow("h")?.ids).toEqual(["h-1", "h-2", "h-3"]);
    expect(potWindow("h")?.total).toBe(3);
    expect(cardsById["h-0"]).toBeUndefined();
    expect(cardsById["h-3"]).toBeDefined();
  });

  it("re-reads the whole window in one local query, not one page at a time", async () => {
    nextLocalPage(cards("i", 0, 100), 250);
    await loadNextCardsPage("i");
    nextLocalPage(cards("i", 100, 200), 250);
    await loadNextCardsPage("i");

    vi.mocked(queryCardsPage).mockReset();
    nextDiff([]);
    nextLocalPage(cards("i", 0, 200), 251);
    await resyncPot("i");

    expect(queryCardsPage).toHaveBeenCalledTimes(1);
    expect(queryCardsPage).toHaveBeenCalledWith("i", 0, 200);
    expect(potWindow("i")?.total).toBe(251);
  });

  it("does nothing while nothing is loaded", async () => {
    await resyncPot("j");
    expect(pullAll).not.toHaveBeenCalled();
  });

  it("leaves the window untouched when a request fails", async () => {
    nextLocalPage(cards("k", 0, 2), 2);
    await loadNextCardsPage("k");

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pullAll).mockRejectedValueOnce(new Error("offline"));
    await resyncPot("k");
    logged.mockRestore();

    expect(potWindow("k")?.ids).toEqual(["k-0", "k-1"]);
    expect(cardsById["k-0"]).toBeDefined();
  });

  it("resyncs every loaded pot when the channel reports a gap", async () => {
    const { resync } = watch();
    nextLocalPage(cards("p", 0, 1), 1);
    await loadNextCardsPage("p");
    nextLocalPage(cards("q", 0, 1), 1);
    await loadNextCardsPage("q");

    nextDiff([]);
    nextDiff([]);
    nextLocalPage(cards("p", 1, 2), 1);
    nextLocalPage(cards("q", 1, 2), 1);
    resync();

    await vi.waitFor(() => {
      expect(potWindow("p")?.ids).toEqual(["p-1"]);
      expect(potWindow("q")?.ids).toEqual(["q-1"]);
    });
  });

  it("runs when the realtime channel reports a gap", async () => {
    const { resync } = watch();
    nextLocalPage(cards("l", 0, 2), 2);
    await loadNextCardsPage("l");

    nextDiff([]);
    nextLocalPage(cards("l", 1, 3), 2);
    resync();

    await vi.waitFor(() => expect(potWindow("l")?.ids).toEqual(["l-1", "l-2"]));
  });
});
