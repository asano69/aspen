import { describe, expect, it } from "vitest";
import { decoClasses } from "./decoClasses";

describe("decoClasses", () => {
  it("gives bold a level", () => {
    expect(decoClasses("*")).toEqual(["deco-*", "level", "level-1"]);
    expect(decoClasses("***")).toEqual(["deco-*", "level", "level-3"]);
  });

  it("caps the level", () => {
    expect(decoClasses("*".repeat(12))).toContain("level-10");
  });

  it("stacks combined characters regardless of their order", () => {
    expect(new Set(decoClasses("*/"))).toEqual(new Set(decoClasses("/*")));
  });

  it("does not give other characters a level", () => {
    expect(decoClasses("/-")).toEqual(["deco-/", "deco--"]);
  });
});
