import { db } from "./db";

// Returns up to `limit` titles of the pod's cards whose titleLc starts with
// prefixLc, in titleLc order. Reads only the replica (which holds no deleted
// cards), so it also works offline. "\uffff" is above any character a title
// can contain, which turns the prefix into a key range on [pod+titleLc].
export async function suggestTitles(
  pod: string,
  prefixLc: string,
  limit = 20,
): Promise<string[]> {
  const cards = await db.cards
    .where("[pod+titleLc]")
    .between([pod, prefixLc], [pod, prefixLc + "\uffff"], true, true)
    .limit(limit)
    .toArray();
  return cards.map((card) => card.title);
}
