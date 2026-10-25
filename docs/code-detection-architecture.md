# コード検出アーキテクチャ

言語指定のないコード(`code:` ブロックの `code:` のみの宣言、およびインラインコード `` `...` ``)に、シンタックスハイライトを付けるための設計。

**判定はバックエンドだけで行い、結果を本文のハッシュをキーにして保存する。** クライアントは判定を要求せず、保存済みの結果を引くだけにする。

このドキュメントは、ハイライト実装前のコードベースを前提に書いている。

## 1. 前提(現状のコード)

### フロントエンド

- `parser/cardpod/codeLanguages.ts` が、`parseMixed` で `CodeBlock` の本文を入れ子パースしている。
  - 宣言行(`code:ts`、`code:main.rs(rust)`)の言語名を `@codemirror/language-data` の catalog で引く。
  - 言語は初回使用時に動的 import する。読み込み完了までは `ParseContext.getSkippingParser(promise)` を返す。これは木を作らない(素のテキストのまま表示される)パーサで、Promise の解決後に再パースが予約される。
  - **言語指定がなければハイライトしない。**
  - インラインコード(`Code` ノード)は対象外。
- 既知の不具合: `readInfo` と `codeRange` が `node.node.firstChild` を宣言行の mark と仮定している。インデント付き(`\tcode:ts`)では `firstChild` が `Indent` になり、言語を検出できない。
- ブロックの背景は `codeBlockLines.ts` が付けるので、ハイライトの有無とは無関係に表示される。

### バックエンド

- `internal/parser` が Go 版パーサ。
  - `KindCodeBlock` は `Text`(宣言の `code:` 以降)と `Body`(本文行。宣言のインデント + 1 文字を除去済み)を持つ。
  - `KindInlineCode` は本文を持たない。
  - `Node.CodeLanguage()` が、宣言から言語名(括弧内があればそれ、なければ全体)を返す。
- `internal/serve/ydoc.go` の `store()` は、ygo のデバウンス済み保存(2s / 最大 10s)のたびに、本文を読んで `updatePreview` と `wikilink.Sync` を呼ぶ。失敗は `slog.Warn` だけで、保存は止めない。
- `internal/wikilink` は、本文から導出したデータを `card_links` に差分同期している。本設計はこれと同じ形にする。

## 2. 目的と非目的

**目的**

- 言語未指定のコードブロックとインラインコードに、色を付ける。
- 複数人が同じカードを開いても、サーバー負荷が増えない。
- 精度は問わない(間違った色が付いてもよい)。

**非目的**

- 判定の信頼度の管理。
- ユーザーによる言語の上書き UI(明示指定は既存の `code:ts` が担う)。
- オフラインで新しく書いたコードへの即時ハイライト(§8 参照)。

## 3. 設計方針

| 判断 | 内容 |
| --- | --- |
| 判定の場所 | バックエンドのみ。クライアントから判定 API は呼ばない |
| 判定のタイミング | `store()`(ygo の保存タイミング)。入力のたびには走らない |
| 結果のキー | 本文のハッシュ。位置(行番号・文字位置)では指さない |
| 明示指定 | `code:ts` のようにフロントで解決できる指定は、判定もハッシュ参照もしない |
| 結果の共有 | ハッシュ → 言語のグローバルなテーブル。カードにも pod にも依存しない |

### なぜ位置ではなくハッシュか

「12 行目の 13〜30 文字目を Python とする」形式は、共同編集で上に 1 行足されるだけでずれる。Yjs の RelativePosition で追従する手もあるが、Go 側で扱うのは重い(`lines.go` の TODO と同じ「行の識別」問題になる)。

ハッシュ方式は位置に依存しない。編集でずれても壊れず、同じ本文をコピーした別のカードでも結果を再利用できる。本文が変われば新しいハッシュになり、再判定される。

## 4. データモデル

PocketBase の WEB UI で `code_langs` コレクションを作る(CLAUDE.md の方針どおり、マイグレーションコードは書かない)。

| フィールド | 型 | 備考 |
| --- | --- | --- |
| `content_hash` | text, required | 正規化した本文の 64 bit FNV-1a(16 桁の小文字 16 進)。**unique index** |
| `language` | text | enry の言語名。**空文字は「判定したが不明」**(再判定を避けるために保存する) |

- 本文自体は保存しない。容量は小さい。
- どのカードからも参照されなくなったレコードは残る。本文を持たないので、掃除は増えすぎてからでよい。
- 全コレクションが superuser 専用(listRule 等は null)という既存の方針に従う。

## 5. 正規化テキストとハッシュ

バックエンドとフロントエンドが**同じハッシュを計算できること**が、この設計の前提になる。

### 正規化テキスト

| 対象 | 正規化テキスト |
| --- | --- |
| `code:` ブロック | 本文行から、宣言のインデント + 1 文字を除いたもの(それより深い空白はコードの一部として残す)を `"\n"` で連結。Go の `Node.Body` と一致する |
| インラインコード | 前後のバッククォートの間の文字列 |

### ハッシュ関数

**64 bit FNV-1a を、UTF-8 バイト列に対して計算する。** 暗号学的な強度は要らない。衝突しても色が変になるだけだからである。

理由は、フロントのパーサ層(`nestCodeBlock`)が**同期**だからである。`crypto.subtle.digest` は非同期なので使えない。FNV-1a は両言語で数行で実装できる。

Go

```go
// hashCode returns the key a code snippet is stored under. The frontend
// computes the same value (see codeHash.ts); keep them in lockstep.
func hashCode(text string) string {
	h := fnv.New64a()
	h.Write([]byte(text))
	return fmt.Sprintf("%016x", h.Sum64())
}
```

TypeScript

```ts
// Must match internal/codelang's hashCode.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export function hashCode(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
```

両実装が一致することを、**同じテストベクタを両方のテストに書いて**確認する(ASCII、日本語、空白のみ、複数行)。

## 6. バックエンド

### 6.1 言語判定(go-enry)

```
go get github.com/go-enry/go-enry/v2
```

**`enry.GetLanguage("", code)` だけでは、ほぼ何も返らない。** enry は戦略(modeline、ファイル名、shebang、拡張子、内容ヒューリスティクス)を順に試し、Bayes 分類器は「前段が出した候補の絞り込み」にしか使わない。ファイル名がなく shebang もない断片は候補が 0 件になり、常に `""` が返る(`echo hello` でも同様)。

対処は、分類器を `GetLanguageByClassifier` で単独で使い、候補を明示的に渡すことである。

```go
// classifierCandidates lists the languages the classifier may answer with.
// enry only consults the classifier to narrow down candidates found by
// earlier strategies (extension, ...). An untagged snippet has none, so the
// list must be passed explicitly. It is limited to languages the editor can
// highlight (see @codemirror/language-data), since any other answer would
// be useless. Names are enry's; the frontend maps them back with
// LanguageDescription.matchLanguageName.
var classifierCandidates = []string{
	"C", "C++", "CSS", "Go", "HTML", "Java", "JavaScript", "JSON", "Markdown",
	"PHP", "Python", "Rust", "SCSS", "Shell", "SQL", "TypeScript", "XML", "YAML",
}

// detectLanguage guesses the language of an untagged code snippet. It
// returns "" when nothing matches.
func detectLanguage(code []byte) string {
	// Shebang and modeline are certain when present, so they win.
	if language := enry.GetLanguage("", code); language != "" {
		return language
	}
	language, _ := enry.GetLanguageByClassifier(code, classifierCandidates)
	return language
}
```

- **候補は CodeMirror がハイライトできる言語に限る。** 対応外の言語を返しても無意味だからである。候補が短いほど、分類器の誤判定の幅も狭まる。
- **分類器は必ず何かを返す。** 信頼度は返らないので、散文でも何かの言語になる。「間違ってもよい」ので許容する。ノイズが気になれば、本文が短すぎる(たとえば 3 文字未満)場合は判定しない条件を足す。
- 数行のスニペット、特に 1 語のインラインコードは、精度が低い。実装後、手元のスニペットで実用になるか確認する。

### 6.2 パーサの変更

インラインコードの本文をノードに持たせる。

`internal/parser/inlinecode.go`

```go
// parseInlineCode mirrors frontend rules/inlineCode.ts. The node's Text is
// the code between the backticks.
func parseInlineCode(s string, pos int) (*Node, int) {
	end := strings.IndexByte(s[pos+1:], '`')
	if end < 0 {
		return nil, 0
	}
	return &Node{Kind: KindInlineCode, Text: s[pos+1 : pos+1+end]}, pos + end + 2
}
```

`internal/parser/nodes.go` の `Node` のコメントにも、`Text` に `KindInlineCode` の本文が入ることを追記する。

コード断片の一覧を返す小さなメソッドを足す。

```go
// UntaggedCode returns the normalized text of every code snippet that has no
// explicit language: code: blocks whose declaration names none, and inline
// code spans. Empty snippets are skipped.
func (n *Note) UntaggedCode() (snippets []string) {
	n.Walk(func(node *Node) bool {
		switch node.Kind {
		case KindCodeBlock:
			if node.CodeLanguage() == "" && len(node.Body) > 0 {
				snippets = append(snippets, strings.Join(node.Body, "\n"))
			}
		case KindInlineCode:
			if node.Text != "" {
				snippets = append(snippets, node.Text)
			}
		}
		return true
	})
	return snippets
}
```

- 本文が空白のみのスニペットは、ここで `strings.TrimSpace` して落としてよい(判定しても意味がない)。ただし**ハッシュはトリム前の正規化テキストで計算する**。フロントと一致させるためである。
- `code:` ブロックの中の `` ` `` はインラインコードとして解釈されない(本文は生テキスト)。これはフロントのパーサと一致している。

### 6.3 同期(`internal/codelang`)

`internal/wikilink` と同じ形の小さなパッケージにする。

```go
// Package codelang keeps the "code_langs" collection filled with a guessed
// language for every untagged code snippet found in a card's text, so the
// editor can highlight them without asking the server on every keystroke.
package codelang

// Sync detects the language of every untagged snippet in text that has no
// stored answer yet. A snippet is identified by the hash of its text, so the
// same code is detected once no matter how many cards or editors it appears
// in. Nothing is written when every snippet is already known.
func Sync(app core.App, text string) error {
	for _, snippet := range parser.Parse(text).UntaggedCode() {
		hash := hashCode(snippet)
		known, err := isKnown(app, hash)
		if err != nil {
			return err
		}
		if known {
			continue
		}
		if err := save(app, hash, detectLanguage([]byte(snippet))); err != nil {
			return err
		}
	}
	return nil
}
```

- 既知かの確認は、ハッシュごとに `FindFirstRecordByFilter` する単純な形でよい(1 カードのスニペット数は少ない)。
- 同じハッシュを同時に保存しようとした場合は unique index が守る。保存エラーは、重複なら成功扱いにするか、`slog.Warn` だけで無視する(次の保存で再試行される)。
- テストでは `internal/wikilink/wikilink_test.go` の `newTestApp` と同じ要領で、最小のコレクションだけ作る。

### 6.4 `store()` への組み込み

`ydoc.go` の `store()` で、`wikilink.Sync` の隣に呼ぶ。

```go
// Language guesses for untagged code. Like the preview and the links, a
// failure is only logged: it must never block persisting the document.
if err := codelang.Sync(p.app, text); err != nil {
	slog.Warn("sync code languages", "room", room, "error", err)
}
```

`import.go` の `importImportedPage` も、`wikilink.Sync` と同様に呼ぶ(インポートしたカードも判定される)。

### 6.5 参照 API

クライアントが必要なハッシュを送り、保存済みの結果だけを返す。**判定はしない。**

```
POST /api/admin/code-langs
  request : {"hashes": ["0123456789abcdef", ...]}
  response: {"languages": {"0123456789abcdef": "Python", ...}}
```

- 保存されていないハッシュは、レスポンスに含めない(未判定)。判定して不明だったものは `""` で含める。両者を区別できることが重要。
- `hashes` の上限を設ける(たとえば 200)。超えたら 400。
- `admin` グループ(`RequireSuperuserAuth`)に登録する。

## 7. フロントエンド

### 7.1 ハッシュと保存済み結果のキャッシュ

`codeHash.ts`(§5 の `hashCode`)と、結果を持つモジュールを用意する。

- モジュール変数 `languages: Map<hash, "" | 言語名>`(判定済みの結果)。
- `nestCodeBlock` が未知のハッシュに遭遇したら、**その場では問い合わせず**、集めておく。短い遅延(数百 ms)でまとめて 1 回の `POST /api/admin/code-langs` にする。
- レスポンスを Map に入れ、上限件数に達したら全消去する。全消去のあとは、次のパースで再度問い合わせられるだけで、無限ループにはならない(判定中の Promise を Map に残さないこと)。
- 問い合わせ中の複数ブロック・複数回のパースで、同じハッシュの重複リクエストを出さない(集めた Set で除外)。

### 7.2 `nestCodeBlock` の変更

- `CodeBlock` に加え、`Code`(インラインコード)も対象にする。範囲は、`Code` ノードの前後 1 文字(バッククォート)を除いたもの。空なら `null`。
- 宣言に言語名がある場合(`info` が空でない)は、従来どおり catalog で引いて終わる。**ハッシュ参照はしない。** 未知の名前ならプレーン表示のまま(誤字に気づける)。
- 言語名がない場合は、正規化テキストのハッシュを計算して Map を引く。
  - 判定済みで言語あり: `LanguageDescription.matchLanguageName(languages, 名前, true)` で catalog に照合し、従来の `parserFor`(読み込み済みならその parser、未読み込みなら `getSkippingParser(found.load())`)を返す。
  - 判定済みで空、または catalog に照合できない: `null`(プレーン)。
  - 未判定: `getSkippingParser(結果が届く Promise)` を返し、プレーン表示のまま待つ。届いたあとに再パースが走り、Map の結果で色が付く。**未判定でもブロックは非表示にならない。**
- ブロックの正規化テキストは、ブロック範囲の各行から「宣言のインデント + 1 文字」を除いて `"\n"` で連結する。Go の `Body` と一致させる。

### 7.3 既知の不具合の修正(同時に入れる)

前提の `readInfo` / `codeRange` は、`firstChild` の代わりに `getChild("CodeBlockMark")` で宣言行を探す。修正しないと、`\tcode:ts` の明示指定が「言語なし」扱いになり、ハッシュ参照に流れてしまう。

回帰テストを先に書く。`readInfo` を export し、`cardpodSyntaxLanguage.parser.parse` で得た木から、次の 3 ケースを確認する。

- `code:typescript` は `"typescript"`
- `code:main.rs(rust)` は `"rust"`
- `\tcode:ts`(インデント付き)は `"ts"`

修正後、`parser/cardpod/README.md` 末尾の「`codeLanguages.ts` とインデント付きコードブロック(要確認)」の項を削除する。

### 7.4 結果の更新

他のユーザーや自分の保存により、あとから判定結果が増える。届ける経路の候補は次のとおり。

- カードを開いたときに問い合わせる(必須)。
- 未判定のまま残ったハッシュを、そのカードの realtime `update` イベント(すでに `cardsStore` が受信している)を契機に、再度まとめて問い合わせる。
- 一定間隔でポーリングする(単純だが無駄が多い)。

まずは「開いたとき + 未判定分の再問い合わせ(数秒後に 1〜2 回)」で足りる。保存の遅延(最大 10 秒)より長く待つ必要はない。realtime への統合は、体感が足りなければ後から足す。

## 8. トレードオフと制約

- **反映の遅れ。** 新しく書いたコードに色が付くのは、ygo の保存(2〜10 秒)+ 再問い合わせのあと。入力後すぐ(800ms 程度)に判定するクライアント方式より遅い。
- **オフライン。** 新しく書いたコードは、同期して保存されるまで色が付かない。既存のブロックは、結果を Dexie などにキャッシュすれば、オフラインでも色が付く(初期実装ではメモリの Map のみでよい)。
- **精度。** 短いスニペットの判定は当たりにくい。誤りは保存され、本文が変わるまで固定される。手動指定(`code:ts`)は常に優先されるので、実害は小さい。
- **ハッシュの前提。** バックエンドとフロントエンドの正規化テキストとハッシュ関数は、必ず一致させる。パーサの規則(インデント、`code:` の終了条件)を変えるときは、両方のテストを更新する。

## 9. テスト

- Go
  - `detectLanguage`: shebang 付き(`#!/bin/sh` は Shell)、Go と Python の断片。`echo hello` のような 1 行は分類器任せなので、期待値を固定しない(実際の値を一度確認する)。
  - `classifierCandidates` の全名が `data.LanguagesLogProbabilities` に存在する(綴りの誤りは、エラーにならず黙って無視されるため)。
  - `hashCode`: テストベクタ(フロントと同じ値)。
  - `UntaggedCode`: 言語なしブロック、`code:go`、インラインコード、`code:` ブロック内のバッククォート、空のスニペット。
  - `Sync`: 新規保存、既知の再判定なし、消えたスニペットは何もしない、削除済みカードの無視。
  - 参照 API: 保存済みのみ返る、`""` と未判定の区別、上限超過。
- フロント
  - `hashCode` のテストベクタ(Go と同じ値)。
  - `readInfo`(§7.3)。
  - 各判定結果の Map から、`nestCodeBlock` が返す parser の分岐(判定済み・空・未判定)。
- 判定結果の言語名が、catalog の `matchLanguageName` で全候補について解決できること(名前のずれを検出する)。

## 10. 実装の順序

1. `readInfo` / `codeRange` の修正と回帰テスト(§7.3)。単独で価値があり、他に依存しない。
2. Go パーサ: `KindInlineCode.Text`、`UntaggedCode`。
3. `codeHash`(両言語)とテストベクタ。
4. `internal/codelang` と `code_langs` コレクション、`store()` と `import.go` への組み込み。
5. 参照 API。
6. フロント: 問い合わせのまとめ処理、`nestCodeBlock` の変更。
7. 精度の確認。足りなければ、候補の絞り込み、短い断片のスキップ、あるいは別の判定器(highlight.js の `highlightAuto` など。フロント完結でオフラインにも強いが、バンドルが重い)を検討する。

## 11. 却下した案

| 案 | 理由 |
| --- | --- |
| クライアントから判定 API を呼ぶ | 開いた人数 × ブロック数の負荷になる。入力中は打鍵ごとに(デバウンスしても)リクエストが増え、同じ本文を複数人が同時に判定する |
| 位置(行・文字位置)を付けてノートのメタデータに持たせる | 編集でずれる。追従には RelativePosition が要り、Go 側の実装が重い |
| カード単位で結果を持つ(`card_code_langs`) | カードごとに重複して判定・保存される。コピーした本文の結果が再利用できない |
