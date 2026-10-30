足りないのは機能の豊富さではなく、y-websocket が黙ってやってくれていた運用面の部分です。

見えているのは TS 側(`src/`)だけで、Go 側 `collab` パッケージは見えていません。以下は TS 側と、この app が Yjs に何を頼っているかからの推測です。

## 1. 最低限必要なもの(ないと実用にならない)

**再接続(自動リトライ + バックオフ)**
`Channel` は WebSocket を1本ラップしているだけで、切れたらそれきりです。y-websocket が一番助けていたのはここです。`connect(() => url)` のようにURLを関数にして、再接続のたびに最新トークンで接続し直せるようにしてください。`yjs_auth.go` の `expiringWriter` はトークン期限で切る設計なので、これがないと期限ごとに編集不能になります。再接続時はリモートカーソルを全消去してください(切断中は `leave` が届きません)。

**接続状態とinitial syncの通知**
`ExistingCardEditor` は `provider.synced` を待ってエディタを出しています。同じことをするには `channel.onSynced` と、online/connecting/offline の状態が必要です。


## 2. 入れると app 全体が単純になるもの

実はここが本題です。`@codemirror/collab` は中央サーバーが更新を直列化するので、Yjs より単純にできる部分があります。

**サーバーがバージョン不一致のpushを拒否する方式にする**
公式例と同じ方式です。この場合、Go 側に必要なのは「ChangeSet JSON を適用する」ことだけで、OT変換(rebase)は不要です。UTF-16 インデックスだけ注意してください(`rename.go` はすでに UTF-16 で扱っているので問題ないはずです)。

**サーバー起源の更新を普通のupdateとして流せる**
これが一番効きます。今の `rename_links.go` は、roomを閉じてpeerを再接続させる、scratch docで編集してDBトランザクションを張る、といった手順を踏んでいます。collab なら、サーバーが `clientID: "server"` のupdateを履歴に追記して全員に配信すれば済み、room closeは要りません。`move_cards`、`import` の `replaceContent`、`Export` の「ログから復元」も同じ形に畳めます。

**サーバーがupdateに `userId` と `at` を刻む**
これは `lineMeta`(Y.Map)、`lineId`(CRDTのitem id)、`unseen`(state vector)の置き換えになります。

- 自己申告ではなくサーバーが刻むので、信頼できます。
- unread は state vector ではなく、**「最後に見た version(整数1個)」** で済みます。`card_views.seen` が JSON から数値になります。
- telomere は、クライアントが「変更範囲+メタ」を `StateField` の RangeSet として持ち、変更で map すれば作れます。`lineId.ts`、`lineMeta.ts`、`unseen.ts`、`lineRange.ts` の大部分が不要になり、`_start` を触るような Yjs 内部依存もなくなります。

**undo は標準の `history()` で足りる**
`yUndoManagerKeymap` の代わりに `history()` と `historyKeymap` を使います。collab のリモート更新は history が正しく map してくれます。undo stack が2つになる問題も起きません。

**cursor はすでに位置の整数なので `outsideCursors` が単純になる**
`cursorsField` が変更で map された位置を持っているので、Y.RelativePosition を経由する部分は不要です。

## 3. 入れなくていいもの

awareness の汎用化、バイナリプロトコル、圧縮、複数docの多重化は不要です。1接続1カード、テキストのみで、今のプロトコルのまま十分です。

## 4. 注意点

- **新規参加者に既存カーソルを送る**ことを確認してください(y-websocket の awareness は接続時に全状態を送ります)。Go 側の `Tracker` がやっているか、私には見えません。
- **オフラインの二重送信**が起こりえます。リロード後は `clientID` が変わるので、「サーバーは受理済みだがクライアントは未確認」の updateが重複する可能性があります。pushに `(clientID, 連番)` を付けてサーバーで弾くのが一番単純です。
- **DBの追記は `(card, version)` のユニーク制約**にしてください。並行pushの整合性をDB側で保証でき、サーバー側のロックが要りません。
- **CRDTを手放す代償**として、長時間オフラインの後はrebaseが効かないケースがあり得ます。テキストカードなら実害は小さいはずですが、「20人同時編集」と「オフライン」の優先度で判断が分かれます。

## 優先順位

1. 再接続とURL関数化
2. 状態通知と synced
3. IndexedDB 永続化
4. サーバーが `userId` / `at` を刻む
5. スナップショット

4 を入れるかどうかが、Yjs をやめて得をするかの分かれ目です。入れれば、line系・unread・rename・move・import がまとめて単純になります。入れないなら、Yjs のままでいい可能性が高いです。

