import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncReplica } from "./replica";
import { openPodReplicas } from "./dataReplicas";

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

describe("openPodReplicas", () => {
  it("syncs only pod-scoped replicas with the pod id", async () => {
    // Regression test: the global pods replica was pulled with the pod id as
    // its scope, which requests a route that does not exist.
    await openPodReplicas("pod-1");

    const synced = vi
      .mocked(syncReplica)
      .mock.calls.map(([replica, scope]) => [replica.name, scope]);
    expect(synced).toEqual([["card_links", "pod-1"]]);
  });
});
