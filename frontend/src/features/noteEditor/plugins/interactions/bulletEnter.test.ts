import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { cardpodSyntax } from "../../parser/cardpod";
import { insertNewlineKeepingBullet } from "./bulletEnter";

// insertNewlineKeepingBullet only reads `view.state` and calls
// `view.dispatch(tr)` -- it never touches the DOM -- so a plain fake
// object satisfying that shape is enough to exercise it, with no need
// to construct a real EditorView (and therefore no jsdom dependency).
function runCommand(doc: string, cursor: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    // Same unit index.tsx configures: one real tab per indent level.
    extensions: [cardpodSyntax(), indentUnit.of("\t")],
  });

  let result: EditorState = state;
  const fakeView = {
    state,
    dispatch(tr: import("@codemirror/state").Transaction) {
      result = tr.state;
    },
  } as unknown as EditorView;

  insertNewlineKeepingBullet(fakeView);
  return result;
}

// The first line of a card is its title, which never carries a bullet (see
// parser/cardpod/rules/title.ts). Bullet behavior is therefore exercised on
// the lines after it: this runs the command on `doc` placed below a
// throwaway title line and returns the outcome with that line removed again.
const TITLE_LINE = "T\n";

function runOnBody(doc: string, cursor: number) {
  const result = runCommand(TITLE_LINE + doc, TITLE_LINE.length + cursor);
  return {
    doc: result.doc.toString().slice(TITLE_LINE.length),
    head: result.selection.main.head - TITLE_LINE.length,
  };
}

describe("insertNewlineKeepingBullet", () => {
  it("inserts a plain newline on an unindented line", () => {
    const result = runOnBody("hello", 5);
    expect(result.doc).toBe("hello\n");
    expect(result.head).toBe(6);
  });

  it("keeps the same bullet depth when the line has text", () => {
    const result = runOnBody("\t\thello", 7);
    expect(result.doc).toBe("\t\thello\n\t\t");
    expect(result.head).toBe(10);
  });

  it("copies a space bullet's own whitespace characters verbatim", () => {
    const result = runOnBody(" \u3000hello", 7);
    expect(result.doc).toBe(" \u3000hello\n \u3000");
    expect(result.head).toBe(10);
  });

  it("releases bullet mode and still inserts a newline on an empty bullet", () => {
    const result = runOnBody("\t\t", 2);
    expect(result.doc).toBe("\n");
    expect(result.head).toBe(1);
  });

  it("releases bullet mode for a single-tab empty bullet", () => {
    const result = runOnBody("\t", 1);
    expect(result.doc).toBe("\n");
    expect(result.head).toBe(1);
  });

  it("only considers the current line's depth, not other lines", () => {
    // Cursor is on the second body line ("\t\tbar"); the first body
    // line's deeper indent ("\t\t\tfoo") must not leak into this line's
    // computed depth.
    const doc = "\t\t\tfoo\n\t\tbar";
    const result = runOnBody(doc, doc.length); // end of "bar"
    expect(result.doc).toBe("\t\t\tfoo\n\t\tbar\n\t\t");
  });

  it("treats a bullet line with only whitespace after the tabs as empty", () => {
    const result = runOnBody("\t\t   ", 5);
    expect(result.doc).toBe("\n");
    expect(result.head).toBe(1);
  });

  it("never continues a bullet on the title line", () => {
    // Raw document: the first line is the title even with leading
    // whitespace, so Enter inserts a plain newline.
    const result = runCommand("\thello", 6);
    expect(result.doc.toString()).toBe("\thello\n");
    expect(result.selection.main.head).toBe(7);
  });

  it("copies only the indentation left of the cursor", () => {
    // The tab right of the cursor travels down with the text.
    const result = runOnBody("\t\tfoo", 1);
    expect(result.doc).toBe("\t\n\t\tfoo");
    expect(result.head).toBe(3);
  });

  it("moves the whole line down when the cursor is at column 0", () => {
    const result = runOnBody("\tfoo", 0);
    expect(result.doc).toBe("\n\tfoo");
    expect(result.head).toBe(1);
  });
});

describe("insertNewlineKeepingBullet inside a code: block", () => {
  it("copies the whole leading whitespace of a body line", () => {
    // The parser's Indent only covers the block's own level; the
    // second tab is code indentation and is carried over as well.
    const doc = "code:x\n\t\tfoo";
    const result = runOnBody(doc, doc.length);
    expect(result.doc).toBe("code:x\n\t\tfoo\n\t\t");
    expect(result.head).toBe(doc.length + 3);
  });

  it("copies non-tab indentation characters too", () => {
    const doc = "code:x\n \u3000foo";
    const result = runOnBody(doc, doc.length);
    expect(result.doc).toBe("code:x\n \u3000foo\n \u3000");
  });

  it("never releases an empty code line, so the block stays open", () => {
    const doc = "code:x\n\t\t";
    const result = runOnBody(doc, doc.length);
    expect(result.doc).toBe("code:x\n\t\t\n\t\t");
    expect(result.head).toBe(doc.length + 3);
  });

  it("indents the first body line deeper than the declaration", () => {
    const doc = "code:x";
    const result = runOnBody(doc, doc.length);
    expect(result.doc).toBe("code:x\n\t");
    expect(result.head).toBe(doc.length + 2);
  });

  it("keeps the declaration's own indentation on the first body line", () => {
    const doc = "\tcode:x";
    const result = runOnBody(doc, doc.length);
    expect(result.doc).toBe("\tcode:x\n\t\t");
  });

  it("adds no extra indent when Enter is pressed before the declaration text", () => {
    // The declaration itself moves down; it is not a continuation.
    const result = runOnBody("\tcode:x", 1);
    expect(result.doc).toBe("\t\n\tcode:x");
    expect(result.head).toBe(3);
  });
});
