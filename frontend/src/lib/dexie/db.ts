import Dexie, { type EntityTable, type Table } from "dexie";
import type { CardRecord } from "../models/card";
import type { CardLinkRecord } from "../models/cardLink";
import type { PotRecord } from "../models/pot";

// pin is stored as 0/1 rather than a real boolean, since whether
// IndexedDB indexes can key on booleans varies by browser.
export interface CachedCard extends Omit<CardRecord, "pin"> {
  pin: 0 | 1;
}

// Where the next pull of one collection in one pot resumes (see Checkpoint
// in api/replication.ts).
export interface CheckpointRecord {
  collection: string;
  potId: string;
  updatedAt: string;
  recordId: string; // Checkpoint.id, renamed to avoid clashing with Dexie's own primary key convention
}

// IndexedDB-backed local replica of every replicated collection (see
// internal/replica on the server). All of them share one database, with the
// pot as an indexed column rather than one database per pot. Adding a
// replicated collection means adding a table here.
//
// Indexes are declared ahead of being queried where a query is expected
// (card_links' two), because adding one later needs a version bump, which
// forces a migration on every existing browser. Version 2 added cards'
// [pot+titleLc], which linkAliveQuery.ts uses.
class ReplicaDB extends Dexie {
  cards!: EntityTable<CachedCard, "id">;
  card_links!: EntityTable<CardLinkRecord, "id">;
  pots!: EntityTable<PotRecord, "id">;
  checkpoints!: Table<CheckpointRecord, [string, string]>;

  constructor() {
    super("cardpot-replica");
    this.version(1).stores({
      cards: "id, pot, [pot+pin+position]",
      card_links: "id, source, [target_pot+target_titleLc]",

      checkpoints: "[collection+potId]",
    });
    // Only the changed table is listed: Dexie keeps the others as they were.
    this.version(2).stores({
      cards: "id, pot, [pot+pin+position], [pot+titleLc]",
    });
    // Version 3 added card_lines (the line ids of each card).
    this.version(3).stores({
      card_lines: "id, card",
    });
    // Version 4 dropped card_lines: line ids now come from the Y.Text itself
    // (see lib/models/lineId.ts). Setting a table to null deletes it from
    // browsers that already have it.
    this.version(4).stores({
      card_lines: null,
    });
    // Version 5 added pots, read in position order.
    this.version(5).stores({
      pots: "id, position",
    });
  }
}

export const db = new ReplicaDB();

// Drops the database used before replication was generalized. Can be removed
// once no browser still has it.
void Dexie.delete("cardpot-cards-cache");
