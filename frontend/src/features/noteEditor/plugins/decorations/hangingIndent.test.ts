import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { cardpotSyntax } from "../../parser/cardpot";
import { buildDecorations } from "./hangingIndent";

// buildDecorations only reads `view.state` and `view.visibleRanges`, so a
// plain fake object is enough (same pattern as bulletEnter.test.ts).
// Returns the 1-based numbers of the lines whose last pad draws a bullet dot.
function dotLines(doc: string): number[] {
  const state = EditorState.create({ doc, extensions: [cardpotSyntax()] });
  const fakeView = {
    state,
    visibleRanges: [{ from: 0, to: doc.length }],
  } as unknown as EditorView;

  const lines: number[] = [];
  const cursor = buildDecorations(fakeView).iter();
  for (; cursor.value; cursor.next()) {
    const widget = cursor.value.spec.widget;
    if (widget?.toDOM().querySelector(".dot")) {
      lines.push(state.doc.lineAt(cursor.from).number);
    }
  }
  return lines;
}

describe("hangingIndent bullets", () => {
  it("draws a dot on an indented code: declaration line but not on its body", () => {
    // Regression test: the declaration line was treated as code, so its
    // bullet was missing.
    // Lines: 1 title, 2 declaration, 3 body, 4 paragraph.
    expect(dotLines("T\n\tcode:x\n\t\tfoo\n\tbar")).toEqual([2, 4]);
  });

  it("draws no dot on a code: block body line", () => {
    expect(dotLines("T\n\tcode:x\n\t\tfoo\n\t\t\tbar")).toEqual([2]);
  });
});
