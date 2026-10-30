import { EditorState, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { CodeBlock } from "../../parser/aspen";
import { mermaidSource } from "./mermaidSource";

// Replaces a `code:mermaid` block with its rendered diagram while the
// selection does not touch the block (same live-preview rule as
// imageWidget.ts and syntaxReveal.ts); once the caret enters it, the raw code
// shows again for editing.
//
// A replacement spanning line breaks cannot come from a ViewPlugin, so this
// is a StateField providing the decorations directly. No IME guard (see
// decorationPlugin.ts) is needed: the block holding the caret is never
// replaced, and an unchanged widget keeps its DOM through `eq`.

// The mermaid library is large, so it is imported the first time a mermaid
// block is actually shown. Notes without one never load it. Vite splits the
// dynamic import into its own chunk.
let mermaidPromise: Promise<typeof import("mermaid").default> | undefined;

function loadMermaid() {
  mermaidPromise ??= import("mermaid")
    .then((module) => module.default)
    .catch((err) => {
      mermaidPromise = undefined; // allow a retry, e.g. after going online
      throw err;
    });
  return mermaidPromise;
}

// Pan/zoom controls (see mermaid-diagram-pan-zoom) are loaded together with
// the first rendered diagram, so notes without one never pay for them. The
// SDK finds diagrams itself through ENHANCED_CLASS, which is only added to a
// successfully rendered block, so error messages never get controls.
const ENHANCED_CLASS = "mermaid-pan-zoom";

let enhancementsPromise:
  Promise<typeof import("mermaid-diagram-pan-zoom")> | undefined;

function loadEnhancements() {
  enhancementsPromise ??= Promise.all([
    import("mermaid-diagram-pan-zoom"),
    import("mermaid-diagram-pan-zoom/styles/mermaid-enhancements.css"),
  ])
    .then(([sdk]) => {
      sdk.init({
        containerSelector: `.${ENHANCED_CLASS}`,
        sourceAttribute: "data-mermaid-source",
        // A double click is how the user opens the block for editing (see
        // MermaidWidget.ignoreEvent), so it must not also zoom.
        panZoomOptions: { dblClickZoomEnabled: false },
      });
      return sdk;
    })
    .catch((err) => {
      enhancementsPromise = undefined; // allow a retry
      throw err;
    });
  return enhancementsPromise;
}

// A failure only costs the controls: the diagram itself is already shown.
function enhanceDiagrams() {
  loadEnhancements()
    .then((sdk) => sdk.enhance())
    .catch((err) => console.error("[mermaid] failed to add controls:", err));
}

// svg-pan-zoom fits the diagram into the container, so the container needs a
// height. It takes the diagram's own aspect ratio, which makes the height
// follow the container's width instead of being a fixed size.
function diagramAspectRatio(container: HTMLElement): string {
  const box = container.querySelector("svg")?.viewBox.baseVal;
  return box && box.width > 0 && box.height > 0
    ? `${box.width} / ${box.height}`
    : "";
}

// Rendered SVG per theme and source, so toggling the caret in and out of a
// block does not render the same diagram again.
const svgCache = new Map<string, string>();
let nextId = 0;

async function renderSvg(source: string): Promise<string> {
  const dark = document.documentElement.getAttribute("data-mode") === "dark";
  // "neutral" is mermaid's grayscale theme; its own "default" is purple.
  const theme = dark ? "dark" : "default";
  const key = `${theme}\n${source}`;
  const cached = svgCache.get(key);
  if (cached) return cached;

  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
  const id = `mermaid-${nextId++}`;
  try {
    const { svg } = await mermaid.render(id, source);
    svgCache.set(key, svg);
    return svg;
  } catch (err) {
    // A failed render leaves its temporary element in <body>.
    document.getElementById(`d${id}`)?.remove();
    throw err;
  }
}

class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: MermaidWidget) {
    return other.source === this.source;
  }

  get estimatedHeight() {
    return 120;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "mermaid-block";
    renderSvg(this.source)
      .then(
        (svg) => {
          el.innerHTML = svg;
          el.style.aspectRatio = diagramAspectRatio(el);
          el.dataset.mermaidSource = this.source; // used by the copy button
          el.classList.add(ENHANCED_CLASS);
          enhanceDiagrams();
        },
        (err) => {
          el.classList.add("mermaid-error");
          el.textContent = err instanceof Error ? err.message : String(err);
        },
      )
      // The diagram's height is only known now.
      .then(() => view.requestMeasure());
    return el;
  }

  // Panning and the control buttons need the mouse events, so the widget
  // keeps them. Only a double click reaches the editor, which moves the
  // caret to the block's edge and reveals its code.
  ignoreEvent(event: Event) {
    return event.type !== "dblclick";
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const { main } = state.selection;
  const decorations = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.type !== CodeBlock) return;
      // A CodeBlock never contains another one.
      const { from, to } = node;
      const touching = main.from <= to && main.to >= from;
      if (touching) return false;

      const source = mermaidSource(state.sliceDoc(from, to));
      if (source === null) return false;
      decorations.push(
        Decoration.replace({
          widget: new MermaidWidget(source),
          block: true,
        }).range(from, to),
      );
      return false;
    },
  });

  return Decoration.set(decorations, true);
}

export const mermaidBlock = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
