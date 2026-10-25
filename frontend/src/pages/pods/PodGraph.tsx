import { createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { GraphView } from "@/features/graph";
import { podCoverURL } from "@/lib/api/pods";
import { sameGraphData, type GraphData } from "@/lib/graph/graphData";
import { podsToGraphData } from "@/lib/graph/podGraph";
import { orderedPods } from "@/lib/stores/podsStore";

const EMPTY: GraphData = { nodes: [], edges: [] };

// The pod list as a graph of related pods. orderedPods() already follows the
// Dexie replica live; the memo only passes on a change that alters the graph,
// so renumbering positions does not lay it out again.
export default function PodGraph() {
  const navigate = useNavigate();
  const data = createMemo(
    () => podsToGraphData(orderedPods(), podCoverURL),
    EMPTY,
    { equals: sameGraphData },
  );

  const open = (id: string) => {
    const pod = orderedPods().find((p) => p.id === id);
    if (pod) navigate(`/${pod.name}`);
  };

  return <GraphView data={data()} onNodeOpen={open} />;
}
