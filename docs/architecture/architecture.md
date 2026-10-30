# Architecture

Aspenの全体構成をまとめる。個々の設計判断の経緯は各機能のソースコード内コメント、およびオフライン同期については`docs/signaldb-offline-sync.md`を参照。

## 1. 全体構成

```
┌─────────────┐   HTTP/WS    ┌───────────────────────┐
│ Frontend     │ ───────────▶ │ Backend (Go)           │
│ (Solid.js)   │              │ - PocketBase (REST/DB) │
│              │ ◀─────────── │ - Yjs sync (ygo)        │
└─────────────┘   Centrifuge  │ - Centrifuge (realtime) │
                               └───────────────────────┘
```

- バックエンドは単一のGoバイナリ(`cmd/aspen`)。PocketBase(`internal/serve`)がREST APIとSQLiteを、`reearth/ygo`がYjsのWebSocket同期を、`centrifugal/centrifuge`がカード変更のリアルタイム配信を担当する。
- フロントエンドはSolid.jsのSPA(`frontend/`)で、Viteでビルドされ`internal/static`にGoバイナリへ埋め込まれる。

## 2. データモデル (PocketBase collections)

| コレクション | 役割 |
| --- | --- |
| `pods` | カードの入れ物。`name`がURLセグメント |
| `cards` | 1枚のカード。`title`/`titleLc`/`description`/`image`/`position`/`pin`/`deleted`(ソフトデリート) |
| `card_ydocs` | カード本文のYjs更新ログ（base64、append-only。一定件数でコンパクション） |
| `card_links` | wiki-linkのグラフ (`source` -> `target_titleLc`)。1-hop/2-hopリンク表示用 |
| `card_lines` | 現状未使用（CodeMirror移行によりid付き行の概念が消えたため。`internal/serve/lines.go`のTODO参照） |

カードのタイトルは本文の1行目から**サーバー側で**解決される(`internal/serve/title_watch.go`)。クライアントはYjsドキュメントを編集するだけで、タイトルの確定・重複解消・URLセグメント算出はすべてサーバーの責務。

## 3. カード編集 (Yjs)

- 本文はCodeMirror 6 + Yjsの`Y.Text`（プレーンテキスト、Markdown/ProseMirror的なノードツリーではない）。
- 独自のScrapbox/Cosense互換記法パーサ(`frontend/src/features/noteEditor/parser/aspen/`)を`@lezer/markdown`の骨組みの上に構築している。フロントエンドとバックエンド(`internal/parser/`)で同じ規則を並行実装しており、両者は同期して保守する必要がある(README参照)。
- 1行目は常にタイトル候補として扱われ、フロントの`titleCandidatePlugin.ts`がデバウンス付きでクライアント側の下書き作成(`DraftCardEditor`)をトリガーする。既存カードのタイトル確定はサーバー側の`title_watch.go`がYjsドキュメントを直接observeして行う（クライアントの往復不要）。
- Yjsの永続化は`internal/serve/ydoc.go`：更新は`card_ydocs`にappend-onlyで保存され、閾値を超えると1レコードに圧縮される。

## 4. リアルタイム同期 (Centrifuge)

- `internal/realtime`が`cards`コレクションのcreate/update/delete をCentrifugeの`cards`チャンネルに配信する。認証はPocketBaseのスーパーユーザートークンのみ。
- フロントは`lib/api/realtime.ts`で購読し、`lib/stores/cardsStore.ts`の`handleCardEvent`がSolidストアとSignalDBキャッシュ双方に反映する。
- 履歴切れ（`onResync`）を検知した場合は後述のオフライン同期プロトコルで差分を取り直す。

## 5. オフライン同期とページング (SignalDB)

カード一覧は「1ポット最大10万件」を想定しており、全件を常時メモリ・IndexedDBに展開しつつも、無限スクロールのUXは維持する必要がある。設計の経緯は`docs/signaldb-offline-sync.md`に詳しいが、最終形は以下の通り：

- **サーバー側**: `internal/serve/replication.go`が`GET /api/pages/{podId}/cards/pull`を提供する。`(updated, id)`のcheckpointベースで、変更されたカード（ソフトデリートされたカードも含む）を`updated,id`昇順で返す。返却件数が`limit`未満なら「それが最後のページ」というシンプルな終了条件。
- **クライアント側 (`frontend/src/lib/`)**:
  - `api/replication.ts`: checkpointをループしてpullし切る`pullAll`。
  - `signaldb/cardsCollection.ts`: pod単位のカードコレクション（IndexedDB永続化、`@signaldb/core`+`@signaldb/indexeddb`+`@signaldb/solid`）と、pod単位のcheckpointを保持する別コレクション。SignalDBはpodの**全カードを保持する完全レプリカ**として機能する。
  - `stores/cardsStore.ts`: UIが実際に読む唯一のソース。外部インターフェース（`podWindow`/`cardsById`/`loadNextCardsPage`/`resyncPod`）はSignalDB移行の前後で変えていない。
    - `loadNextCardsPage`: pod初回オープン時に`ensurePodSynced`でSignalDBレプリカを最新化してから、`queryCardsPage`(skip/limitのローカルクエリ)でwindowを1ページずつ読み進める。
    - `resyncPod`: Centrifugeの履歴切れ時に呼ばれる。`pullAndApplyDiff`（保存済みcheckpointからの差分pull→SignalDBへの反映→checkpoint更新）でレプリカを最新化し、その後windowが元々カバーしていた件数を**1回のローカルクエリ**で読み直す。REST側への再フェッチは発生しない。
  - リアルタイムイベント（Centrifuge）や自分自身のミューテーション（作成/更新/削除）も、Solidストアへの反映と同時にSignalDBキャッシュへ書き込む(`mergeCards`/`dropCard`)ので、両者は常に同期している。
- **設計上の要点**:
  - SignalDBコレクションはreactiveなUIソースとして直接バインドせず、`queryCardsPage`/`countCards`という明示的な関数呼び出しでのみ読む「ページング用のローカルインデックス」として位置づけている。Solidストア(`cardsById`/`windows`)が実際にUIが読むミラー。
  - 初回オープン時の「古いキャッシュをまず一瞬見せる」二段階ペイントは行わない。`ensurePodSynced`の完了を待ってから最初のページを描画する（オフライン時はSignalDBの前回同期時点のデータがそのまま使われる）。
  - 同一podの同時オープンによる重複pullは`podSyncPromises`（pod単位のin-flight Promiseキャッシュ）で防いでいる。

## 6. フロントエンドのルーティングとレイアウト

- `lib/router.tsx`がルート定義の唯一の場所。`AppShell`(`components/layout/AppShell.tsx`)がRouterの`root`として全ページを包み、pod一覧のロードとリアルタイム購読をここで開始する。
- `/:slug`配下は`PodLayout`(`pages/pods/PodLayout.tsx`)がpodのフェッチとTopBarのpodリンク登録を一度だけ行い、`CardList`/`CardForm`間の遷移で再フェッチや表示のちらつきが起きないようにしている。
- `/:slug/new`と`/:slug/:cardSlug`は同一の`<Route>`（`CardForm`）にまとめてあり、下書き作成からタイトル確定後の既存カード編集への遷移でエディタ（WebsocketProvider/Y.Doc）を再マウントしないようにしている。

## 7. 認証


