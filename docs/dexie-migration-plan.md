## リファクタリングの背景

- SignalDBの Cursor.getItems() は：フィルタ(全件 or index絞り込み) → ①ソート(M件) → ②skip → ③limit という順序で、①のソートが毎回M件全体に対して走ります。indexを張ってもフィルタ（O(N)→O(M)）は速くなりますが、ソート済みのindexという概念自体が無いため、ソートコストはM件分そのまま残ります。

- DexieはIndexedDBのネイティブindexを直接使います。IndexedDBのindexは内部的にB-treeとしてソート順を常時維持しているため、.offset(skip).limit(limit) はカーソルをskip件分進めてlimit件読むだけで済みます。計算量は O(skip + limit) であり、Mの全件を毎回ソートし直す必要がありません。

- このコストが10万件スケールでは致命的なので、signalDBからdexie.jsにリファクタリングする. dexies.jsとSignalDBの両方をつかう中間状態は必要ない.

## 事前確認：壊してはいけない契約

`cardsCollection.ts` が外部に見せている7関数と、それぞれの呼び出し元（すべて `cardsStore.ts` とそのテスト）を棚卸しします。

| 関数 | 契約 |
|---|---|
| `queryCardsPage(podId, skip, limit)` | `{pin:-1, position:-1, id:1}` でソートした結果からページを返す |
| `countCards(podId)` | pod内の総件数 |
| `writeCache(podId, records)` | upsert、`isReady()`待ちが必須（現状の注意点） |
| `deleteFromCache(podId, id)` | 削除、同上 |
| `forgetCache(podId)` | in-memoryハンドルだけ破棄、IndexedDBデータは残す |
| `readCheckpoint(podId)` / `writeCheckpoint(podId, cp)` | pod単位のcheckpoint永続化 |

面白い発見として、`internal/serve/replication.go` の冒頭コメントに既に **"the frontend's Dexie database... (see docs/dexie-offline-sync.md)"** という記述があります。実装がSignalDBになった今は嘘になっているコメントですが、今回の移行で**辻褄が合う**ことになります。Stage4で `docs/signaldb-offline-sync.md` → `docs/dexie-offline-sync.md` にリネームすれば、このコメントも同時に正しくなります。

---

## Stage 1: 土台の置き換え（振る舞い完全維持、性能改善はまだしない）

**目的**: ストレージ層をDexieに挿げ替えるだけ。ソートアルゴリズムは変えず、まず「壊れていないこと」を確認する安全な一歩。

### 設計判断（要確認）
1. **pod単位の別コレクション → 単一の共有Dexie DB**（`pod`カラムをindex）に変更。SignalDBの`cacheFor`が pod ごとに動的にコレクション（≒別IndexedDB）を作っていたのに対し、Dexieは1つのDB内でテーブルを共有し `pod` でフィルタする設計が標準的で、`forgetCache`のようなハンドル管理も不要になります。
2. **`forgetCache`は実質消滅**：Dexieはクエリのたびに直接IndexedDBを読み、SignalDBのように全件をJSメモリ上に保持し続けることをしません（後述のメモリ使用量の懸念自体が構造的に解消される）。`cardsStore.ts`の`releasePod`から呼び出しを削除します。
3. **`isReady()`待ちのレースコンディションが消える**：SignalDBはハイドレーション未完了で書き込むとロストする問題があり `writeCache`/`deleteFromCache`にコメント付きの回避策がありましたが、DexieはIndexedDBに直接アクセスするので、この種の待ち合わせが不要になります。
4. **`pin`はbooleanではなく`0`/`1`のnumberとして保存**：IndexedDBのindexキーとしてbooleanを使えるかはブラウザ実装差があるため、安全側に倒します。
5. **スキーマはStage2で使うcompound indexを最初から宣言**：`[pod+pin+position]`をStage1の時点で `stores()` に含めておき、Stage2でDBバージョンを上げ直す必要がないようにします（IndexedDBのバージョンアップはコストが高いので1回で済ませる）。
6. **旧SignalDBのIndexedDBデータへの移行はしない**：`CLAUDE.md`の「後方互換性は維持しなくてよい」方針に従い、新しいDB名（例：`cardpod-cards-cache`）を使い、旧データは単に孤立させます（SignalDB自体も過去の実装から意図的に別名にしていた前例があります）。

### 変更対象ファイル
- `mv frontend/src/lib/signaldb frontend/src/lib/dexie`（ディレクトリごとリネーム、`CLAUDE.md`の慣習に従いmvコマンドで提示）
- `frontend/src/lib/dexie/cardsCollection.ts`：新規に書き直し（Search/Replaceせず削除→新規作成）
  - `queryCardsPage`は「podでindexフィルタ→JSでsort→skip→limit」という**今と同じ計算量のロジック**をDexie上で再実装（ここではまだ性能改善しない）
  - `writeCache`は`bulkPut`、`deleteFromCache`は`delete`
  - `checkpoints`テーブルも同様に移植
- `frontend/src/lib/dexie/cardsCollection.test.ts`：`fake-indexeddb`を使ってCRUDを再テスト
- `frontend/src/lib/stores/cardsStore.ts`：import pathの変更、`forgetCache`呼び出しの削除のみ（ロジックは無変更）
- `frontend/package.json`：`@signaldb/core` `@signaldb/indexeddb` `@signaldb/solid` を削除、`dexie` を追加（devDependenciesに`fake-indexeddb`）

### 検証
- `cardsStore.test.ts`は`cardsCollection`モジュールをモックしているため**無修正で通ること**を確認（インターフェース互換の証明）
- 新しい`cardsCollection.test.ts`でCRUD等価性を確認
- 以前手動で行った「タブB差分取得」のシナリオを再度実施し、機能面の後退がないことを確認

---

## Stage 2: ページングをインデックスベースに変更（本題の性能改善）

**目的**: `queryCardsPage`のO(M log M)ソートを、IndexedDBのBツリーindexによるO(skip+limit)のカーソル走査に置き換える。

### 実装方針
- `[pod+pin+position]` indexを使い、**pinned/unpinnedを別々のindex範囲クエリに分割**し、`.reverse()`でposition降順に取得、`.offset()/.limit()`で必要な範囲だけ切り出す
- 呼び出し側（`skip`, `limit`）に対して「pinned件数を数える→pinned/unpinnedへの按分を計算→それぞれ範囲クエリ」というロジックを`queryCardsPage`内に実装
- `countCards`も`[pod]` indexの`.count()`に変更（既にO(N)フィルタからの改善）

### 明示的な確認が必要な仕様変更
現在の`{pin:-1, position:-1, id:1}`ソートのうち、`id`昇順のタイブレークは**厳密には維持できません**（IndexedDBのcompound indexは全フィールド同一方向でしか使えないため）。ただし：
- `position`の同値は`lib/position.ts`のフラクショナルインデックス方式によりほぼ発生しない
- 最終的な表示順序は`CardList.tsx`が独自に`sort()`し直しているため、`queryCardsPage`の順序はページング境界の一貫性にのみ影響する

→ このタイブレーク省略を許容してよい.

### テスト
- pagination正当性（ページ境界での重複/欠落がないこと）を検証するcollectionレベルのテストを新規追加
- pinnedが常にunpinnedより先に返ることを確認するテスト

---

## Stage 3: 性能検証

- DevTools MemoryタブでのSignalDB時代との比較（10万件podを開いた際のヒープサイズ）
- `skip`が深い位置（例：99,000件目）へのクエリのレイテンシ測定
- 既知の残存制約として明記：`.offset(n)`はDexieでもO(n)であり、真のカーソルベース（seekベース）ページングではない。現状`skip`の最大値は`win.ids.length`（読み込み済み件数）に留まるため実用上大きな問題にはなりにくいが、将来さらに深いページングが必要になった場合はseek方式への変更を検討する旨を記録に残す

---

## Stage 4: 後片付け

- `docs/signaldb-offline-sync.md` → `docs/dexie-offline-sync.md` にリネームし、内容をDexie設計に合わせて書き直す（`replication.go`の既存コメントが指すファイル名と一致させる）
- コードベース中の "SignalDB" への言及（コメント含む）を洗い出して更新
- `bun install`で`bun.lock`を再生成


# 備考
## DexieのLiveQueryはあえて使わない

今回の移行計画でも `dexie-react-hooks` 相当の仕組み（Dexie本体には無く、`liveQuery()`関数自体はcoreにありますが、Solid用のreactiveバインディングは別途自作が必要）は使わない前提で組んでいます。理由は、これまでの議論と完全に一貫しています。

## 理由：SignalDBのreactivityアダプタを切った理由と同じ

以前確認した通り、このアプリのアーキテクチャは：

- **Solid store（`cardsById`/`windows`）が唯一のUIが読むreactiveな状態**
- SignalDB（今後はDexie）は「明示的な関数呼び出しでのみ読み書きされる永続化層」であり、UIに直接バインドされない

`docs/signaldb-offline-sync.md` に明記されている通りです：
> SignalDB... UIから直接reactiveにバインドされることはなく、`queryCardsPage`/`countCards`という明示的な関数呼び出しでのみ読まれる

`liveQuery()`をSolidで使うには、`from`（RxJSのObservable相当）を`createSignal`にブリッジする自作アダプタが必要になり、これはまさに`@signaldb/solid`が担っていた役割そのものです。つまり `liveQuery` を導入すると、削除したはずの「未使用のreactivity統合レイヤー」を**Dexie版として再び作ることになり**、以前の判断（「削除して良い」）と矛盾します。

## もう一つの理由：業務ロジックがreactive queryに乗らない

`loadNextCardsPage`のwindow管理（pin優先ソート、重複排除、削除時のズレ吸収）や`resyncPod`のcheckpoint差分適用は、単純な「クエリ結果をそのまま表示」ではなく、**複数のステップを経た手続き的なロジック**です。`liveQuery`で自動追随させても、その結果を今の`windows`/`cardsById`の形に変換する手続きは結局手で書く必要があり、恩恵が薄いという判断は変わりません。

## Stage 1の設計に反映すべき点

先ほどの計画で `queryCardsPage`/`countCards`/`readCheckpoint` はSignalDB版と同じく**普通の`await`ベースの一回限りのクエリ**として実装し、`liveQuery`は使いません。これはコメントとして明示しておくと、SignalDB版にあった「なぜreactive:falseなのか」という疑問と同じものが今後Dexie版で再発するのを防げます：

```ts
// This module deliberately does not use Dexie's liveQuery(): the
// reactive source the UI actually renders from is the Solid store in
// cardsStore.ts (cardsById/windows), not this cache directly. Every
// read here is a one-shot query, and cardsStore.ts is responsible for
// pushing results into the Solid store itself (see mergeCards).
```



