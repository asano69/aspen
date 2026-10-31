import type { ParentProps } from "solid-js";

export interface SettingsRowProps {
  label: string;
}

// A label on the left and its control on the right.
export default function SettingsRow(props: ParentProps<SettingsRowProps>) {
  return (
    <div class="settings-row">
      <span class="settings-row-label">{props.label}</span>
      <div class="settings-row-control">{props.children}</div>
    </div>
  );
}
