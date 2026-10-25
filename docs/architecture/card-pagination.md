docs/architecture/card-pagination.md
# カード一覧のページネーションと Solid Store 設計

10万件規模のポットでも動くように、`cards` コレクションを起動時に全件取得するのをやめ、
**表示に必要なウィンドウだけを Solid Store に保持する**構成にした。

## 1. 方針

| 以前 | 現在 |
| --- | --- |
| 起動時に `loadAllCards()` で全ポット・全カードを取得 | ポットごとに100件単位でページ取得（`loadNextCardsPage`） |
| `CardList` が `Object.values(cardsById)` を全走査して毎回ソート | ポットのウィンドウ（読み込み済み id 列）だけをソート |
| `findCardByPodAndSlug` が全カードに `titleToSlug` を掛ける線形探索 | サーバへ単体取得（`openCardBySlug`）。`titleLc` の unique index を使う |
| 全 realtime イベントを store に書き込み | store が保持していないカードのイベントは無視 |
| 一度読んだカードは永久に store に残る | ポットを離れたら `releasePod` で解放 |

`cardsById` は「全カードのキャッシュ」ではなく、**今 UI が必要としているカードだけ**を持つ。

## 2. データ構造（`lib/stores/cardsStore.ts`）

```
cardsById : Record<cardId, CardRecord>     表示中ウィンドウのカード + URL で開いたカード
windows   : Record<podId, PodWindow>       ポットごとの読み込み状況
```

```ts
interface PodWindow {
  ids: string[];     // 読み込み順の id 列。表示順ではない（ソートは CardList 側）
  total: number;     // サーバが報告したポット内の総件数（フッター表示用）
  loaded: boolean;   // 最初のページ要求が成功・失敗を問わず完了したか
  loading: boolean;  // 要求中か（二重要求の防止）
}
```

- `PAGE_SIZE = 100`。
- ソートはサーバ側 `-pin,-position,id`（`cardApi.ts` の `CARDS_SORT`）。クライアントも同じ並びで再ソートする。
- `ids` を持つのは、`cardsById` に混在する「URL で開いただけのカード」と「一覧ウィンドウのカード」を区別するため。

## 3. データフロー

```
[CardList マウント]
   └─ window が無ければ loadNextCardsPage(podId)  ── 1ページ目
[sentinel が見える] ── IntersectionObserver
   └─ loadNextCardsPage(podId)                     ── 次ページ
[CardForm: /:pod/:cardSlug]
   └─ openCardBySlug(podId, slug)                  ── 単体取得 → cardsById へ
[PodLayout アンマウント / ポット切替]
   └─ releasePod(podId)                            ── window と該当カードを破棄
[realtime "cards" 購読 (AppShell が1回だけ開始)]
   └─ handleCardEvent                              ── 保持しているものだけ反映
```

### 3.1 `loadNextCardsPage(podId)`

- 要求済みなら（`loading`）、または全件読み込み済みなら（`loaded && ids.length >= total`）何もしない。
- 要求ページは `floor(ids.length / PAGE_SIZE) + 1`。**「最後に読んだページ + 1」ではない。**
  ウィンドウ内のカードが削除されるとサーバの一覧が1つ詰まり、次ページを要求すると
  その隙間に入ったカードが飛ばされるため。重複分は id で捨てる。
- 応答後にウィンドウが解放済み（`releasePod` 済み）なら結果を捨てる。
- 新規追加が0件のページは「サーバの並びとウィンドウがずれた」とみなし、
  `total = ids.length` にして完了扱いにする（同じページを無限に要求しないため）。
  ずれはリロードで解消する。
- 失敗はログのみ。`loaded = true` にして、ローディング表示で固まらないようにする。

### 3.2 `openCardBySlug(podId, slug)`（`cardApi.fetchCardBySlug`）

1. `titleLc = slug.toLowerCase()` で unique index を引く（`(pod, titleLc)`）。
2. `titleLc` は単射ではない（`"a b"` と `"a_b"` が同じ）ので、`titleToSlug(title) === slug` で検証。
3. 404 のみ「カードなし」（`undefined` → 下書きとして扱う）。それ以外のエラー（ネットワーク等）は投げる。
   以前は全エラーが下書き扱いになっていた。

取得したカードは `cardsById` に入るので、開いている間は realtime で更新が反映される。

### 3.3 realtime（`handleCardEvent`）

| イベント | 動作 |
| --- | --- |
| `delete` | `dropCard`: ウィンドウにあれば `ids` から除き `total` を減らす。`cardsById` からも削除 |
| `update`（`deleted` あり） | ソフトデリート。`delete` と同じく `dropCard` で除く（`create` で `deleted` 付きが来た場合も同様） |
| `create` | `addCreatedCard`: **そのポットのウィンドウが `loaded` のときだけ**追加（`total` +1、重複は無視） |
| `update` | `cardsById` に**既にある**カードだけ反映。無ければ無視 |

- 購読自体は全ポット分（`"*"`）を受信するが、store は保持していないものを書き込まない。
- 全操作は `withCardsFlip` で包まれ、並び替えは FLIP アニメーションになる。
- 下書きから作成したカードは `DraftCardEditor` が `mergeCards` で `cardsById` に入れるが、
  ウィンドウへは入れない。ウィンドウへは realtime の `create` エコーで入る。

### 3.4 `releasePod(podId)`

`windows[podId]` を消し、`cardsById` から `pod === podId` のカードを全て消す。
`PodLayout` の `createEffect` 内で `onCleanup(() => releasePod(id))` を登録している。
`CardList` ⇄ `CardForm` の移動では `PodLayout` がマウントされたままなので、ウィンドウは保たれる。

## 4. 各コンポーネントの役割

| ファイル | 役割 |
| --- | --- |
| `lib/api/cardApi.ts` | `fetchCardsPage` / `fetchCardBySlug`。どちらも `requestKey: null` |
| `lib/stores/cardsStore.ts` | 上記の store と操作関数。`podWindow(podId)` で読み取り |
| `pages/pods/PodLayout.tsx` | ポットを1回取得。離脱時に `releasePod` |
| `pages/cards/CardList.tsx` | ウィンドウ → 表示。sentinel で次ページ。ドラッグ並び替え |
| `pages/cards/CardForm.tsx` | slug から `openCardBySlug`。`openRequest` カウンタで古い応答を破棄 |
| `components/layout/AppShell.tsx` | `loadAllPods` と realtime 購読の開始のみ（カードは読まない） |

### `requestKey: null` が必要な理由

PocketBase SDK は同じメソッド・パスの要求が重なると前の要求を自動キャンセルする。
一覧取得と slug 検索（どちらも `cards` の list）が互いにキャンセルし合うため、両方で無効化している。

### CardList の詳細

- 最初のページ: `podWindow` が無いときだけ `loadNextCardsPage`（`untrack` で再実行を避ける）。
- 表示: `ids → cardsById → filter(defined) → sort(pin, position 降順, id)`。
- sentinel: `IntersectionObserver` は**変化しか通知しない**。ページを読んでも sentinel が
  見えたままだと次が要求されないので、`ids.length` の変化ごとに `unobserve` → `observe` し直す。
- フッター: `podWindow.total`（サーバ報告の総件数）。

### ドラッグ並び替え

ロジックは以前のまま（`computePosition`、ピン有無でグループ分け）で、次の制限だけ加えた。

- ウィンドウ末尾のカードより下へは落とせない（未読込のカードが残っているとき）。
  その下に来るカードの `position` が分からず、隣接値を計算できないため。
- 全件読み込み済みなら制限なし。

## 5. 既知の制約

- **ページ番号方式のずれ**: スクロール中に他ユーザーが並び替えると、重複や取りこぼしが起きうる。
  重複は id で除去。最悪の場合は「新規0件 → 完了扱い」で一覧が途中で止まる。リロードで直る。
- **ピン留めが100件超**: `nextPinnedPosition` は読み込み済みのピン留めカードしか見ない。
- **購読は全ポット分**を受信する（store は無視するだけ）。負荷が問題になったら
  ポット単位のフィルタ付き購読に切り替える。
- **ウィンドウは縮まない**: 下までスクロールし続けると DOM のカード数が増える。
  dnd-kit の登録コストも含め、必要になったら仮想化を検討する。
- `releasePod` と `nextPinnedPosition` は保持中のカード全件を走査する（O(保持数)）。
  保持数はウィンドウ分だけなので現状は許容。

## 6. テスト

`lib/stores/cardsStore.test.ts`。PocketBase の `pb.collection("cards")` は同一インスタンスが
キャッシュされるため、その `getList` / `subscribe` を `vi.spyOn` で差し替えている
（`vi.mock` は使わない）。

- 削除後にウィンドウ末尾を含むページを要求し、カードが飛ばされない
- 新規0件のページで完了扱いになり、再要求しない
- 保持していないカードの `create` / `update` を無視する
- `create` / `delete` の二重イベントで `total` が二重に増減しない
- `releasePod` 後に遅れて届いたページで window が復活しない

テストごとに別のポット id を使う（store がモジュールレベルの状態のため）。
spy のキューを使い切ると実サーバへ要求が飛ぶので、各テストは使うページ数だけ積むこと。
