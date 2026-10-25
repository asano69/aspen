# Wikiリンク／バックリンク機能 設計メモ

## 1. 方針サマリー

- バックリンクの計算は **サーバーサイドのみ**。クライアント側では計算しない（バックリンクは逆引きクエリであり、原理的に全カードのデータが必要なため）。
- 計算結果は `card_links` コレクションに永続化し、フロントへの反映は **PocketBaseの標準realtimeにそのまま乗せる**。独自のSSE配信は実装しない。
- 計算のトリガーは、既存の `internal/serve/ydoc.go` の `store()` 内、`updatePreview` / `updateLines` と同じタイミングに追加する。ygoの `PersistCoalesceWindow`（2s）/ `PersistCoalesceMaxWait`（10s）によるデバウンスをそのまま利用し、専用のデバウンス処理は書かない。
- パフォーマンス対策は「バッチ処理・トランザクション化」のみを最初に実装する。インメモリキャッシュ化は現時点では見送り（下記「6. 見送った案」参照）。

## 2. スキーマ変更

現行の `card_links`（`migrations/1788869455_collections_snapshot.go`）は `target` が `required: true` の relation。これだと「まだ存在しないカードへのリンク（空リンク）」を表現できないため、以下のように変更する。

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `source` | relation (cards, cascadeDelete: true) | 必須 | リンク元カード |
| `target` | relation (cards, cascadeDelete: false) | **任意（null可）** | リンク先カード。存在しない場合はnull |
| `target_title` | text | 必須 | リンク先のタイトル文字列（`[タイトル]` の中身） |

- リンク先が存在する: `target` に relation ID、`target_title` にその時点のタイトルをセット
- リンク先が存在しない（空リンク）: `target` は null、`target_title` のみセット

### 空リンクの実体化について

「リンク先が存在しない場合に自動でカードを生成する」（Scrapbox方式）は**採用しない**。理由:

- ユーザーが書いていないのにカードが増えるのは驚き最小の原則に反する
- タイポの救済にならず、ゴミカードが残る
- 削除・Undoの扱いが複雑化する
- `resolveTitle`（`internal/serve/slug.go`）の「候補は常にユーザーが明示的に確定したもの」という前提と噛み合わない

空リンクはUI上「存在しないリンク」として表示するに留め、実体化はユーザーが明示的にカードを作成した時のみ行う。

### 後追い解決（バックフィル）

ユーザーが空リンクの先を実際にカードとして作成したとき、既存の `card_links` レコードの `target` は null のままだと機能しない。そのため `createCardHandler`（`internal/serve/cards.go`）でカード作成が成功した直後に、以下を実行する。

```
UPDATE card_links
SET target = <新カードID>
WHERE pod経由でsourceが同じpod内 AND target IS NULL AND target_title = <新タイトル>
```

### タイトルリネーム時の扱い

カードのタイトルが変わっても（`updateCardTitleHandler`）、既存の `card_links.target_title` は更新しない。`target`（relation ID）さえ正しければバックリンク自体は機能するため実害はない。表示側の原則として:

> `target` が非nullの場合、表示用タイトルは常に紐づくカードの現在の `title` を優先して使う。`target_title` は `target` が未解決（null）の間だけ使う。

## 3. 処理フロー

`internal/serve/ydoc.go` の `store()` 内、`updateLines` と同じ位置に `updateLinks` を追加するイメージ。

```go
if doc := yjsServer.GetDoc(room); doc != nil {
    xml := doc.GetXmlFragment("prosemirror").ToXML()
    p.updatePreview(room, xml) // description/image
    p.updateLines(room, xml)   // card_lines
    p.updateLinks(room, xml)   // card_links（新規追加）
}
```

`updateLinks` の内部ステップ:

1. **抽出**: XMLからブラケットリンク（`[タイトル]`）を正規表現等で抽出し、タイトル文字列の一覧を得る。抽出ロジックは `internal/slug.StripBracketLinks` 系の既存パースと重複しないよう共通化を検討。
2. **既存カードの一括解決**: 抽出したタイトル一覧をまとめて1クエリで解決する（N回クエリしない）。

   ```go
   existingTargets, err := app.FindRecordsByFilter(
       "cards", "pod = {:pod} && title IN ({:titles})",
       "", 0, 0,
       dbx.Params{"pod": podID, "titles": extractedTitles},
   )
   ```

3. **差分計算**: `updateLines` と同じ考え方で、現在の `card_links`（`source = このカード`）と抽出結果を比較し、増えたリンク／消えたリンク／`target`が解決した空リンクのみを対象にする。変化がなければ一切書き込まない（`updated` タイムスタンプを無駄に更新しない）。
4. **トランザクション内でバッチ書き込み**: insert/delete/updateをまとめて1トランザクションで実行し、SQLiteの単一writerロックの保持時間を最小化する。個別 `Save()` をループで呼ばない。

## 4. リアルタイム反映（フロント）

独自実装は不要。`card_links` への `Save()`/`Delete()` がPocketBaseの標準realtimeフックを自動発火するので、フロントは `cardsStore.ts` と同じパターンで購読するだけでよい。

```ts
pb.collection("card_links").subscribe("*", (e) => {
  // withCardsFlip 等と同様、ストアを更新するだけ
});
```

バックリンク一覧を表示するUIは、この購読結果を `target = 対象カードID` でフィルタして描画する。

## 5. パフォーマンス対策（採用するもの）

1. **バッチ処理・トランザクション化**（最優先・唯一の初期対策）
   - `IN` 句でのタイトル一括解決（クエリ1回）
   - `card_links` の増減をトランザクション1本にまとめて書き込み
2. **既存デバウンスの活用**
   - `PersistCoalesceWindow`（2s）/ `PersistCoalesceMaxWait`（10s）にすでに乗っているため、タイピングごとに計算が走ることはない
   - 専用のデバウンス機構は実装しない

Goのgoroutineスケジューリングにより「重いページの解析が他のリクエスト処理を止める」ことは基本的に起きないが、SQLiteの単一writerロックはgoroutineの並行性では解決しないため、実効的なボトルネック対策は上記の「バッチ・トランザクション化」に尽きる。

## 6. 見送った案

### インメモリキャッシュ（全`cards`をメモリにロード）

以下の理由で今回は見送り。

- `(pod, title)` に既存のユニークインデックス（`idx_r30t04lu5q`）があるため、単発クエリのコストはもともと低い（実測せず最適化する必要性が薄い）
- ボトルネックの本体はSQLiteの単一writerロック（書き込み側）であり、読み取りキャッシュはそこに効かない
- キャッシュ同期（起動時ロード、3フックでの更新、起動直後のリークウィンドウ）の複雑さに対して効果が見合わない
- 将来マルチプロセス構成にした場合、プロセス間でのキャッシュ無効化の仕組みが別途必要になる

必要になった場合の代替として、`IN` 句によるバッチ取得（3節参照）で往復回数自体は十分削減できる。

## 7. 実装ステップ（想定順序）

1. `card_links` のスキーマ変更（`target` を optional に、`target_title` を追加）— PocketBase管理画面から実施（マイグレーションコード不要、`CLAUDE.md` のルールに準拠）
2. リンク抽出関数の実装（`internal/xmldoc` 配下に追加するのが既存構成と整合的）
3. `updateLinks`（`internal/serve/ydoc.go` もしくは新規 `internal/serve/links.go`）の実装
   - まず失敗するテストを先に書く（`CLAUDE.md` のルール: バグ修正時は回帰テストを先に書く。新機能でも同様の方針でテストファーストが望ましい）
4. `createCardHandler` へのバックフィル処理追加
5. フロント側: `card_links` の購読とバックリンク表示UI

## 8. 未決事項

- リンク抽出の対象は「ブラケットリンク（`[タイトル]`）」のみか、それとも本文中の自動リンク（`urlLinkRule.ts` 相当のプレーンURL）も対象に含めるか
- バックリンク一覧のUI配置（カード編集画面の下部？ サイドパネル？）
- 空リンクをエディタ上でどう視覚的に区別するか（存在するリンクと異なるスタイルにするか）
