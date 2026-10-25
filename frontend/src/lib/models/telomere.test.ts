import { describe, expect, it } from "vitest";
import { telomereEntries, telomereThickness } from "./telomere";

describe("telomereEntries", () => {
  it("converts seconds to milliseconds and the unread flag to a status", () => {
    expect(
      telomereEntries([
        { id: "l1", updated: 5, user: "alice", unread: true },
        { id: "l2", updated: 6, user: "", unread: false },
      ]),
    ).toEqual([
      { id: "l1", updatedAt: 5000, user: "alice", status: "unread" },
      { id: "l2", updatedAt: 6000, user: "", status: "read" },
    ]);
  });
});

describe("telomereThickness", () => {
  const hour = 3_600_000;

  it("starts at 10px and thins as the edit gets older", () => {
    expect(telomereThickness(0)).toBe(10);
    expect(telomereThickness(60_000)).toBe(10);
    expect(telomereThickness(hour)).toBe(9);
    expect(telomereThickness(8 * hour)).toBe(8);
    expect(telomereThickness(98 * hour)).toBe(6);
    expect(telomereThickness(1000 * hour)).toBe(4);
  });

  it("never goes below 1px", () => {
    expect(telomereThickness(100_000 * hour)).toBe(1);
    expect(telomereThickness(Infinity)).toBe(1);
  });

  it("treats a future edit as fresh", () => {
    expect(telomereThickness(-hour)).toBe(10);
  });
});
