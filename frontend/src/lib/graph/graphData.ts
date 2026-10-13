// Plain, framework-free description of a graph. Everything that draws or
// lays out a graph (buildGraph.ts, features/graph) only knows this shape, so
// pots and, later, cards can share it.
export interface GraphNodeData {
  id: string;
  label: string;
  // URL of the icon drawn inside the node.
  image?: string;
}

export interface GraphEdgeData {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

// Used as the memo equality check, so a change that does not alter the graph
// (e.g. reordering pots) does not trigger a new layout.
export function sameGraphData(a: GraphData, b: GraphData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
