import { createSignal } from "solid-js";
import { Search } from "@kobalte/core/search";
import { Search as SearchIcon } from "@/lib/icons";
import { useHotkeys } from "@/lib/hotkeys";

export interface TitleSearchProps {
  // Returns the titles matching the typed text, best first.
  suggest: (query: string) => Promise<string[]>;
  // Called with the title the user picked.
  onSelect: (title: string) => void;
  // Called with the text of the input on every change, so the parent can
  // use it (TopBar's "add card" button opens a card with this title).
  onQueryChange?: (value: string) => void;
}

// TopBar's title search. What is searched (a pot's cards, or the pots
// themselves) and what picking a title does are decided by the caller (see
// TopBar). Class names follow Cosense's navbar (.navbar-form > .search-form >
// .form-group > .dropdown > .form-control, plus .btn-search for the icon).
export default function TitleSearch(props: TitleSearchProps) {
  const [titles, setTitles] = createSignal<string[]>([]);
  // Identifies the latest query, so a slow answer to an older input is dropped.
  let latest = 0;

  // Mounted on every page (see TopBar), so the hotkey works everywhere.
  let input: HTMLInputElement | undefined;
  useHotkeys({
    "search.focus": () => {
      input?.focus();
      input?.select();
    },
  });

  const handleInput = async (value: string) => {
    props.onQueryChange?.(value);
    const request = ++latest;
    if (value.trim() === "") {
      setTitles([]);
      return;
    }
    try {
      const found = await props.suggest(value);
      if (request === latest) setTitles(found);
    } catch (err) {
      console.error("[title-search] failed to search:", err);
    }
  };

  const handleChange = (title: string | null) => {
    if (title) props.onSelect(title);
  };

  return (
    <div class="navbar-form">
      <form
        class="search-form"
        role="search"
        onSubmit={(e) => e.preventDefault()}
      >
        <Search<string>
          class="form-group"
          options={titles()}
          onInputChange={handleInput}
          onChange={handleChange}
          itemComponent={(item) => (
            <Search.Item item={item.item} class="search-item">
              <Search.ItemLabel>{item.item.rawValue}</Search.ItemLabel>
            </Search.Item>
          )}
        >
          {/* The popup is positioned against Search.Control, so it must wrap
              the input. */}
          <Search.Control class="dropdown" aria-label="Search titles">
            <Search.Input
              ref={input}
              class="form-control"
              autocomplete="off"
              spellcheck={false}
            />
            <Search.Indicator class="btn-search">
              <Search.Icon>
                <SearchIcon class="kamon" />
              </Search.Icon>
            </Search.Indicator>
          </Search.Control>
          <Search.Portal>
            <Search.Content
              class="dropdown-menu search-menu"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <Search.Listbox />
              <Search.NoResult class="search-item">No results</Search.NoResult>
            </Search.Content>
          </Search.Portal>
        </Search>
      </form>
    </div>
  );
}
