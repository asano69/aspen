import type { PodRecord } from "../models/pod";
import type { GraphData } from "./graphData";

// Pods as a graph: one node per pod, one edge per entry of its "links".
// Links to pods that are not in `pods` (e.g. deleted ones) and links to the
// pod itself are dropped. Nodes are sorted by id, so the result does not
// depend on the pod order the UI happens to use. `coverOf` is passed in to
// keep this function free of the PocketBase client.
export function podsToGraphData(
  pods: PodRecord[],
  coverOf: (pod: PodRecord) => string | undefined,
): GraphData {
  const sorted = [...pods].sort((a, b) => (a.id < b.id ? -1 : 1));
  const ids = new Set(sorted.map((pod) => pod.id));

  return {
    nodes: sorted.map((pod) => ({
      id: pod.id,
      label: pod.title,
      image: coverOf(pod),
    })),
    edges: sorted.flatMap((pod) =>
      (pod.links ?? [])
        .filter((target) => target !== pod.id && ids.has(target))
        .map((target) => ({ source: pod.id, target })),
    ),
  };
}
