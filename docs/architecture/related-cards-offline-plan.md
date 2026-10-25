# 関連カードのオフライン対応とリアクティブ化

ノートエディタの下に出る関連カード(1 hop / 2 hop / New Links / Query)を、Dexie レプリカからの**導出**に置き換え、完全オフラインで読めるようにするための段階的な設計計画。

## 1. 背景と問題

`relatedStore` は Solid store だが、リアクティブなのは入れ物だけで、データの取得経路が非リアクティブ。

| 行 | 現在の情報源 | オフライン | リアクティブ |
| --- | --- | --- | --- |
| 1 hop / 2 hop | サーバー API (`/links1hop`, `/links2hop`) を `openRelated` で一度だけ fetch | ✗ | ✗（title / query 変更時のみ再取得） |
| Query | サーバー API（Datalog） | ✗ | ✗ |
| New Links | ytext → `setOwnLinks` | ✓ | ✓ |

New Links だけが動くのは、ytext から直接導出しているから。この方式を 1 hop / 2 hop に広げる。

## 2. 前提と範囲

### 前提

- **オフライン中の新規作成・編集・削除は禁止とみなす（読み取り専用）。** 実装は次回以降。したがって、ローカルで作った行とサーバーのエコーの突き合わせ、楽観更新の整合は考えなくてよい。導出が読むのは、Dexie（サーバーのミラー）と、開いているカードの発リンクだけ。
- Dexie の `cards` / `card_links` は**サーバーの純粋なミラー**のまま。クライアントが導出した値は書き込まない（`link-extraction.md` §5）。
- 一度も同期していない pod は、オフラインでは空として扱う（§7 判断 1）。

### 今回やること

- 1 hop / 2 hop を Dexie と `ownLinks` からの導出に置き換える。
- Dexie の `liveQuery` を Solid に橋渡しして、自動で追随させる。
- `relatedStore` を薄くする。

### 今回やらないこと

- Datalog（Query 行）のクライアント評価。
- オフラインでの新規作成・編集・削除。
- Go の `links1hop` / `links2hop` ルートの変更・削除（§3）。

## 3. Go の links1hop / links2hop API は残す

- ルート `/api/pages/{pod}/{slug}/links1hop`、`/links2hop` と Go の実装・テストは**削除しない**。Agent など AI から使える API として残す。
- フロントエンドは今回から**呼ばない**。`cardApi.ts` の `fetchLinks1Hop` / `fetchLinks2Hop` / `fetchHop` は未使用のデッドコードになるので削除する（ルートはサーバー側に残るので、API の存在はこの文書と `handler.go` のコメントで示す）。
- 結果として、同じ規則が **Go（SQL）と TS（Dexie）の二重実装**になる。CLAUDE.md の方針（二重実装は許容、よくテストして常に同じ結果にする）に従い、共有フィクスチャで契約を固定する（Phase 0）。
- 基準は **Go**。理由は、Go が既存で、既にテストされている挙動だから（`link-extraction` は TS が基準だったので向きが逆になる）。TS が Go に合わせる。
- 規則を変えるときは、Go を変更 → フィクスチャにケース追加 → TS を追従 → 両方のテストが緑、の順。

## 4. 導出の規則

Go の `links1Hop` / `links2Hop`（`internal/serve/links.go`）と同じ規則を TS で実装する。入力が違う点だけ明記する。

### 入力

```ts
interface RelatedInput {
  pod: string;
  // Id of the open card. Undefined for a draft or a page that does not exist yet.
  selfId: string | undefined;
  // titleToLowerKey(title) of the open card.
  selfTitleLc: string;
  // titleLc of every link written in the open card, in order of first appearance.
  ownTargets: string[];
}
```

- `ownTargets` は、サーバー側が `card_links`（`source = selfId`）から取る代わりに、**`relatedStore` の `ownLinks`**（ytext 由来。ytext が未報告の間は Dexie の `card_links`）から作る。オフラインで開いたカードの発リンクが、サーバー反映を待たずに出るようにするため。
- 着信リンクだけは Dexie の `card_links` を引く。

### 1 hop

次の 2 つの和集合から、自分自身を除き、`title` 順に並べる。

1. 発: `cards` の `[pod+titleLc]` を `ownTargets` で引く（存在するカードだけ）。
2. 着: `card_links` の `[target_pod+target_titleLc] = [pod, selfTitleLc]` の `source` を `cards` から id で引く。

### 2 hop

- 各 `ownTargets` の X について、`card_links` の `[target_pod+target_titleLc] = [pod, X]` の `source`（= X にリンクしているカード）を集める。
- 自分自身と、1 hop に含まれるカードは除く（1 hop と 2 hop に同じカードを出さない）。
- 複数の X を共有するカードは、`ownTargets` の中で**最初に当たる X の下に 1 回だけ**出す。
- X はカードとして存在しなくてよい。他に誰もリンクしていない X は行を作らない。
- 行の並びは、X の `ownTargets` 内の順、同じ X の中では `title` 順。

### 出力の型

サーバーの `LinkedCard.target_titleLc`（2 hop のグルーピング用に Go 内部で使うだけ）は、UI が使っていないので**クライアントの型には含めない**。

```ts
// What the grid needs to draw a related card.
export type RelatedCard = CardGridCard & { id: string };
export type RelatedHopCard = RelatedCard & {
  via_title: string;
  via_titleLc: string;
};
```

`RelatedCards.tsx` の `Link2HopCard`（`generated.ts`）の import はこの型に置き換える。`generated.ts` は Go の API 用として残す。

### 並び順の比較

SQLite の `ORDER BY title` は BINARY 照合（UTF-8 バイト順）。`localeCompare` は使わない。JS の `<` は UTF-16 コード単位順なので、BMP 上位（U+E000 以降）と補助面の文字の間で順序がずれる。**コードポイント順の比較関数**を 1 つ用意し、これを使う。フィクスチャにそれを踏む日本語・絵文字のケースを入れる。

## 5. リアクティブ化: Dexie `liveQuery` を Solid に橋渡しする

`docs/dexie-offline-sync.md` §7 は `liveQuery` を使わない理由を、window のピン優先ソートなど「手続き的な変換が必要なストア」に求めていた。関連カードは「クエリ結果をそのまま表示する」ものなので、その理由は当てはまらない。**関連カードだけ `liveQuery` を使う**（cardsStore の window は従来どおり）。

### 得られるもの

realtime・pull・再同期のどの経路で Dexie が変わっても、導出が自動で追随する。`refreshLinkAlive()` のような手動の呼び出し点を増やさずに済む。

- カードの realtime は `handleCardEvent` が常に `cardsReplica.put` / `remove` を呼ぶ。
- `card_links` の realtime は `watchDataReplicas` が `applyRecords` で書く。
- pull は `syncReplica` が `applyRecords` で書く。

### 橋渡しヘルパー（小さく閉じ込める）

`lib/dexie/liveQuery.ts`:

```ts
// Runs `query` against Dexie and keeps the result current.
// `args` is read reactively (outside Dexie's tracking), so a change of
// its dependencies re-subscribes with the new arguments. `query` must
// touch only Dexie: liveQuery tracks nothing else.
export function createLiveQuery<A, T>(
  args: () => A | undefined,
  query: (args: A) => Promise<T>,
  initial: T,
): Accessor<T>;
```

実装の要点:

- `createEffect` の中で `args()` を読み（Solid が追跡）、`liveQuery(() => query(a))` を subscribe する。
- 引数が変わるたび、または破棄時に `onCleanup` で unsubscribe する。
- 値は `createStore` + `reconcile(..., { key: "id" })` で更新し、変化のないカードの DOM を作り直さない。
- エラーは `console.error` に出し、最後の値を保つ。

### リアクティブにする入力

- `ownTargets`（ytext → 300ms デバウンスの `setOwnLinks`）
- `selfTitleLc`（title 変更。サーバー解決 → realtime で `cardsById` が更新 → `props.title` が変わる）
- `selfId`、`pod`

これらは `args` の中で読む。

## 6. `relatedStore` を薄くする

導出になると、1 hop / 2 hop の取得用の仕組みは要らなくなる。

| 現在 | 変更後 |
| --- | --- |
| `openRelated`（4 本の並列 fetch） | 1 hop / 2 hop 分は削除。Query だけ別に取得（§7 判断 5） |
| `latest` カウンタ（古い応答の破棄） | 1 hop / 2 hop は `liveQuery` が担うので不要。Query 取得用に残るかは Phase 3 で判断 |
| `loaded` / `error` | 導出の読み取りには不要。Query 用にだけ残るなら Query の行に閉じ込める |
| `ownLinks` + `ownLinksLive` フラグ | 「ytext 由来の値（`undefined` なら未報告）」と「Dexie 由来の値」の 2 本に分け、`ownLinks = live ?? replica` を派生にする |

### 目標の形

```
relatedStore (input only)
  liveOwnLinks: OwnLink[] | undefined   // set by the editor; cleared on close
  replicaOwnLinks                       // createLiveQuery over card_links (source = cardId)
  ownLinks = liveOwnLinks ?? replicaOwnLinks

RelatedCards
  oneHop / twoHop = createLiveQuery(() => input, computeRelated, [])
  newLinks        = ownLinks filtered by linkAlive   // unchanged
  query           = separate, online only            // see §7
```

`setOwnLinks` / `closeRelated` の呼び出し側（`ExistingCardEditor`）は変えない。`ownLinksLive` の意味は「`liveOwnLinks` が `undefined` かどうか」に移るだけで、`link-extraction.md` §7 の挙動（ライブ値が Dexie 由来の値で上書きされない）は保たれる。

## 7. 設計判断

### 判断 1: 一度も同期していない pod をオフラインで開いたとき

導出は Dexie だけを読むので、オフラインで初めて開く pod の関連カードは空になる（カード一覧自体も `ensurePodSynced` が失敗して空）。完全オフライン対応の前提は「**そのデバイスで一度は pod を開いている**」とする。pod 単位の事前ダウンロードは別課題。

### 判断 2: pod の初回同期中の表示

`linkAliveStore` は半端なレプリカで「死んだリンク」と誤判定するのを避けるため、`markLinkAlivePodReady` まで評価を待つ。関連カードは、半端なレプリカでは「行が足りない」だけで、誤った表示は出さない。同期が進むと `liveQuery` が自動で埋める。

**案: 同期完了を待たず、段階的に表示する**（待つ仕組みを足さず、シンプル）。巨大な pod の初回同期は時間がかかるが、その間は関連カードが徐々に増える。

### 判断 3: ハブになるターゲットの重さ

`#tag` のように何千枚ものカードがリンクするターゲットがあると、2 hop の導出は数千枚の `bulkGet` になり、関連テーブルが変わるたびに再実行される。サーバー版（SQL）も同じ形の問題を抱えている。

**案: 今回は上限を設けない**（保守性優先）。重いと分かった時点で、表示件数の上限と「もっと見る」、あるいは再実行のデバウンスを検討する。

### 判断 4: Dexie の `pin` の変換

`CachedCard.pin` は 0/1。`relatedQuery.ts` で `pin === 1` に変換する。`cardsCollection.ts` の `fromCached` と同じ変換を 2 か所に持つことになるが、`fromCached` を公開すると cards 専用モジュールの内部が漏れるので、**変換は `relatedQuery.ts` に局所的に書く**。

### 判断 5: Query 行（Datalog）

クライアント評価は今回やらない。現行のサーバー取得（`fetchRelatedCards`）は残す。

- 1 hop / 2 hop / New Links の導出とは**完全に分離**する。Query の失敗（オフライン含む）が、導出行や「Failed to load related cards」の表示に影響しないようにする。
- **案: オフライン、または失敗時は Query 行を出さない**（古い結果の保持はしない。誤解を招くため）。失敗は `console.error` だけ。
- Query 行を出すタイミングは現状どおり（カードを開いたとき、保存済み `query` の変更時）。

### 判断 6: 空の `ownTargets` と下書き

- 下書き（`selfId` なし）: `selfTitleLc` は `initialTitle` から作る。着信リンクだけが出る（現在の `absentCard` と同じ）。
- カードが作られて `selfId` が付いたら `args` が変わり、自動で再購読される。

### 判断 7: 読み取り専用の強制は今回しない

「オフライン中は編集しない」は前提であって、今回は UI で強制しない。オフラインで編集しても、ytext → `ownLinks` の導出は動くので、関連カード側は壊れない。強制（エディタの無効化、`createCard` の抑止）は、オフライン書き込みの実装と一緒に決める。

### 判断 8: `linkAliveStore` の手動リフレッシュ

`refreshLinkAlive()` は `liveQuery` に置き換えられる候補だが、**今回は触らない**。関連カードの `liveQuery` が実績を作ってから、同じヘルパーで別途移行する。

## 8. 段階的な計画

### Phase 0: 契約を固定する

- `testdata/link-graph.json` を作る。構造:

  ```jsonc
  [
    {
      "name": "...",
      // Cards of one pod; links are written by title.
      "cards": [{ "title": "A", "pin": false, "deleted": false, "links": ["B", "X"] }],
      // The open card: an existing title, or a title with no card yet.
      "open": "A",
      "oneHop": ["B"],
      "twoHop": [{ "via": "X", "title": "C" }]
    }
  ]
  ```

- Go: 既存の `links1Hop` / `links2Hop` をフィクスチャで検証するテストを追加する（`links_test.go` のヘルパーを使う）。**この時点で Go のコードは変更しない**。
- ケース: 発・着の和集合、自己リンクと自己の除外、削除済みカード、他 pod、存在しないカード宛リンクと着信、1 hop との重複除外、複数ターゲット共有（最初の X の下に 1 回）、X の順序、タイトル順（日本語・絵文字・大小文字）、下書き（`open` が未存在のタイトル）。

### Phase 1: TS の導出関数

- `lib/dexie/relatedQuery.ts`: `computeRelated(input): Promise<{ oneHop; twoHop }>`。§4 の規則を、`[pod+titleLc]` と `[target_pod+target_titleLc]` の index で実装する。`bulkGet` で必要なカードだけ取る。新しい index は要らない。
- テスト: `fake-indexeddb` に `link-graph.json` の行を入れて `computeRelated` を呼ぶ（`linkAliveQuery.test.ts` と同じ方式）。TS と Go が同じフィクスチャで緑になることを確認する。
- コードポイント順の比較関数と、そのテスト。

### Phase 2: 橋渡しヘルパー

- `lib/dexie/liveQuery.ts`: `createLiveQuery`（§5）。
- テスト: `fake-indexeddb` で、Dexie に書くと値が更新されること、`args` の変更で再購読されること、破棄で unsubscribe されること。

### Phase 3: `relatedStore` と `RelatedCards` の移行

- `RelatedCards` が `createLiveQuery(…, computeRelated, …)` で 1 hop / 2 hop を読む。`Link2HopCard`（`generated.ts`）の import を §4 の型に置き換える。
- `relatedStore` を §6 の形にする。`openRelated` は Query の取得だけにする（判断 5）。
- `cardApi.ts` の `fetchLinks1Hop` / `fetchLinks2Hop` / `fetchHop` を削除する。
- `relatedStore.test.ts` を更新する（導出のテストは Phase 1 に移り、ここは `ownLinks` と Query の挙動だけ残す）。
- 確認: ネットワークを切った状態でカードを開き、1 hop / 2 hop / New Links が出ること。ほかのカードを同期で更新したとき、開いたままのカードの関連カードが自動で変わること。

### Phase 4: ドキュメントの更新

- `docs/dexie-offline-sync.md` §7: 「関連カードの導出に限り `liveQuery` を使う」例外を追記する。
- `docs/architecture/link-extraction.md` §8: 1 hop / 2 hop 行の情報源を Dexie の導出に、反映のタイミングを「同期・realtime で自動」に更新し、§9 の「開いたまま追加したリンクで 1 hop / 2 hop が更新されない」制約を削除する。
- `internal/serve/handler.go` の `links1hop` / `links2hop` ルートに「Agent 等の外部利用向け。フロントエンドは使わない」旨のコメントを足す。

## 9. 変更時のチェックリスト

- 導出規則を変える: Go を変更 → `link-graph.json` にケース追加 → TS を追従 → Go と TS の両方のテストが緑。
- Dexie の `card_links` / `cards` にクライアント導出値を書かない。
- `createLiveQuery` の `query` では Dexie 以外を読まない（`liveQuery` は Dexie のアクセスだけを追跡する）。
- Go の `links1hop` / `links2hop` ルートと、そのテストは残す。
