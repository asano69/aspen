import { createResource } from "solid-js";
import { useParams } from "@solidjs/router";
import { SettingsTabs, type SettingsTab } from "@/features/settings";
import { fetchPodByName, podCoverURL } from "@/lib/api/pods";
import { orderedPods } from "@/lib/stores/podsStore";
import { useTopBarPodLink } from "@/lib/topBarSlot";
import PodGitSettings from "./PodGitSettings";

// Add a `content` to a tab once its settings exist.
const TABS: SettingsTab[] = [
  { id: "general", label: "General Settings" },
  { id: "git", label: "Git Settings", content: PodGitSettings },
  { id: "cover", label: "Cover" },
  { id: "theme", label: "Theme" },
  { id: "export", label: "Export your pod data" },
  { id: "import", label: "Import your pod data" },
];

// Route: /pods/:podName/settings. This route is outside PodLayout, so the
// TopBar's pod link is registered here: it is the way back to the pod's top.
export default function PodSettings() {
  const params = useParams();
  const [pod] = createResource(() => params.podName, fetchPodByName);

  // The pods store holds the latest title (it changes on rename), while the
  // fetched record does not.
  const title = () =>
    orderedPods().find((p) => p.id === pod()?.id)?.title ?? pod()?.title;

  useTopBarPodLink(() =>
    pod()
      ? {
          name: title()!,
          slug: pod()!.name,
          id: pod()!.id,
          cover: podCoverURL(pod()!),
        }
      : undefined,
  );

  return <SettingsTabs tabs={TABS} />;
}
