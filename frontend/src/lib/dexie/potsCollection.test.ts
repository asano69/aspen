import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { PotRecord } from "../models/pot";
import { potsReplica, readPots } from "./potsCollection";

function pot(id: string, position: number): PotRecord {
  return {
    id,
    collectionId: "c",
    collectionName: "pots",
    name: id,
    title: id,
    done: false,
    position,
    links: [],
    deleted: "",
    created: "",
    updated: "",
  };
}

describe("pots replica", () => {
  it("reads pots in position order and forgets a removed one", async () => {
    await potsReplica.put([pot("b", 2), pot("a", 1), pot("c", 3)]);
    expect((await readPots()).map((p) => p.id)).toEqual(["a", "b", "c"]);

    await potsReplica.remove("b");
    expect((await readPots()).map((p) => p.id)).toEqual(["a", "c"]);
  });
});
