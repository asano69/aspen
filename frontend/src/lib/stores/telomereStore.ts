import { createSignal } from "solid-js";

// How often the clock ticks. Thickness only changes at hour boundaries, so a
// minute is precise enough. Every tick dispatches to the editor, so a slower
// clock also means fewer idle updates at the caret.
const CLOCK_INTERVAL_MS = 60_000;

// The current time, ticking (see startTelomereClock). Reactive. The edit
// history itself is per card and lives in its Y.Doc (see lineMetaStore.ts).
const [now, setNow] = createSignal(Date.now());
export { now as telomereNow };

// Starts the clock and returns a function that stops it.
export function startTelomereClock(): () => void {
  const timer = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
  return () => clearInterval(timer);
}
