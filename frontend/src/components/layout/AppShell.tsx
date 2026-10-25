import { onCleanup, onMount, type ParentProps } from "solid-js";
import MainLayout from "./MainLayout";
import { loadAllPods } from "@/lib/stores/podsStore";
import { watchCards } from "@/lib/stores/cardsStore";
import { watchConnection } from "@/lib/stores/connectionStore";
import { watchMergeAlerts } from "@/lib/stores/mergeAlertStore";
import { watchRenameAlerts } from "@/lib/stores/renameAlertStore";
import { watchDataReplicas } from "@/lib/dexie/dataReplicas";
import { installHotkeys } from "@/lib/hotkeys";

// Wraps every route so Header and Sidebar render once regardless of page.
// Passed as Router's `root` prop (see lib/router.tsx) instead of wrapping
// <Router> from outside, since anything AppShell renders needs to live
// inside the router context (e.g. Logo's <A> links).
//
// Realtime is started here and stays on while the app is open: each
// replicated collection has one channel that carries every pod's events (see
// lib/stores/cardsStore.ts and lib/dexie/dataReplicas.ts).
export default function AppShell(props: ParentProps) {
  // Cards are no longer loaded here: each pod's card list pages in on
  // demand (see lib/stores/cardsStore.ts). Only the pod list is
  // fetched up front (see lib/stores/podsStore.ts).
  onMount(() => {
    loadAllPods();
    onCleanup(watchCards());
    onCleanup(watchDataReplicas());
    onCleanup(watchConnection());
    onCleanup(watchMergeAlerts());
    onCleanup(watchRenameAlerts());
    onCleanup(installHotkeys());
  });

  return <MainLayout>{props.children}</MainLayout>;
}
