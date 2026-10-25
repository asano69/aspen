import type { EntityTable, IDType } from "dexie";
import { pullAll, type ReplicaRecord } from "../api/replication";
import { readCheckpoint, writeCheckpoint } from "./checkpoints";

// The write side of one replicated collection's local copy. Reads stay with
// each collection (a collection with a UI store has its own queries, see
// cardsCollection.ts); everything the generic sync code needs is here.
export interface Replica<T extends ReplicaRecord> {
  // The PocketBase collection name, also the pull URL segment and the
  // realtime channel (see internal/replica).
  name: string;
  put(records: T[]): Promise<void>;
  remove(id: string): Promise<void>;
}

// A replica for a table that stores records exactly as the server sends them.
export function tableReplica<T extends ReplicaRecord>(
  name: string,
  table: EntityTable<T, "id">,
): Replica<T> {
  return {
    name,
    put: async (records) => {
      await table.bulkPut(records);
    },
    // IDType<T, "id"> is unresolved for a generic T, although a ReplicaRecord's
    // id is always a string.
    remove: (id) => table.delete(id as IDType<T, "id">),
  };
}

// Applies changed records to a replica: a soft-deleted record is removed,
// everything else is upserted. Used for pulled records and realtime events
// alike.
export async function applyRecords<T extends ReplicaRecord>(
  replica: Replica<T>,
  records: T[],
): Promise<void> {
  const live = records.filter((record) => !record.deleted);
  if (live.length) await replica.put(live);
  for (const record of records) {
    if (record.deleted) await replica.remove(record.id);
  }
}

// Pulls every change to a collection in a pod since its stored checkpoint
// (see lib/api/replication.ts), applies it (see applyRecords), and advances
// the checkpoint. Rejects when the pull fails; callers decide how to report it.
export async function syncReplica<T extends ReplicaRecord>(
  replica: Replica<T>,
  podId: string,
): Promise<void> {
  const after = await readCheckpoint(replica.name, podId);
  const { records, checkpoint } = await pullAll<T>(replica.name, podId, after);
  await applyRecords(replica, records);
  if (checkpoint) await writeCheckpoint(replica.name, podId, checkpoint);
}
