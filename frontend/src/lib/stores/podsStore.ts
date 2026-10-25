import { createRoot, createSignal } from "solid-js";
import { createPod, deletePod, updatePod } from "../api/pods";
import { syncGlobalReplicas } from "../dexie/dataReplicas";
import { createLiveQuery } from "../dexie/liveQuery";
import { podsReplica, readPod, readPods } from "../dexie/podsCollection";
import type { PodRecord } from "../models/pod";
import { computePosition } from "../position";

// Every view of the pod list (the pods page, the sidebar) reads from here, so
// a change made in one is immediately visible in the other. The pods are not
// held in a store of their own: they follow the Dexie replica (see
// lib/dexie/podsCollection.ts), which pulls and realtime events keep current.
// A local change is written through to the replica as soon as the server has
// accepted it, so it shows up without waiting for its realtime echo.
const pods = createRoot(() =>
  createLiveQuery(() => true, readPods, [] as PodRecord[]),
);

// Whether the initial pull (see loadAllPods below) has settled.
const [podsLoaded, setPodsLoaded] = createSignal(false);

export { podsLoaded };

// Every pod, sorted ascending by "position" -- unlike cards, pods have
// no pin concept, so this is a single flat ordering. Reactive when
// called inside a tracking scope.
export function orderedPods(): PodRecord[] {
  return pods();
}

// Pulls every pod change since the stored checkpoint. Called once from
// AppShell. A failure is only logged: the replica keeps whatever it already
// holds, which is also what shows while offline.
export async function loadAllPods(): Promise<void> {
  await syncGlobalReplicas();
  setPodsLoaded(true);
}

// Position for a newly created pod: one past the current highest
// position, so it's always appended at the end regardless of any gaps
// left by earlier deletes or reorders. New pods still start on this
// simple incrementing scale; only reordering (see reorderPod) switches
// to fractional indexing.
function nextPodPosition(): number {
  const list = orderedPods();
  return list.length === 0 ? 0 : list[list.length - 1].position + 1;
}

export async function addPod(
  title: string,
  links: string[] = [],
): Promise<PodRecord> {
  const record = await createPod(title, nextPodPosition(), links);
  await podsReplica.put([record]);
  return record;
}

export async function renamePod(id: string, title: string): Promise<void> {
  await podsReplica.put([await updatePod(id, { title })]);
}

export async function removePod(id: string): Promise<void> {
  await deletePod(id);
  await podsReplica.remove(id);
}

// Applies the new position immediately, then persists it; rolls back
// if the request fails.
async function persistPosition(id: string, position: number): Promise<void> {
  const previous = await readPod(id);
  if (!previous) return;

  await podsReplica.put([{ ...previous, position }]);
  try {
    await podsReplica.put([await updatePod(id, { position })]);
  } catch (err) {
    console.error("[pods] failed to reorder pod:", err);
    await podsReplica.put([previous]);
  }
}

// Persists a drag-to-reorder drop: only the moved pod's own position
// changes, computed from fractional indexing (see lib/position.ts)
// between whichever two pods now sit on either side of it -- no
// full-list renumber needed. `fromIndex`/`toIndex` are indexes into
// orderedPods().
export function reorderPod(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;

  const list = orderedPods();
  const moved = list[fromIndex];
  if (!moved) return;

  const rest = list.filter((pod) => pod.id !== moved.id);
  // Ascending order: the pod now before the drop slot has the smaller
  // position, the one after has the larger -- the same order
  // computePosition's (prev, next) already expects.
  const position = computePosition(
    rest[toIndex - 1]?.position,
    rest[toIndex]?.position,
  );
  void persistPosition(moved.id, position);
}
