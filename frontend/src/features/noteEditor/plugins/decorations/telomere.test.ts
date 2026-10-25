import { describe, expect, it } from "vitest";
import { ChangeSet, Text } from "@codemirror/state";
import type { TelomereEntry } from "@/lib/models/telomere";
import { mapEntries } from "./telomere";

const entry = (user: string): TelomereEntry => ({
  updatedAt: 0,
  user,
  status: "read",
});
const edit: TelomereEntry = { updatedAt: 1, user: "me", status: "updated" };

// Applies `spec` to `text` and maps one entry per line through it.
function run(text: string, entries: TelomereEntry[], spec: object) {
  const doc = Text.of(text.split("\n"));
  const changes = ChangeSet.of(spec, doc.length);
  return mapEntries(entries, doc, changes.apply(doc), changes, edit);
}

describe("mapEntries", () => {
  const [a, b, c] = [entry("a"), entry("b"), entry("c")];

  it("marks the touched line and keeps the others in place", () => {
    expect(run("x\ny\nz", [a, b, c], { from: 2, insert: "!" })).toEqual([
      a,
      edit,
      c,
    ]);
  });

  it("adds a fresh line for Enter and shifts the lines below", () => {
    expect(run("x\ny", [a, b], { from: 1, insert: "\n" })).toEqual([
      edit,
      edit,
      b,
    ]);
  });

  it("drops a deleted line and marks the line the deletion reaches", () => {
    expect(run("x\ny\nz", [a, b, c], { from: 2, to: 4 })).toEqual([a, edit]);
  });

  it("returns nothing when the entries do not fit the document", () => {
    expect(run("x\ny", [a], { from: 0, insert: "!" })).toEqual([]);
  });
});
