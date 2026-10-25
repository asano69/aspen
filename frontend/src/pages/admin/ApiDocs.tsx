import { createSignal } from "solid-js";

import pb from "@/lib/api/pb";

// Minimal GET-only API tester, replacing the need to run fetch() by hand in
// the browser console with a manually copied auth token (see pb.ts's own
// authStore). Not a SwaggerUI-style explorer -- just a URL box, a Go
// button, and a response viewer -- since that's all manual endpoint testing
// actually needs.
export default function ApiDocs() {
  const [url, setUrl] = createSignal("/api/version");
  const [status, setStatus] = createSignal<number>();
  const [body, setBody] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setStatus(undefined);
    setBody("");
    try {
      const res = await fetch(url(), {
        headers: pb.authStore.token
          ? { Authorization: pb.authStore.token }
          : {},
      });
      setStatus(res.status);
      const text = await res.text();
      // Pretty-print JSON responses; fall back to raw text for anything
      // else (e.g. plain "ok" health checks).
      try {
        setBody(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setBody(text);
      }
    } catch {
      setError("Request failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="api-docs">
      <h1 class="admin-title">API Debug</h1>

      <form onSubmit={run} class="api-docs-form">
        <input
          type="text"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          placeholder="/api/pages/pod/slug/links1hop"
          class="input input-mono"
        />
        <button type="submit" class="btn" disabled={loading()}>
          {loading() ? "Running…" : "Go"}
        </button>
      </form>

      {error() && <p class="form-error">{error()}</p>}

      {status() !== undefined && (
        <p class="api-docs-status">Status: {status()}</p>
      )}

      <pre class="api-docs-body">{body()}</pre>
    </div>
  );
}
