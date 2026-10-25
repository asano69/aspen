// Telomere: the thin vertical bar left of each line that shows how fresh the
// line is. This module holds only pure data types and rules, so it is
// testable without CodeMirror or Solid.
import type { TelomereLine } from "../api/generated";

// "read": nothing new. "unread": edited by someone else since this user last
// left the card. "updated": edited after the card was opened.
export type TelomereStatus = "read" | "unread" | "updated";

export interface TelomereEntry {
  // ID of the line; empty when unknown (e.g. a line edited in this session).
  id: string;
  // Epoch milliseconds of the line's last recorded edit.
  updatedAt: number;
  // Who made that edit; empty when unknown (e.g. an edit of another user in
  // this session).
  user: string;
  status: TelomereStatus;
}

// Converts the server's rows (see internal/serve/telomere.go) into entries.
export function telomereEntries(lines: TelomereLine[]): TelomereEntry[] {
  return lines.map((line) => ({
    id: line.id,
    updatedAt: line.updated * 1000,
    user: line.user,
    status: line.unread ? "unread" : "read",
  }));
}

const HOUR_MS = 3_600_000;

// Border width in pixels for a line last edited `ageMs` ago: 10px for a fresh
// edit, thinning logarithmically down to 1px. The width shrinks by 1px each
// time (hours + 2) grows by a factor of e. An age below zero (clock skew)
// counts as fresh; Infinity gives the thinnest bar.
export function telomereThickness(ageMs: number): number {
  const hours = Math.max(0, ageMs) / HOUR_MS;
  return Math.max(1, 10 - Math.floor(Math.log(hours + 2)));
}
