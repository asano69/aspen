import type { PodRecord } from "../models/pod";
import { db } from "./db";
import { tableReplica } from "./replica";

// The write side of the pods replica (see replica.ts). Used by the generic
// sync code and by podsStore.ts's write-through of local changes.
export const podsReplica = tableReplica<PodRecord>("pods", db.pods);

// Every live pod, in position order. Soft-deleted pods are already gone from
// the replica (see applyRecords in replica.ts), so no filtering is needed.
export function readPods(): Promise<PodRecord[]> {
  return db.pods.orderBy("position").toArray();
}

// One pod as stored, as a plain object (never a Solid store proxy, which
// IndexedDB cannot clone).
export function readPod(id: string): Promise<PodRecord | undefined> {
  return db.pods.get(id);
}
