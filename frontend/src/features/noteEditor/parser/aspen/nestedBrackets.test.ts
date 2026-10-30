import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { aspenSyntaxLanguage } from ".";

// Shared with the Go test (internal/parser/nested_test.go): the cases are
// the contract between the two parsers for nested brackets, taken from what
// Cosense does. Each case lists the top-level inline nodes of one line as
// "name:source"; text between them is plain.
interface FixtureCase {
  name: string;
  text: string;
  nodes: string[];
}

// Resolved from the working directory, like extractLinks.test.ts.
const fixture: FixtureCase[] = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../testdata/nested-brackets.json"),
    "utf8",
  ),
);

// The first line of a card is its title and is never parsed, so the text goes
// on the second line.
const TITLE_LINE = "T\n";

function inlineNodes(text: string): string[] {
  const doc = TITLE_LINE + text;
  const line =
    aspenSyntaxLanguage.parser.parse(doc).topNode.firstChild?.nextSibling;
  const nodes: string[] = [];
  for (let node = line?.firstChild; node; node = node.nextSibling) {
    nodes.push(`${node.name}:${doc.slice(node.from, node.to)}`);
  }
  return nodes;
}

describe("nested brackets fixture", () => {
  it("has uniquely named cases", () => {
    const names = fixture.map((c) => c.name);
    expect(fixture.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const c of fixture) {
    it(c.name, () => expect(inlineNodes(c.text)).toEqual(c.nodes));
  }
});
