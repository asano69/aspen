import { describe, expect, it } from "vitest";
import type { PodRecord } from "../models/pod";
import { sameGraphData } from "./graphData";
import { podsToGraphData } from "./podGraph";

function pod(id: string, links: string[] = []): PodRecord {
  return { id, title: id.toUpperCase(), links } as PodRecord;
}

const noCover = () => undefined;

describe("podsToGraphData", () => {
  it("makes one node per pod and one edge per link", () => {
    const data = podsToGraphData([pod("a", ["b"]), pod("b")], noCover);
    expect(data.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(data.edges).toEqual([{ source: "a", target: "b" }]);
  });

  it("drops self links and links to unknown pods", () => {
    const data = podsToGraphData([pod("a", ["a", "gone"])], noCover);
    expect(data.edges).toEqual([]);
  });

  it("does not depend on the order of the input", () => {
    const x = podsToGraphData([pod("b"), pod("a", ["b"])], noCover);
    const y = podsToGraphData([pod("a", ["b"]), pod("b")], noCover);
    expect(sameGraphData(x, y)).toBe(true);
  });

  it("passes the cover through", () => {
    const data = podsToGraphData([pod("a")], () => "/cover.svg");
    expect(data.nodes[0].image).toBe("/cover.svg");
  });
});
