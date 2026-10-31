import { SettingsTabs, type SettingsTab } from "@/features/settings";

// Add a `content` to a tab once its settings exist.
const TABS: SettingsTab[] = [
  { id: "general", label: "General Settings" },
  { id: "git-profile", label: "Git Profile" },
  { id: "avatar", label: "Avatar" },
  { id: "api-tokens", label: "API Tokens" },
  { id: "webhooks", label: "Webhook Notifications" },
  { id: "bot-users", label: "Bot Users" },
  { id: "backup", label: "Backup" },
];

// Route: /settings
export default function UserSettings() {
  return <SettingsTabs tabs={TABS} />;
}
