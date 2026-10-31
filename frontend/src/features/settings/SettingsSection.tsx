import type { ParentProps } from "solid-js";

export interface SettingsSectionProps {
  title: string;
}

// One card of a settings panel: a bold title followed by its content (usually
// SettingsRow elements).
export default function SettingsSection(props: ParentProps<SettingsSectionProps>) {
  return (
    <section class="settings-section">
      <h2 class="settings-section-title">{props.title}</h2>
      <div class="settings-section-body">{props.children}</div>
    </section>
  );
}
