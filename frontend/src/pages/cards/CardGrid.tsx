import type { ParentProps } from "solid-js";
import QuickLaunch from "./QuickLaunch";

// The grid shared by the pod list (the root page) and a pod's card list: the
// quick launch bar above the card grid. What the grid holds (pods or cards)
// and how its items behave is up to the caller.
export default function CardGrid(props: ParentProps) {
  return (
    <>
      <QuickLaunch />
      <ul class="card-grid">{props.children}</ul>
    </>
  );
}
