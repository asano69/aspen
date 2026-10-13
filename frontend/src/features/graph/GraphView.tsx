/* eslint-disable solid/reactivity --
   The effect below deliberately rebuilds the whole Sigma instance whenever
   `data` changes; the callback prop is only read inside event handlers. */
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import Sigma, { DEFAULT_STYLES } from "sigma";
import ForceSupervisor from "graphology-layout-force/worker";
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

// How much larger the selected node is drawn.
const SELECTED_SCALE = 1.3;

export interface GraphViewProps {
  data: GraphData;
  // Called when a node is opened: a double click, or a click on a node that
  // is already selected. A drag never counts as a click.
  onNodeOpen?: (id: string) => void;
}

// Draws any GraphData as a directed graph: each node is a filled circle with
// its image inside. Nodes can be dragged while a live force layout keeps
// running; a click selects a node. It knows nothing about pots or cards. The
// Sigma instance is rebuilt (and laid out again) whenever `data` changes,
// which is cheap at this size and keeps the component simple.
export default function GraphView(props: GraphViewProps) {
  let container!: HTMLDivElement;

  // Kept outside the effect so the selection survives a rebuild.
  const [selected, setSelected] = createSignal<string | null>(null);

  createEffect(() => {
    const graph = buildGraph(props.data);
    // A node that no longer exists cannot stay selected.
    if (untrack(selected) && !graph.hasNode(untrack(selected)!)) {
      setSelected(null);
    }
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
        nodes: [
          DEFAULT_STYLES.nodes,
          { cursor: "grab" },
          {
            whenState: "isDragged",
            then: {
              labelVisibility: "visible",
              backdropVisibility: "visible",
              cursor: "grabbing",
            },
          },
        ],
        edges: [DEFAULT_STYLES.edges, { head: "arrow" }],
        stage: [{ whenState: "isDragging", then: { cursor: "grabbing" } }],
      },
      settings: {
        // Node sizes are in screen pixels, not graph coordinates.
        itemSizesReference: "screen",
        enableNodeDrag: true,
        // Rescale only once, otherwise the view jumps while a node is dragged.
        autoRescale: "once",
      },
    });

    // Live force layout. A node is pinned while it is dragged, and the layout
    // resumes when it is released.
    const layout = new ForceSupervisor(graph, {
      settings: { repulsion: 0.2, attraction: 0.0002 },
      isNodeFixed: (node) => sigma.getNodeState(node).isDragged,
    });
    layout.start();

    // A click on the selected node opens it; any other click selects.
    sigma.on("clickNode", ({ node }) => {
      if (node === untrack(selected)) props.onNodeOpen?.(node);
      else setSelected(node);
    });
    sigma.on("doubleClickNode", ({ node, preventSigmaDefault }) => {
      // Sigma's default would zoom the camera in.
      preventSigmaDefault();
      props.onNodeOpen?.(node);
    });
    sigma.on("clickStage", () => setSelected(null));

    // Draws the selection by enlarging the node. Runs on its own, so a
    // selection change does not rebuild the graph.
    createEffect(() => {
      const current = selected();
      graph.forEachNode((node, attr) => {
        const base = attr.baseSize ?? attr.size;
        graph.mergeNodeAttributes(node, {
          baseSize: base,
          size: node === current ? base * SELECTED_SCALE : base,
        });
      });
      sigma.refresh();
    });

    onCleanup(() => {
      layout.kill();
      sigma.kill();
    });
  });

  // Sigma needs a container with a non-zero size (see .graph-view).
  return <div ref={container} class="graph-view" />;
}
