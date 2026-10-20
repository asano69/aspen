# リンクの有効性と関連カードの設計

wikiリンク（`[title]`）の「有効／無効」の判定、関連カード（1 hop / 2 hop / New Links / Query）の表示、そして削除済みカードのリンクの扱いをまとめた設計ドキュメント。新規の開発者が、データがどこで生まれ、どこを通り、どこで画面に出るかを追えることを目的とする。

## 1. 用語

| 用語 | 意味 |
| --- | --- |
| リンク先 | `[title]` が指すカード。キーは `(pot, titleLc)` |
| `titleLc` | タイトルから導出する検索キー。小文字化し、半角スペースを `_` にしたもの（`internal/slug.ToLowerKey`、フロントは `titleToLowerKey`） |
| 有効（alive） | リンクを開いても「空の下書き」にならない状態。後述の判定規則で決まる |
| 無効（dead） | 有効でないリンク。エディタでは赤字、カード一覧の説明欄では赤字、関連カードでは「New Links」に出る |
| ソフトデリート | レコードを消さず `deleted` に日時を入れる削除方式。オフラインのクライアントが次のpullで削除を知るために必要 |
| レプリカ | Dexie（IndexedDB）上のローカルコピー。`cards` と `card_links` が対象（`docs/dexie-offline-sync.md`） |

## 2. 全体像

責務は4層に分かれている。上の層は下の層の中身を知らない。

```
[構文解析]  Lezer (parser/cardpod)
            WikiLink ノードを作るだけ。リンク先が存在するかは知らない
                │
[判定]      dexie/linkAliveQuery.ts の computeAlive(pot, titleLc)
            レプリカを読んで boolean にする。判定規則の定義はここだけ
                │
[共有store] stores/linkAliveStore.ts
            結果（boolean）だけを持つ。キーは "pot:titleLc"
                │
   ┌────────────┼──────────────────────┐
[エディタ]   [カード一覧の説明欄]   [関連カードの New Links]
emptyLinks   CardDescription        RelatedCards
```

関連カード用の `relatedStore` は **別の store** で、有効性を一切知らない。有効性が必要な場面（New Links）は `linkAliveStore` を読む。これにより、有効性の計算は1か所にしか存在しない。

## 3. 有効性の判定規則（`computeAlive`）

```
alive = (pot 内に titleLc が一致するカードが存在する)
        || (そのリンク先を指す card_links が 2 件以上ある)
```

実装は `frontend/src/lib/dexie/linkAliveQuery.ts`。使うindexは次の2つ。

- `cards` の `[pot+titleLc]`
- `card_links` の `[target_pot+target_titleLc]`

### なぜ「1件」ではなく「2件以上」か

判定結果が「誰が尋ねたか」に依存しないようにするため。

- 画面に出ているリンクは、必ず表示中のカード自身の本文に書かれている。
- つまり、そのカード自身が必ずリンク元の1枚として `card_links` に入っている。
- 「自分以外にも、同じ先にリンクしているカードがある」は「リンク元が2枚以上」と同じ意味になる。

こうすると結果は boolean 1つで足り、store にキーごとの結果だけを持たせられる。自己リンクは「カードが存在する」側で有効になる。

### 既知の不正確さ

- リンクを打った直後は、サーバーが本文を保存して `card_links` に反映するまで（約2秒）自分が数えられない。その間、「他の1枚だけがリンクしているリンク先」は一瞬赤くなる。同期後はイベントで直る。
- 下書き（まだカードレコードがない）で打ったリンクは、保存されるまで数えられない。

## 4. 削除済みカードのリンクの扱い

### 問題

`computeAlive` はレプリカ上で `card_links` の件数を数える。削除済みカードが張っていたリンクが生きたまま残ると、存在しないカードが「リンク元」として数えられ、本来無効なリンクが有効に見えてしまう。

そこで、次の不変条件を保つ。

> **`card_links` の生きている行（`deleted = ""`）のリンク元は、常に生きているカードである。**

この不変条件があれば、レプリカ上で件数を数えるだけでよく、リンク元カードの生死をいちいち確認する必要がない。ポットをまたぐリンクを足したときも同じ。

### 仕組み

カードが削除されたら、そのカードの全リンクを、ソフトデリートする。2段構えになっている。

**① `wikilink.Sync` が削除済みカードを「リンクなし」として扱う**（`internal/wikilink/wikilink.go`）

```go
if !source.GetDateTime("deleted").IsZero() {
	text = ""
}
```

`Sync` は「カードの本文から wiki リンクの一覧を作り、`card_links` をそれに合わせる」関数。本文を空として扱うと、リンク先が0件になり、既存の生きている行はすべて「不要な行（stale）」として `deleted` を立てられる。通常のリンク削除と同じ経路なので、特別な分岐は増えない。

**② カードが削除された瞬間に `Sync` を呼ぶフック**（`internal/serve/link_cleanup.go`）

```go
app.OnRecordAfterUpdateSuccess("cards") // deleted が入っていれば
    → wikilink.Sync(app, card.Id, "")
```

①だけでは足りない。`Sync` は本文のスナップショット保存（`ydoc.go` の `store`）から呼ばれるが、削除済みカードはもう編集されないので、次のスナップショットは来ない。そのため、削除（`cards` の更新）そのものをきっかけに呼ぶ。

- 失敗しても削除自体は失敗させない（ログのみ）。
- `Sync` は冪等。削除済みカードが更新されるたびに呼ばれても、行が既に消えていれば何も書かない。

### データフロー

```
クライアント: removeCard(id)
   updateCard(id, {deleted: now})            ← cards をソフトデリート
        │
サーバー: cards の更新が成功
   ├─ realtime: cards の update イベントを publish
   │     → クライアントが dropCard、refreshLinkAlive()
   └─ link_cleanup.go のフック
        wikilink.Sync(app, id, "")
          → このカードの card_links 行に deleted を立てる
          → realtime: card_links の update イベントを publish
                │
クライアント: watchDataReplicas
   applyRecords(card_links)                  ← deleted の行は replica から remove
   → refreshLinkAlive()                      ← 件数が減った結果を再評価
```

オフラインだったクライアントは、次回の `syncReplica`（pull）で `deleted` 付きの行を受け取り、同じく `applyRecords` で削除する。行を物理削除しないのはこのため。

### 復元について

カードの復元（`deleted` を空に戻す）機能は今はない。もし作る場合、リンクは次の本文スナップショットまで戻らない。復元時に `Sync` を本文付きで呼ぶ処理が必要になる。

### 過去データ

この仕組みの導入前に削除されたカードのリンクは、生きたまま残っている。一度だけ、削除済みカードに対して `wikilink.Sync(app, id, "")` を呼ぶスクリプトを `scripts/` に用意して流す必要がある。

## 5. `linkAliveStore`（結果の共有store）

`frontend/src/lib/stores/linkAliveStore.ts`

### 持つもの

| 名前 | 型 | 役割 |
| --- | --- | --- |
| `alive` | `Record<"pot:titleLc", boolean>`（Solid store） | 結果。`undefined` は「まだ答えが出ていない」 |
| `version` | Solid signal（`linkAliveVersion`） | 結果が変わるたびに増える。CodeMirror 用 |
| `watched` | `Map<key, {pot, lc}>` | 誰かが要求したキー。再評価の対象はこれだけ |
| `readyPots` | `Set<pot>` | レプリカの初回同期が済んだポット |

### 公開関数

| 関数 | 用途 |
| --- | --- |
| `linkAlive(pot, lc)` | リアクティブな読み取り。そのキーだけ追跡される。`undefined` を返しうる |
| `requestLinkAlive(pot, lc)` | 結果を要求する。同じキーを何度呼んでも1回しか計算しない |
| `markLinkAlivePotReady(pot)` | ポットの準備完了を通知し、溜まっていた要求を一括で評価する |
| `refreshLinkAlive()` | 要求済みの全キーを再評価する（200msのデバウンス付き） |
| `releaseLinkAlive(pot)` | ポットを離れたとき、そのポットの要求と結果を捨てる |

### 守るべき約束

1. **`undefined` は「有効」として扱う。** 答えが出る前にリンクが赤く点滅しないようにするため。エディタの述語は `linkAlive(...) ?? true`、説明欄とNew Linksは `=== false` のときだけ無効扱いにしている。
2. **準備完了前は計算しない。** 同期途中のレプリカを読むと、生きているリンクが無効と判定される。要求は `watched` に溜め、`markLinkAlivePotReady` で初めて評価する。
3. **計算は必要なキーだけ。** 表示したリンクのぶんしか要求されないので、1つのポットが10万枚でも、store の大きさは表示範囲で頭打ちになる。
4. **結果が変わらなければ書かない。** 同じ値の再代入では `version` も増やさず、不要な再描画を避ける。

### 準備完了のタイミング

`PotLayout` が、カードとリンクの両方のレプリカが同期し終わったあとに通知する。

```ts
Promise.all([openPotReplicas(id), ensurePotSynced(id)]).then(() => markLinkAlivePotReady(id));
```

- `ensurePotSynced` は `cards` のレプリカ（`cardsStore.ts`）。
- `openPotReplicas` は `card_links` のレプリカ（`dataReplicas.ts`）。
- ポットを離れると `releaseLinkAlive(id)` で捨てる。

## 6. 再評価のきっかけ（`refreshLinkAlive`）

レプリカの中身が変わる箇所で呼ぶ。計算そのものは `computeAlive` だけが行う。

| 呼び出し元 | きっかけ |
| --- | --- |
| `cardsStore.handleCardEvent` | カードの作成・タイトル変更・削除（realtime） |
| `cardsStore.resyncPot` | realtime の取りこぼし後の再同期 |
| `dataReplicas.watchDataReplicas` | `card_links` のイベントを `applyRecords` で適用した後 |
| `dataReplicas` の `resync` | `card_links` の再同期後 |

連続したイベントは200msのデバウンスで1回にまとまる。再評価の費用は「要求済みキーの数」に比例する。

## 7. 消費側

### 7.1 noteEditor

`features/noteEditor/emptyLinks.ts` は「このリンクは有効か」という**述語**だけを受け取る。述語がどこから来るかは知らない。

`features/noteEditor/index.tsx` で橋渡しする。

```ts
createEffect(() => {
  linkAliveVersion();            // 結果が変わるたびに再実行する
  const potId = pot()?.id;
  untrack(() => view.dispatch({ effects: setLinkAlive.of(
    potId ? (lc) => { requestLinkAlive(potId, lc); return linkAlive(potId, lc) ?? true; } : null
  )}));
});
```

- CodeMirror は Solid の追跡の外にあるので、`version` を購読して述語を作り直し、`dispatch` する。
- 述語の中で `requestLinkAlive` を呼ぶことで、初めて見たリンクの結果が遅延ロードされる。述語自体は `untrack` で実行する。
- `null` の述語は「ポット未確定」を意味し、何も赤くしない。
- `emptyLinks.ts` は、述語が変わると装飾を再構築する。IME変換中は `decorationPlugin` が再構築を保留する。

### 7.2 カード一覧の説明欄

```
CardItemView                  usePot() で pot を取得
  └─ CardDescription (potId)  wikilink セグメントごとに WikiLinkSpan
       └─ WikiLinkSpan        requestLinkAlive → classList で "grid-empty"
```

- `parseDescription` はこれまで通り純粋関数で、wikilink セグメントを返すだけ。`titleLc` への変換は `CardDescription` 側で `titleToLowerKey` を呼ぶ。
- `potId` が渡されないとき、赤字にはならない。
- `.grid-empty` のスタイルは `styles/components.css`。
- 説明欄は120文字で切れるので、末尾の閉じていないリンクは wikilink と解釈されず、色付けもされない。

### 7.3 関連カード（New Links）

`pages/cards/RelatedCards.tsx` は `related.ownLinks`（開いているカード自身のリンク）を `linkAliveStore` に要求し、`=== false` のものだけを「New Links」の行に出す。**有効性の判定は持たない。**

## 8. `relatedStore`（関連カードのstore）

`frontend/src/lib/stores/relatedStore.ts`

開いている**1枚のカード**の関連カードだけを持つ store。`cardsById` には入れない（`cardsById` は表示ウィンドウの管理に特化しており、リンク由来のカードが入るとウィンドウに属さないカードが紛れ込むため）。

### 持つもの

| フィールド | 取得元 | 内容 |
| --- | --- | --- |
| `oneHop` | サーバー `/links1hop` | リンク先と、自分へリンクしているカード |
| `twoHop` | サーバー `/links2hop` | 同じリンク先を共有するカード（共有先ごとの行） |
| `query` | サーバー `/api/admin/cards/{id}/related` | カードに保存されたDatalogクエリの結果 |
| `ownLinks` | Dexie（`readOwnLinks`） | このカード自身が書いたリンク。位置順 |
| `error` / `loaded` | — | 失敗したか／一度でも成功したか |

### 約束

- すべて id を持つレコードで、サーバーが返した順序のまま保持する（グルーピングは表示側）。
- `openRelated` は4つを並列に取得する。新しいカードを開いたあとに古い応答が届いたら捨てる（`latest` のカウンタで判定）。
- 取得中は前のカードの内容を見せ続け、新しい結果が来たら置き換える。
- `closeRelated` で空にし、進行中の取得も無視させる。
- Solid の store は `undefined` を設定するとプロパティを消すため、リスト系は必ず `?? []` で配列にしてから書く。

### 更新のきっかけ

`RelatedCards` が、`title` または保存済みクエリの変化で `openRelated` を呼ぶ。開いたままカードにリンクを追加しても、`oneHop` / `twoHop` / `ownLinks` は再オープンするまで更新されない（New Links の有効性自体は `linkAliveStore` が追従するが、対象の行は `ownLinks` に依存する）。

### サーバー側の「関連」の意味

`internal/serve/links.go`。有効性の判定とは別の問い（「実在する隣接カードは何か」）に答えるもの。

- 1 hop: そのカードがリンクしている先で**実在するカード**と、そのカードへリンクしているカード。
- 2 hop: 同じリンク先を共有するカード。1 hop のカードは除外。共有先が複数あるカードは、そのカードのリンク順で最初の共有先の下に1回だけ出す。
- 削除済みカード（`deleted != ""`）は結果に含めない。

## 9. 二重計算の回避

| 疑問 | 答え |
| --- | --- |
| 有効性の計算は何か所にあるか | `computeAlive` の1か所だけ |
| エディタの赤字と New Links が食い違うことはあるか | ない。同じ `linkAliveStore` の結果を読むため |
| `relatedStore` は有効性を持つか | 持たない。`ownLinks`（事実）だけを持ち、判定は store の結果を参照する |
| 同じリンク先が複数箇所に出たらどうなるか | キーが同じなので1回しか計算されず、結果も共有される |

## 10. ファイル対応表

| ファイル | 役割 |
| --- | --- |
| `internal/wikilink/wikilink.go` | `card_links` の同期。削除済みカードは「リンクなし」として扱う |
| `internal/serve/link_cleanup.go` | カードが削除された瞬間にリンクを消すフック |
| `internal/serve/links.go` | 1 hop / 2 hop のサーバー側クエリ |
| `frontend/src/lib/dexie/db.ts` | スキーマ。`cards` の `[pot+titleLc]` を含む |
| `frontend/src/lib/dexie/linkAliveQuery.ts` | `computeAlive`（判定規則の唯一の定義） |
| `frontend/src/lib/dexie/cardLinksCollection.ts` | `readOwnLinks`（カード自身のリンクの読み取り） |
| `frontend/src/lib/stores/linkAliveStore.ts` | 有効性の結果を持つ共有store |
| `frontend/src/lib/stores/relatedStore.ts` | 関連カードのstore |
| `frontend/src/lib/stores/cardsStore.ts` | カードのstore。変更時に `refreshLinkAlive` を呼ぶ |
| `frontend/src/lib/dexie/dataReplicas.ts` | `card_links` のレプリカ。変更時に `refreshLinkAlive` を呼ぶ |
| `frontend/src/pages/pots/PotLayout.tsx` | ポットの準備完了と解放を `linkAliveStore` に通知 |
| `frontend/src/features/noteEditor/index.tsx` | store の結果をエディタの述語に変換 |
| `frontend/src/features/noteEditor/plugins/decorations/emptyLinks.ts` | 述語を受け取って赤字の装飾を付ける |
| `frontend/src/features/cardDescription/CardDescription.tsx` | 説明欄のwikiリンクの赤字 |
| `frontend/src/pages/cards/RelatedCards.tsx` | 関連カードの表示。New Links は store を読む |

## 11. 将来の拡張: ポットをまたぐリンク

キーが最初からリンク先の `(pot, titleLc)` なので、store の形は変えずに済む。変わるのは次の2点だけ。

1. `computeAlive` の中身。リンク先ポットの `cards` を参照できる必要がある。
2. 準備完了の扱い。リンク先ポットのレプリカが未同期の間は答えを出さない（`undefined` のまま＝有効扱い）。同期できないポットは、`computeAlive` だけをサーバー問い合わせに差し替える手もある。

「`card_links` の生きている行のリンク元は常に生きているカード」という不変条件（§4）があるため、リンク元ポットのカードの生死を確認する処理は増えない。

## 12. 変更するときの注意

- **キーの正規化を揃える。** フロントの `titleToLowerKey`（`lib/models/slugify.ts`）と、サーバーの `wikilink.orderedTargets` ＋ `slug.ToLowerKey` は同じ規則でなければならない。ずれると、サイレントに誤判定する。変更は両方に入れ、テストも両方に足す。
- **判定規則を変えるなら `computeAlive` だけを直す。** 各消費側に判定を書き足さない。
- **`linkAliveStore` の `undefined` を無効扱いにしない。** 初期表示で全リンクが赤く光る。
- **Dexie のindexを足すときは `version` を上げる。** 既存ブラウザでマイグレーションが走る。
- **削除済みカードのリンクを消す処理（§4）を外さない。** 外すと、削除済みカードが「リンク元」として数えられ、無効なリンクが有効に見える。
