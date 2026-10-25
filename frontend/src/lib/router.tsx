// frontend/src/lib/router.tsx
import { Router, Route } from "@solidjs/router";

import AppShell from "../components/layout/AppShell";
import PodLayout from "../pages/pods/PodLayout";

import PodCards from "../pages/pods/PodCards";
import CardList from "../pages/cards/CardList";
import CardForm from "../pages/cards/CardForm";
import SearchPage from "../pages/search/SearchPage";
import ApiDocs from "../pages/admin/ApiDocs";
import Md2sb from "../pages/admin/Md2sb";

// All top-level routes in one place, so adding or removing a page never
// requires touching main.tsx.
//
// AppShell is passed as `root` rather than wrapped around <Router> here,
// so its contents (e.g. NavBar's <A> links) render inside the router
// context instead of erroring outside a Route.
export default function AppRouter() {
  return (
    <Router root={AppShell}>
      {/* GET-only API tester (see ApiDocs.tsx). Lives under AppShell/
          AuthGate like every other route, so it reuses the same
          PocketBase session -- no separate login needed. */}
      <Route path="/admin/api-docs" component={ApiDocs} />
      {/* Markdown -> Scrapbox notation converter (see features/md2sb). */}
      <Route path="/admin/md2sb" component={Md2sb} />
      <Route path="/" component={PodCards} />
      {/* The pod segment in the URL is now the pod's unique
          "name" field, not its PocketBase id (see CardList.tsx
          and CardForm.tsx, which resolve the actual record via
          this name). PodLayout owns fetching the pod and registering
          TopBar's pod-name link (see PodLayout.tsx), so it stays
          mounted continuously while navigating between CardList and
          CardForm below instead of flickering on every transition. */}
      <Route path="/:slug" component={PodLayout}>
        <Route path="/" component={CardList} />
        {/* "/new" (draft creation) and "/:cardSlug" (edit) share ONE
            Route -- not two separate <Route> elements -- so navigating
            between them never remounts CardForm/NoteEditor.
            CardForm's own URL-sync effect replaces "/new" with
            "/:cardSlug" the instant a draft's title resolves (right
            after createCard() returns); with two separate pages,
            Solid Router treated that as a match against a different
            Route and tore down the still-connecting WebsocketProvider
            and its in-memory Y.Doc before the just-typed header ever
            reached the server. The freshly mounted NoteEditor then
            synced against the (still empty) server room, so line0
            came back blank -- intermittently, only when the WebSocket
            handshake lost the race against that reactive navigate.
            "new" is a reserved slug (see internal/serve/slug.go's
            reservedSlug handling), so a real card can never resolve to
            it and collide with this literal path; it's listed first
            so the static segment still wins the match. */}
        <Route path="/search/page" component={SearchPage} />
        <Route path={["/new", "/:cardSlug"]} component={CardForm} />
      </Route>
    </Router>
  );
}
