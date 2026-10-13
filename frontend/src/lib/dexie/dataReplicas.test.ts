import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncReplica } from "./replica";
import { openPotReplicas } from "./dataReplicas";

// The realtime module wraps the centrifuge SDK, which needs a live server.
vi.mock("../api/realtime", () => ({
  subscribeToCollection: vi.fn(() => () => {}),
}));
vi.mock("./replica", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replica")>()),
  syncReplica: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.mocked(syncReplica).mockClear();
});

describe("openPotReplicas", () => {
  it("syncs only pot-scoped replicas with the pot id", async () => {
    // Regression test: the global pots replica was pulled with the pot id as
    // its scope, which requests a route that does not exist.
    await openPotReplicas("pot-1");

    const synced = vi
      .mocked(syncReplica)
      .mock.calls.map(([replica, scope]) => [replica.name, scope]);
    expect(synced).toEqual([["card_links", "pot-1"]]);
  });
});
