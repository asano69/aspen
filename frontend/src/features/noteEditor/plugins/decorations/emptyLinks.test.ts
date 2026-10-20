import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { cardpodSyntax } from "../../parser/cardpod";
import {
  buildEmptyLinkDecorations,
  emptyLinks,
  setLinkAlive,
} from "./emptyLinks";

function markedTexts(doc: string, isAlive: ((lc: string) => boolean) | null) {
  const state = EditorState.create({
    doc,
    extensions: [cardpodSyntax(), emptyLinks],
  }).update({ effects: setLinkAlive.of(isAlive) }).state;

  const texts: string[] = [];
  buildEmptyLinkDecorations(state).between(0, doc.length, (from, to) => {
    texts.push(doc.slice(from, to));
  });
  return texts;
}

describe("emptyLinks", () => {
  const doc = "T\n[Alive One] [ghost]";

  it("marks only links the predicate calls dead, matching by titleLc", () => {
    expect(markedTexts(doc, (lc) => lc === "alive_one")).toEqual(["[ghost]"]);
  });

  it("marks a hashtag whose target is dead, matching by its title", () => {
    expect(markedTexts("T\n#ghost #alive", (lc) => lc === "alive")).toEqual([
      "#ghost",
    ]);
  });

  it("marks nothing until a predicate is known", () => {
    expect(markedTexts(doc, null)).toEqual([]);
  });
});
