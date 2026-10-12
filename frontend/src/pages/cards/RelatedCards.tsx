import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { A } from "@solidjs/router";
import { cardsById } from "@/lib/stores/cardsStore";
import {
  clearQuery,
  createOwnLinks,
  openRelated,
  queryCardsOf,
} from "@/lib/stores/relatedStore";
import { linkAlive, requestLinkAlive } from "@/lib/stores/linkAliveStore";
import { createLiveQuery } from "@/lib/dexie/liveQuery";
import { computeRelated, type RelatedInput } from "@/lib/dexie/relatedQuery";
import { Link, Unlink } from "@/lib/icons";
import { titleToLowerKey, titleToSegment } from "@/lib/models/slugify";
import { asCardTitle, type CardGridCard } from "@/lib/models/card";
import { usePot } from "../pots/PotContext";
import { CardItemView } from "./CardItem";

export interface RelatedCardsProps {
  // Title of the card the relations are shown for. Undefined shows nothing.
  title: string | undefined;
  // Id of the card, when it exists. A draft has none, so it has no
  // datalog query either, but its title can still have incoming links.
  cardId?: string;
  potSlug: string;
}

interface RelationRowProps {
  // Class of the row's outer <div> ("links-1-hop", "links-2-hop", ...).
  rowClass: string;
  // Extra class of the label <li> ("links", "headword", ...).
  labelClass: string;
  label: string;
  // When given, the label links to that page (a 2-hop headword).
  href?: string;
  cards: CardGridCard[];
  potSlug: string;
  // The row holds links whose target does not exist yet: its label shows
  // the unlink icon and its cards are drawn faded.
  empty?: boolean;
}

// One labelled row: a relation label followed by its cards, all in one grid.
function RelationRow(props: RelationRowProps) {
  const count = () => `${props.cards.length} pages`;
  // The label's text, with the link icon below it (the "kamon" of the
  // original design). An empty row shows a broken link instead.
  const labelContent = () => (
    <>
      <span class="title">{props.label}</span>
      {props.empty ? (
        <Unlink class="kamon" size={28} />
      ) : (
        <Link class="kamon" size={28} />
      )}
    </>
  );

  return (
    <div class={props.rowClass}>
      <ul class="grid">
        <li class={`relation-label ${props.labelClass}`}>
          <Show
            when={props.href}
            fallback={<a title={count()}>{labelContent()}</a>}
          >
            <A href={props.href!} title={count()}>
              {labelContent()}
            </A>
          </Show>
          <span class="arrow" />
        </li>
        <For each={props.cards}>
          {(card) => (
            <CardItemView
              card={card}
              potSlug={props.potSlug}
              empty={props.empty}
            />
          )}
        </For>
      </ul>
    </div>
  );
}

// Shows the open card's related cards: the cards one wiki-link hop away, the
// cards two hops away (one row per shared target), the links whose target does
// not exist yet, and the cards matched by the datalog query saved in the
// card's "query" field. The hop rows are derived from the local replica and
// follow it live (see lib/dexie/relatedQuery.ts), so they also work offline.
// The query row is loaded from the server (see relatedStore.ts).
export default function RelatedCards(props: RelatedCardsProps) {
  const pot = usePot();
  const savedQuery = () =>
    props.cardId ? (cardsById[props.cardId]?.query ?? "") : "";

  // The links written in the open card: its live text, or the replica's rows
  // until the editor reports it.
  const ownLinks = createOwnLinks(() => props.cardId);

  // Whether the 1 hop / 2 hop rows have been computed at least once. "New
  // Links" waits for it, so it appears after those rows instead of before
  // them. It is reset whenever the card changes (see the effect below).
  const [relatedLoaded, setRelatedLoaded] = createSignal(false);
  const computeAndMark = async (input: RelatedInput) => {
    const result = await computeRelated(input);
    setRelatedLoaded(true);
    return result;
  };

  const related = createLiveQuery(
    (): RelatedInput | undefined => {
      const potId = pot()?.id;
      if (!potId || !props.title) return undefined;
      return {
        pot: potId,
        selfId: props.cardId,
        selfTitleLc: titleToLowerKey(props.title),
        ownTargets: ownLinks().map((link) => ({
          title: link.target_title,
          titleLc: link.target_titleLc,
        })),
      };
    },
    computeAndMark,
    { oneHop: [], twoHop: [] },
  );

  // A different card starts over: its rows are not computed yet. Only the
  // card id counts: a rename keeps the rows, and resetting on it would hide
  // "New Links" and replay its appear animation.
  createEffect(() => {
    void props.cardId;
    setRelatedLoaded(false);
  });

  // The datalog query is evaluated by the server, once per card and saved
  // query. A card without a saved query has nothing to load. The cleanup
  // drops only this card's result, whenever this card goes away or its query
  // changes.
  createEffect(() => {
    const id = props.cardId;
    if (!id) return;
    if (savedQuery()) void openRelated(id);
    onCleanup(() => clearQuery(id));
  });

  // The 2 hop rows come with the rows of a target adjacent. The list of rows
  // is a list of target keys (strings, compared by value), so a row survives
  // while its target is still there and only its cards update. Building new
  // group objects on every change would recreate every row and replay its
  // appear animation.
  const sameKeys = (a: string[], b: string[]) =>
    a.length === b.length && a.every((key, i) => key === b[i]);
  const twoHopTargets = createMemo(
    () => [...new Set(related().twoHop.map((row) => row.via_titleLc))],
    [],
    { equals: sameKeys },
  );

  // Links of the open card whose target is dead, drawn as empty cards. Reads
  // the same shared results as the editor's red links (see linkAliveStore.ts),
  // so the two can never disagree and nothing is computed twice.
  createEffect(() => {
    for (const link of ownLinks()) {
      requestLinkAlive(link.target_pot, link.target_titleLc);
    }
  });
  //
  // The card of a link is kept (by titleLc) while the link stays dead, so
  // <For> keeps its element instead of recreating it on every edit, which
  // would replay the appear animation of every "New Links" card.
  let newLinkCards = new Map<string, CardGridCard>();
  const newLinks = createMemo<CardGridCard[]>(() => {
    const next = new Map<string, CardGridCard>();
    for (const link of ownLinks()) {
      if (linkAlive(link.target_pot, link.target_titleLc) !== false) continue;
      const kept = newLinkCards.get(link.target_titleLc);
      next.set(
        link.target_titleLc,
        kept && kept.title === link.target_title
          ? kept
          : {
              title: asCardTitle(link.target_title),
              description: [],
              image: "",
              pin: false,
            },
      );
    }
    newLinkCards = next;
    return [...next.values()];
  });

  return (
    <>
      <Show when={related().oneHop.length}>
        <RelationRow
          rowClass="links-1-hop"
          labelClass="links"
          label="Links"
          cards={related().oneHop}
          potSlug={props.potSlug}
        />
      </Show>
      <For each={twoHopTargets()}>
        {(titleLc) => {
          // The rows of related() are store objects with a stable identity,
          // so the cards of a row keep their elements too.
          const cards = () =>
            related().twoHop.filter((row) => row.via_titleLc === titleLc);
          const title = () => cards()[0]?.via_title ?? titleLc;
          return (
            <RelationRow
              rowClass="links-2-hop"
              labelClass="headword"
              label={title()}
              href={`/${props.potSlug}/${titleToSegment(title())}`}
              cards={cards()}
              potSlug={props.potSlug}
            />
          );
        }}
      </For>
      {/* The rows always appear in this order: Links, the 2-hop rows, New
          Links, Query. A row with no cards is simply not rendered, so
          New Links never jumps ahead of the others. */}
      <Show when={relatedLoaded() && newLinks().length}>
        <RelationRow
          rowClass="links-new"
          labelClass="empty-links"
          label="New Links"
          cards={newLinks()}
          potSlug={props.potSlug}
          empty
        />
      </Show>
      <Show when={queryCardsOf(props.cardId).length}>
        <RelationRow
          rowClass="links-query"
          labelClass="query"
          label="Query"
          cards={queryCardsOf(props.cardId)}
          potSlug={props.potSlug}
        />
      </Show>
    </>
  );
}
