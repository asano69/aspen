import { createSignal, createEffect, Show } from "solid-js";
import { useParams, A } from "@solidjs/router";
import DraftCardEditor from "@/features/noteEditor/DraftCardEditor";
import ExistingCardEditor from "@/features/noteEditor/ExistingCardEditor";
import Loading from "@/components/Loading";
import PageAlert from "@/components/PageAlert";
import { cardsById, openCardBySlug } from "@/lib/stores/cardsStore";
import {
  titleToSegment,
  titleToLowerKey,
  segmentToSlug,
  slugToTitle,
} from "@/lib/models/slugify";
import { useTitle } from "@/lib/useTitle";
import { useFooterSlot } from "@/lib/footerSlot";
import { deriveCardGridTitle } from "@/lib/models/card";
import { renameLinks } from "@/lib/api/cardApi";
import { mergeTargetOf } from "@/lib/stores/mergeAlertStore";
import {
  dismissRenameAlert,
  renameAlertOf,
} from "@/lib/stores/renameAlertStore";
import { usePot } from "../pots/PotContext";
import PageMenu from "./PageMenu";
import { isRenameOfOpenCard, type SyncedCard } from "./cardUrlSync";

type Draft = { initialTitle?: string };

// Chooses one physical editor mode. A draft owns only a local Y.Doc; an
// existing card owns its IndexedDB and websocket providers. Switching modes
// deliberately remounts the editor so neither provider can survive with the
// wrong room id.
export default function CardForm() {
  const params = useParams();
  const pot = usePot();
  const [cardId, setCardId] = createSignal<string>();
  const [draft, setDraft] = createSignal<Draft | undefined>(
    params.cardSlug ? undefined : {},
  );
  // The text of the draft that just became a card (see handleCreated).
  const [draftText, setDraftText] = createSignal<string>();
  // The title the open card duplicates, announced by the server (see
  // lib/stores/mergeAlertStore.ts).
  const mergeTarget = () => mergeTargetOf(cardId());
  // The pending rename alert of the open card, with the card's current title
  // as the new one. Hidden once the card is back to its old title (titleLc is
  // what links match by).
  const renameAlert = () => {
    const id = cardId();
    const alert = renameAlertOf(id);
    const card = id ? cardsById[id] : undefined;
    if (!alert || !card) return undefined;
    if (titleToLowerKey(card.title) === titleToLowerKey(alert.oldTitle)) {
      return undefined;
    }
    return { ...alert, newTitle: card.title as string };
  };
  const [updatingLinks, setUpdatingLinks] = createSignal(false);
  const [updateLinksError, setUpdateLinksError] = createSignal("");
  // Rewrites the links of the other cards from the old title to the card's
  // current one. The alert goes away once the server has done it.
  const handleUpdateLinks = async (id: string, oldTitle: string) => {
    setUpdateLinksError("");
    setUpdatingLinks(true);
    try {
      await renameLinks(id, oldTitle);
      dismissRenameAlert(id);
    } catch (err) {
      console.error("[card-form] failed to update links:", err);
      setUpdateLinksError("Failed to update the links.");
    } finally {
      setUpdatingLinks(false);
    }
  };
  // Set only right before a draft's title resolves into a real card
  // (see handleCreated below), so the freshly mounted ExistingCardEditor
  // restores the caret where the draft editor left it. Reset to undefined
  // everywhere else cardId is set from the normal URL-driven effect, so
  // re-opening an existing card never inherits a stale value from an
  // earlier draft creation.
  const [focusSelection, setFocusSelection] = createSignal<{
    anchor: number;
    head: number;
  }>();
  // Getter for the currently-open card's live Yjs text, handed up by
  // ExistingCardEditor (see its onContentSnapshot prop). Re-registered
  // on every card open, since ExistingCardEditor remounts per card
  // (keyed Show below) -- never stale across a card switch.
  const [contentSnapshot, setContentSnapshot] = createSignal<() => string>();
  // Whether an existing card's editor is shown yet (see ExistingCardEditor's
  // onReady). The page menu waits for it, so it does not sit in a column that
  // is still narrow and then jump when the editor appears.
  const [editorReady, setEditorReady] = createSignal(false);
  const menuReady = () => (cardId() ? editorReady() : true);
  // The slug (decoded) of the card the editor currently reflects. Updated
  // whenever a lookup settles or the address bar is rewritten, so it never
  // drifts from what is actually open.
  let urlSegment = params.cardSlug ? segmentToSlug(params.cardSlug) : "";
  // Identifies the latest slug lookup, so a slow response for a card the
  // user has already navigated away from is dropped.
  let openRequest = 0;

  // The comparison is still necessary because router params react to our own
  // replace navigation. It is intentionally limited to URL echoes; editor
  // identity itself is now derived solely from cardId/draft via keyed Show.
  createEffect(() => {
    if (!params.cardSlug) {
      openRequest++;
      setCardId(undefined);
      setDraftText(undefined);
      setDraft({});
      setFocusSelection(undefined);
      return;
    }
    const potId = pot()?.id;
    if (!potId) return;

    // Compare decoded forms: urlSegment holds the raw (unencoded) slug,
    // but params.cardSlug reflects the URL's actual path, which the
    // browser percent-encodes for any non-ASCII text (e.g. Japanese)
    // even though titleToSegment/replaceUrl never encoded it themselves.
    // Comparing the raw encoded param against the raw slug therefore
    // never matched for non-ASCII titles, so this guard silently fell
    // through on every keystroke instead of short-circuiting.
    const slug = segmentToSlug(params.cardSlug);
    if (slug === urlSegment && cardId()) {
      // Back to the open card: cancel any lookup still in flight for another card.
      openRequest++;
      return;
    }
    setDraftText(undefined);
    setFocusSelection(undefined);
    // The card is looked up
    // The card is looked up on the server, not in the store, so nothing
    // here depends on which cards happen to be loaded. The loading
    // fallback below shows until the lookup settles.
    const request = ++openRequest;
    openCardBySlug(potId, slug)
      .then((record) => {
        if (request !== openRequest) return;
        urlSegment = slug;
        if (record) {
          setCardId(record.id);
          setDraft(undefined);
        } else {
          setCardId(undefined);
          setDraft({ initialTitle: slugToTitle(slug) });
        }
      })
      .catch((err) => {
        console.error("[card-form] failed to open card:", err);
        if (request !== openRequest) return;
        // Keep the address bar in step with what the editor actually shows.
        const openTitle = cardsById[cardId() ?? ""]?.title;
        if (openTitle) replaceUrl(titleToSegment(openTitle));
      });
  });

  // Updates only the browser's address bar, bypassing Solid Router's own
  // navigate(). navigate() also updates Router's reactive location/params
  // signals, which re-fires every effect that reads them -- including this
  // component's own top createEffect (which reads params.cardSlug) -- and
  // that visibly re-evaluates the page even though the open card never
  // actually changes. history.replaceState() fires no popstate event, so
  // Router's signals (and this component's own reactivity) stay untouched;
  // only what's shown in the address bar changes.
  const replaceUrl = (segment: string) => {
    urlSegment = segmentToSlug(segment);
    window.history.replaceState(
      window.history.state,
      "",
      `/${params.slug}/${segment}`,
    );
  };

  // Keeps the address bar's slug in sync with the server-resolved title
  // (see internal/serve/title_watch.go). replaceUrl() only touches
  // history.replaceState, so this causes no visible re-render or remount
  // (see replaceUrl's own comment above).
  // Only a rename of the card that is already open may rewrite the address
  // bar (see isRenameOfOpenCard for why a plain navigation must not).
  let synced: SyncedCard = {};
  createEffect(() => {
    const id = cardId();
    const next: SyncedCard = {
      id,
      title: id ? cardsById[id]?.title : undefined,
    };
    const rename = isRenameOfOpenCard(synced, next);
    synced = next;
    if (rename) replaceUrl(titleToSegment(next.title!));
  });

  const handleCreated = (
    id: string,
    text: string,
    selection: { anchor: number; head: number },
  ) => {
    // Keep the caret where the user left it in the draft editor.
    setFocusSelection(selection);
    setDraftText(text);
    // The draft's URL is already committed, so it is safe to replace it now.
    const title = cardsById[id]?.title;
    if (title) replaceUrl(titleToSegment(title));
    setCardId(id);
    setDraft(undefined);
  };

  useTitle(() => {
    const potTitle = pot()?.title;
    const card = cardId() ? cardsById[cardId()!] : undefined;
    return potTitle
      ? card
        ? `${deriveCardGridTitle(card)} - ${potTitle}`
        : potTitle
      : undefined;
  });
  // Footer's status-bar slot: the open card's own title. Only shown
  // once a real card exists -- a still-unresolved draft has no title
  // to show yet (see DraftCardEditor, which creates the record only
  // after the header is confirmed).
  // Debug-only indicator of which editor mode is currently mounted: a
  // draft only owns a local Y.Doc and has no "cards" record yet (see
  // DraftCardEditor), while an existing card has already synced
  // against its own room (see ExistingCardEditor). Surfacing this in
  // the footer makes it easy to tell which one is active without
  // reading logs.
  const editorMode = () =>
    cardId() ? "editor" : draft() ? "draft" : undefined;

  useFooterSlot(() => {
    const id = cardId();
    const card = id ? cardsById[id] : undefined;
    return (
      <>
        {card && <div class="page-title">{deriveCardGridTitle(card)}</div>}
        <Show when={editorMode()}>
          <div class="page-list-status">
            <span class="item">{editorMode()}</span>
          </div>
        </Show>
      </>
    );
  });
  return (
    <Show when={cardId() || draft()} fallback={<Loading />}>
      <div class="page-column">
        <div class="col-page">
          <Show when={mergeTarget()}>
            {(target) => (
              <PageAlert variant="info" class="merge-pages">
                "
                <A href={`/${params.slug}/${titleToSegment(target())}`}>
                  {target()}
                </A>
                " already exists.
                {/* Merging is not implemented yet: the button only
                    reserves its place in the layout. */}
                <button type="button" class="btn btn-primary">
                  Merge pages
                </button>
              </PageAlert>
            )}
          </Show>
          <Show when={renameAlert()}>
            {(alert) => (
              <PageAlert
                variant="success"
                class="replace-page-links-alert"
                onClose={() => dismissRenameAlert(alert().cardId)}
              >
                <p>
                  This page is linked from {alert().linkedFrom.length}{" "}
                  {alert().linkedFrom.length === 1 ? "page" : "pages"}:{" "}
                  {alert().linkedFrom.join(", ")}
                </p>
                <button
                  type="button"
                  class="btn"
                  disabled={updatingLinks()}
                  onClick={() =>
                    handleUpdateLinks(alert().cardId, alert().oldTitle)
                  }
                >
                  Update links from [{alert().oldTitle}] to [{alert().newTitle}]
                </button>
                <Show when={updateLinksError()}>
                  <p>{updateLinksError()}</p>
                </Show>
              </PageAlert>
            )}
          </Show>
          <Show
            when={cardId()}
            keyed
            fallback={
              <Show when={draft()} keyed>
                {(value) => (
                  <DraftCardEditor
                    potId={() => pot()?.id}
                    potSlug={() => params.slug}
                    initialTitle={value.initialTitle}
                    onCreated={handleCreated}
                  />
                )}
              </Show>
            }
          >
            {(id) => (
              <ExistingCardEditor
                cardId={id}
                potSlug={() => params.slug}
                initialText={draftText()}
                onContentSnapshot={(fn) => setContentSnapshot(() => fn)}
                onReady={setEditorReady}
                initialSelection={focusSelection()}
              />
            )}
          </Show>
        </div>
        {/* Always rendered so the layout does not shift when a draft
            becomes a real card; while there is no card yet (a draft),
            its buttons are disabled. */}
        <PageMenu
          cardId={cardId()}
          potSlug={params.slug}
          hidden={!menuReady()}
          getContent={contentSnapshot()}
        />
      </div>
    </Show>
  );
}
