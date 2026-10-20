# `internal/notation` → `internal/parser`（手書き再帰下降パーサ）移行計画

## 0. 目的とスコープ

バックエンドに、フロントエンド（Lezer）と同じ規則で動く小さな本物のパーサを持たせる。
ノートの構文は Scrapbox/Cosense 互換で、フロントエンドは `parser/cardpod/` に実装済み。
バックエンドは今まで `internal/notation` の手書きスキャナで済ませてきたが、構文が増えるたびに場当たり的に拡張することになる。

**直近で必要なのは次の3つだけ**であり、それ以外の構文は必要になるまで実装しない。

1. wikilink（`[title]`）の識別
2. line 0（カードのタイトル行）の識別
3. 画像URL構文の識別（`cards.image` 用に、本文中の最初の画像の src を得る）

ただし「必要になったときに足せる」ことは要件とする（7章）。

## 1. 現状の問題

- `internal/notation/wikilink.go` は AST を作らず、タイトル文字列を集めるだけ。画像など別の目的に使い回せない。
- 画像URLを取れない。`internal/serve/ydoc.go` の `updatePreview` は `cards.image` を更新しておらず、TODO のままになっている。
  ProseMirror 時代の `internal/xmldoc` は、もう使えない。
- 「1行目はタイトル」という定義が3か所に散っている（`ydoc.go` の `firstLine`、`title_watch.go` の `firstLine`、
  `ExtractWikiLinkTitles` の `i == 0` スキップ）。
- 既知の差異が残っている（ラベル付き外部リンクのラベル内 wikilink を拾わない、など。2章）。

ただし、スキャナの骨格は悪くない。`at()` は Lezer の契約（位置を受け取り、終端位置か -1 を返す）で書かれており、
足りないのは「結果を AST として残す」ことと「ルールを frontend と1対1のファイルに分ける」ことだけ。
したがってこれは**置き換えではなく、整理して育てる**作業になる。

## 2. 直近スコープ

「直近で必要」な構文は、目的そのもののためか、他の構文の中身を正しく無視・再帰するためのものに限る。

| 構文 | 直近 | 理由 |
| --- | --- | --- |
| Title（1行目） | 要 | 目的2。記法を一切解釈しない生テキスト |
| Line（1行=1ブロック） | 要 | フロントエンドと同じ行モデル。空白のみの行はノードを作らない |
| CodeBlock（`code:`） | 要 | 中身の wikilink・画像を無視するため。中身は生テキスト |
| InlineCode（`` `x` ``） | 要 | 同上 |
| WikiLink | 要 | 目的1 |
| Image / LinkedImage / `[[image]]` | 要 | 目的3。バックエンドでは `Image`（src を持つ）1種類にまとめる |
| Decoration（`[* x]` `[/ x]` `[*/ x]`） | 要（中身を再帰） | 中の wikilink・画像を拾うため |
| Strong（`[[x]]`） | 要（中身を再帰） | 同上。中身が Image/Icon なら葉 |
| Blank（`[ ]`） | 要 | WikiLink と誤認しないため |
| その他の `[...]`（Math, Icon, ProjectLink, GoogleMap, ExternalLink） | 分類のみ | WikiLink と誤認しないため。範囲を消費し、種別つきの葉ノードにする |
| Quote | 不要 | `>` は角括弧ではなく、Line と同じ結果になる |
| Table | 不要 | 行を Line として扱う（下記「既知の差異」） |
| HashTag / Helpfeel / CommandLine / NumberList | 不要 | 必要になったら7章の手順で追加（HashTag は下記「既知の差異」） |

### 既知の差異（直近スコープの外に置く代わりに、明記しておく）

frontend との結果が食い違う入力。いずれも実運用では稀で、必要になった時点で7章の手順で解消する。

- **ラベル付き外部リンクのラベル**: `[https://example.com/ see [page]]` の `[page]` を拾わない（frontend は拾う）。
- **HashTag**: `#a[b]` は frontend では `#a[b]` 全体が1つのハッシュタグで、wikilink は無い。backend は `[b]` を wikilink として拾う。
  HashTag は約15行なので、この差異が問題になったら最初に足す。
- **Table**: frontend は各セルを別々に解析する（括弧はタブをまたげない）うえ、`table:` 宣言行は解析しない。backend は宣言行も行も Line として扱う。
- **Quote**: 差異なし（`>` は角括弧の解析に影響しない）。

## 3. 設計方針

### 3.1 公開 API を先に固定する

呼び出し側（`internal/wikilink`, `internal/serve`）が見るのは次の形だけ。内部のノード構造には依存させない。

```go
// Note is a parsed card text. Parse receives the whole document; telling the
// title line apart from the body is the parser's job, not the caller's.
type Note struct {
	Nodes []*Node // the whole document in order; the title line, if any, is the first node
}

func Parse(text string) *Note

// Title returns the raw title line, or "" when the first line is blank.
func (n *Note) Title() string

// WikiLinkTitles returns the raw title of every wiki link, in document order.
// The title line is never scanned: it is a leaf Title node.
func (n *Note) WikiLinkTitles() []string

// FirstImageSrc returns the src of the first image notation, or "".
func (n *Note) FirstImageSrc() string
```

`wikilink.Sync(app, cardID, text)` のシグネチャは変えない（`wikilink_test.go` が無修正で通る）。
`Sync` と `updatePreview` がそれぞれ `Parse` を呼んでもよい（ydoc の保存は2秒デバウンスなので二重パースは問題にならない）。
計測して問題が出たら、`store()` で1回だけパースして渡す形に変える。

### 3.2 文書全体を渡し、タイトルもパーサが識別する

呼び出し側は文書をタイトルと本文に分けない。`Parse` に全文を渡し、パーサが1行目を `Title` ノードとして識別する。
これは frontend の `rules/title.ts` と同じ構造（ドキュメント先頭の行だけを、他のどのルールよりも先に claim する）で、
「タイトルとは何か」の定義がパーサの1か所に集まる。

- 1行目が空白のみでなければ、その行全体（生テキスト）を持つ葉ノード `Title` を作る。記法・インデントは一切解釈しない。
  タイトル行に `code:` があってもコードブロックは始まらず、`[page]` があっても wikilink にはならない。
- 1行目が空白のみなら、ノードは作らない（サーバ側は既存の通り "Untitled" にフォールバックする）。2行目以降は本文であり、タイトルにはならない。
- `WikiLinkTitles` / `FirstImageSrc` は木を辿るだけでよい。`Title` は子を持たないので、タイトル行が除外される処理は木の構造から自然に決まる（特別扱いの分岐が要らない）。

`SplitTitle` のような「文書を切り分ける関数」は作らない。`ydoc.go` / `title_watch.go` の `firstLine` は、Phase 4 で `Parse(text).Title()` に置き換える。
`title_watch` は Yjs の更新ごとに呼ばれるため、全文パースのコストが問題になったら、そのとき初めて先頭行だけを読む軽い関数をパーサ側に足す（定義はパーサが持ち続ける）。

### 3.3 ルールの契約は Lezer と同じにする

インラインルールは「位置を受け取り、成功なら終端位置を、失敗なら不成立を返す」。失敗したら呼び出し側が1文字進めて再試行する。
frontend の `parseInline` 配列、cosy の `alt(...)` + 1文字フォールバックと同じ構造。

```go
// A rule tries to parse the notation starting at s[pos]. On success it returns
// the node (nil when the notation is consumed without producing one) and the
// end position, which is always greater than pos. On failure ok is false and
// the caller retries at the next position.
type inlineRule func(s string, pos int) (n *Node, end int, ok bool)
```

トリガー文字（`[`, `` ` ``）はすべて ASCII なので、UTF-8 のテキストでもバイト単位で安全に走査できる。
バックエンドはソース位置を必要としないので、オフセットは引き回さない。

### 3.4 ノードは小さく保つ

```go
type Kind string

type Node struct {
	Kind     Kind
	Text     string  // Title: raw first line; WikiLink: title; Image: src; other bracket kinds: raw content
	Children []*Node // Line, Decoration, Strong only
}
```

`Kind` は次の通り。ブロック: `Title`, `Line`, `CodeBlock`。インライン: `InlineCode`, `Decoration`, `Strong`, `Blank`、
そして `DecideBracket` が返す括弧の種別（`WikiLink`, `Image`, `ExternalLink`, `Math`, `Icon`, `ProjectLink`, `GoogleMap`）。
`LinkedImage` と `[[image]]` は `Image` として出力する（src だけが目的のため）。`href` などは必要になった時点でフィールドを足す。

`Title` と `CodeBlock` は子を持たない（`CodeBlock` の中身は生テキストで、必要になるまで保持しない）。

### 3.5 `[` で始まる構文は1つのルールに集約する

frontend は Lezer の都合で Decoration / Blank / Bracket を別ルールにしているが、backend は `bracket.go` の1つのルールにまとめる。
順序は frontend と同じ「Decoration → Blank → Strong（`[[`）→ 単括弧」。対応する `]` を探す処理（ネスト深度カウント）を共有できる。
関数名は frontend の rules に対応させる（`parseDecoration`, `parseBlank`, `parseStrong`, `parseSingle`）。

### 3.6 分類は `DecideBracket` に一本化し、Src を返す

`notation.DecideBracketKind` を `DecideBracket(content) Decision` に拡張し、`decide.go` に移す。
これは frontend の `decideBracketNodeType`（`BracketDecision`）に対応する純粋関数で、パーサの型には依存させない。

```go
type Decision struct {
	Kind BracketKind
	Src  string // Image and LinkedImage only
}
```

- Image: `Src` = content
- LinkedImage: 画像側のトークン。**両方が画像なら先頭**（frontend は `firstKind === "image" ? first : last`。cosy は末尾で、ここは frontend が正）

`href` / `label` は必要になった時点で足す。テストは `bracket_test.go` に `Src` の期待値を追加して移植する。

### 3.7 インデント定義

ECMAScript の `\s` 1文字 = 1レベル。`notation` の `isJSSpace` / `measureIndent` / `isBlank` を `indent.go` に移す。
frontend の `indent.ts` と lockstep（片方を変えたら両方直す）。

`\s` の集合は ECMA-262 の定義で決まっている: WhiteSpace（TAB, VT, FF, ZWNBSP=U+FEFF, Unicode の Zs カテゴリ）と
LineTerminator（LF, CR, U+2028, U+2029）。したがって標準ライブラリだけで、ライブラリなしに正確に書ける。

```go
// isJSSpace reports whether r matches ECMAScript's `\s`.
func isJSSpace(r rune) bool {
	return unicode.Is(unicode.Zs, r) || strings.ContainsRune("\t\n\v\f\r\u2028\u2029\uFEFF", r)
}
```

Go の `regexp`（RE2）の `\s` は ASCII のみで、`unicode.IsSpace` は U+0085 を含み U+FEFF を含まないため、どちらも使わない。


`code:` ブロックの終端も frontend と同じ規則: 宣言行より深いインデントの行が続く間は本文で、`depth <= 宣言のインデント` の行で終わる。
完全に空の行は深さ 0 で終端になる。空白だけの行は空白の文字数が深さになるので、宣言より深ければ本文に含まれる。

### 3.8 lockstep 規約

`internal/slug` と同じ。frontend の `parser/cardpod/rules/*.ts` に対応するファイルには冒頭コメントでそれを明記し、
frontend のテストケースが増えたら backend にも足す（逆も同様）。

## 4. ファイル構成

```
internal/parser/
├── parser.go      # Parse, Note, Title, WikiLinkTitles, FirstImageSrc
├── title.go       # the title line rule                 (mirrors rules/title.ts)
├── indent.go      # isJSSpace, measureIndent, isBlank   (mirrors indent.ts)
├── block.go       # line loop: Title, Line, code: blocks (mirrors paragraph.ts, codeBlock.ts, indentedBlock.ts)
├── inline.go      # parseInline: the rule loop          (mirrors parseInline in index.ts)
├── inlinecode.go  # `code` rule                         (mirrors rules/inlineCode.ts)
├── bracket.go     # "[" rule: decoration, blank, strong, single
│                  #                                     (mirrors rules/decoration.ts, blank.ts, bracket.ts)
├── decide.go      # DecideBracket, moved from notation  (mirrors decideBracketNodeType)
├── nodes.go       # Kind, Node
└── *_test.go
```

## 5. パーサの構造

### 5.1 ブロック層（`block.go`）

文書全体を行ごとに1回走査する。持つ状態は `code:` だけ。1行目は `title.go` のルールが、他のどのルールよりも先に処理する。

```go
func parseNote(text string) []*Node {
	var nodes []*Node
	codeIndent := -1 // indent depth of the open "code:" declaration, or -1
	for i, line := range strings.Split(text, "\n") {
		if i == 0 {
			// The first line is the card's title. It is plain text: no block or
			// inline notation is interpreted, and a blank one produces no node.
			if n := parseTitle(line); n != nil {
				nodes = append(nodes, n)
			}
			continue
		}
		depth, offset := measureIndent(line)
		if codeIndent >= 0 {
			if depth > codeIndent {
				continue // still inside the code block; the body is raw text
			}
			codeIndent = -1 // the block ends; this line is dispatched normally
		}
		switch {
		case isBlank(line):
			// Blank lines produce no node.
		case strings.HasPrefix(line[offset:], "code:"):
			codeIndent = depth
			nodes = append(nodes, &Node{Kind: KindCodeBlock})
		default:
			nodes = append(nodes, &Node{Kind: KindLine, Children: parseInline(line)})
		}
	}
	return nodes
}
```

- `table:` と `>` は特別扱いしない（2章）。追加するときはここに `case` を足す（7章）。
- 空行の扱いは frontend と同じ。ブロック終端になった行は、その場で次のブロックとして再ディスパッチされる。

### 5.2 インライン層（`inline.go`）

```go
// parseInline tries the rules at every position, like Lezer does.
func parseInline(s string) []*Node {
	var nodes []*Node
	for pos := 0; pos < len(s); {
		n, end, ok := parseAt(s, pos)
		if !ok {
			pos++
			continue
		}
		if n != nil {
			nodes = append(nodes, n)
		}
		pos = end
	}
	return nodes
}

// parseAt dispatches on the trigger character. The order of the rules for a
// character is their priority, same as the parseInline array in index.ts.
func parseAt(s string, pos int) (*Node, int, bool) {
	switch s[pos] {
	case '[':
		return parseBracket(s, pos)
	case '`':
		return parseInlineCode(s, pos)
	}
	return nil, 0, false
}
```

Decoration と Strong の中身の再帰パースは、内容の部分文字列に対する `parseInline(content)` を呼ぶだけ。

```go
// parseDecoration handles "[*/ text]": one or more decoration characters,
// a space, then non-empty content that is parsed recursively.
func parseDecoration(s string, pos int) (*Node, int, bool) {
	i := pos + 1
	for i < len(s) && (s[i] == '*' || s[i] == '/') {
		i++
	}
	if i == pos+1 || i >= len(s) || s[i] != ' ' {
		return nil, 0, false
	}
	contentFrom := i + 1
	end := matchingBracket(s, contentFrom)
	if end < 0 || end == contentFrom {
		return nil, 0, false
	}
	return &Node{Kind: KindDecoration, Children: parseInline(s[contentFrom:end])}, end + 1, true
}
```

## 6. フェーズ

各フェーズはそれだけで `go test ./...` が通る状態で終える。

### Phase 1 — `internal/parser` を作る（呼び出し側はまだ変えない）

- `Parse` / `Note`、`title.go`、`block.go`、`inline.go`、`inlinecode.go`、`bracket.go`、`decide.go`（`DecideBracket`）を実装する。
  `notation` からは、`matchingBracket`、`isJSSpace` / `measureIndent` / `isBlank`、`DecideBracketKind` のロジックを移す（コピーして削らない。Phase 2 でまとめて削除する）。
- `internal/notation` の `wikilink_test.go` と `bracket_test.go` の全ケースを `internal/parser` へ移植する（`WikiLinkTitles()` 経由）。
  `bracket_test.go` には `Src` の期待値を足し、「両方が画像の LinkedImage は先頭が src」のケースも入れる。
- 画像の新規ケース: 通常 / Linked / `[[image]]`、`code:` ブロック内、インラインコード内、Decoration 内、複数あるときは先頭が返ること、タイトル行内は無視されること。
- タイトルの新規ケース（frontend の `title.test.ts` に対応）: 1行だけの文書、2行目以降が本文であること、タイトル行に記法があっても解釈されないこと（`[page]`、`code:`）、
  1行目が空白のみ（半角・全角）なら `Title()` が空でノードも作られず、2行目がタイトルにならないこと、タイトルの先頭の空白が保たれること。
- `isJSSpace` のテスト（3.7 の方式）。
- **DoD**: 移植したテストがすべて通る。`internal/wikilink` はまだ `notation` を使っている。

### Phase 2 — wikilink の切り替えと `notation` の削除

- `internal/wikilink/wikilink.go` を `parser.Parse(text).WikiLinkTitles()` に切り替える。`wikilink_test.go` は無修正で通ること。
- `internal/notation` を削除する。
- **DoD**: `grep -r "internal/notation"` がヒットしない。

### Phase 3 — `cards.image` の復活

- `updatePreview` で `parser.Parse(text).FirstImageSrc()` を `image` フィールドに書く（変更がなければ書かない。既存の description と同じ扱い）。
- `ydoc.go` の `updatePreview` の TODO コメントを削除し、`internal/xmldoc` を削除する（`grep -r xmldoc` で他に参照がないことを確認してから）。
- **DoD**: 画像 URL を含むカードが CardItem のサムネイルとして表示される。

### Phase 4 — title 定義の一本化（任意）

- `ydoc.go` / `title_watch.go` の `firstLine` を `parser.Parse(text).Title()` に置き換える（コストは3.2を参照）。

## 7. 将来の構文の追加手順

いずれも「frontend の該当ルールを見て、1ファイル足して分岐を1つ足す」だけで済む構造を保つ。

| 構文 | 足すもの | 注意 |
| --- | --- | --- |
| HashTag | `hashtag.go`（`#` のルール）+ `parseAt` に `case '#'` | 行頭または空白の直後のみ。2章の既知の差異を解消する |
| Quote | `block.go` に `>` の `case` | 先頭の `>` の扱いだけ。中身は今まで通り `parseInline` |
| Table | `block.go` に `table:` の `case` + 行をタブで分割し、セルごとに `parseInline` | 括弧がセルをまたがなくなる。宣言行は解析しない |
| Helpfeel / CommandLine / NumberList | `block.go` に各 `case` | prefix 判定の順序は cosy の `parse_block` に合わせる |
| ラベル付き ExternalLink のラベル内 wikilink | `DecideBracket` に `Label` を追加し、`parseSingle` で `parseInline(label)` を子にする | 2章の既知の差異を解消する |
| Decoration の記号追加（`-` / `_` など） | `bracket.go` の記号表を frontend の `MARKS` と揃えて拡張 | frontend が先 |
| 上記以外の `[...]` の意味付け | `parseSingle` は既に全種別を葉ノードにしている。使う側が `Kind` を見るだけ | `DecideBracket` は全種別を分類済み |

新しい構文を足すたびに、frontend のテストケースを backend にも移植する。

## 8. Markdown 対応の方針

将来 Markdown を扱いたくなった場合は、**ノートのパーサに Markdown を混ぜず、インポート時の一方向の変換として扱う**。

- Markdown ファイル（またはインポート元のテキスト）を goldmark でパースし、AST を辿って Cardpod 記法のテキストへ書き出す。
- 変換器はノートのパーサとは別のパッケージにする（例: `internal/mdimport`）。goldmark に依存するのはそこだけになる。
- 変換結果は普通の Cardpod テキストとして保存されるので、frontend とのlockstep の対象は増えない。
- 具体的な変換規則（見出し・箇条書き・リンクなど）は、必要になった時点で決める。今は決めない。

## 9. 検討した選択肢（記録）

- **goldmark v2 を土台にする**: CommonMark のパーサをすべて外すと残る価値が小さく、「1行=1ブロック」「インデント=箇条書き」が
  CommonMark の前提と逆になる。公開 API にはサブ範囲を再帰パースする手段が見当たらず、Decoration / Strong の中身の再帰が難しい。
  Markdown 対応をインポート方式にするなら、ノートのパーサに組み込む理由がない。
- **パーサコンビネータライブラリ（`go-parser-combinators`）**: 再帰は素直に書けるが、ブロック層は結局ループと状態で書くことになり、
  コンビネータが効くのはインライン層の数ルールだけ。frontend の Lezer の契約とも書き方が違い、個人メンテの依存も増える。
- **`auvred/regonaut`（ECMAScript 正規表現エンジン）**: `\s` の判定だけなら標準ライブラリで正確に書ける（3.7）。本番コードには採用せず、テストでの照合に使うかを Phase 1 で決める。
- **手書きの再帰下降パーサ（採用）**: 既存のスキャナが既に Lezer の契約で書かれており、AST 化とファイル分割で済む。外部依存がなく、
  再帰は部分文字列への関数呼び出しで済む。

## 10. リスク・注意点

- **frontend との乖離**: 手書きなので、frontend に構文が増えても自動では追従しない。3.8 の lockstep 規約と、テストケースの移植で防ぐ。
- **インデント定義の二重管理**（3.7）: frontend/backend の両方に存在する。片方を変えたら両方直す。
- **`DecideBracket` は純粋関数のまま保つ**: パーサの型に依存させない。frontend との対応とテスト容易性のため。
- **文法が大きくなった場合**: ブロック構文が大幅に増えたり、位置情報つきの厳密なエラー報告が要るようになったら、
  そのときにコンビネータや生成系を再検討する。ルールの契約（3.3）と公開 API（3.1）を保っておけば、差し替えは内部で完結する。
