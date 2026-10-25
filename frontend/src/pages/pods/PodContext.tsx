import { createContext, useContext, type Accessor } from "solid-js";
import type { PodRecord } from "@/lib/models/pod";

// Shares the pod record fetched once by PodLayout with every route
// nested under it (CardList, CardForm), so navigating between them
// never issues a second identical fetchPodBySlug request. Duplicate
// in-flight requests to the same PocketBase endpoint get
// auto-cancelled by the SDK, which is what broke navigation once
// CardList and CardForm each fetched the pod on their own.
const PodContext = createContext<Accessor<PodRecord | undefined>>(
  () => undefined,
);

export function usePod(): Accessor<PodRecord | undefined> {
  return useContext(PodContext);
}

export default PodContext;
