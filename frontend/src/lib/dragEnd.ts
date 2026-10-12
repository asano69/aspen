import { onCleanup } from "solid-js";

// The card list and the sidebar's pot list share one DragDropProvider (see
// MainLayout), so a card can be dropped on a pot. Each of them registers its
// own drag-end handler here and ignores sources that are not its own (see
// each handler's check of source.type). Same lifetime pattern as useHotkeys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DragEndHandler = (event: any) => void;

const mounted: DragEndHandler[] = [];

// Registers `handler` for as long as the calling component stays mounted.
export function useDragEnd(handler: DragEndHandler): void {
  mounted.push(handler);
  onCleanup(() => {
    const index = mounted.indexOf(handler);
    if (index >= 0) mounted.splice(index, 1);
  });
}

// Passed to the provider's onDragEnd.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchDragEnd(event: any): void {
  for (const handler of [...mounted]) handler(event);
}
