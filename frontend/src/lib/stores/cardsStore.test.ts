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
  ensurePodSynced,
  loadNextCardsPage,
  podWindow,
  releasePod,
  resyncPod,
  setCardSort,
  watchCards,
} from "./cardsStore";

// The realtime module is replaced wholesale: it wraps the centrifuge SDK,
// which needs a live server. Tests capture the handlers watchPod passes in
// and call them directly (see watch below).
vi.mock("../api/realtime", () => ({
  subscribeToCollection: vi.fn(() => () => {}),
}));

// Stubbed so loadNextCardsPage's initial checkpoint sync (see
// ensurePodSynced in cardsStore.ts) resolves instantly instead of
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

// Each test uses its own pod id: the store is module-level state.

function card(id: string, pod: string): CardRecord {
  return {
    id,
    pod,
    title: id as CardRecord["title"],
    titleLc: id,
    description: [],
    image: "",
    deleted: "",
    created: "",
    updated: "",
  } as CardRecord;
}

// Cards "<pod>-<from>" up to (not including) "<pod>-<to>".
function cards(pod: string, from: number, to: number): CardRecord[] {
  return Array.from({ length: to - from }, (_, i) =>
    card(`${pod}-${from + i}`, pod),
  );
}

// Queues the next page loadNextCardsPage (or resyncPod's own window
// re-read, see resyncPod in cardsStore.ts) will read from the local
// SignalDB cache (see queryCardsPage/countCards there).
function nextLocalPage(items: CardRecord[], total: number) {
  vi.mocked(queryCardsPage).mockResolvedValueOnce(items);
  vi.mocked(countCards).mockResolvedValueOnce(total);
}

// Queues the diff resyncPod will pull and apply to the SignalDB
// replica (see pullAndApplyDiff in cardsStore.ts) before re-reading the
// window from it. The records' content rarely matters to these tests
// -- they only exercise how resyncPod re-reads the window afterward
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

// A gap resyncs every loaded window, so pods left loaded by earlier tests
// would consume the pages a test queues for its own pod.
//
// getList is also reset here: mockClear() alone only clears call
// records, not any still-queued mockResolvedValueOnce/
// mockRejectedValueOnce values, so a test that ends up calling
// getList fewer times than it queued values for would leak its
// leftover queued response into the next test's first call(s).
// mockReset() clears that queue too, so every test starts from a
// clean slate regardless of how many calls the previous test made.
beforeEach(() => {
  for (const podId of "abcdefghijklmnopqr") releasePod(podId);
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
    expect(podWindow("a")?.ids).toHaveLength(99);

    // The cache's list shifted up: a-100 now sits at local index 99,
    // exactly where the next query's skip lands.
    nextLocalPage(cards("a", 6, 101), 149);
    await loadNextCardsPage("a");

    expect(queryCardsPage).toHaveBeenLastCalledWith("a", 99, 100, "created");
    expect(podWindow("a")?.ids).toHaveLength(100);
    expect(cardsById["a-100"]).toBeDefined();
  });

  it("treats the window as complete when a page adds nothing new", async () => {
    nextLocalPage(cards("b", 0, 100), 300);
    await loadNextCardsPage("b");
    nextLocalPage(cards("b", 0, 100), 300);
    await loadNextCardsPage("b");
    expect(podWindow("b")?.total).toBe(100);

    vi.mocked(queryCardsPage).mockReset();
    await loadNextCardsPage("b");
    expect(queryCardsPage).not.toHaveBeenCalled();
  });
});

describe("ensurePodSynced", () => {
  it("syncs a pod before any page is loaded, and loading a page does not pull again", async () => {
    // Regression test: opening a card by URL never mounts CardList, so the
    // replica used to stay unsynced. PodLayout now syncs on open, and the
    // later page load must share that same sync.
    await ensurePodSynced("r");
    expect(pullAll).toHaveBeenCalledTimes(1);

    nextLocalPage(cards("r", 0, 2), 2);
    await loadNextCardsPage("r");

    expect(pullAll).toHaveBeenCalledTimes(1);
    expect(podWindow("r")?.ids).toHaveLength(2);
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
    // Regression test: the card may sit on a page of the open pod that is
    // not loaded yet, and that page is read from the replica, so the
    // replica must not keep a stale copy.
    const { emit } = watch();
    const updated = card("c-3", "c");
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
    expect(podWindow("d")?.total).toBe(3);

    emit("delete", card("d-new", "d"));
    emit("delete", card("d-new", "d"));
    expect(podWindow("d")?.total).toBe(2);
    expect(cardsById["d-new"]).toBeUndefined();
  });

  it("applies an update to a held card", async () => {
    const { emit } = watch();
    nextLocalPage(cards("e", 0, 1), 1);
    await loadNextCardsPage("e");

    emit("update", { ...card("e-0", "e"), description: ["changed"] });
    expect(cardsById["e-0"].description).toEqual(["changed"]);
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
    expect(podWindow("m")?.ids).toEqual(["m-1"]);
    expect(podWindow("m")?.total).toBe(1);
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
    expect(podWindow("o")?.total).toBe(1);
  });
});

describe("setCardSort", () => {
  it("rebuilds a loaded window from the first page in the new order", async () => {
    nextLocalPage(cards("n", 0, 3), 3);
    await loadNextCardsPage("n");

    vi.mocked(queryCardsPage).mockResolvedValueOnce([
      card("n-9", "n"),
      card("n-0", "n"),
    ]);
    setCardSort("updated");

    await vi.waitFor(() =>
      expect(podWindow("n")?.ids).toEqual(["n-9", "n-0"]),
    );
    expect(queryCardsPage).toHaveBeenLastCalledWith("n", 0, 100, "updated");
    expect(podWindow("n")?.total).toBe(3);
    expect(cardsById["n-1"]).toBeUndefined();

    releasePod("n");
    setCardSort("created");
  });

  it("brings an edited card the window does not hold to the top under the updated sort", async () => {
    setCardSort("updated");
    const { emit } = watch();
    nextLocalPage(cards("o", 0, 2), 3);
    await loadNextCardsPage("o");

    emit("update", card("o-9", "o"));

    expect(podWindow("o")?.ids).toEqual(["o-0", "o-1", "o-9"]);
    expect(podWindow("o")?.total).toBe(3);

    releasePod("o");
    setCardSort("created");
  });
});

describe("releasePod", () => {
  it("drops the window and every card of the pod", async () => {
    nextLocalPage(cards("f", 0, 3), 3);
    await loadNextCardsPage("f");
    expect(cardsById["f-0"]).toBeDefined();

    releasePod("f");
    expect(podWindow("f")).toBeUndefined();
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
    releasePod("g");
    resolve({ records: cards("g", 0, 2), checkpoint: null });
    await loading;

    expect(podWindow("g")).toBeUndefined();
    expect(cardsById["g-0"]).toBeUndefined();
  });
});

describe("resyncPod", () => {
  it("replaces the window with fresh data and drops vanished cards", async () => {
    nextLocalPage(cards("h", 0, 3), 3);
    await loadNextCardsPage("h");

    // Simulates h-0 having been deleted and h-3 created while events
    // were missed: the pulled diff itself is irrelevant here, only
    // what the cache looks like once resyncPod re-reads the window.
    nextDiff([]);
    nextLocalPage(cards("h", 1, 4), 3);
    await resyncPod("h");

    expect(podWindow("h")?.ids).toEqual(["h-1", "h-2", "h-3"]);
    expect(podWindow("h")?.total).toBe(3);
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
    await resyncPod("i");

    expect(queryCardsPage).toHaveBeenCalledTimes(1);
    expect(queryCardsPage).toHaveBeenCalledWith("i", 0, 200, "created");
    expect(podWindow("i")?.total).toBe(251);
  });

  it("does nothing while nothing is loaded", async () => {
    await resyncPod("j");
    expect(pullAll).not.toHaveBeenCalled();
  });

  it("leaves the window untouched when a request fails", async () => {
    nextLocalPage(cards("k", 0, 2), 2);
    await loadNextCardsPage("k");

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pullAll).mockRejectedValueOnce(new Error("offline"));
    await resyncPod("k");
    logged.mockRestore();

    expect(podWindow("k")?.ids).toEqual(["k-0", "k-1"]);
    expect(cardsById["k-0"]).toBeDefined();
  });

  it("resyncs every loaded pod when the channel reports a gap", async () => {
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
      expect(podWindow("p")?.ids).toEqual(["p-1"]);
      expect(podWindow("q")?.ids).toEqual(["q-1"]);
    });
  });

  it("runs when the realtime channel reports a gap", async () => {
    const { resync } = watch();
    nextLocalPage(cards("l", 0, 2), 2);
    await loadNextCardsPage("l");

    nextDiff([]);
    nextLocalPage(cards("l", 1, 3), 2);
    resync();

    await vi.waitFor(() => expect(podWindow("l")?.ids).toEqual(["l-1", "l-2"]));
  });
});
