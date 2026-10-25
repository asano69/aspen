import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { readCheckpoint, writeCheckpoint } from "./checkpoints";

describe("checkpoints", () => {
  it("persists and overwrites a checkpoint", async () => {
    expect(await readCheckpoint("cards", "pod-1")).toBeNull();

    await writeCheckpoint("cards", "pod-1", { updatedAt: "t1", id: "c1" });
    expect(await readCheckpoint("cards", "pod-1")).toEqual({
      updatedAt: "t1",
      id: "c1",
    });

    await writeCheckpoint("cards", "pod-1", { updatedAt: "t2", id: "c2" });
    expect(await readCheckpoint("cards", "pod-1")).toEqual({
      updatedAt: "t2",
      id: "c2",
    });
  });

  it("keeps collections and pods apart", async () => {
    await writeCheckpoint("card_links", "pod-2", { updatedAt: "t", id: "l" });

    expect(await readCheckpoint("cards", "pod-2")).toBeNull();
    expect(await readCheckpoint("card_links", "pod-3")).toBeNull();
  });
});
