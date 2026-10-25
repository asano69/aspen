// Pod domain type. Matches the PocketBase "pods" collection schema.
export interface PodRecord {
  id: string;
  // Needed to build the cover's file URL (see podCoverURL in api/pods.ts).
  collectionId: string;
  collectionName: string;
  // File name of the cover image; empty while none is set.
  cover?: string;
  name: string;
  title: string;
  done: boolean;
  position: number;
  // Ids of the pods this pod links to (a multiple relation to "pods").
  // Backlinks are not stored: derive them by scanning the pods store.
  links: string[];
  // Soft-delete timestamp; an empty string while the pod is live.
  deleted: string;
  created: string;
  updated: string;
}
