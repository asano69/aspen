// Fractional-indexing helper for drag-to-reorder lists backed by a
// single "position" float column (see pages/pods/CardForm.tsx and
// CardList.tsx). Inserting between two existing positions is just
// their average; appending past either end steps by POSITION_STEP so
// ordinary appends don't immediately eat into float precision. This
// never requires a full-list renumber, which matters once a list can
// hold thousands of records spread across pagination and filtered
// views -- only the moved record's own position ever changes.
export const POSITION_STEP = 1000;

// Returns a position that sorts strictly between `prev` and `next`
// (either may be omitted for "moved to the very start/end"). Callers
// are responsible for tie-breaking equal positions elsewhere (see
// CardList's cards sort, which adds `id` as a secondary key).
export function computePosition(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return POSITION_STEP;
  if (prev === undefined) return next! / 2;
  if (next === undefined) return prev + POSITION_STEP;
  return (prev + next) / 2;
}
