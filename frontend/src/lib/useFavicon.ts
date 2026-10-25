import { createEffect, onCleanup } from "solid-js";

// Sets the browser tab's icon reactively to whatever `href()` returns,
// restoring the original icon once the calling page unmounts. Same
// pattern as useTitle.ts: a page with no icon of its own (e.g. the pods
// list) is never left showing a stale one after leaving a page that set
// one.
//
// `href()` returning undefined (e.g. still loading) leaves the current
// icon untouched. The `type` attribute is removed while an override is
// active, since a pod's cover may be any image format, not only the SVG
// that index.html declares.
export function useFavicon(href: () => string | undefined): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;

  const originalHref = link.getAttribute("href");
  const originalType = link.getAttribute("type");

  createEffect(() => {
    const next = href();
    if (!next) return;
    link.removeAttribute("type");
    link.setAttribute("href", next);
  });

  onCleanup(() => {
    if (originalHref) link.setAttribute("href", originalHref);
    if (originalType) link.setAttribute("type", originalType);
  });
}
