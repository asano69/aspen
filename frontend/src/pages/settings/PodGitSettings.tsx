import { createEffect, createResource, createSignal, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { SettingsRow, SettingsSection } from "@/features/settings";
import { fetchGitSettings, saveGitSettings } from "@/lib/api/pods";

// The "Git Settings" tab of the pod settings: the remote the pod's Git
// repository is pushed to after each commit. The password is write-only: an
// empty field keeps the stored one.
export default function PodGitSettings() {
  const params = useParams();
  const [settings, { mutate }] = createResource(
    () => params.podName,
    fetchGitSettings,
  );
  const [url, setUrl] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    const loaded = settings();
    if (!loaded) return;
    setUrl(loaded.url);
    setUsername(loaded.username);
  });

  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    try {
      const saved = await saveGitSettings(params.podName, {
        url: url(),
        username: username(),
        password: password(),
      });
      mutate(saved);
      setPassword("");
      setMessage("Saved.");
    } catch (err) {
      console.error("[pod-git] failed to save:", err);
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Git Settings">
      <form onSubmit={save} class="settings-section-body">
        <SettingsRow label="Remote URL">
          <input
            type="url"
            class="input"
            placeholder="https://example.com/me/pod.git"
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
          />
        </SettingsRow>
        <SettingsRow label="Username">
          <input
            type="text"
            class="input"
            autocomplete="off"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
        </SettingsRow>
        <SettingsRow label="Password or token">
          <input
            type="password"
            class="input"
            autocomplete="new-password"
            placeholder={settings()?.hasPassword ? "(unchanged)" : ""}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </SettingsRow>
        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>
        <Show when={message()}>
          <p class="settings-empty">{message()}</p>
        </Show>
        <div>
          <button type="submit" class="btn" disabled={saving()}>
            {saving() ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </SettingsSection>
  );
}
