import { describe, expect, it, vi } from "vitest";
import pb from "./pb";
import { pullAll, PULL_LIMIT, type Checkpoint } from "./replication";
import type { CardRecord } from "../models/card";

// Minimal stand-in: only `id`/`updated`/`deleted` matter to pullAll's
// own logic (paging and checkpoint tracking), so the rest is padding.
function record(id: string, updated: string): CardRecord {
  return { id, updated, deleted: "" } as CardRecord;
}

describe("pullAll", () => {
  it("stops after a single short page and advances the checkpoint to its last record", async () => {
    const send = vi.spyOn(pb, "send").mockResolvedValueOnce({
      records: [record("a", "t1"), record("b", "t2")],
    });

    const { records, checkpoint } = await pullAll("cards", "pod1", null);

    expect(send).toHaveBeenCalledTimes(1);
    expect(records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(checkpoint).toEqual({ updatedAt: "t2", id: "b" });
  });

  it("keeps paging while a page is exactly PULL_LIMIT long", async () => {
    const fullPage = Array.from({ length: PULL_LIMIT }, (_, i) =>
      record(`p${i}`, `t${i}`),
    );
    const send = vi
      .spyOn(pb, "send")
      .mockResolvedValueOnce({ records: fullPage })
      .mockResolvedValueOnce({ records: [record("last", "tlast")] });

    const { records, checkpoint } = await pullAll("cards", "pod1", null);

    expect(send).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(PULL_LIMIT + 1);
    expect(checkpoint).toEqual({ updatedAt: "tlast", id: "last" });
    // Second call resumed from the first page's last record.
    expect(send.mock.calls[1][1]?.query).toMatchObject({
      updatedAt: `t${PULL_LIMIT - 1}`,
      id: `p${PULL_LIMIT - 1}`,
    });
  });

  it("returns the original checkpoint unchanged when nothing changed", async () => {
    vi.spyOn(pb, "send").mockResolvedValueOnce({ records: [] });
    const after: Checkpoint = { updatedAt: "t0", id: "c0" };

    const { records, checkpoint } = await pullAll("cards", "pod1", after);

    expect(records).toEqual([]);
    expect(checkpoint).toEqual(after);
  });
});
