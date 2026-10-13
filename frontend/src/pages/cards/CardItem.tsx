// frontend/src/pages/cards/CardItem.tsx
import { Match, onCleanup, Show, Switch, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { useSortable } from "@dnd-kit/solid/sortable";
import { registerCardElement } from "@/lib/stores/cardsStore";
import { titleToSegment } from "@/lib/models/slugify";
import {
  deriveCardGridTitle,
  type CardGridCard,
  type CardRecord,
} from "@/lib/models/card";
import { ripple } from "@/lib/directives/ripple";
import { resolveImageSrc } from "@/lib/models/attachmentPath";
import { CardDescription } from "@/features/cardDescription";
import { usePot } from "../pots/PotContext";

export interface CardItemViewProps {
  card: CardGridCard;
  // Where the card links to. The caller builds it, so a pot can be shown
  // with this same view.
  href: string;
  // Overlay shown over the top-right corner (e.g. an actions menu). It is a
  // sibling of the <a>, so clicking it does not trigger the link.
  actions?: JSX.Element;
  // Ref callback for the <li>, so a wrapper can make it sortable.
  ref?: (el: HTMLLIElement) => void;
  // Fades the card while it is being dragged.
  dragging?: boolean;
  // The card stands for a page that does not exist yet (see
  // styles/components.css's .card-grid-item.empty).
  empty?: boolean;
}

// The look of a single card in a card grid, styled to match Cosense's
// own page-list card (see .card-grid-item in styles/components.css).
// Has no drag behavior of its own, so it also works outside a
// DragDropProvider (see RelatedCards). Both the title and the description
// text are precomputed server-side (see internal/serve/ydoc.go's
// buildTitleAndPreview) from the card's live Yjs body, not parsed here.
export function CardItemView(props: CardItemViewProps) {
  // Shared by every grid under PotLayout (the card list and the related
  // cards), so no extra prop is needed to know which pot the links belong to.
  const pot = usePot();

  return (
    // The <li> carries the grid item's aspect-ratio; the whole card
    // links to its edit page (CardForm doubles as both the create and
    // edit form) instead of only some inner element, so clicking
    // anywhere on the card opens it.
    <li
      // ref is a callback supplied by the wrapper, not a reactive value.

      ref={props.ref}
      class="card-grid-item"
      classList={{ empty: props.empty }}
      data-dragging={props.dragging ? "" : undefined}
    >
      <A ref={ripple} href={props.href}>
        {/* Folded-corner indicator for pinned cards (see
            styles/components.css's .card-grid-item .pin). */}
        <Show when={props.card.pin}>
          <div class="pin" aria-hidden="true" />
        </Show>
        <div class="content">
          <div class="header">
            <h3 class="title">{deriveCardGridTitle(props.card)}</h3>
          </div>
          {/* If the document has an image (see internal/xmldoc's
              FirstImageSrc, mirrored into the "image" field by
              internal/serve/ydoc.go), show it as a cover thumbnail
              instead of the plain-text description -- there's rarely
              room for both in a card this small. */}
          <Switch
            fallback={
              <div class="description">
                <CardDescription
                  text={(props.card.description ?? []).join("\n")}
                  potId={pot()?.id}
                />
              </div>
            }
          >
            {/* A page that does not exist yet has no text to show, so
                skeleton lines stand in for it (see styles/components.css's
                .line-img). */}
            <Match when={props.empty}>
              <div class="description">
                <div class="line-img">
                  <div />
                  <div />
                  <div />
                  <div />
                  <div />
                </div>
              </div>
            </Match>
            <Match when={props.card.image}>
              <div class="icon">
                <img
                  loading="lazy"
                  src={resolveImageSrc(props.card.image)}
                  alt=""
                />
              </div>
            </Match>
          </Switch>
        </div>
        {/* Whole-card hover tint (see styles/components.css's
            .card-grid-item .hover). Its position in the DOM doesn't
            affect stacking -- that's controlled by CSS z-index -- this
            just keeps it grouped with .pin, the other overlay layer. */}
        <div class="hover" aria-hidden="true" />
      </A>
      <Show when={props.actions}>
        <div class="actions">{props.actions}</div>
      </Show>
    </li>
  );
}

export interface CardItemProps {
  card: CardRecord;
  // This card's position in the currently rendered grid order. Fed to
  // useSortable below so dnd-kit can report initialIndex/index on drop
  // (see CardList.tsx's handleDragEnd).
  index: number;
  potSlug: string;
}

// A card in CardList's sortable grid: CardItemView plus drag-and-drop.
export default function CardItem(props: CardItemProps) {
  // Makes this card draggable and a drop target within the grid.
  // Getter syntax (not a plain destructure) is required so the hook
  // re-reads id/index reactively instead of only once at setup -- see
  // dnd-kit's Solid docs.
  // type/accept keep cards and the sidebar's pots (type "pot") from
  // reordering each other inside the shared provider (see MainLayout).
  const { ref, isDragging } = useSortable({
    get id() {
      return props.card.id;
    },
    get index() {
      return props.index;
    },
    type: "card",
    accept: "card",
  });

  // Registers this card's element so a reorder -- local or from
  // another user -- can animate it into its new grid slot instead of
  // snapping there instantly (see withCardsFlip in lib/cardFlip.ts).
  const setRef = (el: HTMLLIElement) => {
    ref(el);
    onCleanup(registerCardElement(props.card.id, el));
  };

  return (
    <CardItemView
      card={props.card}
      href={`/${props.potSlug}/${titleToSegment(props.card.title)}`}
      ref={setRef}
      dragging={isDragging()}
    />
  );
}
