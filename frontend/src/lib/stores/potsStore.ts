import { createRoot, createSignal } from "solid-js";
import { createPot, deletePot, updatePot } from "../api/pots";
import { syncGlobalReplicas } from "../dexie/dataReplicas";
import { createLiveQuery } from "../dexie/liveQuery";
import { potsReplica, readPot, readPots } from "../dexie/potsCollection";
import type { PotRecord } from "../models/pot";
import { computePosition } from "../position";

// Every view of the pot list (the pots page, the sidebar) reads from here, so
// a change made in one is immediately visible in the other. The pots are not
// held in a store of their own: they follow the Dexie replica (see
// lib/dexie/potsCollection.ts), which pulls and realtime events keep current.
// A local change is written through to the replica as soon as the server has
// accepted it, so it shows up without waiting for its realtime echo.
const pots = createRoot(() =>
  createLiveQuery(() => true, readPots, [] as PotRecord[]),
);

// Whether the initial pull (see loadAllPots below) has settled.
const [potsLoaded, setPotsLoaded] = createSignal(false);

export { potsLoaded };

// Every pot, sorted ascending by "position" -- unlike cards, pots have
// no pin concept, so this is a single flat ordering. Reactive when
// called inside a tracking scope.
export function orderedPots(): PotRecord[] {
  return pots();
}

// Pulls every pot change since the stored checkpoint. Called once from
// AppShell. A failure is only logged: the replica keeps whatever it already
// holds, which is also what shows while offline.
export async function loadAllPots(): Promise<void> {
  await syncGlobalReplicas();
  setPotsLoaded(true);
}

// Position for a newly created pot: one past the current highest
// position, so it's always appended at the end regardless of any gaps
// left by earlier deletes or reorders. New pots still start on this
// simple incrementing scale; only reordering (see reorderPot) switches
// to fractional indexing.
function nextPotPosition(): number {
  const list = orderedPots();
  return list.length === 0 ? 0 : list[list.length - 1].position + 1;
}

export async function addPot(
  title: string,
  links: string[] = [],
): Promise<PotRecord> {
  const record = await createPot(title, nextPotPosition(), links);
  await potsReplica.put([record]);
  return record;
}

export async function renamePot(id: string, title: string): Promise<void> {
  await potsReplica.put([await updatePot(id, { title })]);
}

export async function removePot(id: string): Promise<void> {
  await deletePot(id);
  await potsReplica.remove(id);
}

// Applies the new position immediately, then persists it; rolls back
// if the request fails.
async function persistPosition(id: string, position: number): Promise<void> {
  const previous = await readPot(id);
  if (!previous) return;

  await potsReplica.put([{ ...previous, position }]);
  try {
    await potsReplica.put([await updatePot(id, { position })]);
  } catch (err) {
    console.error("[pots] failed to reorder pot:", err);
    await potsReplica.put([previous]);
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
