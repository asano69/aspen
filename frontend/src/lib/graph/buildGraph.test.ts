import { describe, expect, it } from "vitest";
import { buildGraph } from "./buildGraph";
import type { GraphData } from "./graphData";

const data: GraphData = {
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "a", target: "b" }, // duplicate
    { source: "b", target: "missing" }, // dangling
  ],
};

describe("buildGraph", () => {
  it("gives every node finite coordinates", () => {
    const graph = buildGraph(data);
    graph.forEachNode((_, attr) => {
      expect(Number.isFinite(attr.x)).toBe(true);
      expect(Number.isFinite(attr.y)).toBe(true);
    });
  });

  it("ignores duplicate and dangling edges", () => {
    expect(buildGraph(data).size).toBe(1);
  });

  it("is deterministic", () => {
    const first = buildGraph(data).getNodeAttributes("c");
    const second = buildGraph(data).getNodeAttributes("c");
    expect(first.x).toBe(second.x);
    expect(first.y).toBe(second.y);
  });

  it("handles an empty graph", () => {
    expect(buildGraph({ nodes: [], edges: [] }).order).toBe(0);
  });
});
