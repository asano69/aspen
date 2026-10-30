import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTitleCandidate } from "./card";
import { titleToLowerKey } from "./slugify";

// Shared with the Go tests (internal/serve/title_derivation_test.go and
// internal/wikilink/title_derivation_test.go). The frontend does not resolve
// titles itself, but it derives the same key (titleLc) from a candidate to
// match links to cards, so the two must agree.
interface FixtureCase {
  name: string;
  candidate: string;
  title: string;
  empty?: boolean;
}

// Resolved from the working directory, like extractLinks.test.ts.
const fixture: FixtureCase[] = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../testdata/title-derivation.json"),
    "utf8",
  ),
);

describe("title derivation fixture", () => {
  it("has uniquely named cases", () => {
    const names = fixture.map((c) => c.name);
    expect(fixture.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const c of fixture) {
    it(c.name, () => {
      // A candidate with no usable text has no key (the server falls back to
      // "Untitled" for the card itself).
      const want = c.empty ? "" : c.title.toLowerCase().replaceAll(" ", "_");
      expect(titleToLowerKey(c.candidate)).toBe(want);
    });
  }
});

describe("makeTitleCandidate", () => {
  it("trims both ends, including full-width spaces and tabs", () => {
    expect(makeTitleCandidate(" \t abc \u3000")).toBe("abc");
  });

  it("keeps inner whitespace", () => {
    expect(makeTitleCandidate("a  b\tc")).toBe("a  b\tc");
  });
});
