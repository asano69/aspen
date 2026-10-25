import { beforeEach, describe, expect, it, vi } from "vitest";
import { pullAll, type ReplicaRecord } from "../api/replication";
import { readCheckpoint, writeCheckpoint } from "./checkpoints";
import { applyRecords, syncReplica, type Replica } from "./replica";

vi.mock("../api/replication", () => ({ pullAll: vi.fn() }));
vi.mock("./checkpoints", () => ({
  readCheckpoint: vi.fn(async () => null),
  writeCheckpoint: vi.fn(),
}));

function record(id: string, deleted = ""): ReplicaRecord {
  return { id, updated: `t${id}`, deleted };
}

function fakeReplica(): Replica<ReplicaRecord> {
  return {
    name: "things",
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.mocked(pullAll).mockReset();
  vi.mocked(readCheckpoint).mockClear();
  vi.mocked(writeCheckpoint).mockClear();
});

describe("applyRecords", () => {
  it("upserts live records and removes soft-deleted ones", async () => {
    const replica = fakeReplica();
    await applyRecords(replica, [record("a"), record("b", "2026-01-01")]);

    expect(replica.put).toHaveBeenCalledWith([record("a")]);
    expect(replica.remove).toHaveBeenCalledWith("b");
  });
});

describe("syncReplica", () => {
  it("pulls after the stored checkpoint, applies it and advances the checkpoint", async () => {
    const replica = fakeReplica();
    const stored = { updatedAt: "t0", id: "c0" };
    vi.mocked(readCheckpoint).mockResolvedValueOnce(stored);
    vi.mocked(pullAll).mockResolvedValueOnce({
      records: [record("a"), record("b", "2026-01-01")],
      checkpoint: { updatedAt: "tb", id: "b" },
    });

    await syncReplica(replica, "pod1");

    expect(pullAll).toHaveBeenCalledWith("things", "pod1", stored);
    expect(replica.put).toHaveBeenCalledWith([record("a")]);
    expect(replica.remove).toHaveBeenCalledWith("b");
    expect(writeCheckpoint).toHaveBeenCalledWith("things", "pod1", {
      updatedAt: "tb",
      id: "b",
    });
  });

  it("leaves the checkpoint alone when nothing was pulled", async () => {
    vi.mocked(pullAll).mockResolvedValueOnce({ records: [], checkpoint: null });

    await syncReplica(fakeReplica(), "pod1");

    expect(writeCheckpoint).not.toHaveBeenCalled();
  });
});
