import { ClientResponseError } from "pocketbase";
import pb from "./pb";
import type { CardRecord, TitleCandidate } from "../models/card";
import type {
  CreateCardRequest,
  MoveCardsRequest,
  MoveCardsResponse,
  RenameLinksRequest,
  RenameLinksResponse,
  SearchResponse,
  UploadAttachmentResponse,
} from "./generated";
import { titleToSlug } from "../models/slugify";

// Response shape of createCard: the saved card. A duplicate title is not
// reported here: the server announces it on its own channel (see
// lib/stores/mergeAlertStore.ts).
export interface CardMutationResult {
  card: CardRecord;
}

// Creates a new "cards" record with a title resolved server-side from
// `titleCandidate` (see internal/serve/cards.go's createCardHandler).
// Used by NoteEditor's draft mode, which needs a real record id before
// Yjs sync can start.
export async function createCard(
  pot: string,
  titleCandidate: TitleCandidate,
): Promise<CardMutationResult> {
  const body: CreateCardRequest = { pot, titleCandidate };
  return await pb.send<CardMutationResult>("/api/admin/cards", {
    method: "POST",
    body,
  });
}

// Moves cards to another pot (see internal/serve/move_cards.go). The server
// soft-deletes each card and creates a copy in the target pot, so the copies
// have new ids and arrive through the ordinary realtime events.
export async function moveCards(
  ids: string[],
  pot: string,
): Promise<MoveCardsResponse> {
  const body: MoveCardsRequest = { ids, pot };
  return await pb.send<MoveCardsResponse>("/api/admin/cards/move", {
    method: "POST",
    body,
  });
}

// Rewrites, in every other card that links to `oldTitle`, those links to the
// current title of card `cardId` (see internal/serve/rename_links.go). The new
// title is not sent: the server reads the card's current one.
export async function renameLinks(
  cardId: string,
  oldTitle: string,
): Promise<RenameLinksResponse> {
  const body: RenameLinksRequest = { oldTitle };
  return await pb.send<RenameLinksResponse>(
    `/api/admin/cards/${cardId}/rename-links`,
    { method: "POST", body },
  );
}


// Uploads an image to the server (see internal/serve/attachments.go), which
// shrinks it and stores it. Resolves to the attachment path
// ("@/<recordId>/<filename>") to write in image notation; it has no origin
// (see lib/models/attachmentPath.ts). requestKey: null keeps concurrent
// uploads from auto-cancelling each other.
export async function uploadAttachment(file: File): Promise<string> {
  const body = new FormData();
  body.append("image", file);
  const res = await pb.send<UploadAttachmentResponse>(
    "/api/admin/attachments",
    { method: "POST", body, requestKey: null },
  );
  return res.url;
}

// Resolves a single card by its URL slug, without fetching the rest
// of the pot -- replaces the old approach of scanning every already-
// loaded card with titleToSlug (see cardsStore.ts's
// findCardByPotAndSlug).
//
// titleLc (see internal/slug.ToLowerKey) is a fast, indexed candidate
// lookup: lowercase, spaces mapped to underscores. It is not
// injective ("a b" and "a_b" share a titleLc), so the single match it
// returns is re-verified against titleToSlug(title) -- the real slug
// comparison -- before being trusted. Returns undefined when no card
// matches, whether because titleLc found nothing or because the
// verification failed. Any other failure (network, auth, ...) is
// rethrown, so a caller never mistakes it for "no such card".
export async function fetchCardBySlug(
  potId: string,
  slug: string,
): Promise<CardRecord | undefined> {
  const candidateTitleLc = slug.toLowerCase();
  let record: CardRecord;
  try {
    record = await pb.collection("cards").getFirstListItem<CardRecord>(
      pb.filter('pot = {:pot} && titleLc = {:titleLc} && deleted = ""', {
        pot: potId,
        titleLc: candidateTitleLc,
      }),
      { requestKey: null },
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
  return titleToSlug(record.title) === slug ? record : undefined;
}

// Fetches the cards matched by the datalog query saved in a card's "query"
// field (see internal/serve/links_datalog.go's cardQueryHandler). Rejects
// with the server's message when the query is invalid. requestKey: null
// keeps a refetch from auto-cancelling an earlier in-flight request.
export async function fetchRelatedCards(cardId: string): Promise<CardRecord[]> {
  const res = await pb.send<{ cards: CardRecord[] }>(
    `/api/admin/cards/${cardId}/related`,
    { method: "GET", requestKey: null },
  );
  return res.cards;
}

// Full-text search over the cards of a pot (see internal/serve/search.go).
// `pot` is the pot's unique name, as in the URL. requestKey: null keeps a
// newer search from auto-cancelling an older one still in flight.
export async function searchCards(
  pot: string,
  q: string,
): Promise<SearchResponse> {
  return await pb.send<SearchResponse>(`/api/pages/${pot}/search/query`, {
    method: "GET",
    query: { q },
    requestKey: null,
  });
}

// Updates a card's own fields directly. The title is deliberately not
// in this list: it only ever changes via updateCardTitle above.
export async function updateCard(
  id: string,
  changes: Partial<Pick<CardRecord, "deleted" | "query">>,
): Promise<CardRecord> {
  return await pb.collection("cards").update<CardRecord>(id, changes);
}

// Soft-deletes a card by stamping its "deleted" date; the record itself
// stays in the database. The realtime "update" event this produces is
// what makes other clients drop the card (see cardsStore.ts).
export async function deleteCard(id: string): Promise<void> {
  await updateCard(id, { deleted: new Date().toISOString() });
}
