import type { ParentProps } from "solid-js";
import QuickLaunch from "./QuickLaunch";

// The grid shared by the pot list (the root page) and a pot's card list: the
// quick launch bar above the card grid. What the grid holds (pots or cards)
// and how its items behave is up to the caller.
export default function CardGrid(props: ParentProps) {
  return (
    <>
      <QuickLaunch />
      <ul class="card-grid">{props.children}</ul>
    </>
  );
}
