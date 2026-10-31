import { SettingsTabs, type SettingsTab } from "@/features/settings";

// Add a `content` to a tab once its settings exist.
const TABS: SettingsTab[] = [
  { id: "general", label: "General Settings" },
  { id: "git", label: "Git Settings" },
  { id: "cover", label: "Cover" },
  { id: "theme", label: "Theme" },
  { id: "export", label: "Export your pod data" },
  { id: "import", label: "Import your pod data" },
];

// Route: /pods/:podName/settings. The pod name is available through
// useParams() once a tab needs it.
export default function PodSettings() {
  return <SettingsTabs tabs={TABS} />;
}
