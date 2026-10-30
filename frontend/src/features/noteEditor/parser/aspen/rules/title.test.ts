import { describe, expect, it } from "vitest";
import { TreeFragment } from "@lezer/common";

import { aspenSyntaxLanguage } from "..";

const parser = aspenSyntaxLanguage.parser;

function tree(input: string): string {
  return parser.parse(input).toString();
}

// Parses `before`, applies a single edit and reparses incrementally with the
// old tree's fragments, the same way CodeMirror does. The title rule depends
// on a line's position rather than its content, so a reused fragment could
// otherwise keep a stale Title (or Paragraph) node at the top of the document.
function reparse(
  before: string,
  from: number,
  to: number,
  insert: string,
): string {
  const after = before.slice(0, from) + insert + before.slice(to);
  const fragments = TreeFragment.applyChanges(
    TreeFragment.addTree(parser.parse(before)),
    [{ fromA: from, toA: to, fromB: from, toB: from + insert.length }],
    2,
  );
  return parser.parse(after, fragments).toString();
}

describe("Aspen title line", () => {
  it("claims a lone first line as the title", () => {
    expect(tree("Only title")).toBe("Document(Title)");
  });

  it("claims only the first line", () => {
    expect(tree("a\nb\nc")).toBe("Document(Title,Paragraph,Paragraph)");
  });

  it("treats the first line as plain text whatever its notation", () => {
    // Block prefixes must not open a block, and the following lines must not
    // be swallowed as the block's body.
    expect(tree("code: notes\n\tbody")).toBe(
      "Document(Title,Paragraph(indent))",
    );
    expect(tree("table:x\n\ta\tb")).toBe("Document(Title,Paragraph(indent))");
    expect(tree("> quote\nbody")).toBe("Document(Title,Paragraph)");
    // Inline notation stays raw, so the parser agrees with the title the
    // server resolves from the unparsed first line.
    expect(tree("[page] [* bold] `code` #tag\nbody")).toBe(
      "Document(Title,Paragraph)",
    );
    // Leading whitespace is not an indent, so the title never gets a bullet.
    expect(tree("\t indented\nbody")).toBe("Document(Title,Paragraph)");
  });

  it("leaves a blank first line to the paragraph rule", () => {
    // A blank title produces no node (the server falls back to "Untitled"),
    // and the second line is body text, not a title.
    expect(tree("\nbody")).toBe("Document(Paragraph)");
    expect(tree("\u3000\nbody")).toBe("Document(Paragraph)");
  });

  it("re-resolves the title after an incremental edit of the title", () => {
    expect(reparse("a\nb", 0, 1, "zz")).toBe("Document(Title,Paragraph)");
  });

  it("promotes the next line to the title when the first line is deleted", () => {
    expect(reparse("a\nb", 0, 2, "")).toBe("Document(Title)");
  });

  it("demotes the old title when a line is inserted above it", () => {
    expect(reparse("a\nb", 0, 0, "x\n")).toBe(
      "Document(Title,Paragraph,Paragraph)",
    );
  });
});
