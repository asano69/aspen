/* eslint-disable solid/reactivity --
   The effect below deliberately rebuilds the whole Sigma instance whenever
   `data` changes; the callback prop is only read inside event handlers. */
import { createEffect, onCleanup } from "solid-js";
import Sigma, { DEFAULT_STYLES } from "sigma";
import {
  extremityArrow,
  layerFill,
  layerPlain,
  pathLine,
} from "sigma/rendering";
import { layerImage } from "@sigma/node-image";
import { buildGraph } from "@/lib/graph/buildGraph";
import type { GraphData } from "@/lib/graph/graphData";
import { cssColor } from "./cssColor";

// Shown for a node without an image.
const PLACEHOLDER_IMAGE = "/favicon.svg";

export interface GraphViewProps {
  data: GraphData;
  onNodeClick?: (id: string) => void;
}

// Draws any GraphData as a directed graph: each node is a filled circle with
// its image inside. It knows nothing about pots or cards. The Sigma instance
// is rebuilt (and laid out again) whenever `data` changes, which is cheap at
// this size and keeps the component simple.
export default function GraphView(props: GraphViewProps) {
  let container!: HTMLDivElement;

  createEffect(() => {
    const graph = buildGraph(props.data);
    const edgeColor = cssColor("--tool-color");
    graph.forEachEdge((edge) => graph.setEdgeAttribute(edge, "color", edgeColor));

    const sigma = new Sigma(graph, container, {
      primitives: {
        nodes: {
          variables: {
            image: { type: "string", default: PLACEHOLDER_IMAGE },
          },
          layers: [layerFill({ color: cssColor("--card-bg") }), layerImage()],
        },
        edges: {
          paths: [pathLine()],
          extremities: [extremityArrow()],
          layers: [layerPlain()],
        },
      },
      styles: {
        nodes: [DEFAULT_STYLES.nodes, { cursor: "pointer" }],
        edges: [DEFAULT_STYLES.edges, { head: "arrow" }],
      },
      settings: {
        // Node sizes are in screen pixels, not graph coordinates.
        itemSizesReference: "screen",
      },
    });

    sigma.on("clickNode", ({ node }) => props.onNodeClick?.(node));
    onCleanup(() => sigma.kill());
  });

  // Sigma needs a container with a non-zero size (see .graph-view).
  return <div ref={container} class="graph-view" />;
}
