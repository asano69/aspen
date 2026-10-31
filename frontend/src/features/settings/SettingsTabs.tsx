import { For, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Tabs } from "@kobalte/core/tabs";
import SettingsSection from "./SettingsSection";

export interface SettingsTab {
  // Unique key of the tab.
  id: string;
  // Text of the tab in the left column.
  label: string;
  // The panel. Without it the tab shows a "not implemented" placeholder.
  content?: Component;
}

export interface SettingsTabsProps {
  tabs: SettingsTab[];
}

// Shared layout of the user settings and the pod settings: a vertical tab list
// on the left and the selected panel on the right. What the tabs are and what
// they hold is up to the caller.
export default function SettingsTabs(props: SettingsTabsProps) {
  return (
    <Tabs
      orientation="vertical"
      defaultValue={props.tabs[0]?.id}
      class="settings"
    >
      <Tabs.List class="settings-nav">
        <For each={props.tabs}>
          {(tab) => (
            <Tabs.Trigger value={tab.id} class="settings-tab">
              {tab.label}
            </Tabs.Trigger>
          )}
        </For>
      </Tabs.List>
      <For each={props.tabs}>
        {(tab) => (
          <Tabs.Content value={tab.id} class="settings-panel">
            <Show
              when={tab.content}
              fallback={
                <SettingsSection title={tab.label}>
                  <p class="settings-empty">Not implemented yet.</p>
                </SettingsSection>
              }
            >
              <Dynamic component={tab.content} />
            </Show>
          </Tabs.Content>
        )}
      </For>
    </Tabs>
  );
}
