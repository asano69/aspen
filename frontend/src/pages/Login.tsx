import { createSignal } from "solid-js";

import Logo from "@/components/Logo";

import { login } from "@/lib/api/auth";

// Login screen shown by AuthGate when no valid session exists. One form
// serves both regular users ("users" collection) and superusers; see
// login() in lib/api/auth.ts.
export default function Login() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await login(email(), password());
      // No further action needed here: AuthGate subscribes to auth
      // changes (see lib/api/auth.ts) and swaps this screen for the app
      // once the token is stored.
    } catch {
      setError("Invalid email or password.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="login">
      <form onSubmit={handleSubmit} class="login-form">
        <div class="login-logo">
          <Logo size={40} showTitle showVersion />
        </div>
        <input
          type="email"
          placeholder="Email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          required
          autofocus
          class="input"
        />
        <input
          type="password"
          placeholder="Password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          required
          class="input"
        />
        {error() && <p class="form-error">{error()}</p>}
        <button type="submit" class="btn" disabled={pending()}>
          {pending() ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
