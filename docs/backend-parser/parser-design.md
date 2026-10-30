# `internal/parser` 設計書 — 手書き再帰下降パーサの骨格（Phase 1）

対象読者: `internal/parser` を実装・保守する開発者。この文書だけで Phase 1 の実装に着手できることを目的とする。
移行計画（どの順で `internal/notation` から置き換えるか）は別の文書にあり、ここでは扱わない。

## 0. 何を作るのか

Aspen のカード本文は Scrapbox/Cosense 互換のテキスト記法で書かれる。フロントエンドは Lezer で解析しているが、
バックエンドにも同じ規則で本文を解析するパーサが必要で、次の3つを取り出せればよい。

1. **タイトル**: 1行目
2. **wikilink**: `[title]` のタイトル（ただし、コードブロック・インラインコードの中は除く）
3. **画像**: 本文中の最初の画像の URL

必要になったら構文を足せることは要件だが、**今は足さない**。この文書の設計は「小さく作り、同じ形で育てられること」を優先する。

### 0.1 Phase 1 のスコープ

| 構文 | Phase 1 | 備考 |
| --- | --- | --- |
| Title（1行目） | 実装する | 記法を解釈しない生テキスト |
| Line（1行=1ブロック） | 実装する | 空白のみの行はノードを作らない |
| CodeBlock（`code:`） | 実装する | 中身は生テキスト。wikilink・画像を無視するため |
| InlineCode（`` `x` ``） | 実装する | 同上 |
| Decoration（`[* x]` `[/ x]` `[*/ x]`） | 実装する | 中身を再帰解析する |
| Strong（`[[x]]`） | 実装する | 中身を再帰解析する。中身が画像・アイコンなら葉 |
| Blank（`[ ]`） | 実装する | WikiLink との誤認を防ぐ |
| 単括弧 `[...]` | 実装する | 内容を分類し、WikiLink / Image / LinkedImage / その他（不透明な葉）にする |
| Quote / Table / HashTag / Helpfeel / CommandLine / NumberList | **しない** | 9章の手順で足せる形にしておく |

### 0.2 非目標

- ソース位置（バイトオフセット）を持たない。バックエンドでは使わない（9章に追加方法がある）。
- エラーを返さない。`Parse` はどんな入力でも必ず成功する（3.7）。
- Markdown を解釈しない。

## 1. 設計の全体像

```
text ──▶ Parse ──▶ Note{Nodes}
          │
          ├─ ブロック層 (block.go)   : 行を1本ずつ読み、行頭の形でブロックを決める
          └─ インライン層 (inline.go): 1行の中を左から右へ、各位置で規則を試す
                                       └─ 一部の規則は自分の内容を再帰的にインライン層へ渡す
```

- **2層構造**。ブロック層は行の単位、インライン層は文字位置の単位。フロントエンド（Lezer の `parseBlock` / `parseInline`）と同じ。
- **各規則は小さな関数**で、「ここから始まる自分の記法か」を判定し、そうなら「消費した終端」を返す。そうでなければ何も返さない（呼び出し側が次を試す）。
- **木は疎**。記法にマッチしたところだけがノードになり、普通のテキストはノードにならない（Lezer の木も同じ）。
- 依存は標準ライブラリだけ。パッケージ変数は持たない（コンパイル済み正規表現を除く）ので、複数の goroutine から同時に呼んでよい。

## 2. 公開 API

呼び出し側（`internal/wikilink`、`internal/serve`）が見るのは次の5つだけ。ノードの内部構造には依存させない。

```go
// Note is a parsed card text. Parse receives the whole document: telling the
// title line apart from the body is the parser's job, not the caller's.
type Note struct {
	Nodes []*Node // the whole document in order; the title line, if any, is the first node
}

// Parse never fails and never panics, whatever the input.
func Parse(text string) *Note

// Title returns the raw title line, or "" when the first line is blank.
func (n *Note) Title() string

// WikiLinkTitles returns the raw title of every wiki link, in document order.
// The title line is never scanned: it is a leaf Title node.
func (n *Note) WikiLinkTitles() []string

// FirstImageSrc returns the src of the first image notation, or "".
func (n *Note) FirstImageSrc() string

// String renders the tree shape, e.g. "Document(Title,Line(WikiLink,InlineCode))".
func (n *Note) String() string
```

`String` はテスト用（4.1）。`Walk`（3.1）も公開するが、呼び出し側が使う想定ではない。

## 3. データモデル（`nodes.go`）

### 3.1 Node

```go
// Kind identifies what a Node represents.
type Kind string

const (
	// Blocks.
	KindTitle     Kind = "Title"
	KindLine      Kind = "Line"
	KindCodeBlock Kind = "CodeBlock"

	// Inline notation.
	KindInlineCode Kind = "InlineCode"
	KindDecoration Kind = "Decoration"
	KindStrong     Kind = "Strong"
	KindBlank      Kind = "Blank"

	// Bracket notation. These are also the values DecideBracket returns.
	KindWikiLink     Kind = "WikiLink"
	KindImage        Kind = "Image"
	KindLinkedImage  Kind = "LinkedImage"
	KindExternalLink Kind = "ExternalLink"
	KindMath         Kind = "Math"
	KindIcon         Kind = "Icon"
	KindProjectLink  Kind = "ProjectLink"
	KindGoogleMap    Kind = "GoogleMap"
)

type Node struct {
	Kind     Kind
	Text     string  // Title: raw line; WikiLink: title; Image, LinkedImage: src; other bracket kinds: raw content
	Children []*Node // Line, Decoration and Strong only
}
```

設計上の決定:

- **構造体1つ + `Kind`**。型ごとのインターフェースにしない。木の走査・出力・テストが一様に書ける。
- **`Kind` は文字列**。テストの失敗メッセージやログでそのまま読める。
- **`Text` は種別ごとの「主な中身」**。構文が増えて足りなくなったら、その時点でフィールドを足す（`Href`、`Label` など）。
- **子を持つのは `Line` / `Decoration` / `Strong` だけ**（不変条件 I4）。`Strong` は `[[text]]` の中身（`[[image]]` なら `Image` ノード1つ）を子に持つ。
- 木は構築後に変更しない（読み取り専用として扱う）。

`[[https://…/a.png]]` は `Strong(Image)`、`[[me.icon]]` は `Strong(Icon)` になる。フロントエンドの `Strong(StrongMark, StrongImage, StrongMark)` に対応し、
大きく表示する構文であることは親の `Strong` が表す。ソースの `[` `]` などの区切り文字は、バックエンドでは使わないのでノードにしない。

### 3.2 木の走査

```go
// Walk calls fn for every node in document order (a node before its children).
// It stops as soon as fn returns false, and reports whether it ran to the end.
func (n *Note) Walk(fn func(*Node) bool) bool { return walkNodes(n.Nodes, fn) }

func walkNodes(nodes []*Node, fn func(*Node) bool) bool {
	for _, n := range nodes {
		if !fn(n) || !walkNodes(n.Children, fn) {
			return false
		}
	}
	return true
}
```

`WikiLinkTitles` と `FirstImageSrc` は `Walk` だけで書ける。タイトル行の除外は特別扱いではなく、`Title` ノードが子を持たず `KindWikiLink` でもないことから自然に決まる。

```go
func (n *Note) WikiLinkTitles() []string {
	var titles []string
	n.Walk(func(x *Node) bool {
		if x.Kind == KindWikiLink {
			titles = append(titles, x.Text)
		}
		return true
	})
	return titles
}

func (n *Note) FirstImageSrc() string {
	src := ""
	n.Walk(func(x *Node) bool {
		if x.Kind == KindImage || x.Kind == KindLinkedImage {
			src = x.Text
			return false
		}
		return true
	})
	return src
}
```

### 3.3 木の文字列表現

```go
func (n *Node) String() string {
	if len(n.Children) == 0 {
		return string(n.Kind)
	}
	parts := make([]string, len(n.Children))
	for i, c := range n.Children {
		parts[i] = c.String()
	}
	return string(n.Kind) + "(" + strings.Join(parts, ",") + ")"
}

func (n *Note) String() string {
	parts := make([]string, len(n.Nodes))
	for i, c := range n.Nodes {
		parts[i] = c.String()
	}
	return "Document(" + strings.Join(parts, ",") + ")"
}
```

形式はフロントエンドのテストが使う Lezer の `tree.toString()`（`Document(Paragraph(WikiLink(…)))`）に合わせてある。
ノードの名前と、区切り文字のノードがないことは違うが、テストケースを見比べて移植できる。

## 4. 規則の契約

### 4.1 インライン規則

```go
// An inlineRule tries to parse a notation that starts at s[pos]. On success it
// returns the node and end, the position just after the notation
// (pos < end <= len(s)). On failure it returns a nil node and the caller
// retries at the next position.
type inlineRule func(s string, pos int) (n *Node, end int)
```

- 失敗は `nil` で表す（`ok bool` は要らない）。成功したのに `nil` を返すことはない。
- 規則は**入力だけに依存する純粋関数**で、失敗しても何も変えない（副作用がない）。
- 位置は**バイト位置**。トリガー文字（`[`、`` ` ``）はすべて ASCII で、UTF-8 の後続バイトは常に 0x80 以上なので、バイト単位で走査しても安全（不正な UTF-8 でも同じ）。
- ある位置で規則が失敗したら、呼び出し側は1バイト進めて再試行する（Lezer と同じ）。したがって `[[unterminated]` は、先頭の `[` が失敗しても、2つ目の `[` から WikiLink として拾われる。

### 4.2 ブロック規則

```go
// A blockRule tries to parse a block that starts at the cursor's current line.
// It returns nil and leaves the cursor untouched when the line is not its
// notation. On success it returns the node, with the cursor moved past the
// last line it consumed (at least one).
type blockRule func(c *cursor) *Node
```

- 規則は複数行を消費してよい（`code:` など）。**ブロックの終端になった行は消費せず、現在行のまま残す**。その行は次のブロックとして再ディスパッチされる。
- 空白のみの行は、規則に渡される前にループが読み飛ばす（5.1）。規則は空白のみの行を気にしなくてよい。

### 4.3 不変条件

実装とテストの拠り所。テスト（10章）で機械的に確認する。

| # | 不変条件 |
| --- | --- |
| I1 | `Parse` はどんな入力でも panic せず、必ず終了する。同じ入力からは同じ木ができる |
| I2 | インライン規則が成功したら `pos < end <= len(s)` |
| I3 | ブロック規則が失敗したらカーソルは動かない。成功したら1行以上進む |
| I4 | `Line` / `Decoration` / `Strong` 以外のノードは子を持たない |
| I5 | `Title` ノードは、あるとすれば `Nodes` の先頭に1つだけ |
| I6 | `WikiLink` ノードの `Text` は空でない |

## 5. ブロック層（`block.go`, `title.go`）

### 5.1 ループ

文書を行に分け、カーソルで1回だけ前から読む。**状態を持つのはカーソルだけ**（`code:` の途中かどうかを外の変数に持たない。規則が自分で行を消費する）。

```go
// cursor walks the lines of a document.
type cursor struct {
	lines []string
	i     int
}

func (c *cursor) done() bool   { return c.i >= len(c.lines) }
func (c *cursor) line() string { return c.lines[c.i] }
func (c *cursor) next()        { c.i++ }

// blockRules are the notations that claim a whole line or several lines. The
// order is the priority; a line no rule claims is a plain Line.
var blockRules = []blockRule{
	parseTitle, // must stay first: no other rule may see the first line
	parseCodeBlock,
}

func parseBlocks(lines []string) []*Node {
	c := &cursor{lines: lines}
	var nodes []*Node
	for !c.done() {
		start := c.i
		if isBlank(c.line()) {
			c.next() // blank lines produce no node
		} else if n := tryBlockRules(c); n != nil {
			nodes = append(nodes, n)
		} else {
			nodes = append(nodes, parseLine(c))
		}
		if c.i == start {
			c.next() // a rule that consumed nothing is a bug; never loop forever
		}
	}
	return nodes
}

func tryBlockRules(c *cursor) *Node {
	for _, rule := range blockRules {
		if n := rule(c); n != nil {
			return n
		}
	}
	return nil
}

// parseLine is the fallback: one non-blank line becomes one Line whose
// children are the inline notations found in it.
func parseLine(c *cursor) *Node {
	n := &Node{Kind: KindLine, Children: parseInline(c.line())}
	c.next()
	return n
}
```

`Parse` は `parseBlocks(strings.Split(text, "\n"))` を呼ぶだけ。エディタが作る改行は `\n` で、`\r` が残っても `\r` は空白（`\s`）なので害はない。

### 5.2 タイトル規則

```go
// parseTitle claims the first line of the document. The title is plain text:
// no block or inline notation is interpreted in it, so `code:` does not open a
// block and `[page]` is not a link. A blank first line never reaches this rule
// (the loop skips it), so it produces no Title, and the second line is body
// text, not a title.
func parseTitle(c *cursor) *Node {
	if c.i != 0 {
		return nil
	}
	n := &Node{Kind: KindTitle, Text: c.line()}
	c.next()
	return n
}
```

- `Text` は**生の行そのもの**（先頭の空白も含む）。サーバ側のタイトル解決（重複の連番付けなど）はこの生テキストを受け取る。
- 1行目は他のどの規則にも見せない。`blockRules` の先頭に置くのは、そのため。

### 5.3 コードブロック規則と共通ヘルパー

```go
// parseCodeBlock handles "code:name" and the lines indented deeper than it.
// The body is raw text: nothing in it is parsed.
func parseCodeBlock(c *cursor) *Node {
	depth, offset := measureIndent(c.line())
	if !strings.HasPrefix(c.line()[offset:], "code:") {
		return nil
	}
	c.next()
	bodyLines(c, depth)
	return &Node{Kind: KindCodeBlock}
}

// bodyLines consumes and returns the lines that follow a block declaration at
// the given indent depth: every line indented deeper than depth. The first line
// that is not deeper stays current, so it is dispatched as the next block.
func bodyLines(c *cursor, depth int) []string {
	start := c.i
	for !c.done() {
		if d, _ := measureIndent(c.line()); d <= depth {
			break
		}
		c.next()
	}
	return c.lines[start:c.i]
}
```

- 終端の判定は `深さ <= 宣言の深さ`（フロントエンドの `consumeIndentedLines` と同じ）。**完全に空の行は深さ 0 で終端になる**。
  空白だけの行は、空白の文字数が深さになる。宣言より深ければ本文に含まれる。
- `bodyLines` は今は結果を捨てているが、Table（9章）が同じ関数で本文の行を受け取る。

## 6. インライン層（`inline.go`, `inlinecode.go`, `bracket.go`）

### 6.1 ループとディスパッチ

```go
// parseInline tries the rules at every position of s, like Lezer does.
func parseInline(s string) []*Node {
	var nodes []*Node
	for pos := 0; pos < len(s); {
		n, end := parseAt(s, pos)
		if n == nil || end <= pos {
			pos++
			continue
		}
		nodes = append(nodes, n)
		pos = end
	}
	return nodes
}

// parseAt dispatches on the trigger byte. Rules that share a trigger are tried
// in priority order inside their own function (see parseBracket); rules with
// different triggers cannot compete, since the leftmost notation always wins.
func parseAt(s string, pos int) (*Node, int) {
	switch s[pos] {
	case '[':
		return parseBracket(s, pos)
	case '`':
		return parseInlineCode(s, pos)
	}
	return nil, 0
}

var (
	_ inlineRule = parseBracket
	_ inlineRule = parseInlineCode
)
```

- **再帰は部分文字列への `parseInline` 呼び出し**で表す。フロントエンドの `cx.parser.parseInline(content, offset)` と等価で、
  「文脈の先頭（`pos == 0`）は境界として扱う」といった規則もそのまま揃う（HashTag で効く）。
- 優先順位が意味を持つのは、**同じトリガーを共有する規則の間だけ**。今は `[` だけで、その順序は `parseBracket` の中に書く。

### 6.2 インラインコード

```go
// parseInlineCode handles `code`: everything up to the next backtick, which is
// raw text and never parsed. Mirrors rules/inlineCode.ts.
func parseInlineCode(s string, pos int) (*Node, int) {
	n := strings.IndexByte(s[pos+1:], '`')
	if n < 0 {
		return nil, 0
	}
	return &Node{Kind: KindInlineCode}, pos + 1 + n + 1
}
```

### 6.3 `[` の規則（`bracket.go`）

`[` で始まる記法は1つの入口にまとめ、規則を次の順に試す。フロントエンドは Decoration → Blank → Bracket を別の規則としているが、
バックエンドは「対応する `]` を探す処理」を共有できるので1か所にまとめる。

```go
func parseBracket(s string, pos int) (*Node, int) {
	if n, end := parseDecoration(s, pos); n != nil {
		return n, end
	}
	if n, end := parseBlank(s, pos); n != nil {
		return n, end
	}
	if pos+1 < len(s) && s[pos+1] == '[' {
		return parseStrong(s, pos) // "[[" is only ever Strong; it does not fall back to a single bracket
	}
	return parseSingle(s, pos)
}
```

**対応する `]` の探索**（ネストの深さを数える。全規則で共有）:

```go
// matchingBracket returns the index of the "]" that closes a "[" whose content
// starts at from, or -1.
func matchingBracket(s string, from int) int {
	depth := 0
	for i := from; i < len(s); i++ {
		switch s[i] {
		case '[':
			depth++
		case ']':
			if depth == 0 {
				return i
			}
			depth--
		}
	}
	return -1
}
```

**Decoration** — `[*/ text]`: 装飾文字（今は `*` と `/`）を1つ以上、空白1つ、空でない本文、`]`。本文は再帰解析する。

```go
func parseDecoration(s string, pos int) (*Node, int) {
	i := pos + 1
	for i < len(s) && (s[i] == '*' || s[i] == '/') {
		i++
	}
	if i == pos+1 || i >= len(s) || s[i] != ' ' {
		return nil, 0
	}
	from := i + 1
	end := matchingBracket(s, from)
	if end < 0 || end == from {
		return nil, 0
	}
	return &Node{Kind: KindDecoration, Children: parseInline(s[from:end])}, end + 1
}
```

**Blank** — `[ ]`: 空白のみの、空でない内容。最初の `]` までで、ネストは数えない。

```go
func parseBlank(s string, pos int) (*Node, int) {
	n := strings.IndexByte(s[pos+1:], ']')
	if n <= 0 || !isBlank(s[pos+1:pos+1+n]) { // n == 0 is "[]": empty content is not a blank
		return nil, 0
	}
	return &Node{Kind: KindBlank}, pos + 1 + n + 1
}
```

**Strong** — `[[text]]`: 内側の `[` に対応する `]` の直後に、もう1つ `]` が続く。中身が画像・アイコンなら葉、それ以外は再帰解析。

```go
func parseStrong(s string, pos int) (*Node, int) {
	from := pos + 2
	inner := matchingBracket(s, from)
	if inner < 0 || inner == from || inner+1 >= len(s) || s[inner+1] != ']' {
		return nil, 0
	}
	content := s[from:inner]
	end := inner + 2
	switch d := DecideBracket(content); d.Kind {
	case KindImage, KindIcon:
		return &Node{Kind: KindStrong, Children: []*Node{bracketNode(d, content)}}, end
	}
	return &Node{Kind: KindStrong, Children: parseInline(content)}, end
}
```

**単括弧** — `[content]`: 対応する `]` を先に見つけ、内容を分類してからノードにする。

```go
func parseSingle(s string, pos int) (*Node, int) {
	end := matchingBracket(s, pos+1)
	if end < 0 || end == pos+1 {
		return nil, 0
	}
	content := s[pos+1 : end]
	return bracketNode(DecideBracket(content), content), end + 1
}

// bracketNode builds the node for a classified bracket. WikiLink and the
// opaque kinds keep the raw content; images keep their src.
func bracketNode(d Decision, content string) *Node {
	if d.Kind == KindImage || d.Kind == KindLinkedImage {
		return &Node{Kind: d.Kind, Text: d.Src}
	}
	return &Node{Kind: d.Kind, Text: content}
}
```

`WikiLink` の中身は再帰解析しない（`[a [b] c]` は1つの WikiLink で、内側の `[b]` はノードにならない）。
Math・Icon・ProjectLink・GoogleMap・ExternalLink は「範囲を消費して種別を残すだけの葉」で、WikiLink と誤認されないためにある。

### 6.4 分類（`decide.go`）

```go
type Decision struct {
	Kind Kind   // WikiLink, Image, LinkedImage, ExternalLink, Math, Icon, ProjectLink or GoogleMap
	Src  string // Image and LinkedImage only
}

// DecideBracket classifies non-empty bracket content. It is a pure function of
// the string and knows nothing about the parser's types.
func DecideBracket(content string) Decision
```

判定は次の順で、最初に当てはまったものが勝つ（フロントエンド `rules/bracket.ts` の `decideBracketNodeType` と同じ）。

| 順 | 条件 | 結果 |
| --- | --- | --- |
| 1 | `$ ` で始まる | Math |
| 2 | `名前.icon` / `名前.icon*N`（N ≥ 1） | Icon |
| 3 | `/project` / `/project/page` | ProjectLink |
| 4 | 全体・先頭トークン・末尾トークンのいずれかが座標（`N35.6,E139.7[,Z14]`） | GoogleMap |
| 5 | スペースなし・画像 URL | Image（`Src` = 内容） |
| 6 | スペースなし・画像でない URL | ExternalLink |
| 7 | スペースがちょうど1つで、両側が URL かつ少なくとも一方が画像 | LinkedImage |
| 8 | 先頭トークンが画像でない URL | ExternalLink |
| 9 | 末尾トークンが URL | ExternalLink |
| 10 | それ以外 | WikiLink |

- 「URL」は `://` を含み URL として解釈できるもの。「画像 URL」は Gyazo か、パスの拡張子が画像（png, jpg, gif, svg, webp など）。
- **LinkedImage の `Src`**: 両方が画像なら**先頭のトークン**、片方だけが画像ならその画像のトークン（フロントエンドは `firstKind === "image" ? first : last`。cosy は末尾を取るが、フロントエンドを正とする）。
- URL と見なせるのは先頭と末尾のトークンだけ。3トークン以上なら、間は URL 候補にならない（`[a.png mid https://x/]` は LinkedImage ではなく ExternalLink）。
- 既存の `notation.DecideBracketKind` から、判定ロジックと正規表現をそのまま移し、`Src` を追加する。

### 6.5 インデントと空白（`indent.go`）

```go
// isJSSpace reports whether r matches ECMAScript's `\s`.
func isJSSpace(r rune) bool {
	return unicode.Is(unicode.Zs, r) || strings.ContainsRune("\t\n\v\f\r\u2028\u2029\uFEFF", r)
}

// measureIndent returns the number of leading whitespace characters (the
// indent depth: one character is one level, whatever it is) and the byte
// offset where the content starts. A whitespace-only line has depth
// len(line in characters) and offset len(line).
func measureIndent(line string) (depth, offset int) {
	for i, r := range line {
		if !isJSSpace(r) {
			return depth, i
		}
		depth++
	}
	return depth, len(line)
}

// isBlank reports whether s is empty or only whitespace.
func isBlank(s string) bool {
	_, offset := measureIndent(s)
	return offset == len(s)
}
```

- インデントの深さは**文字数**（タブも全角スペースも1）。表示幅ではない。フロントエンドの `indent.ts` と同じ定義で、片方を変えたら両方直す。
- Go の `regexp` の `\s` は ASCII のみ、`unicode.IsSpace` は U+0085 を含み U+FEFF を含まない。どちらも ECMAScript の `\s` と一致しないので使わない。
- **`isBlank("")` は true**（空行は空白のみの行）。一方 Blank 記法（`[ ]`）は「空でない」空白が条件で、`parseBlank` が `n <= 0` で別に弾いている。混同しやすい。

## 7. ファイル構成と依存

```
internal/parser/
├── parser.go       # Parse, Note, Title, WikiLinkTitles, FirstImageSrc
├── nodes.go        # Kind, Node, Walk, String
├── block.go        # cursor, blockRule, parseBlocks, parseLine, parseCodeBlock, bodyLines
├── title.go        # parseTitle                          (mirrors rules/title.ts)
├── inline.go       # inlineRule, parseInline, parseAt
├── inlinecode.go   # parseInlineCode                     (mirrors rules/inlineCode.ts)
├── bracket.go      # parseBracket and its four rules     (mirrors rules/decoration.ts, blank.ts, bracket.ts)
├── decide.go       # Decision, DecideBracket             (mirrors decideBracketNodeType)
├── indent.go       # isJSSpace, measureIndent, isBlank   (mirrors indent.ts)
└── *_test.go
```

依存の向き（循環しない）:

```
parser.go ──▶ block.go ──▶ inline.go ──▶ bracket.go ──▶ decide.go
                 │             │             │
                 └─────────────┴─────────────┴──▶ indent.go, nodes.go
```

- `decide.go` と `indent.go` は他のファイルに依存しない（`Kind` の定数を除く）。単体でテストできる。
- パッケージ全体が PocketBase などに依存しない。

## 8. 設計上の判断と、退けた案

| 判断 | 退けた案 | 理由 |
| --- | --- | --- |
| 規則は「位置を受け取り、終端かなしを返す」関数 | パーサコンビネータ / goldmark の Parser インターフェース | フロントエンドの契約と同じ形になり、規則を1つずつ対応させて移植できる。再帰は関数呼び出しで済む |
| 疎な木（テキストのノードを作らない） | テキストも含む完全な木 | 目的は記法の取り出し。Lezer の木も同じ |
| 再帰は**部分文字列**を渡す | 元の文字列と範囲 `[from,to)` を渡す | フロントエンドの `parseInline(content, offset)` と意味が揃う（文脈の先頭が境界になる）。位置が要るときは offset を足す（9章） |
| ブロックは「カーソル + 規則のリスト + 既定の Line」 | ループ内の状態変数（`codeIndent`）と `switch` | 複数行の規則が自分で行を消費するので、Table・Quote を足すときもループに触れない |
| 空白のみの行はループが飛ばす | 各規則が処理する | 規則が単純になる。フロントエンドの Paragraph 規則が空白行を消費するのと結果が同じ |
| タイトルは規則の1つ（先頭の行だけ claim） | 呼び出し側が文書を切り分けてから渡す | 「タイトルとは何か」の定義をパーサ1か所に集める |
| トリガー文字の `switch` | 規則の配列を全部試す | 速く、どの文字がどの規則を起こすか一目で分かる |
| エラーを返さない | `(Note, error)` | 未知の記法は普通のテキスト。どんな入力でも構文木にできる |

## 9. 拡張の作法

新しい構文を足すときは、**フロントエンドの該当する規則を見て、1ファイルと分岐1つを足す**。すべてこの骨格の中で済む。

| 構文 | 足すもの | 注意 |
| --- | --- | --- |
| HashTag | `hashtag.go` と `parseAt` の `case '#'` | 文脈の先頭（`pos == 0`）か空白の直後だけ（直前の文字は `utf8.DecodeLastRuneInString(s[:pos])` で見る）。`#a[b]` のようにタグの中の括弧を消費するので、wikilink の結果が変わる |
| Quote | `blockRules` に規則（`>` で始まる行）。既定の `Line` の前 | 中身は今まで通り `parseInline` |
| Table | `blockRules` に規則。`bodyLines` の各行を `strings.Split(row, "\t")` で分け、セルごとに `parseInline` | 括弧がセルをまたがなくなる。`table:` の宣言行は解析しない |
| Helpfeel / CommandLine / NumberList | `blockRules` に各規則 | 行頭の接頭辞で決まる |
| ラベル付き ExternalLink のラベル内の記法 | `Decision` に `Label` を足し、`parseSingle` でラベルを `parseInline` して `Children` にする | `Children` を持てる種別が増えるので I4 を更新 |
| Decoration の記号追加（`-` など） | `parseDecoration` の記号判定 | フロントエンドが先 |
| インデントの深さ（箇条書き） | `Line` にフィールドを足し、`parseLine` で `measureIndent` の結果を入れる | フロントエンドの `Indent` ノードに対応 |
| ソース位置 | `Node` に `From`/`To`。`parseInline(s string, base int)` に変え、再帰のときは `base + from` を渡す。ブロック層は行の先頭のオフセットを持つ | 再帰の入口が `parseInline` の1点なので、変更は局所的 |

新しい規則を足すたびに、フロントエンドのテストケースをバックエンドにも移植する。

## 10. テスト戦略

### 10.1 形のテスト

木の形を `Note.String()` で比較する表形式のテスト。フロントエンドの `index.test.ts` と同じ手法で、ケースを見比べて移植できる。
1行目はタイトルになるので、本文の記法を試すときは先頭に捨てのタイトル行を足すヘルパーを使う（フロントエンドの `TITLE_LINE` と同じ）。

```go
const titleLine = "T\n"

func body(t *testing.T, text string) string {
	t.Helper()
	// Drop the Title so cases only describe the notation under test.
	return strings.Replace(Parse(titleLine+text).String(), "Document(Title,", "Document(", 1)
}
```

ケースの出典:

- `internal/notation` の `wikilink_test.go` と `bracket_test.go` の全ケース（`WikiLinkTitles()` と `DecideBracket` の期待値に読み替える）
- フロントエンドの `parser/aspen/index.test.ts` と `rules/title.test.ts`
- 画像: 通常 / Linked / `[[image]]`（`Strong(Image)`）、`code:` ブロック内、インラインコード内、Decoration 内、複数あるとき先頭が返ること、タイトル行内は無視されること
- タイトル: 1行だけの文書、2行目以降が本文、タイトル行の記法が解釈されないこと（`[page]`、`code:`）、1行目が空白のみ（半角・全角）なら `Title()` が空でノードも作られず2行目もタイトルにならないこと、先頭の空白が保たれること

### 10.2 単体テスト

- `DecideBracket`: 6.4 の表の各行と、`Src` の期待値（両方が画像の LinkedImage は先頭）
- `isJSSpace`: 全コードポイント（0〜0x10FFFF）を ECMAScript の `\s` と突き合わせる。方式は次のいずれか。
  - `auvred/regonaut` をテストだけの依存にして、`/\s/u` と比較する
  - フロントエンド側（bun）で `\s` にマッチするコードポイントの一覧を一度生成し、テストデータとして置く
- `measureIndent` / `isBlank`: 空文字列、空白のみ、タブ・半角・全角の混在

### 10.3 Fuzz テストと不変条件

標準の `testing` の Fuzz で I1〜I6 を確認する。追加の依存は要らない。

```go
func FuzzParse(f *testing.F) {
	f.Add("T\n[a] `b` [* [c]]\ncode:x\n\t[d]\n[[me.icon]] [ ] [[[x]]")
	f.Fuzz(func(t *testing.T, text string) {
		a := Parse(text) // must terminate and not panic (I1)
		if a.String() != Parse(text).String() {
			t.Fatal("not deterministic")
		}
		checkInvariants(t, a) // I4, I5, I6
		_ = a.WikiLinkTitles()
		_ = a.FirstImageSrc()
	})
}
```

I2 と I3 は規則ごとの単体テストと、`parseInline` / `parseBlocks` の進行の保証（`end <= pos` や消費なしを進める分岐）で守る。

### 10.4 将来: フロントエンドとの共有コーパス

「入力 → タイトル・wikilink・最初の画像」を1つのテストデータファイルにして、Go とフロントエンド（Lezer の木から wikilink を集めて比較）の両方が読めば、
lockstep が「手作業の移植」から「同じデータを両方が満たす」ことに変わる。Phase 1 のスコープ外。

## 11. 既知の性質と限界

- **計算量**: 対応する `]` の探索は、その位置から行末まで走査する。`[* ` を閉じずに大量に並べたような1行では、位置ごとに行末まで走査するので行の長さの2乗に近づく。
  フロントエンドの解析も同じ性質。実際のノートの行は短く問題にならないが、問題になったら、1行につき1回、スタックで `[` と `]` の対応表を作る方法で線形にできる
  （対応関係は今の探索と同じ結果になる）。それまでは行の長さに上限を設けない。
- **フロントエンドとの差異**（直近のスコープの外）:
  - ラベル付き外部リンクのラベル内の wikilink を拾わない（`[https://x/ see [page]]`）
  - `#a[b]` はフロントエンドでは1つのハッシュタグで wikilink はないが、バックエンドは `[b]` を wikilink として拾う（HashTag は数行なので、必要になったら最初に足す）
  - Table のセル境界をまたぐ括弧と、`table:` 宣言行の中の記法
- **インデントの二重管理**: フロントエンドの `indent.ts` と同じ定義が必要。片方を変えたら両方直す。
- **lockstep**: 手書きなので、フロントエンドに構文が増えても自動では追従しない。10章のテストの移植と、各ファイル冒頭の「どの rules に対応するか」のコメントで防ぐ。

## 12. 実装の順序

各段階で `go test ./...` が通る状態にする。

1. `nodes.go`（`Kind`, `Node`, `Walk`, `String`）と `indent.go`（`isJSSpace`, `measureIndent`, `isBlank`）＋そのテスト
2. `decide.go`: `notation` から判定ロジックを移し、`Decision` と `Src` を追加＋テスト
3. `inline.go` と `inlinecode.go`（空の `parseBracket` を置き、`parseInline` を通す）
4. `bracket.go`: `matchingBracket` → `parseSingle` → `parseBlank` → `parseDecoration` → `parseStrong` の順
5. `title.go` と `block.go`（`cursor`, `parseBlocks`, `parseLine`, `parseCodeBlock`, `bodyLines`）
6. `parser.go`: `Parse`, `Title`, `WikiLinkTitles`, `FirstImageSrc`
7. 10.1 のテストケースの移植、Fuzz テスト、`isJSSpace` の照合テスト

### 完了条件

- `notation` の全テストケースが、`internal/parser` の同等のテストとして通る（WikiLink の結果が一致する）
- 10章のテストがすべて通り、Fuzz を一定時間（例: 数分）回しても不変条件が破れない
- 呼び出し側（`internal/wikilink`、`internal/serve`）はまだ変更していない。`internal/notation` もまだ削除しない
