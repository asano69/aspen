# 一般ユーザー対応の段階的設計計画

現状は superuser (admin) しか使えない。一般ユーザーを追加してログインできるようにするための段階的な設計計画。

## 1. 現状の問題

- `login()` は `_superusers` にしか認証しない。
- `realtime.authenticate` は superuser 以外を拒否する。
- `/api/admin` と `/api/pages` は `RequireSuperuserAuth`。
- 各コレクションのルールは null (superuser 専用)。
- `pb.ts` の `afterSend` は 403 で `authStore` を clear する。

ログイン処理の拡張に加えて、これらのサーバー側のルールも直す必要がある。

## 2. 前提と方針

### 権限モデル

「ログイン済みなら誰でも全ポットを読み書きできる」という最も単純なモデルにする。1〜20人の信頼できるチーム用途 (CLAUDE.md) なら十分。ポット単位の ACL やロール (owner / member) は今回やらない。

### 決めておく事項

| 項目 | 提案 | 理由 |
| --- | --- | --- |
| サインアップ | 閉じる。ユーザーは superuser がダッシュボードで作る | 全員が全データを見られるモデルなので、公開サインアップは致命的 |
| ログイン画面 | 1つのフォーム。`users` で認証し、失敗したら `_superusers` を試す | admin も今まで通り使える。画面は増やさない |
| centrifuge | 有効な認証トークンなら誰でも接続可 (superuser 限定だけ外す) | ポット単位の制御はしない。匿名は弾いたままにできる |
| y-websocket (`/yjs/{room}`) | 現状維持 (無認証のまま) | 認証機構は後で設計する。今回は悪化しない |
| ポット削除 | 認証済みなら誰でも (迷うなら `deleteRule` を null にして superuser 専用) | カスケードで全カードが消える操作なので、ここだけは確認したい |

centrifuge を一切触らない場合、一般ユーザーはフッターが `offline` のままでリアルタイム更新が来ない。そのため認証チェックの緩和だけは入れる。

### 段階分けの理由

superuser は PocketBase のルールを常にバイパスし、`apis.RequireAuth()` も superuser を通す。したがって各段階を単独でデプロイしても、既存の admin は壊れない。

## 3. Stage 1: コレクションのルール (PocketBase の Web UI)

認証済みの条件は `@request.auth.id != ""`。空文字のルールは「未認証も許可」になるので使わない。

| コレクション | list / view | create | update | delete |
| --- | --- | --- | --- | --- |
| `users` | 本人のみ (現状) | **`""` から null に変更** | 本人のみ (現状) | null (自己削除を禁止) |
| `pods` | 認証済み | 認証済み | 認証済み | 認証済み (または null) |
| `cards` | 認証済み | null | 認証済み + 下記の項目制限 | null |
| その他すべて | null のまま | null | null | null |

**`users.createRule` の修正は最優先。** 現状は `""` で、誰でも登録できる。ユーザーを1人でも作る前に閉じる。

### `cards` を絞る理由

- カード作成は `/api/admin/cards` (`e.App` で動くのでルールをバイパス) と `aspen import` だけ。REST の create は不要。
- 論理削除は `deleted` の update で行うので、`deleteRule` は null のままで足りる。
- `title` / `titleLc` / `description` / `image` はサーバーが解決・導出する値。REST で直接書かれると、一意性や pull の整合性が壊れる。フロントが送るのは `pin` / `position` / `deleted` / `query` だけなので、他は拒否する。

`cards.updateRule`:

```
@request.auth.id != "" &&
@request.body.pod:isset = false &&
@request.body.title:isset = false &&
@request.body.titleLc:isset = false &&
@request.body.description:isset = false &&
@request.body.image:isset = false &&
@request.body.created:isset = false &&
@request.body.updated:isset = false
```

### `card_links` と周辺コレクション

`card_links` / `card_ydocs` / `renders` などは null のまま。フロントは REST で触らず、pull ルートとリアルタイム経由だけで使う。`renders.output_file` は protected ではないため、URL が分かれば取得できる (ルールは不要)。

### 手順

1. Web UI でルールを変更する。
2. `make migrate-collections` でスナップショットを再生成する。
3. 設定の Rate limiting で認証系エンドポイントの制限を有効にする。ログインを受け付けるアカウントが増えるため。

## 4. Stage 2: Go のサーバー側

### 4-1. `internal/serve/handler.go`

```go
// /api/admin and /api/pages accept any authenticated record (a regular
// user or a superuser). Per-pod permissions do not exist yet.
admin.Bind(apis.RequireAuth())
pages.Bind(apis.RequireAuth())
```

パス名 `/api/admin` は変えない (フロント、スクリプト、型生成に波及するため)。名前と実態のズレはこの文書に残す。

### 4-2. `internal/realtime/register.go` の `authenticate`

`IsSuperuser()` の判定を削除する。`FindAuthRecordByToken` は `users` のトークンも解決する。

```go
// authenticate accepts any valid PocketBase auth token. There is no
// per-pod filtering yet: every client receives the events of all pods.
func authenticate(app core.App, token string) (userID string, err error) {
	record, err := app.FindAuthRecordByToken(token, core.TokenTypeAuth)
	if err != nil {
		return "", errors.New("invalid or expired auth token")
	}
	return record.Id, nil
}
```

### 4-3. テスト (CLAUDE.md の規則どおり先に書く)

- `TestAuthenticate`: 「非 superuser は拒否」という現在の期待を「受理」に直す。空・不正トークンの拒否はそのまま残す。
- ルールの結合テスト (推奨): 本番スナップショットを読み込んだアプリに対し、次を確認する。
  - 未認証は拒否される。
  - `users` のサインアップは拒否される。
  - 一般ユーザーが `cards` の `title` を PATCH すると拒否される。
  - 一般ユーザーが `pin` / `position` を PATCH すると成功する。

## 5. Stage 3: フロントエンド

### 5-1. `lib/api/auth.ts` のログイン

```ts
export async function login(email: string, password: string): Promise<void> {
  try {
    await pb.collection("users").authWithPassword(email, password);
  } catch (err) {
    // Wrong credentials for "users" (400): the same form is also the
    // superuser's login. Anything else (network, ...) is a real failure.
    if (!(err instanceof ClientResponseError) || err.status !== 400) throw err;
    await pb.collection("_superusers").authWithPassword(email, password);
  }
}
```

### 5-2. `lib/api/pb.ts` の `afterSend`

- **403 でのログアウトをやめ、401 だけにする。** 403 はこれまで「無効トークン」の代用だったが、今後は「権限なし」という普通のエラーになり得る。そのまま残すと、権限エラーでセッションが切れる。
- 無効なトークンで認証必須の REST を叩くと、listRule が「空配列」を返し、403 にはならない。例えば `fetchCardBySlug` は「カードなし」と誤解して下書きを開く。
- 対策として `auth.ts` に `refreshSession()` を足し、起動時と定期的に `authRefresh()` を呼ぶ。失敗したら `authStore.clear()` する。`AuthGate` の既存の30秒タイマーの隣に置く。これでパスワード変更後の失効トークンも拾え、トークンの有効期限も延びる。
- カスタムルートは `RequireAuth` が 401 を返すので、こちらは `afterSend` で拾える。

### 5-3. コメントの更新

次のファイルに「superuser のみ」「single-user」と書かれたコメントが残っている。実態に合わせて英語で直す。

- `pages/Login.tsx`
- `components/AuthGate.tsx`
- `lib/api/auth.ts`
- `lib/api/pb.ts`
- `internal/serve/handler.go`
- `internal/realtime/register.go`
- `internal/realtime/hub.go`

## 6. Stage 4: 検証とドキュメント

手動確認 (2ブラウザ: 一般ユーザーと admin):

1. 一般ユーザーでログインし、ポット一覧、カード編集、ピン留め、並べ替え、論理削除ができる。
2. フッターが `online` になり、admin の編集が届く。
3. `POST /api/collections/users/records` が拒否される。
4. REST で `title` を変更しようとして拒否される。
5. パスワードを変更したユーザーが、再読み込みでログイン画面に戻る。
6. `scripts/load_test_cards.py` (superuser) が従来どおり動く。

完了後、権限モデル、ルール表、未対応事項をこの文書から `docs/architecture/auth.md` に移す。

## 7. 既知の問題 (今回は対象外)

| 問題 | 内容 |
| --- | --- |
| ポット一覧が即時反映されない | `podsStore` に realtime がなく、他人の作成・改名・削除は再読み込みまで見えない |
| `pods.position` の一意制約 | 同時にポットを作ると `nextPodPosition` が衝突して失敗し得る (「Failed to add the pod」) |
| ログアウト後のデータ残り | Dexie、y-indexeddb、モジュール変数にデータが残る。全員が同権限なので漏洩ではないが、ACL を入れる時点で必須 (logout 時のクリアまたは reload) |
| Yjs / centrifuge の認可 | ルーム・チャネル単位の認可が未実装。別途設計する |
| ポット ACL | `pods.members` と各ルールへの組み込みに加え、`createCardHandler` のポット検証、pull / realtime のフィルタが要る |
| `query` (datalog) | サーバーで評価されるため、重い式による負荷が一般ユーザーにも向く。タイムアウトを検討する |
