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

// The "style" attribute of every line decoration, by 1-based line number.
function lineStyles(doc: string): Record<number, string> {
  const state = EditorState.create({ doc, extensions: [cardpotSyntax()] });
  const fakeView = {
    state,
    visibleRanges: [{ from: 0, to: doc.length }],
  } as unknown as EditorView;

  const styles: Record<number, string> = {};
  const cursor = buildDecorations(fakeView).iter();
  for (; cursor.value; cursor.next()) {
    const style = cursor.value.spec.attributes?.style;
    if (style) styles[state.doc.lineAt(cursor.from).number] = style;
  }
  return styles;
}

describe("hangingIndent code: block margin", () => {
  it("passes the declaration's own indent to the body lines only", () => {
    // Lines: 1 title, 2 declaration (1 level), 3 body (2 levels).
    const styles = lineStyles("T\n\tcode:x\n\t\tfoo");
    expect(styles[2]).not.toContain("--code-outer-width");
    expect(styles[3]).toContain("--code-outer-width: 22.5px");
    expect(styles[3]).toContain("--indent-width: 45px");
  });
});

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
