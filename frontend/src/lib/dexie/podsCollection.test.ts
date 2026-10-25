import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { PodRecord } from "../models/pod";
import { podsReplica, readPods } from "./podsCollection";

function pod(id: string, position: number): PodRecord {
  return {
    id,
    collectionId: "c",
    collectionName: "pods",
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

describe("pods replica", () => {
  it("reads pods in position order and forgets a removed one", async () => {
    await podsReplica.put([pod("b", 2), pod("a", 1), pod("c", 3)]);
    expect((await readPods()).map((p) => p.id)).toEqual(["a", "b", "c"]);

    await podsReplica.remove("b");
    expect((await readPods()).map((p) => p.id)).toEqual(["a", "c"]);
  });
});
