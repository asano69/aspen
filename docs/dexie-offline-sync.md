`
# Dexie オフライン同期設計

`internal/serve/replication.go` のチェックポイント式pullプロトコルを使い、各podのカードをDexie（IndexedDB）にローカルレプリカとして保持する設計。旧SignalDB版からの移行が完了した後の、現行実装のドキュメント。

## 1. 全体のレイヤー構成

```
PocketBase (source of truth)
    │  GET /api/pages/{podId}/cards/pull?updatedAt=...&id=...&limit=...
    ▼
lib/api/replication.ts (pullAll: ページングクライアント)
    ▼
lib/dexie/cardsCollection.ts (Dexie: IndexedDBローカルレプリカ)
    ▼
lib/stores/cardsStore.ts (Solid store: cardsById / windows)
    ▼
UI (CardList, CardItem, ...)
```

- **PocketBase**: 全カードの正本。書き込みは常にPocketBaseの通常のREST API（`updateCard`/`deleteCard`など）を経由する。
- **Dexie**: 「今表示するのに十分な範囲」ではなく、pullした分すべてを持つpod単位のローカルレプリカ。ページング（`queryCardsPage`）と件数（`countCards`）をこの層から直接読む。
- **Solid store**: UIが唯一reactiveに読む状態。DexieはUIに直接バインドされず、`cardsStore.ts`の関数呼び出しを介してのみ読み書きされる（§6で詳述）。

## 2. チェックポイントpullプロトコル

サーバ側（`internal/serve/replication.go`）の実装:

- `cardCheckpoint{ UpdatedAt, ID }`: `updated`だけでは複数カードが同値になりうるため、`id`をタイブレークに使う。
- `pullCards`: `pod = {:pod} && (updated > {:updatedAt} || (updated = {:updatedAt} && id > {:id}))` で、チェックポイント以降の変更を`updated, id`昇順に返す。ソフトデリートされたカードも「削除イベント」として含まれる。
- `limit`: デフォルト200、最大1000（`maxPullLimit`）。フロントエンドの`PULL_LIMIT`と一致させる必要がある（短いページ＝終端のシグナルになるため）。

クライアント側（`lib/api/replication.ts`）:

- `pullAll(podId, after)`: `after`（nullなら最初から）から、ページが`PULL_LIMIT`未満になるまで`pullPage`を繰り返し呼ぶ。戻り値は `{ records, checkpoint }` で、何も変化がなければ`checkpoint`は渡された`after`のまま。
- 削除されたカードもそのまま返る。フィルタするのは呼び出し側（`applyPulledRecords`）の責務。

## 3. Dexieスキーマ（`lib/dexie/cardsCollection.ts`）

```ts
class CardsCacheDB extends Dexie {
  cards!: EntityTable<CachedCard, "id">;
  checkpoints!: EntityTable<CheckpointRecord, "podId">;

  constructor() {
    super("cardpod-cards-cache");
    this.version(1).stores({
      cards: "id, pod, [pod+pin+position]",
      checkpoints: "podId",
    });
  }
}
```

- **単一の共有DB**: SignalDB時代の「pod単位で別コレクション」をやめ、`pod`カラムで絞り込む標準的なDexie設計にした。これにより、podを離れた際に破棄すべき「in-memoryハンドル」の概念自体が存在しない（後述の`releasePod`はDexie側では何もしない）。
- **`pin`は`0`/`1`のnumber**: IndexedDBのcompound indexキーとしてbooleanを使えるかはブラウザ実装依存のため、numberに正規化して保存する（`toCached`/`fromCached`が変換を担う）。
- **`[pod+pin+position]`複合index**: `queryCardsPage`のページングをIndexedDBのB-tree走査だけで完結させるためのindex。

## 4. ページング（Stage 2完了後の実装）

`queryCardsPage(podId, skip, limit)`は、CardListがグリッドに表示する順序（pinned優先、次に`position`降順）をIndexedDBのindex範囲クエリだけで再現する。

```ts
function queryPinRange(podId, pin, offset, limit) {
  return db.cards
    .where("[pod+pin+position]")
    .between([podId, pin, Dexie.minKey], [podId, pin, Dexie.maxKey])
    .reverse()
    .offset(offset)
    .limit(limit)
    .toArray();
}
```

- pinnedカードとunpinnedカードは`[pod+pin+position]`indexの別範囲に存在する。`queryCardsPage`はまずpinnedの件数を数え、`skip`/`limit`がその境界のどちら側に落ちるかで、pinned範囲・unpinned範囲それぞれに按分してから読み出す。
- 計算量は`O(skip + limit)`。ソート済みindexを直接辿るだけなので、pod内の全件（M件）を毎回JSでソートし直す必要がない（旧SignalDBの`Cursor.getItems()`が抱えていた問題そのものの解消）。
- **既知のトレードオフ**: `position`が完全一致する2枚のカードの並び順は、`id`昇順のタイブレークをもう保証しない（compound indexは全フィールド同一方向でしか使えないため）。`lib/position.ts`のフラクショナルインデックスにより同値はほぼ発生せず、最終的な表示順序も`CardList.tsx`が独自に`sort()`し直すため、影響はページ境界の一貫性のみに限られる。

`countCards(podId)`は`pod`単一フィールドindexの`.count()`のみで、全件フィルタは発生しない。

## 5. 書き込み（write-through）

- `writeCache(podId, records)`: `db.cards.bulkPut(...)`。`mergeCards`（cardsStore.ts）がSolid storeを更新するたびに、対応するpodのDexieキャッシュへも書き込む（fire-and-forget）。
- `deleteFromCache(podId, id)`: `db.cards.delete(id)`。
- どちらも待ち合わせ不要（IndexedDBに直接アクセスするため、SignalDB時代の「hydration未完了で書き込むとロストする」といったレースコンディションは構造的に存在しない）。

## 6. 同期フロー

### 6.1 初回同期（`ensurePodSynced` → `syncPodReplica`）

`loadNextCardsPage`が初めてpodのwindowを作る際、まず`ensurePodSynced(podId)`を`await`してから最初のページをDexieから読む。

- `ensurePodSynced`: 同一podに対する同時呼び出し（初期呼び出しと、IntersectionObserverの即時発火が競合するケースなど）を、同じ進行中のPromiseに束ねる。
- `syncPodReplica` → `pullAndApplyDiff`: 保存済みチェックポイント（`readCheckpoint`）から`pullAll`で差分を取得し、`applyPulledRecords`でDexieに反映（生存カードは`writeCache`、削除されたカードは`deleteFromCache`）、最後に`writeCheckpoint`でチェックポイントを進める。
- 失敗時はログのみ（次回のpod再訪問、またはリアルタイムのgap検知時の再試行に委ねる）。

### 6.2 リアルタイム反映（`watchCards` → `handleCardEvent`）

- サーバのcentrifugeチャンネル（`internal/realtime`）経由で、全podのcard作成/更新/削除イベントを1本の共有チャンネルで受信する。
- `handleCardEvent`はSolid store（`cardsById`/`windows`）を直接更新する。Dexieへの反映は`mergeCards`内の`writeCache`呼び出し経由で自動的に行われる（§5）。
- Dexieの`checkpoints`テーブルはここでは更新されない。リアルタイムイベントは「今画面に出ている分」への即時反映であり、チェックポイントは§6.1/6.3のpullでのみ進む。

### 6.3 ギャップ検知時の再同期（`resyncPod`）

サーバ再起動や履歴の上限超過などで、リアルタイムチャンネルが「取りこぼしがあり、リプレイもできない」と判断した場合（`subscribeToCards`の`onResync`）、`resyncPod(podId)`が読み込み済みの全podに対して呼ばれる。

1. `pullAndApplyDiff(podId)`でDexieレプリカ自体を最新化する（チェックポイントも進む）。
2. 現在のwindowサイズ分だけ、Dexieから`queryCardsPage(podId, 0, windowSize)`と`countCards(podId)`を再読み込みする（1ページずつ辿り直すのではなく、レプリカが既にpod全体を持っているため1クエリで完結する）。
3. 差し替え後のwindowに含まれなくなったカードIDをSolid storeから削除する（Dexie自体は§6.3の1で既に正しい状態になっている）。

## 7. なぜ `liveQuery()` を使わないか

Dexie本体の`liveQuery()`（Solid用の公式reactiveバインディングは別途自作が必要）は意図的に使っていない。理由はSignalDB時代の判断と同じ:

- **Solid store（`cardsById`/`windows`）だけがUIの唯一のreactiveな状態**であり、Dexieは明示的な関数呼び出し（`queryCardsPage`/`countCards`/`readCheckpoint`など）でのみ読み書きされる、UIに直接バインドされない永続化層として設計している。
- `loadNextCardsPage`のwindow管理（pin優先ソート、重複排除、削除時のインデックスずれ吸収）や`resyncPod`のチェックポイント差分適用は、単純な「クエリ結果をそのまま表示」ではない手続き的なロジックであり、`liveQuery`で自動追随させても結局その変換コードは手で書く必要がある。

このため`cardsCollection.ts`の各関数は普通の`await`ベースの一回限りのクエリとして実装されている。

## 8. 既知の制約

- `.offset(n)`はDexieでも内部的にはO(n)であり、真のカーソル（seek）ベースのページングではない。現状は`skip`の最大値が「読み込み済み件数（`win.ids.length`）」に留まるため実用上大きな問題にはなりにくいが、将来さらに深いページングが必要になった場合はseek方式（前ページ末尾の`position`を起点にした範囲クエリ）への変更を検討する。
- `position`が完全一致するカード間の並び順は保証されない（§4）。

## 9. ファイル対応表

| ファイル | 役割 |
| --- | --- |
| `internal/serve/replication.go` | pullエンドポイント（サーバ側チェックポイント処理） |
| `frontend/src/lib/api/replication.ts` | pullクライアント（`pullAll`） |
| `frontend/src/lib/dexie/cardsCollection.ts` | Dexieスキーマ、`queryCardsPage`/`countCards`/write系/checkpoint系 |
| `frontend/src/lib/stores/cardsStore.ts` | Solid store、初回同期・リアルタイム反映・ギャップ再同期の司令塔 |
| `frontend/src/lib/api/realtime.ts` | centrifugeによるリアルタイムチャンネル購読 |

