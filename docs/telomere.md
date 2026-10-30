# テロメア

サーバが行メタを権威として持ち、updates ストリームに同乗させ、クライアントは Solid ストアに畳み込み、CodeMirror は読むだけにする。

## 注意点

* lines メッセージは全量を送る。 collab.Tracker.Message() は「join 時と各受理後の両方に同じものが送られる」契約なので、パッチにすると join 時に全量を返せません。全量なら取りこぼしにも強くなります。JSON エンコードは room にキャッシュし、Track で破棄します。
* メッセージには署名・ハッシュを含めない。 id / user / updated だけにします。
* GET /telomere は残す。 中身は {me, left} に縮め、unread の判定はクライアント側の純粋関数にします。
* updated(開いた後に編集された行)は、最初のスナップショットとの差で判定する。 端末時計とサーバ時計のずれの影響を受けません。
* ストアは ExistingCardEditor が作るカード単位のものにする。 グローバルにすると、閉じたカードの状態が次のカードに残る問題が出ます。スクロールバー用には onLineEntries のようなコールバック prop(onContentSnapshot と同じ形)で lineMeta.entries を親へ渡せます。今回はスコープ外です。
* Enter 直後の一瞬、バーが消える。 ローカルで行数が増えてからサーバのメッセージが届くまでの間、行数が合わず gutter は何も描きません。気になる場合は、未確定のローカル変更でストアをマップする処理を後から足せます。



## 動作の流れ

* 編集が受理されると room.Track が lines を更新し、message キャッシュを破棄します。
* collab が updates の直後に room.Message() を全クライアントへ送ります。join 時も同じ経路です。
* ExistingCardEditor の "lines" ハンドラが lineMeta.apply を呼び、Solid ストアが reconcile され、entries メモが再計算されます。
* NoteEditor の effect が entries を追跡し、refreshTelomere を1回 dispatch します。gutter は entries() を読んで描き直します。


