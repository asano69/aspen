import pb from "./pb";
import { randomKey } from "../randomKey";
import type { PotRecord } from "../models/pot";

// Looks up an pot by its unique "name" field. Pots are addressed by
// this field in the URL instead of their PocketBase id, so any page
// that needs the parent pot for a "/:slug/..." route resolves it
// here rather than duplicating the same filtered lookup.
export async function fetchPotByName(name: string): Promise<PotRecord> {
  return await pb
    .collection("pots")
    .getFirstListItem<PotRecord>(
      pb.filter('name = {:name} && deleted = ""', { name }),
    );
}

// URL of a pot's cover image, or undefined when none is set. The "cover"
// field must not be "Protected" in PocketBase, or the browser cannot load it
// in an <img>.
export function potCoverURL(pot: PotRecord): string | undefined {
  return pot.cover ? pb.files.getURL(pot, pot.cover) : undefined;
}


// Creates a pot. The "name" field is required and pattern-constrained,
// but the real id isn't known until after creation -- so this creates
// with a throwaway placeholder value (satisfying both the required and
// pattern rules) first, then immediately overwrites it with the
// record's own id. No name-picking UI exists yet; this can be replaced
// with a real, user-chosen name once that UI exists.
export async function createPot(
  title: string,
  position: number,
  links: string[] = [],
): Promise<PotRecord> {
  const record = await pb.collection("pots").create<PotRecord>({
    title,
    done: false,
    position,
    links,
    name: randomKey(),
  });
  return await pb
    .collection("pots")
    .update<PotRecord>(record.id, { name: record.id });
}

export async function updatePot(
  id: string,
  changes: Partial<
    Pick<PotRecord, "title" | "position" | "links" | "deleted">
  >,
): Promise<PotRecord> {
  return await pb.collection("pots").update<PotRecord>(id, changes);
}

// Soft-deletes a pot by stamping its "deleted" date; the record itself stays
// in the database, so a pull can report the removal to an offline client.
export async function deletePot(id: string): Promise<void> {
  await updatePot(id, { deleted: new Date().toISOString() });
}
