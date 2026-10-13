import type { PotRecord } from "../models/pot";
import type { GraphData } from "./graphData";

// Pots as a graph: one node per pot, one edge per entry of its "links".
// Links to pots that are not in `pots` (e.g. deleted ones) and links to the
// pot itself are dropped. Nodes are sorted by id, so the result does not
// depend on the pot order the UI happens to use. `coverOf` is passed in to
// keep this function free of the PocketBase client.
export function potsToGraphData(
  pots: PotRecord[],
  coverOf: (pot: PotRecord) => string | undefined,
): GraphData {
  const sorted = [...pots].sort((a, b) => (a.id < b.id ? -1 : 1));
  const ids = new Set(sorted.map((pot) => pot.id));

  return {
    nodes: sorted.map((pot) => ({
      id: pot.id,
      label: pot.title,
      image: coverOf(pot),
    })),
    edges: sorted.flatMap((pot) =>
      (pot.links ?? [])
        .filter((target) => target !== pot.id && ids.has(target))
        .map((target) => ({ source: pot.id, target })),
    ),
  };
}
