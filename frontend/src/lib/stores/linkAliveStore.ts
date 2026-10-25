import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { computeAlive } from "../dexie/linkAliveQuery";

// Wiki link results shared by every view that shows links: the note editor,
// the card grid's descriptions and the "New Links" row. Only results live
// here, as booleans keyed by the link's target (pod, titleLc). How a result
// is computed is computeAlive's business alone.
//
// undefined means "not answered yet". Callers must treat it as alive, so a
// link never flashes red before its first answer.
const [alive, setAlive] = createStore<Record<string, boolean>>({});

// Bumped whenever a result changes. Solid views simply read the store; this
// is for consumers outside Solid's tracking (CodeMirror), which need one
// signal to re-run on.
const [version, setVersion] = createSignal(0);
export { version as linkAliveVersion };

// Delay that merges a burst of realtime events into one re-evaluation.
const REFRESH_DELAY_MS = 200;

// Every key somebody asked for. Only these are evaluated, so the cost is
// bounded by what the UI has shown.
const watched = new Map<string, { pod: string; lc: string }>();

// Pods whose replicas have finished their first sync. Evaluating earlier
// would read a half-filled replica and report live links as dead.
const readyPods = new Set<string>();

const keyOf = (pod: string, lc: string) => `${pod}:${lc}`;

// Reactive read: tracks this one key only.
export function linkAlive(pod: string, lc: string): boolean | undefined {
  return alive[keyOf(pod, lc)];
}

async function evaluate(key: string, pod: string, lc: string): Promise<void> {
  try {
    const value = await computeAlive(pod, lc);
    if (!watched.has(key)) return; // released while the query was running
    if (alive[key] === value) return;
    setAlive(key, value);
    setVersion((n) => n + 1);
  } catch (err) {
    console.error("[link-alive] failed to evaluate link:", err);
  }
}

// Asks for the result of a link target. Asking again is a no-op.
export function requestLinkAlive(pod: string, lc: string): void {
  const key = keyOf(pod, lc);
  if (watched.has(key)) return;
  watched.set(key, { pod, lc });
  if (readyPods.has(pod)) void evaluate(key, pod, lc);
}

// Called once a pod's replicas are synced (see PodLayout): answers every
// request that arrived before that.
export function markLinkAlivePodReady(pod: string): void {
  readyPods.add(pod);
  for (const [key, w] of watched) {
    if (w.pod === pod) void evaluate(key, w.pod, w.lc);
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

// Re-evaluates every requested key after the replicas changed (realtime
// events, resyncs).
export function refreshLinkAlive(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const [key, w] of watched) {
      if (readyPods.has(w.pod)) void evaluate(key, w.pod, w.lc);
    }
  }, REFRESH_DELAY_MS);
}

// Forgets a pod's requests and results when the user leaves it.
export function releaseLinkAlive(pod: string): void {
  readyPods.delete(pod);
  for (const [key, w] of watched) {
    if (w.pod === pod) watched.delete(key);
  }
  setAlive(
    produce((store) => {
      for (const key of Object.keys(store)) {
        if (key.startsWith(`${pod}:`)) delete store[key];
      }
    }),
  );
}
