import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createPot, deletePot, fetchAllPots, updatePot } from "../api/pots";
import type { PotRecord } from "../models/pot";
import { computePosition } from "../position";

// Global cache of every "pots" record, keyed by id. Every view of the
// pot list (the pots page, the sidebar) reads from here, so a change
// made in one is immediately visible in the other. Unlike cardsStore,
// there is no realtime subscription yet: changes made elsewhere only
// show up after a reload.
const [potsById, setPotsById] = createStore<Record<string, PotRecord>>({});

// Whether the initial fetch (see loadAllPots below) has completed.
const [potsLoaded, setPotsLoaded] = createSignal(false);

export { potsLoaded };

// Every pot, sorted ascending by "position" -- unlike cards, pots have
// no pin concept, so this is a single flat ordering. Reactive when
// called inside a tracking scope.
export function orderedPots(): PotRecord[] {
  return Object.values(potsById).sort((a, b) => a.position - b.position);
}

function mergePot(record: PotRecord) {
  setPotsById(record.id, record);
}

// Fetches every pot once and merges it into the store. Called once
// from AppShell. Like loadAllCards, a failure is only logged and the
// store simply stays empty.
export async function loadAllPots(): Promise<void> {
  try {
    const records = await fetchAllPots();
    setPotsById(
      produce((store) => {
        for (const record of records) store[record.id] = record;
      }),
    );
  } catch (err) {
    console.error("[pots] failed to load pots:", err);
  } finally {
    setPotsLoaded(true);
  }
}

// Position for a newly created pot: one past the current highest
// position, so it's always appended at the end regardless of any gaps
// left by earlier deletes or reorders. New pots still start on this
// simple incrementing scale; only reordering (see reorderPot) switches
// to fractional indexing.
function nextPotPosition(): number {
  const pots = orderedPots();
  return pots.length === 0 ? 0 : pots[pots.length - 1].position + 1;
}

export async function addPot(
  title: string,
  links: string[] = [],
): Promise<PotRecord> {
  const record = await createPot(title, nextPotPosition(), links);
  mergePot(record);
  return record;
}

export async function renamePot(id: string, title: string): Promise<void> {
  mergePot(await updatePot(id, { title }));
}

export async function removePot(id: string): Promise<void> {
  await deletePot(id);
  setPotsById(
    produce((store) => {
      delete store[id];
    }),
  );
}

// Applies the new position immediately, then persists it; rolls back
// if the request fails.
async function persistPosition(id: string, position: number): Promise<void> {
  const previous = potsById[id]?.position;
  if (previous === undefined) return;

  setPotsById(id, "position", position);
  try {
    mergePot(await updatePot(id, { position }));
  } catch (err) {
    console.error("[pots] failed to reorder pot:", err);
    setPotsById(id, "position", previous);
  }
}

// Persists a drag-to-reorder drop: only the moved pot's own position
// changes, computed from fractional indexing (see lib/position.ts)
// between whichever two pots now sit on either side of it -- no
// full-list renumber needed. `fromIndex`/`toIndex` are indexes into
// orderedPots().
export function reorderPot(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;

  const list = orderedPots();
  const moved = list[fromIndex];
  if (!moved) return;

  const rest = list.filter((pot) => pot.id !== moved.id);
  // Ascending order: the pot now before the drop slot has the smaller
  // position, the one after has the larger -- the same order
  // computePosition's (prev, next) already expects.
  const position = computePosition(
    rest[toIndex - 1]?.position,
    rest[toIndex]?.position,
  );
  void persistPosition(moved.id, position);
}
