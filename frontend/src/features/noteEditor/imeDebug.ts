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
// - "switch key" + "key after switch": the keys the browser really received.
//   After Convert with the IME on, the next keys arrive as key "Process"
//   (keyCode 229). If they arrive as plain letters instead, the IME was never
//   switched on at the OS level, so the cause is outside CodeMirror.
// - "created" / "destroyed": the editor's lifetime. "destroyed during
//   composition" means the editor was torn down while the IME was converting
//   (e.g. a draft turning into an existing card).
// - "update during composition": every CodeMirror update while composing, with
//   its user events and effects, to spot dispatches that should not happen.
// - "DOM mutation during composition": nodes added or removed under the
//   composing content, to spot decorations that rewrite the DOM.
// - "focus" / "blur": where the focus went, and whether the window has it.
// - "composition did not end": a composition stuck for too long.

const PREFIX = "[ime-debug]";
const SWITCH_KEYS = new Set(["Convert", "NonConvert"]);
// How many key presses after a switch key are logged.
const KEYS_AFTER_SWITCH = 3;
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
  private keysToWatch = 0;
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly observer: MutationObserver;
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
      this.log("beforeinput", {
        inputType: input.inputType,
        isComposing: input.isComposing,
        data: input.data,
      });
    });
    this.listen(dom, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    // A paste is the suspected trigger, so log it with the focus state.
    this.listen(dom, "paste", (e) => {
      const data = (e as ClipboardEvent).clipboardData;
      this.log("paste", {
        types: Array.from(data?.types ?? []),
        files: data?.files.length ?? 0,
        ...this.snapshot(),
      });
    });
    this.listen(dom, "focus", () => this.log("focus", this.snapshot()));
    this.listen(dom, "blur", (e) =>
      this.log("blur", {
        ...this.snapshot(),
        movedTo: describe((e as FocusEvent).relatedTarget),
      }),
    );
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
    // Also logged while idle with focus: an update at the caret can reset
    // the browser's IME state without any composition being active.
    if (!update.view.hasFocus && !this.composing) return;
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
    // Same reason as in update(): idle DOM rewrites matter too.
    if (!this.view.hasFocus && !this.composing) return;
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
