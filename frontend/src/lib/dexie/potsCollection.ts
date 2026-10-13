import type { PotRecord } from "../models/pot";
import { db } from "./db";
import { tableReplica } from "./replica";

// The write side of the pots replica (see replica.ts). Used by the generic
// sync code and by potsStore.ts's write-through of local changes.
export const potsReplica = tableReplica<PotRecord>("pots", db.pots);

// Every live pot, in position order. Soft-deleted pots are already gone from
// the replica (see applyRecords in replica.ts), so no filtering is needed.
export function readPots(): Promise<PotRecord[]> {
  return db.pots.orderBy("position").toArray();
}

// One pot as stored, as a plain object (never a Solid store proxy, which
// IndexedDB cannot clone).
export function readPot(id: string): Promise<PotRecord | undefined> {
  return db.pots.get(id);
}
