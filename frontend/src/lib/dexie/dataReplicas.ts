import { subscribeToCollection } from "../api/realtime";
import { GLOBAL_SCOPE, type ReplicaRecord } from "../api/replication";
import { refreshLinkAlive } from "../stores/linkAliveStore";
import { db } from "./db";
import { podsReplica } from "./podsCollection";
import {
  applyRecords,
  syncReplica,
  tableReplica,
  type Replica,
} from "./replica";

// Replicated collections that have no UI store of their own: they are only
// kept current in IndexedDB (pods are read from there by podsStore.ts, which
// has no write path of its own into it). A collection with a UI store (cards,
// see cardsStore.ts) uses the same building blocks from replica.ts itself.
// Adding a collection here, plus its table in db.ts and its line in
// internal/replica on the server, is all it takes to replicate it.
//
// Pod-scoped replicas are pulled per open pod; global ones (not scoped to a
// pod, see internal/replica) are pulled once at startup.
const podScopedReplicas: Replica<ReplicaRecord>[] = [
  tableReplica("card_links", db.card_links),
];
const globalReplicas: Replica<ReplicaRecord>[] = [podsReplica];
const dataReplicas = [...podScopedReplicas, ...globalReplicas];

// Pods opened in this session. A pod is pulled when it opens (which also
// covers everything missed while it was closed) and again after a realtime
// gap, but only while it is open.
const openPods = new Set<string>();

async function syncSafely(
  replica: Replica<ReplicaRecord>,
  scope: string,
): Promise<void> {
  try {
    await syncReplica(replica, scope);
  } catch (err) {
    console.error(`[${replica.name}] failed to sync replica:`, err);
  }
}

// Brings every pod-scoped replica of a pod up to date and keeps it synced from
// now on. Global replicas are not pulled per pod (see syncGlobalReplicas). A
// failure is only logged; the next open (or gap) retries from the same
// checkpoint.
export async function openPodReplicas(podId: string): Promise<void> {
  openPods.add(podId);
  await Promise.all(
    podScopedReplicas.map((replica) => syncSafely(replica, podId)),
  );
}

export function closePodReplicas(podId: string): void {
  openPods.delete(podId);
}

// Brings every global replica up to date. A failure is only logged; the next
// start (or gap) retries from the same checkpoint.
export async function syncGlobalReplicas(): Promise<void> {
  await Promise.all(
    globalReplicas.map((replica) => syncSafely(replica, GLOBAL_SCOPE)),
  );
}

async function resync(replica: Replica<ReplicaRecord>): Promise<void> {
  const scopes = globalReplicas.includes(replica)
    ? [GLOBAL_SCOPE]
    : [...openPods];
  for (const scope of scopes) await syncSafely(replica, scope);
  refreshLinkAlive();
}

// Applies the realtime events of every data replica to IndexedDB and returns
// a function that stops watching. Events of pods that are not open are
// applied too: they are idempodent, and the next open pulls anyway. Called
// once by AppShell for as long as the app is open.
export function watchDataReplicas(): () => void {
  const stops = dataReplicas.map((replica) =>
    subscribeToCollection<ReplicaRecord>(
      replica.name,
      (event) => {
        applyRecords(replica, [event.record])
          .then(() => refreshLinkAlive())
          .catch((err) =>
            console.error(`[${replica.name}] failed to apply event:`, err),
          );
      },
      () => void resync(replica),
    ),
  );
  return () => stops.forEach((stop) => stop());
}
