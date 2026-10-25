import pb from "./pb";

// Client of the checkpoint-based pull protocol served by
// /api/pages/{podId}/{collection}/pull (see internal/serve/replication.go),
// shared by every replicated collection (see internal/replica). Soft-deleted
// records are returned like any other changed record -- callers must treat
// them as delete events, not filter them out (see pullHandler's own comment).

// The fields the protocol relies on, common to every replicated collection.
// "deleted" is an empty string while the record is live.
export interface ReplicaRecord {
  id: string;
  updated: string;
  deleted: string;
}

// Mirrors internal/serve/replication.go's checkpoint: both fields
// are needed because several records can share one "updated" value -- the
// id breaks that tie.
export interface Checkpoint {
  updatedAt: string;
  id: string;
}

// The scope of a global collection (e.g. pods), which is not pulled per pod.
// Also the "podId" half of its checkpoint key (see lib/dexie/checkpoints.ts).
export const GLOBAL_SCOPE = "";

// Matches the server's maxPullLimit (see replication.go), so a full
// page always means "there might be more" and a short page always
// means "this was the last one".
export const PULL_LIMIT = 1000;

interface PullResponse<T> {
  records: T[];
}

// Fetches one page of the pull protocol, starting just after `after`
// (or from the beginning when null).
async function pullPage<T>(
  collection: string,
  podId: string,
  after: Checkpoint | null,
): Promise<T[]> {
  const query: Record<string, string | number> = { limit: PULL_LIMIT };
  if (after) {
    query.updatedAt = after.updatedAt;
    query.id = after.id;
  }
  const path =
    podId === GLOBAL_SCOPE
      ? `/api/pages/${collection}/pull`
      : `/api/pages/${podId}/${collection}/pull`;
  const res = await pb.send<PullResponse<T>>(path, { method: "GET", query });
  return res.records;
}

// Pulls every record of `collection` in a pod that changed after `after`,
// paging through the server's checkpoint protocol until a short page signals
// the end. Returns every record pulled, plus the checkpoint to resume from
// next time -- `after` itself when nothing at all was pulled.
export async function pullAll<T extends ReplicaRecord>(
  collection: string,
  podId: string,
  after: Checkpoint | null,
): Promise<{ records: T[]; checkpoint: Checkpoint | null }> {
  const records: T[] = [];
  let checkpoint = after;

  for (;;) {
    const page = await pullPage<T>(collection, podId, checkpoint);
    records.push(...page);
    if (page.length === 0) break;

    const last = page[page.length - 1];
    checkpoint = { updatedAt: last.updated, id: last.id };
    if (page.length < PULL_LIMIT) break;
  }

  return { records, checkpoint };
}
