import { createResource, For, Show } from "solid-js";
import { A, useSearchParams } from "@solidjs/router";
import { usePot } from "../../lib/pot";
import { searchCards } from "../../lib/api/cardApi";

export default function SearchPage() {
  const pot = usePot();
  const [params, setParams] = useSearchParams();
  const [res] = createResource(
    () => [pot().name, params.q ?? ""] as const,
    ([name, q]) => (q ? searchCards(name, q) : undefined),
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
        <input name="q" value={params.q ?? ""} placeholder="Search cards" />
      </form>
      <Show when={res()}>
        {(r) => (
          <ul class="search-results">
            <For each={r().items} fallback={<li>No results.</li>}>
              {(it) => (
                <li>
                  <A href={`/${pot().name}/${it.slug}`}>{it.title}</A>
                  <p>{it.preview}</p>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
    </div>
  );
}
