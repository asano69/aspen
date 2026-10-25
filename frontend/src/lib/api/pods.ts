import pb from "./pb";
import { randomKey } from "../randomKey";
import type { PodRecord } from "../models/pod";

// Looks up an pod by its unique "name" field. Pods are addressed by
// this field in the URL instead of their PocketBase id, so any page
// that needs the parent pod for a "/:slug/..." route resolves it
// here rather than duplicating the same filtered lookup.
export async function fetchPodByName(name: string): Promise<PodRecord> {
  return await pb
    .collection("pods")
    .getFirstListItem<PodRecord>(
      pb.filter('name = {:name} && deleted = ""', { name }),
    );
}

// URL of a pod's cover image, or undefined when none is set. The "cover"
// field must not be "Protected" in PocketBase, or the browser cannot load it
// in an <img>.
export function podCoverURL(pod: PodRecord): string | undefined {
  return pod.cover ? pb.files.getURL(pod, pod.cover) : undefined;
}


// Creates a pod. The "name" field is required and pattern-constrained,
// but the real id isn't known until after creation -- so this creates
// with a throwaway placeholder value (satisfying both the required and
// pattern rules) first, then immediately overwrites it with the
// record's own id. No name-picking UI exists yet; this can be replaced
// with a real, user-chosen name once that UI exists.
export async function createPod(
  title: string,
  position: number,
  links: string[] = [],
): Promise<PodRecord> {
  const record = await pb.collection("pods").create<PodRecord>({
    title,
    done: false,
    position,
    links,
    name: randomKey(),
  });
  return await pb
    .collection("pods")
    .update<PodRecord>(record.id, { name: record.id });
}

export async function updatePod(
  id: string,
  changes: Partial<
    Pick<PodRecord, "title" | "position" | "links" | "deleted">
  >,
): Promise<PodRecord> {
  return await pb.collection("pods").update<PodRecord>(id, changes);
}

// Soft-deletes a pod by stamping its "deleted" date; the record itself stays
// in the database, so a pull can report the removal to an offline client.
export async function deletePod(id: string): Promise<void> {
  await updatePod(id, { deleted: new Date().toISOString() });
}
