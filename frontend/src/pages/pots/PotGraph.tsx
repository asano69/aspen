import { createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { GraphView } from "@/features/graph";
import { potCoverURL } from "@/lib/api/pots";
import { sameGraphData, type GraphData } from "@/lib/graph/graphData";
import { potsToGraphData } from "@/lib/graph/potGraph";
import { orderedPots } from "@/lib/stores/potsStore";

const EMPTY: GraphData = { nodes: [], edges: [] };

// The pot list as a graph of related pots. orderedPots() already follows the
// Dexie replica live; the memo only passes on a change that alters the graph,
// so renumbering positions does not lay it out again.
export default function PotGraph() {
  const navigate = useNavigate();
  const data = createMemo(
    () => potsToGraphData(orderedPots(), potCoverURL),
    EMPTY,
    { equals: sameGraphData },
  );

  const open = (id: string) => {
    const pot = orderedPots().find((p) => p.id === id);
    if (pot) navigate(`/${pot.name}`);
  };

  return <GraphView data={data()} onNodeOpen={open} />;
}
