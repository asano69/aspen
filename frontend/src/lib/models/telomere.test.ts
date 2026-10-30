import { describe, expect, it } from "vitest";
import type { TelomereLine } from "../api/generated";
import { telomereEntries, telomereThickness } from "./telomere";

describe("telomereEntries", () => {
  const reader = { me: "me", left: 10 };
  const line = (id: string, updated: number, user: string): TelomereLine => ({
    id,
    updated,
    user,
  });
  // Every line unchanged since the card was opened.
  const opened = (...lines: TelomereLine[]) =>
    new Map(lines.map((l) => [l.id, l.updated]));
  const statusOf = (l: TelomereLine, base = opened(l)) =>
    telomereEntries([l], base, reader)[0].status;

  it("converts seconds to milliseconds", () => {
    const l = line("l1", 5, "alice");
    expect(telomereEntries([l], opened(l), reader)).toEqual([
      { id: "l1", updatedAt: 5000, user: "alice", status: "read" },
    ]);
  });

  it("marks a line edited by someone else after the user left as unread", () => {
    expect(statusOf(line("a", 11, "alice"))).toBe("unread");
  });

  it("does not mark an older, own or anonymous line as unread", () => {
    expect(statusOf(line("a", 9, "alice"))).toBe("read");
    expect(statusOf(line("a", 11, "me"))).toBe("read");
    expect(statusOf(line("a", 11, ""))).toBe("read");
  });

  it("marks a line that changed since the card was opened as updated", () => {
    const before = line("a", 11, "alice");
    expect(statusOf(line("a", 12, "bob"), opened(before))).toBe("updated");
  });

  it("marks a line that did not exist when the card was opened as updated", () => {
    expect(statusOf(line("new", 12, "me"), new Map())).toBe("updated");
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
