import { describe, expect, it } from "vitest";

import { cardpotSyntaxLanguage, ExternalLinkMark, Indent, isIndent } from ".";

// The first line of every document is its title (see rules/title.ts), so most
// tests below describe body notation only. These helpers place a throwaway
// title line above the input and hide it again in the results, so each test
// can keep talking about the lines it actually cares about.
const TITLE_LINE = "T\n";

function tree(input: string): string {
  return cardpotSyntaxLanguage.parser
    .parse(TITLE_LINE + input)
    .toString()
    .replace(/^Document\(Title,?/, "Document(");
}

function indentRanges(input: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const syntax = cardpotSyntaxLanguage.parser.parse(TITLE_LINE + input);
  syntax.iterate({
    enter(node) {
      if (node.type === Indent) {
        ranges.push({
          from: node.from - TITLE_LINE.length,
          to: node.to - TITLE_LINE.length,
        });
      }
    },
  });
  return ranges;
}

describe("Cardpot Lezer syntax", () => {
  it("parses Cardpot inline notation only inside paragraph blocks", () => {
    expect(tree("plain [page] [* bold] `code`")).toBe(
      "Document(Paragraph(link(linkMark,linkMark),Bold(BoldMark,BoldMark),code(codeMark,codeMark)))",
    );
    expect(tree("# not a CommonMark heading\n**not CommonMark bold**")).toBe(
      "Document(Paragraph,Paragraph)",
    );
  });

  it("parses Scrapbox-compatible hashtags at whitespace boundaries", () => {
    expect(tree("#tag #hash#Tag This is a #second .")).toBe(
      "Document(Paragraph(hashTag,hashTag,hashTag))",
    );
    expect(tree("# →#notTag←")).toBe("Document(Paragraph)");
  });

  it("makes the mark on the URL's side cover the URL of a labelled link", () => {
    const markRanges = (input: string) => {
      const ranges: { from: number; to: number }[] = [];
      cardpotSyntaxLanguage.parser.parse(TITLE_LINE + input).iterate({
        enter(node) {
          if (node.type === ExternalLinkMark) {
            ranges.push({
              from: node.from - TITLE_LINE.length,
              to: node.to - TITLE_LINE.length,
            });
          }
        },
      });
      return ranges;
    };
    // Only the label stays outside the marks.
    expect(markRanges("[aaa https://e.com]")).toEqual([
      { from: 0, to: 1 },
      { from: 4, to: 19 },
    ]);
    expect(markRanges("[https://e.com aaa]")).toEqual([
      { from: 0, to: 15 },
      { from: 18, to: 19 },
    ]);
    // Without a label the URL itself is the visible text.
    expect(markRanges("[https://e.com]")).toEqual([
      { from: 0, to: 1 },
      { from: 14, to: 15 },
    ]);
  });

  it("treats a full-width space as the separator of a labelled link", () => {
    expect(tree("[aaa\u3000https://example.com/]")).toBe(
      "Document(Paragraph(urlLink(urlLinkMark,urlLinkMark)))",
    );
    expect(tree("[https://example.com/\u3000aaa]")).toBe(
      "Document(Paragraph(urlLink(urlLinkMark,urlLinkMark)))",
    );
    // Without a URL a full-width space is still part of the title.
    expect(tree("[日本語\u3000タイトル]")).toBe(
      "Document(Paragraph(link(linkMark,linkMark)))",
    );
  });

  it("parses a URL written directly in text", () => {
    expect(tree("see https://example.com/a?b=1 and http://x.y end")).toBe(
      "Document(Paragraph(url,url))",
    );
    // Not a URL: no scheme separator, or nothing after it.
    expect(tree("https:/example.com http://")).toBe("Document(Paragraph)");
  });

  it("does not let a bare URL swallow a closing bracket", () => {
    expect(tree("[* see https://example.com/]")).toBe(
      "Document(Paragraph(Bold(BoldMark,url,BoldMark)))",
    );
    // Inside a bracketed link the bracket rule wins; no nested BareUrl.
    expect(tree("[https://example.com/ label]")).toBe(
      "Document(Paragraph(urlLink(urlLinkMark,urlLinkMark)))",
    );
  });

  it("parses whitespace-only brackets as blanks before WikiLinks", () => {
    expect(tree("[ ] [　] [\t] [ 　 \t　\t ] [page]")).toBe(
      "Document(Paragraph(blank,blank,blank,blank,link(linkMark,linkMark)))",
    );
    // "[*** [ ]]" is now correctly recognized as a Bold decoration
    // wrapping a nested Blank, since parseDecoration tracks bracket
    // depth and recurses into its content (see the "recursively
    // parses a decoration's content" test above). The bare "[]" still
    // matches nothing (empty content) and stays as plain text.
    expect(tree("[] [*** [ ]]")).toBe(
      "Document(Paragraph(Bold(BoldMark,blank,BoldMark)))",
    );
  });

  it("structurally dispatches single brackets after finding their matching close", () => {
    expect(
      tree("[$ x + [y]] [me.icon*3] [/project/page] [N35.68,E139.76,Z14]"),
    ).toBe(
      "Document(Paragraph(Math,icon,ProjectLink(ProjectLinkMark,ProjectLinkMark),location))",
    );
    expect(tree("[a [b] c] [unterminated [page]")).toBe(
      "Document(Paragraph(link(linkMark,linkMark),link(linkMark,linkMark)))",
    );
  });

  it("classifies URLs by their structure rather than rule priority", () => {
    expect(
      tree(
        "[https://example.com/] [https://example.com/a.png] [https://example.com/a.png https://example.com/] [label https://example.com/] [https://example.com/ label]",
      ),
    ).toBe(
      "Document(Paragraph(urlLink(urlLinkMark,urlLinkMark),image,imageLink,urlLink(urlLinkMark,urlLinkMark),urlLink(urlLinkMark,urlLinkMark)))",
    );
    expect(tree("[https://example.com/ label [page]]")).toBe(
      "Document(Paragraph(urlLink(urlLinkMark,link(linkMark,linkMark),urlLinkMark)))",
    );
  });

  it("treats a URL ending in an image extension as an image even when the extension is not in its path", () => {
    // Scrapbox-compatible trick: appending ".png" (e.g. "&s=10.png" or
    // "#.png") forces an extensionless URL to be treated as an image.
    expect(
      tree(
        "[https://example.com/images?q=abc&s=10.png] [https://example.com/img#.png]",
      ),
    ).toBe("Document(Paragraph(image,image))");
    // An extension in the middle of the query is not a trailing one.
    expect(tree("[https://example.com/page?file=a.png&x=1]")).toBe(
      "Document(Paragraph(urlLink(urlLinkMark,urlLinkMark)))",
    );
  });

  it("treats an attachment path with an image extension as an image", () => {
    expect(tree("[@/abc123def456ghi/a.png] [[@/abc123def456ghi/a.png]]")).toBe(
      "Document(Paragraph(image,strong(strongMark,strongImage,strongMark)))",
    );
    // Not an image: an ordinary wiki link.
    expect(tree("[@/abc123def456ghi/a.pdf]")).toBe(
      "Document(Paragraph(link(linkMark,linkMark)))",
    );
  });

  it("parses double brackets as strong and preserves nested bracket pairing", () => {
    expect(
      tree("[[strong [page]]] [[https://example.com/a.png]] [[me.icon]]"),
    ).toBe(
      "Document(Paragraph(strong(strongMark,link(linkMark,linkMark),strongMark),strong(strongMark,strongImage,strongMark),strong(strongMark,StrongIcon,strongMark)))",
    );
    expect(tree("[[]] [[unterminated]")).toBe(
      "Document(Paragraph(link(linkMark,linkMark)))",
    );
  });

  it("parses Bold regardless of how many asterisks are used", () => {
    expect(tree("[* one]")).toBe(
      "Document(Paragraph(Bold(BoldMark,BoldMark)))",
    );
    expect(tree("[** two]")).toBe(
      "Document(Paragraph(Bold(BoldMark,BoldMark)))",
    );
    expect(tree("[***** five]")).toBe(
      "Document(Paragraph(Bold(BoldMark,BoldMark)))",
    );
  });

  it("falls through to link when an asterisk run has no following space", () => {
    // No space after the asterisks -- Bold doesn't match, and the
    // content isn't whitespace-only either, so this still resolves to
    // a WikiLink, matching the old exact-"[* "-prefix behavior.
    expect(tree("[**]")).toBe("Document(Paragraph(link(linkMark,linkMark)))");
  });

  it("parses Italic through the same generic decoration dispatcher as Bold", () => {
    expect(tree("[/ italic]")).toBe(
      "Document(Paragraph(Italic(ItalicMark,ItalicMark)))",
    );
  });

  it("generalizes the repeated-character rule to Italic too", () => {
    expect(tree("[// two]")).toBe(
      "Document(Paragraph(Italic(ItalicMark,ItalicMark)))",
    );
  });

  it("nests multiple decoration characters in MARKS' canonical order", () => {
    expect(tree("[*/ text]")).toBe(
      "Document(Paragraph(Bold(BoldMark,Italic,BoldMark)))",
    );
  });

  it("nests the same way regardless of the characters' order in the source", () => {
    expect(tree("[/* text]")).toBe(
      "Document(Paragraph(Bold(BoldMark,Italic,BoldMark)))",
    );
  });

  it("recurses into a combined decoration's content", () => {
    expect(tree("[*/ [Link]]")).toBe(
      "Document(Paragraph(Bold(BoldMark,Italic(link(linkMark,linkMark)),BoldMark)))",
    );
  });

  it("recursively parses a decoration's content so a nested link still resolves", () => {
    // Unlike the old parseBold, which stopped scanning at the first "[",
    // the shared decoration dispatcher tracks bracket depth and re-parses
    // its content as inline, so a nested link inside the decoration works.
    expect(tree("[* [Link] text]")).toBe(
      "Document(Paragraph(Bold(BoldMark,link(linkMark,linkMark),BoldMark)))",
    );
  });

  it("parses code: blocks until their indentation returns", () => {
    expect(
      tree("before\ncode:typescript\n\t[not-a-link]\n\tconst x = 1\nafter"),
    ).toBe(
      "Document(Paragraph,CodeBlock(CodeBlockMark,indent,indent),Paragraph)",
    );
    expect(tree("\tcode:main.rs(rust)\n\t\tfn main() {}\n\tnext")).toBe(
      "Document(CodeBlock(indent,CodeBlockMark,indent),Paragraph(indent))",
    );
  });

  it("does not treat the removed fenced-code syntax as a block", () => {
    expect(tree("```ts\n[page]\n``` ")).toBe(
      "Document(Paragraph(code(codeMark,codeMark)),Paragraph(link(linkMark,linkMark)),Paragraph(code(codeMark,codeMark)))",
    );
  });

  it("parses tab-indented table rows and delegates each cell to inline rules", () => {
    expect(
      tree("table:links\n\t[* bold]\t[page]\t`code`\n\t#tag\t[ ]\t\noutside"),
    ).toBe(
      "Document(Table(TableMark,TableRow(indent,TableCell(Bold(BoldMark,BoldMark)),TableCell(link(linkMark,linkMark)),TableCell(code(codeMark,codeMark))),TableRow(indent,TableCell(hashTag),TableCell(blank),TableCell)),Paragraph)",
    );
  });

  it("terminates tables at equal or shallower indentation", () => {
    expect(tree("\ttable:nested\n\t\ta\tb\n\tnext\ntail")).toBe(
      "Document(Table(indent,TableMark,TableRow(indent,TableCell,TableCell)),Paragraph(indent),Paragraph)",
    );
  });

  it("parses a quote line and delegates its content to Cardpot inline rules", () => {
    expect(tree("> [* bold] [page] `code`")).toBe(
      "Document(quote(quoteMark,Bold(BoldMark,BoldMark),link(linkMark,linkMark),code(codeMark,codeMark)))",
    );
    expect(tree(">no separating space")).toBe("Document(quote(quoteMark))");
  });

  it("recognizes quote prefixes after any supported indentation", () => {
    expect(tree("  > indented quote")).toBe(
      "Document(quote(indent,quoteMark))",
    );
    expect(tree("\t> indented quote")).toBe(
      "Document(quote(indent,quoteMark))",
    );
  });

  it("records each non-blank line's ECMAScript whitespace indentation", () => {
    const input = "plain\n \t　nested\n\fother";
    expect(tree(input)).toBe(
      "Document(Paragraph,Paragraph(indent),Paragraph(indent))",
    );
    // The ranges themselves encode the character-count depth. `isIndent`
    // gives consumers a NodeProp-based way to recognize these semantic nodes.
    expect(indentRanges(input)).toEqual([
      { from: 6, to: 9 },
      { from: 16, to: 17 },
    ]);
    expect(Indent.prop(isIndent)).toBe(true);
  });

  it("consumes whitespace-only lines that Lezer itself does not treat as blank", () => {
    expect(tree("\u3000\n> quote\n\tnext")).toBe(
      "Document(quote(quoteMark),Paragraph(indent))",
    );
  });

  it("records only the block's own indent level for deeper code/table rows", () => {
    expect(indentRanges("code:x\n\t\tfoo")).toEqual([{ from: 7, to: 8 }]);
    expect(indentRanges("table:x\n\t\ta\tb")).toEqual([{ from: 8, to: 9 }]);
  });

  it("uses the same indentation rule for code and table continuation rows", () => {
    expect(tree(" code:js\n  const x = 1\n　　nested\nafter")).toBe(
      "Document(CodeBlock(indent,CodeBlockMark,indent,indent),Paragraph)",
    );
    expect(tree("　table:data\n　 a\tb\nnext")).toBe(
      "Document(Table(indent,TableMark,TableRow(indent,TableCell,TableCell)),Paragraph)",
    );
  });
});
