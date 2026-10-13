import Graph from "graphology";
import forceLayout from "graphology-layout-force";
import type { GraphData } from "./graphData";

const NODE_SIZE = 20;
const EDGE_SIZE = 2;
const INITIAL_RADIUS = 100;
const LAYOUT_ITERATIONS = 200;

// Turns GraphData into a laid-out graphology graph. Pure and deterministic:
// nodes start on a circle (in input order), then a force layout settles them,
// so the same input always gives the same positions. Edges that point to a
// missing node, and duplicate edges, are ignored.
export function buildGraph(data: GraphData): Graph {
  const graph = new Graph({ type: "directed" });
  const count = Math.max(data.nodes.length, 1);

  data.nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / count;
    graph.addNode(node.id, {
      label: node.label,
      size: NODE_SIZE,
      x: Math.cos(angle) * INITIAL_RADIUS,
      y: Math.sin(angle) * INITIAL_RADIUS,
      ...(node.image ? { image: node.image } : {}),
    });
  });

  for (const { source, target } of data.edges) {
    if (!graph.hasNode(source) || !graph.hasNode(target)) continue;
    if (graph.hasDirectedEdge(source, target)) continue;
    graph.addDirectedEdge(source, target, { size: EDGE_SIZE });
  }

  forceLayout.assign(graph, { maxIterations: LAYOUT_ITERATIONS });
  return graph;
}
