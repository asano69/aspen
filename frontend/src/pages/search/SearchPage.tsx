import { createResource, For, Show } from "solid-js";
import { A, useSearchParams } from "@solidjs/router";
import { usePod } from "../pods/PodContext";
import { searchCards } from "../../lib/api/cardApi";
import { titleToSegment } from "../../lib/models/slugify";

export default function SearchPage() {
  const pod = usePod();
  const [params, setParams] = useSearchParams();
  // A repeated "?q=a&q=b" arrives as an array: only the first value is used.
  const query = () => {
    const q = params.q;
    return (Array.isArray(q) ? q[0] : q) ?? "";
  };
  const [res] = createResource(
    () => [pod()?.name, query()] as const,
    ([name, q]) => (name && q ? searchCards(name, q) : undefined),
  );

  return (
    <div class="search-page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q") as string;
          setParams({ q });
        }}
      >
        <input name="q" value={query()} placeholder="Search cards" />
      </form>
      <Show when={res()}>
        {(r) => (
          <ul class="search-results">
            <For each={r().items} fallback={<li>No results.</li>}>
              {(it) => (
                <li>
                  <A href={`/${pod()?.name}/${titleToSegment(it.title)}`}>
                    {it.title}
                  </A>
                  <p>{it.preview.join(" ")}</p>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
    </div>
  );
}
