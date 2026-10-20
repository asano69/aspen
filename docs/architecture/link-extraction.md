# 発リンクの抽出とリアルタイム反映

カード本文の `[wiki link]` と `#hashtag`（以下まとめて「リンク」）を、サーバーとクライアントの両方で同じ規則で抽出し、リンクの生死判定と関連カード一覧に使う仕組みの設計。

## 1. 要点

- 抽出規則の正は**フロントエンドのパーサ**（`parser/cardpod`）。Go の `internal/parser` はそれに揃える。二重実装は許容するが、共有フィクスチャで常に同じ結果になることを保証する。
- リンクの同一性は **`titleLc`**（`internal/slug.ToLowerKey` / `titleToLowerKey`）。表記が違っても `titleLc` が同じなら同じリンク。
- サーバーは保存のたびに `card_links` を本文に同期する。クライアントは `card_links` を Dexie に**サーバーの純粋なミラー**として持つ。
- **開いているカード自身の発リンクだけ**は、保存を待たずにクライアントが ytext から直接導出し、`relatedStore` の `liveOwnLinks` に載せる。1 hop / 2 hop はそれと Dexie から導出する（`related-cards-offline-plan.md`）。

## 2. データの流れ

```
          ┌────────────────────────── 開いているカード ──────────────────────────┐
          │ CodeMirror ⇄ Y.Text("content")                                         │
          │      │ observe (debounce 300ms)                                        │
          │      ▼                                                                 │
          │ extractLinks(text)  ── 純粋関数、TS パーサで直接パース                   │
          │      ▼                                                                 │
          │ relatedStore.setOwnLinks()  → liveOwnLinks     ─→ RelatedCards         │
          └────────────────────────────────────────────────────────────────────────┘
                 │ y-websocket
                 ▼
 サーバー ydocPersistence.store (ygo が 2〜10 秒でまとめて保存)
      ├─ updatePreview   … description / image
      └─ wikilink.Sync   … parser.Parse → LinkTitles → orderedTargets → card_links
                 │ PocketBase hook
                 ▼
 realtime (centrifuge "card_links" チャネル) / pull (/api/pages/{potId}/card_links/pull)
                 ▼
 Dexie card_links  ← サーバーのミラー
                 ▼
 computeAlive → linkAliveStore → エディタの赤リンク / 説明文 / New Links
```

## 3. 抽出規則（TS が正、Go が追従）

| 層 | 場所 |
| --- | --- |
| TS（正） | `parser/cardpod/*`、純粋関数 `lib/models/extractLinks.ts` |
| Go | `internal/parser/*`、`LinkTitles()` → `internal/wikilink.orderedTargets` |
| 契約 | `testdata/link-extraction.json`（両方のテストが同じ JSON を読む） |

規則:

- 対象は `WikiLink` と `HashTag`。ハッシュタグのタイトルは先頭の `#` を**1つだけ**除いた文字列（`hashTagTitle`、Go は `parseHashTag`）。
- 1行目はタイトル行で、記法を解釈しない。リンクとして数えない。
- インラインコード、`code:` ブロックの本文、`table:` 宣言行は対象外。テーブルは行をタブでセルに分け、セルごとに解析する。
- `[[x]]`（Strong）、画像、アイコン、座標、数式、`/project` などの括弧記法はリンクではない。
- http/https 以外のスキームは URL ではない（`[ftp://x]` は WikiLink）。
- ラベル付き外部リンクのラベルは再帰的に解析する。裸の URL は `]` と空白まで消費する（URL 中の `[x]` はリンクにならない）。
- 空白の判定は ECMAScript の `\s`（Go は `isJSSpace`）。バイト単位で判定しない。
- 抽出結果は `titleLc` で重複排除し、**最初の出現順**に並べ、最初の綴りを残す。`titleLc` が空のものは捨てる。

規則を変えるときは、必ずフィクスチャにケースを足し、TS と Go の両方のテストが通ることを確認する。

## 4. サーバー側の保存（`internal/wikilink`）

- `Sync(app, cardID, text)` が `card_links` を本文に合わせる。変更がなければ何も書かない。
- 消えたリンクの行は**ソフトデリート**（`deleted` を立てる）。オフラインだったクライアントが次の pull で削除を知るために、行は残す。
- 位置（`position`）は最初の出現順。行の同一性は `(source, target_titleLc)`。
- 自己リンクも保存する。自己リンクかどうかはクエリ時に判定する（`titleLc` はカード名変更で変わりうるため）。
- ソフトデリートされたカードは、本文を空として同期する（`link_cleanup.go`）。
- 保存は ygo が間引くため、本文の編集から `card_links` に反映されるまで数秒かかる。

## 5. クライアント側のレプリカ

- `card_links` は `internal/replica` に登録された複製対象で、pull（チェックポイント式）と realtime で Dexie に反映する（詳細は `dexie-offline-sync.md`）。
- Dexie の `card_links` は**サーバーのミラーとして扱い、クライアントが導出した値を書き込まない**。理由:
  1. **行の id**: サーバー行の id は PocketBase が採番する。ローカルで作った行はサーバーのエコーと二重になり、`applyRecords` は id でしか消せない。
  2. **復活**: サーバー側の古い状態（`position` の更新など）が、ローカルで消した行を復活させうる。
  3. **後始末**: ローカル専用行には目印と、サーバー行が来たときの削除処理が要り、overlay より複雑になる。

## 6. リンクの生死（`linkAliveStore` / `computeAlive`）

リンク先が「生きている」条件は次のどちらか。

- `(pot, titleLc)` のカードが存在する。
- そのターゲットにリンクしている行が `card_links` に**2件以上**ある。

「2件以上」にする理由は、結果が誰が尋ねるかに依存しないようにするため。リンクはどこかのカードに書かれており、そのカード自身が1件目のリンカーである。したがって「他にも誰かがリンクしている」は「2件以上」と等しい。複数のカードで共有されるタグは青（生きている）で表示される。これは仕様。

結果は `linkAliveStore` に booleans として持ち、未回答（`undefined`）は「生きている」として扱う。リンクが最初に赤く点滅するのを防ぐ。pot の複製が初回同期を終えるまで評価しない（`markLinkAlivePotReady`）。

利用者は3か所で、同じ結果を読むため食い違わない。

- エディタの赤リンク（`emptyLinks`）
- カード一覧の説明文（`CardDescription`）
- 関連カードの New Links 行（`RelatedCards`）

## 7. 開いているカードの発リンク（リアルタイム部分）

### 仕組み

- `ExistingCardEditor` が `ytext.observe` を購読し、300ms デバウンスして `extractLinks(ytext.toString())` を呼ぶ。
- 結果を `relatedStore.setOwnLinks(pot, links)` で `liveOwnLinks` に置き換える。
- `RelatedCards` は `createOwnLinks` が返す `ownLinks`（`liveOwnLinks ?? Dexie の card_links`）を読む。各リンクに `requestLinkAlive` を出し、死んでいるものを New Links 行に出す。同じ `ownLinks` が 1 hop / 2 hop の導出入力（`ownTargets`）にもなる。

### 設計上の判断

- **開いている間は ytext が正本。** 他のクライアントの編集も ytext に入るので、サーバーのエコーとの突き合わせや、overlay の破棄条件は不要。
- **新しい Store を作らない。** 寿命は `relatedStore` の既存の仕組みに乗る。カードを閉じると `closeRelated()` が `liveOwnLinks` を `undefined` に戻す。
- **`OwnLink` 型**は `target_pot / target_title / target_titleLc` だけ。順序は配列の並びで表す（`position` は持たない）。

### 注意が必要な箇所

- `liveOwnLinks` は**所有カードの id を持つ**（`{ cardId, links }`）。`createOwnLinks` は自分の `cardId` と一致するときだけ採用し、それ以外は Dexie の `card_links` を読む。そのため、直前に開いていたカードの値が下書き（`/new`）や次のカードに見えることは構造的に起きない。Dexie 側が後から更新されても、所有者のライブ値は上書きされない。エディタが破棄されるとき `closeOwnLinks(cardId)` が所有者の値だけを消す。
- 空の ytext はスキップ: 同期前に空の配列を書くと、Dexie 由来の New Links が一瞬消える。同期後に `observe` が発火して導出される。
- ドラフトは対象外: カードが作られ `ExistingCardEditor` に移った後に導出が始まる（ドラフトの Y.Doc は引き継がれるので、初回に即時導出する）。

## 8. 何がいつ更新されるか

| 表示 | 情報源 | 反映のタイミング |
| --- | --- | --- |
| New Links 行（開いているカード） | ytext → `extractLinks` | 編集の約 300ms 後 |
| 1 hop / 2 hop 行 | Dexie（`cards` / `card_links`）と `ownLinks` からの導出（`computeRelated`、`liveQuery`） | 編集の約 300ms 後（`ownLinks` の変化）、および同期・realtime で Dexie が変わったとき。自動 |
| エディタの赤リンク | Dexie → `computeAlive` | サーバー保存後（数秒）の realtime / pull |
| 説明文の赤リンク | 同上 | 同上 |

新しく書いたリンクは、サーバー反映前は Dexie に行がないため、カードの存在か他のリンカーがなければ「死んでいる」と判定され、反映後も1件のままなら同じ結果になる。一貫している。

## 9. 既知の制約

- エディタの赤リンクは、`[新しいリンク]` を書いた直後ではなく、サーバー保存後に反映される（`computeAlive` が開いているカードの未保存リンクを見ない）。気になる場合は `computeAlive` に開いているカードの発リンクを加味する。
- 抽出のたびに本文全体をパースする。長い本文で重ければ `TreeFragment.applyChanges` による増分化を検討する。

## 10. ファイル対応表

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/noteEditor/parser/cardpod/*` | 抽出規則の正（Lezer パーサ） |
| `frontend/src/lib/models/extractLinks.ts` | 本文からリンクを抽出する純粋関数 |
| `frontend/src/lib/models/hashTagTitle.ts` | ハッシュタグのタイトル導出（3か所で共有） |
| `frontend/src/lib/models/slugify.ts` | `titleToLowerKey`（Go の `ToLowerKey` と対） |
| `frontend/src/lib/stores/relatedStore.ts` | `liveOwnLinks`、`createOwnLinks`（`ownLinks` の合成）、`setOwnLinks`、Query 行の取得 |
| `frontend/src/lib/dexie/relatedQuery.ts` | 1 hop / 2 hop の導出（`computeRelated`）。規則の基準は Go の `links1Hop` / `links2Hop` |
| `frontend/src/lib/dexie/liveQuery.ts` | Dexie の `liveQuery` を Solid に橋渡しする `createLiveQuery` |
| `frontend/src/lib/models/compareTitles.ts` | SQLite の `ORDER BY title` と同じコードポイント順の比較 |
| `frontend/src/features/noteEditor/ExistingCardEditor.tsx` | `ytext.observe` による導出 |
| `frontend/src/pages/cards/RelatedCards.tsx` | 関連カード行と New Links の表示 |
| `frontend/src/lib/stores/linkAliveStore.ts` | リンクの生死結果の共有ストア |
| `frontend/src/lib/dexie/linkAliveQuery.ts` | `computeAlive`（生死判定の唯一の定義） |
| `frontend/src/lib/dexie/dataReplicas.ts` | `card_links` レプリカの同期 |
| `internal/parser/*` | Go 側のパーサ（TS に追従） |
| `internal/wikilink/wikilink.go` | `card_links` の同期（`Sync`、`orderedTargets`） |
| `internal/serve/ydoc.go` | 保存時に `Sync` を呼ぶ |
| `internal/serve/link_cleanup.go` | カード削除時のリンク掃除 |
| `internal/replica/replica.go` | 複製対象の登録 |
| `testdata/link-extraction.json` | リンク抽出の TS と Go の契約（共有フィクスチャ） |
| `testdata/link-graph.json` | 1 hop / 2 hop の TS と Go の契約（共有フィクスチャ。基準は Go） |

## 11. 変更時のチェックリスト

- 抽出規則を変える: TS を変更 → フィクスチャにケース追加 → Go を追従 → 両方のテストが緑。
- 新しいリンク記法を足す: `extractLinks` の対象ノード、`hashTagTitle` のような共通関数、Go の `LinkTitles` を揃える。
- Dexie の `card_links` にクライアント導出値を書かない（§5）。
- `ownLinks` を触るときは `liveOwnLinks ?? replica` の優先関係（§7）を壊さない。
- 1 hop / 2 hop の規則を変える: Go を変更 → `link-graph.json` にケース追加 → TS（`relatedQuery.ts`）を追従 → 両方のテストが緑。
