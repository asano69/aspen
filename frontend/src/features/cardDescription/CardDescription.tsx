import { createEffect, createMemo, For, Match, Switch } from "solid-js";

import { hashTagTitle } from "@/lib/models/hashTagTitle";
import { titleToLowerKey } from "@/lib/models/slugify";
import { linkAlive, requestLinkAlive } from "@/lib/stores/linkAliveStore";
import { parseDescription } from "./parseDescription";

export interface CardDescriptionProps {
  text: string;
  // Pod the card belongs to; wiki links are resolved within it. Without it
  // no link is marked as empty.
  podId?: string;
}

// A wiki link or hashtag in a description. `target` is the title it links to
// and `text` is what is shown. Marked empty (see components.css's
// .grid-empty) only once the shared store has answered that its target is
// dead; "not answered yet" is never marked.
function LinkSpan(props: {
  podId?: string;
  class: string;
  target: string;
  text: string;
}) {
  const lc = () => titleToLowerKey(props.target);
  createEffect(() => {
    if (props.podId) requestLinkAlive(props.podId, lc());
  });
  const dead = () =>
    props.podId !== undefined && linkAlive(props.podId, lc()) === false;

  return (
    <span class={props.class} classList={{ "grid-empty": dead() }}>
      {props.text}
    </span>
  );
}

// Renders a card's description with its notation marked up. The card
// itself is an <a>, so links are plain <span>s without click behavior.
export default function CardDescription(props: CardDescriptionProps) {
  const segments = createMemo(() => parseDescription(props.text));

  return (
    <For each={segments()}>
      {(segment) => (
        <Switch
          fallback={<span class={`grid-${segment.kind}`}>{segment.text}</span>}
        >
          <Match when={segment.kind === "text"}>{segment.text}</Match>
          <Match when={segment.kind === "wikilink"}>
            <LinkSpan
              podId={props.podId}
              class="grid-wikilink"
              target={segment.text}
              text={segment.text}
            />
          </Match>
          <Match when={segment.kind === "hashtag"}>
            <LinkSpan
              podId={props.podId}
              class="grid-hashtag"
              target={hashTagTitle(segment.text)}
              text={segment.text}
            />
          </Match>
          <Match when={segment.kind === "inline-code"}>
            <code class="grid-inline-code">{segment.text}</code>
          </Match>
        </Switch>
      )}
    </For>
  );
}
