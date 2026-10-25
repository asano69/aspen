import type { RelatedCard, RelatedHopCard } from "../models/card";
import { compareTitles } from "../models/compareTitles";
import { db, type CachedCard } from "./db";

// The related cards of the open card, derived from the local replica (see
// docs/architecture/related-cards-offline.md). The rules mirror links1Hop and
// links2Hop in internal/serve/links.go, which are the reference; both are
// checked against testdata/link-graph.json.
//
// This only reads the replica. A link written in the open card comes from
// ownTargets (its live text), not from the replica's rows of that card, so
// the result does not wait for the server to store it.

// A link target of the open card, as extractLinks returns it.
export interface RelatedTarget {
  title: string;
  titleLc: string;
}

export interface RelatedInput {
  pod: string;
  // Undefined for a draft, or a page that does not exist yet.
  selfId: string | undefined;
  selfTitleLc: string;
  // Distinct by titleLc, in order of first appearance. The order decides how
  // the 2 hop rows are grouped.
  ownTargets: RelatedTarget[];
}

export interface RelatedResult {
  oneHop: RelatedCard[];
  twoHop: RelatedHopCard[];
}

function toRelatedCard(card: CachedCard): RelatedCard {
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    image: card.image,
  };
}

const byTitle = (a: CachedCard, b: CachedCard) =>
  compareTitles(a.title, b.title);

// The cards of the pod whose titleLc is one of titleLcs.
function cardsByTitleLc(
  pod: string,
  titleLcs: string[],
): Promise<CachedCard[]> {
  return db.cards
    .where("[pod+titleLc]")
    .anyOf(titleLcs.map((titleLc) => [pod, titleLc]))
    .toArray();
}

// The ids of the cards that link to the target (pod, titleLc).
async function linkerIds(pod: string, titleLc: string): Promise<string[]> {
  const links = await db.card_links
    .where("[target_pod+target_titleLc]")
    .equals([pod, titleLc])
    .toArray();
  return links.map((link) => link.source);
}

// The cards with the given ids. An id without a card in the replica (its
// card is deleted) is dropped.
async function cardsByIds(ids: string[]): Promise<CachedCard[]> {
  const found = await db.cards.bulkGet([...new Set(ids)]);
  return found.filter((card): card is CachedCard => card !== undefined);
}

// The cards the open card links to (that exist) and the cards that link to
// it, without the open card itself, sorted by title.
async function oneHopCards(input: RelatedInput): Promise<CachedCard[]> {
  const { pod, selfId, selfTitleLc, ownTargets } = input;
  const [outgoing, incomingIds] = await Promise.all([
    cardsByTitleLc(
      pod,
      ownTargets.map((target) => target.titleLc),
    ),
    linkerIds(pod, selfTitleLc),
  ]);
  const incoming = await cardsByIds(incomingIds);

  const byId = new Map<string, CachedCard>();
  for (const card of [...outgoing, ...incoming]) {
    if (card.id !== selfId) byId.set(card.id, card);
  }
  return [...byId.values()].sort(byTitle);
}

// The cards that link to a target the open card links to, excluding the open
// card and the 1 hop cards. A card sharing several targets is listed once,
// under the first of them in ownTargets. The target does not have to exist.
async function twoHopCards(
  input: RelatedInput,
  oneHopIds: Set<string>,
): Promise<RelatedHopCard[]> {
  const { pod, selfId, ownTargets } = input;
  const idsByTarget = await Promise.all(
    ownTargets.map((target) => linkerIds(pod, target.titleLc)),
  );

  const wanted = (id: string) => id !== selfId && !oneHopIds.has(id);
  const cards = new Map(
    (await cardsByIds(idsByTarget.flat().filter(wanted))).map((card) => [
      card.id,
      card,
    ]),
  );

  const listed = new Set<string>();
  const rows: RelatedHopCard[] = [];
  ownTargets.forEach((target, index) => {
    const group = [...new Set(idsByTarget[index])]
      .map((id) => cards.get(id))
      .filter((card): card is CachedCard => card !== undefined)
      .filter((card) => !listed.has(card.id))
      .sort(byTitle);
    for (const card of group) {
      listed.add(card.id);
      rows.push({
        ...toRelatedCard(card),
        via_title: target.title,
        via_titleLc: target.titleLc,
      });
    }
  });
  return rows;
}

export async function computeRelated(
  input: RelatedInput,
): Promise<RelatedResult> {
  const oneHop = await oneHopCards(input);
  const twoHop = await twoHopCards(input, new Set(oneHop.map((c) => c.id)));
  return { oneHop: oneHop.map(toRelatedCard), twoHop };
}
