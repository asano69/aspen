import { createEffect, onCleanup } from "solid-js";

// Sets the browser tab's title reactively to whatever `title()`
// returns, restoring whatever document.title held before this ran once
// the calling page unmounts. That restore is what keeps a page with no
// title of its own (e.g. the pods list) from being left showing a
// stale title after the user navigates away from a page that set one.
//
// `title()` returning undefined (e.g. still loading) leaves the
// current title untouched instead of clearing it, so the tab never
// flashes blank while data is in flight.
export function useTitle(title: () => string | undefined): void {
  const previous = document.title;
  createEffect(() => {
    const next = title();
    if (next) document.title = next;
  });
  onCleanup(() => {
    document.title = previous;
  });
}
