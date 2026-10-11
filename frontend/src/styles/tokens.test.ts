import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolved from the working directory, like extractLinks.test.ts.
const root = resolve(process.cwd(), "src/styles");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

// The public tokens, copied from token.txt.
const PUBLIC_TOKENS = read("tokens.txt")
  .split("\n")
  .map((t) => t.trim())
  .filter(Boolean);

// Source files that may read a token (everything under src/ except this test).
function sourceFiles(): string[] {
  return readdirSync(resolve(root, ".."), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(css|ts|tsx)$/.test(f) && !f.endsWith("tokens.test.ts"))
    .map((f) => resolve(root, "..", f));
}

describe("design tokens", () => {
  const defaults = read("theme/default.css");

  // Tokens nothing reads yet are only reserved (see default.css), so they
  // need no value.
  it("declares every public token that a component reads", () => {
    const sources = sourceFiles().map((f) => readFileSync(f, "utf8"));
    const used = PUBLIC_TOKENS.filter((name) =>
      sources.some((text) => text.includes(`var(${name}`)),
    );
    const missing = used.filter(
      (name) => !new RegExp(`^\\s*${name}:`, "m").test(defaults),
    );
    expect(missing).toEqual([]);
  });

  it("never gives a public token a fallback value at its use site", () => {
    const files = [
      "components/card-grid.css",
      "components/related.css",
      "components/page.css",
    ];
    const offenders = files.filter((f) =>
      PUBLIC_TOKENS.some((name) => read(f).includes(`var(${name},`)),
    );
    expect(offenders).toEqual([]);
  });
});
