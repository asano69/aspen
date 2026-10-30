// Telomere: the thin vertical bar left of each line that shows how fresh the
// line is. This module holds only pure data types and rules, so it is
// testable without CodeMirror or Solid.
import type { TelomereLine, TelomereResponse } from "../api/generated";

// "read": nothing new. "unread": edited by someone else since this user last
// left the card. "updated": edited after the card was opened (see lineStatus).
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

// The status of a line. `opened` holds the update time of every line when the
// card was opened, so a line that differs from it (or is new) was edited
// since, by anyone. Both sides are server times, so clock skew between the
// server and this browser does not matter. Otherwise the line is unread when
// someone else edited it after the user last left the card.
export function lineStatus(
  line: TelomereLine,
  opened: ReadonlyMap<string, number>,
  reader: TelomereResponse,
): TelomereStatus {
  if (opened.get(line.id) !== line.updated) return "updated";
  const unread =
    line.user !== "" && line.user !== reader.me && line.updated > reader.left;
  return unread ? "unread" : "read";
}

// Converts the server's lines (see internal/serve/telomere.go) into entries.
export function telomereEntries(
  lines: readonly TelomereLine[],
  opened: ReadonlyMap<string, number>,
  reader: TelomereResponse,
): TelomereEntry[] {
  return lines.map((line) => ({
    id: line.id,
    updatedAt: line.updated * 1000,
    user: line.user,
    status: lineStatus(line, opened, reader),
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
