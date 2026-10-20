#!/usr/bin/env python3
"""
migrate_ydoc_to_base64.py
---
python scripts/migrate_ydoc_to_base64.py pb_data/data.db pb_data/storage
---


One-time backfill: reads the existing file-based `data` field on every
`card_ydocs` record, base64-encodes its bytes, and writes the result
into the new `payload` text field. The original `data` file field is
left untouched -- this script only adds data, it never deletes or
modifies the existing file.

IMPORTANT:
  - Stop the cardpod server before running this, so nothing else is
    writing to data.db at the same time (SQLITE_BUSY risk otherwise).
  - Back up pb_data/ first. This script writes directly to the
    database file.
  - The `card_ydocs` collection must already have the `payload` text
    field created via the PocketBase admin UI before running this.

Usage:
    python scripts/migrate_ydoc_to_base64.py pb_data/data.db pb_data/storage

Safe to re-run: rows whose `payload` is already non-empty are skipped,
so a partial run (e.g. interrupted halfway) can simply be re-run.
"""

import base64
import sqlite3
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <path/to/data.db> <path/to/storage>")
        sys.exit(1)

    db_path = Path(sys.argv[1])
    storage_dir = Path(sys.argv[2])

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Resolve the collection id from its name, so this script keeps
    # working regardless of whether the ydoc_updates -> card_ydocs
    # rename has already happened by the time it's run.
    cur.execute("SELECT id FROM _collections WHERE name = 'card_ydocs'")
    row = cur.fetchone()
    if row is None:
        print("collection 'card_ydocs' not found", file=sys.stderr)
        sys.exit(1)
    collection_id = row[0]

    cur.execute(
        "SELECT id, data FROM card_ydocs "
        "WHERE data != '' AND (payload IS NULL OR payload = '')"
    )
    rows = cur.fetchall()
    print(f"{len(rows)} record(s) to migrate")

    migrated = 0
    for record_id, filename in rows:
        file_path = storage_dir / collection_id / record_id / filename
        if not file_path.exists():
            print(f"  [skip] missing file: {file_path}", file=sys.stderr)
            continue

        data = file_path.read_bytes()
        encoded = base64.b64encode(data).decode("ascii")
        cur.execute(
            "UPDATE card_ydocs SET payload = ? WHERE id = ?",
            (encoded, record_id),
        )
        migrated += 1
        print(f"  [ok] {record_id} ({len(data)} bytes -> {len(encoded)} chars)")

    conn.commit()
    conn.close()
    print(f"done: {migrated}/{len(rows)} migrated")


if __name__ == "__main__":
    main()
