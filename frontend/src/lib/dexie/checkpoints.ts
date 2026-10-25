import type { Checkpoint } from "../api/replication";
import { db } from "./db";

// Returns the checkpoint stored for a collection in a pod, or null when it
// has never been pulled before.
export async function readCheckpoint(
  collection: string,
  podId: string,
): Promise<Checkpoint | null> {
  const record = await db.checkpoints.get([collection, podId]);
  return record ? { updatedAt: record.updatedAt, id: record.recordId } : null;
}

// Persists the checkpoint to resume a collection's next pull in a pod from.
export async function writeCheckpoint(
  collection: string,
  podId: string,
  checkpoint: Checkpoint,
): Promise<void> {
  await db.checkpoints.put({
    collection,
    podId,
    updatedAt: checkpoint.updatedAt,
    recordId: checkpoint.id,
  });
}
