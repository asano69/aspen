import { Transaction, type Extension } from "@codemirror/state";
import {
  ViewPlugin,
  type EditorView,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";

// Debug-only plugin for the "the Convert key no longer switches the IME on"
// bug. It logs how CodeMirror and the browser see the IME, so a log taken
// when the bug happens shows which layer lost track of it.
//
// Enabled in development, or in production after running
//   localStorage.setItem("imeDebug", "1")
// in the browser console and reloading. Everything is prefixed "[ime-debug]".
//
// What the log tells:
// - "trace before blur": the recent history of everything that can disturb the
//   browser's input context (updates, DOM mutations, selection changes,
//   pastes), printed when the editor loses focus. When the bug happens, click
//   outside the editor and back: the trace printed by that blur shows what
//   happened before. The Convert key itself never reaches the page while the
//   editor has focus, so it is not a clue.
// - "created" / "destroyed": the editor's lifetime. "destroyed during
//   composition" means the editor was torn down while the IME was converting
//   (e.g. a draft turning into an existing card).
// - "update during composition": every CodeMirror update while composing, with
//   its user events and effects, to spod dispatches that should not happen.
// - "DOM mutation during composition": nodes added or removed under the
//   composing content, to spod decorations that rewrite the DOM.
// - "focus" / "blur": where the focus went, and whether the window has it.
// - "composition did not end": a composition stuck for too long.

const PREFIX = "[ime-debug]";
// How many recent events the idle trace keeps. It is dumped on blur, which is
// when the user recovers from the bug by clicking outside and back.
const TRACE_SIZE = 200;
const SWITCH_KEYS = new Set(["Convert", "NonConvert"]);
const STUCK_MS = 10_000;

// Key names (event.key or event.code) of keys that can switch the IME.
const IME_KEY_RE =
  /^(Convert|NonConvert|KanaMode|Hiragana|Katakana|HiraganaKatakana|Romaji|Zenkaku|Hankaku|ZenkakuHankaku|Eisu|Lang\d|Unidentified|Compose|Dead)$/;

let nextId = 1;

function isEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("imeDebug") === "1";
  } catch {
    return false; // storage may be blocked
  }
}

function describe(node: EventTarget | Node | null): string {
  if (!(node instanceof Element)) return node ? node.constructor.name : "none";
  const cls = typeof node.className === "string" ? node.className : "";
  return cls
    ? `${node.tagName.toLowerCase()}.${cls.split(" ")[0]}`
    : node.tagName.toLowerCase();
}

class ImeDebug implements PluginValue {
  private readonly id = nextId++;
  private readonly createdAt = performance.now();
  // Composition state as seen from DOM events, to compare with view.composing.
  private composing = false;
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly observer: MutationObserver;
  private readonly trace: string[] = [];
  private readonly listeners: [EventTarget, string, EventListener, boolean][] =
    [];

  constructor(private readonly view: EditorView) {
    const dom = view.contentDOM;
    this.listen(dom, "compositionstart", (e) => this.onCompositionStart(e));
    this.listen(dom, "compositionupdate", (e) =>
      this.log("compositionupdate", { data: (e as CompositionEvent).data }),
    );
    this.listen(dom, "compositionend", (e) => this.onCompositionEnd(e));
    this.listen(dom, "beforeinput", (e) => {
      const input = e as InputEvent;
      this.note("beforeinput", {
        inputType: input.inputType,
        defaultPrevented: input.defaultPrevented,
      });
      if (!this.composing && !this.view.composing) return;
      this.log("beforeinput", {
        inputType: input.inputType,
        isComposing: input.isComposing,
        data: input.data,
      });
    });
    this.listen(dom, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(dom, "focus", () => this.log("focus", this.snapshot()));
    this.listen(dom, "blur", (e) => {
      this.log("blur", {
        ...this.snapshot(),
        movedTo: describe((e as FocusEvent).relatedTarget),
      });
      this.dumpTrace();
    });
    // Selection changes the browser reports for the page. A change that
    // CodeMirror did not make shows up as "selectionchange" without a
    // matching "update" just before it.
    this.listen(document, "selectionchange", () => {
      const sel = document.getSelection();
      this.note("selectionchange", {
        anchor: describe(sel?.anchorNode ?? null),
        offset: sel?.anchorOffset,
        inEditor: !!sel?.anchorNode && dom.contains(sel.anchorNode),
      });
    });
    // Whether a paste was taken over (preventDefault) matters: a replaced
    // paste never goes through the browser's own insertion. The check runs in
    // a microtask, after the editor's own paste handlers have run.
    this.listen(dom, "paste", (e) => {
      const data = (e as ClipboardEvent).clipboardData;
      const types = Array.from(data?.types ?? []);
      const files = data?.files.length ?? 0;
      queueMicrotask(() =>
        this.note("paste", {
          defaultPrevented: e.defaultPrevented,
          types,
          files,
        }),
      );
    });
    // Raw IME-related keys, seen at the window in the capture phase: this does
    // not depend on where the focus is or on what the editor does with the key.
    this.listen(
      window,
      "keydown",
      (e) => this.onRawKey(e as KeyboardEvent),
      true,
    );
    this.listen(
      window,
      "keyup",
      (e) => this.onRawKey(e as KeyboardEvent),
      true,
    );
    this.listen(window, "blur", () => this.log("window blur"));
    this.listen(window, "focus", () => this.log("window focus"));
    this.listen(document, "visibilitychange", () =>
      this.log("visibilitychange", { state: document.visibilityState }),
    );

    this.observer = new MutationObserver((records) =>
      this.onMutations(records),
    );
    this.observer.observe(dom, { childList: true, subtree: true });

    this.log("created", this.snapshot());
  }

  update(update: ViewUpdate) {
    if (update.focusChanged) this.log("focusChanged", this.snapshot());
    // Every update is traced, also idle ones: an effect-only update (no
    // document change) at the caret is the main suspect.
    this.note("update", {
      docChanged: update.docChanged,
      selectionSet: update.selectionSet,
      effects: update.transactions.reduce((n, tr) => n + tr.effects.length, 0),
      events: update.transactions
        .map((tr) => tr.annotation(Transaction.userEvent))
        .filter(Boolean),
    });
    if (!update.view.composing && !this.composing) return;
    this.log("update during composition", {
      docChanged: update.docChanged,
      selectionSet: update.selectionSet,
      viewportChanged: update.viewportChanged,
      transactions: update.transactions.map((tr) => ({
        userEvent: tr.annotation(Transaction.userEvent),
        docChanged: tr.docChanged,
        effects: tr.effects.length,
      })),
    });
  }

  destroy() {
    if (this.composing || this.view.composing) {
      console.warn(
        PREFIX,
        `#${this.id}`,
        "destroyed during composition",
        this.snapshot(),
      );
    }
    this.log("destroyed", {
      lifetimeMs: Math.round(performance.now() - this.createdAt),
    });
    clearTimeout(this.stuckTimer);
    this.observer.disconnect();
    for (const [target, type, fn, capture] of this.listeners) {
      target.removeEventListener(type, fn, capture);
    }
  }

  private listen(
    target: EventTarget,
    type: string,
    fn: EventListener,
    capture = false,
  ) {
    target.addEventListener(type, fn, capture);
    this.listeners.push([target, type, fn, capture]);
  }

  // Logs keys that can switch the IME, under whatever name the browser gives
  // them. "Process" (keyCode 229) is left out: it fires for every key while
  // the IME is on (see onKeyDown for the keys right after a switch key).
  private onRawKey(e: KeyboardEvent) {
    // keyCode 229 is how the browser reports a key the IME has processed
    // ("Process"), so it also shows whether the IME saw the switch key.
    if (
      !IME_KEY_RE.test(e.key) &&
      !IME_KEY_RE.test(e.code) &&
      e.keyCode !== 229
    ) {
      return;
    }
    this.log(`raw ${e.type}`, {
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      isComposing: e.isComposing,
      repeat: e.repeat,
      target: describe(e.target),
      ...this.snapshot(),
    });
  }

  // What CodeMirror and the browser each believe right now.
  private snapshot() {
    const { view } = this;
    return {
      viewComposing: view.composing,
      viewCompositionStarted: view.compositionStarted,
      trackedComposing: this.composing,
      viewHasFocus: view.hasFocus,
      documentHasFocus: document.hasFocus(),
      activeElement: describe(document.activeElement),
      connected: view.contentDOM.isConnected,
    };
  }

  private log(message: string, detail?: object) {
    const time = Math.round(performance.now());
    console.log(PREFIX, `#${this.id}`, `${time}ms`, message, detail ?? "");
  }

  // Records an event in the idle trace, dropping the oldest entries.
  private note(message: string, detail?: object) {
    const time = Math.round(performance.now());
    this.trace.push(
      `${time}ms ${message} ${detail ? JSON.stringify(detail) : ""}`,
    );
    if (this.trace.length > TRACE_SIZE) this.trace.shift();
  }

  // Prints the recent trace (see "trace before blur" in the file comment).
  private dumpTrace() {
    console.log(
      PREFIX,
      `#${this.id}`,
      "trace before blur",
      "\n" + this.trace.join("\n"),
    );
    this.trace.length = 0;
  }

  private onCompositionStart(e: Event) {
    this.composing = true;
    this.log("compositionstart", {
      data: (e as CompositionEvent).data,
      ...this.snapshot(),
    });
    clearTimeout(this.stuckTimer);
    this.stuckTimer = setTimeout(() => {
      console.warn(
        PREFIX,
        `#${this.id}`,
        "composition did not end",
        this.snapshot(),
      );
    }, STUCK_MS);
  }

  private onCompositionEnd(e: Event) {
    this.composing = false;
    clearTimeout(this.stuckTimer);
    this.log("compositionend", {
      data: (e as CompositionEvent).data,
      ...this.snapshot(),
    });
  }

  private onKeyDown(e: KeyboardEvent) {
    const detail = {
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      isComposing: e.isComposing,
    };
    if (SWITCH_KEYS.has(e.key)) {
      this.log("switch key", { ...detail, ...this.snapshot() });
    } else {
      // The switch key itself may never reach the page while the editor has
      // focus (the IME consumes it), so every key is logged instead of only
      // the ones after it.
      this.log("key", detail);
    }
  }

  private onMutations(records: MutationRecord[]) {
    // Traced always, also while idle: a DOM rewrite near the caret is a
    // suspect even without a composition. The full log below is only for
    // compositions.
    this.note("mutation", {
      added: records.reduce((n, r) => n + r.addedNodes.length, 0),
      removed: records.reduce((n, r) => n + r.removedNodes.length, 0),
      targets: [...new Set(records.slice(0, 3).map((r) => describe(r.target)))],
    });
    if (!this.composing && !this.view.composing) return;
    let added = 0;
    let removed = 0;
    const targets = new Set<string>();
    for (const record of records) {
      added += record.addedNodes.length;
      removed += record.removedNodes.length;
      if (targets.size < 3) targets.add(describe(record.target));
    }
    this.log("DOM mutation during composition", {
      added,
      removed,
      targets: [...targets],
    });
  }
}

// The debug plugin, or nothing when debugging is not enabled.
export function imeDebug(): Extension {
  return isEnabled() ? ViewPlugin.define((view) => new ImeDebug(view)) : [];
}
