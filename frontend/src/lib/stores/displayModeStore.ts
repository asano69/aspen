import { createSignal } from "solid-js";

export const DISPLAY_MODES = ["Card", "Table", "Graph"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

// How the pod list (the root page) is shown. A pod's card list will get its
// own signal here once it has a graph view too.
const [podsDisplayMode, setPodsDisplayMode] = createSignal<DisplayMode>("Card");

export { podsDisplayMode, setPodsDisplayMode };
