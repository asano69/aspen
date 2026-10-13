import { describe, expect, it } from "vitest";
import type { PotRecord } from "../models/pot";
import { sameGraphData } from "./graphData";
import { potsToGraphData } from "./potGraph";

function pot(id: string, links: string[] = []): PotRecord {
  return { id, title: id.toUpperCase(), links } as PotRecord;
}

const noCover = () => undefined;

describe("potsToGraphData", () => {
  it("makes one node per pot and one edge per link", () => {
    const data = potsToGraphData([pot("a", ["b"]), pot("b")], noCover);
    expect(data.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(data.edges).toEqual([{ source: "a", target: "b" }]);
  });

  it("drops self links and links to unknown pots", () => {
    const data = potsToGraphData([pot("a", ["a", "gone"])], noCover);
    expect(data.edges).toEqual([]);
  });

  it("does not depend on the order of the input", () => {
    const x = potsToGraphData([pot("b"), pot("a", ["b"])], noCover);
    const y = potsToGraphData([pot("a", ["b"]), pot("b")], noCover);
    expect(sameGraphData(x, y)).toBe(true);
  });

  it("passes the cover through", () => {
    const data = potsToGraphData([pot("a")], () => "/cover.svg");
    expect(data.nodes[0].image).toBe("/cover.svg");
  });
});
