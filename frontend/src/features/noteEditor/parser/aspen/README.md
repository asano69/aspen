# Aspen パーサ構造ガイド

「どのファイルが何を担当し、テキストがどのように構文木になるか」を把握するためのガイド

## 1. 概要

- ノート本文は CodeMirror 6 上のプレーンテキスト（Yjs の `Y.Text`）で、記法は Scrapbox/Cosense 互換。
- パーサは `@lezer/markdown` の**インクリメンタルなブロック/インライン基盤だけを再利用**している。CommonMark の文法はすべて `remove` し、Aspen 独自の規則を差し込む（`index.ts`）。
- 出力は Lezer の構文木。この木を表示層（`plugins/decorations/*`）と操作層（`plugins/interactions/*`）が読む。**パーサ自身は DOM も CodeMirror の View も知らない。**

パーサ全体を貫く前提は次の3つ。

| 前提 | 内容 |
| --- | --- |
| 1行 = 1ブロック | Lezer 標準の「隣接行を1つの Paragraph にまとめる」挙動は使わない。すべての行がアウトラインの1行として扱われる |
| インデント = 空白1文字 = 1レベル | ECMAScript の `\s`（タブ・半角スペース・全角スペースなど）1文字が1レベル。表示幅ではなく文字数で数える |
| 1行目 = カードのタイトル | 1行目は記法を一切解釈しないプレーンテキスト（サーバーが解決するタイトルと一致させるため） |

## 2. ファイル構成

```
parser/aspen/
├── index.ts            # パーサの組み立て（唯一の入口）
├── nodeProps.ts        # NodeProp の定義（表示層との契約）
├── indent.ts           # インデントの定義と測定
├── codeLanguages.ts    # code: ブロック内の言語別ハイライト（入れ子パース）
├── index.test.ts       # 構文木のテスト
└── rules/
    ├── title.ts        # [block]  1行目
    ├── paragraph.ts    # [block]  通常行（全行を受け止める最後の砦）
    ├── lineBlock.ts    # [block]  単一行ブロックの共通ヘルパー
    ├── quote.ts        # [block]  "> text"（lineBlock の利用例）
    ├── indentedBlock.ts# [block]  複数行ブロックの共通ヘルパー
    ├── codeBlock.ts    # [block]  "code:..." + 深いインデントの本文
    ├── table.ts        # [block]  "table:..." + タブ区切りの行
    ├── decoration.ts   # [inline] [* bold] [/ italic] [*/ both]
    ├── blank.ts        # [inline] [ ]
    ├── bracket.ts      # [inline] 角括弧の分類（リンク・画像・アイコンなど）
    ├── inlineCode.ts   # [inline] `code`
    ├── hashTag.ts      # [inline] #tag
    └── title.test.ts   # Title ルールのテスト（インクリメンタル再パース含む）
```

| ファイル | 責務 |
| --- | --- |
| `index.ts` | `parser.configure()` で CommonMark を外し、ノード定義・NodeProp・block/inline ルールの**登録と順序**を決める。ノード型（`Bold`, `WikiLink` …）を名前付きで export する |
| `nodeProps.ts` | `revealStyle` / `isMark` / `hideContent` / `isIndent`。表示層がノードを汎用的に扱うための目印 |
| `indent.ts` | `countIndent`, `isBlankLine`, `leadingIndentRange`, `indentRangeForLine`。インデントの定義はここ1か所 |
| `codeLanguages.ts` | `code:` ブロックの本文を、メタデータ（例 `code:ts`）に対応する言語パーサへ委譲する |
| `rules/*.ts` | 記法ごとの parse 関数。1ファイル1記法（共通ヘルパーを除く） |

## 3. 処理の流れ

```
document text
   │
   ▼  ブロック解析（1行ずつ。parseBlock 配列の先頭から試し、最初に true を返した rule が行を消費）
 Title → CodeBlock → Table → Quote → Paragraph（常に消費）
                                │        │
                                └── 行の残りを cx.parser.parseInline(text, offset) に渡す
   ▼
   インライン解析（1文字位置ずつ。parseInline 配列の先頭から試し、最初に成功した rule が範囲を確定）
 Decoration → Blank → Bracket → InlineCode → HashTag
```

- ブロック解析は **行単位**、インライン解析は **文字位置単位**。
- どちらも「先勝ち」なので、**`index.ts` の配列の並びが優先順位そのもの**になる。
- インライン解析は Paragraph・Quote・TableCell・Decoration/ExternalLink/Strong の内側から再帰的に呼ばれる。

## 4. ブロックレベル

### 4.1 ディスパッチ順序

`index.ts` の `parseBlock` 配列。

| 順 | 登録名 | rule | 担当 |
| --- | --- | --- | --- |
| 1 | `AspenTitle` | `title.ts` | 1行目（**必ず先頭。他の rule に1行目を見せない**） |
| 2 | `AspenCodeBlock` | `codeBlock.ts` | `code:` で始まる行と、それより深い行 |
| 3 | `AspenTable` | `table.ts` | `table:` で始まる行と、それより深い行 |
| 4 | `AspenQuote` | `quote.ts` | `>` で始まる行 |
| 5 | `AspenParagraph` | `paragraph.ts` | 上記以外すべて（空白のみの行も消費） |

parse 関数の契約（`(cx: BlockContext, line: Line) => boolean`）:

- **`false`**: 自分の担当ではない。何も消費してはいけない。
- **`true`**: 担当ブロックを消費した。**自分で `cx.nextLine()` を呼んで次の行へ進めておく**こと。
- 複数行ブロックは、終端となった行を「現在行」のまま残して `true` を返す。その行は次のブロックとして再ディスパッチされる。

> `CodeBlock` / `Table` には `endLeaf` も登録されているが、Paragraph ルールが全行を消費するため Lezer の「リーフブロックの蓄積」経路には到達せず、現状は実質使われない（防御的な登録）。

### 4.2 Title（`rules/title.ts`）

- 条件: `cx.lineStart === 0`（ドキュメント先頭）かつ空白のみでない。
- 生成: 子を持たない `Title` ノード。先頭の空白も、ブロック記法も、インライン記法も解釈しない。
- 1行目が空白のみなら `false` を返し、Paragraph ルールが（ノードを作らずに）消費する。次の行は本文であり、タイトルにはならない。
- 位置に依存するルールなので、編集後の**インクリメンタル再パース**でも正しいことをテストしている（`title.test.ts`）。

### 4.3 Paragraph（`rules/paragraph.ts`）

- 空白のみの行: ノードを作らずに `nextLine()` して `true`。
- それ以外: `Paragraph(Indent?, ...インライン)` を1行につき1つ作る。`Indent` は先頭空白の全範囲。残りは `cx.parser.parseInline(text, offset)` で解析する。
- 「常に `true` を返す」ので、これより後ろの rule は存在しない。新しい**ブロック**記法は Paragraph より前に置くこと。

### 4.4 単一行ブロック（`rules/lineBlock.ts` / `rules/quote.ts`）

「行頭の接頭辞を検出し、残りをインライン解析する」形の共通ヘルパー。

- `matchLineBlock(text)`: インデントを測った後、接頭辞を `code:` → `table:` → `>` → `? ` → `$ `/`% ` の順で判定する（Rust 版参照実装 `cosy` の `parse_block` と同じ順序）。
- `parseLineBlock(cx, line, definition)`: 判定結果の種別が `definition.kind` と一致した場合のみ、次の構造を作る。

```
<node>(Indent?, <mark>, ...インライン)   // <node> は行全体の範囲
```

- `trimFollowingSpace: true` の場合、接頭辞の直後の半角スペース1つは mark にも子にも含めない（Quote node の範囲には含まれる）。
- 現状の利用者は `quote.ts` のみ。Helpfeel（`? `）・CommandLine（`$ `/`% `）は接頭辞の判定だけ用意されており、ノード定義と rule が未実装のため Paragraph として扱われる。

### 4.5 複数行ブロック（`rules/indentedBlock.ts` / `codeBlock.ts` / `table.ts`）

宣言行（`code:...` / `table:...`）と、**宣言行より深いインデントが続く間**の行で1つのブロックを作る。閉じマーカーは無い。

- `startsIndentedBlock(line, prefix)`: 宣言行なら、そのインデント（文字数）を返す。違えば `null`。
- `consumeIndentedLines(cx, line, indent, consume)`: 次の行から `countIndent(line.text) <= indent` になるまで読み進め、各行の「宣言インデント + 1 文字を除いた残り」と、その文字位置を `consume` に渡す。終端行は現在行のまま残る。
- **空行（インデント0）は深さ判定で終端になる。** 空行を挟むとブロックは閉じる。

| ブロック | 構造 | 本文の扱い |
| --- | --- | --- |
| `CodeBlock` | `CodeBlock(Indent?, CodeBlockMark, Indent, Indent, ...)`（`Indent` は本文1行につき1つ） | 生テキスト。インライン解析しない |
| `Table` | `Table(Indent?, TableMark, TableRow(Indent, TableCell, ...), ...)` | 行を**タブ文字**で分割して `TableCell` にし、各セルをインライン解析する |

- `CodeBlockMark` / `TableMark` は宣言行の接頭辞以降（`code:ts` や `table:name` 全体）。`isMark` ではないので常に表示される。
- ブロック全体（`CodeBlock` / `Table`）の範囲は、最後に消費した行の末尾まで。

## 5. インデントモデル（`indent.ts`）

- 定義: `/^\s+/u` にマッチする先頭の空白。**文字数 = 深さ**（タブも全角スペースも1）。
- 各 rule はインデントを `Indent` ノード（`isIndent` 付き）として構文木に残す。表示層・操作層は生のテキストを再解釈せず、これを読む。

| 行の種類 | `Indent` の範囲 |
| --- | --- |
| Paragraph / Quote / `code:`・`table:` の宣言行 | 先頭空白の全範囲 |
| CodeBlock 本文行 / TableRow | 行頭から「宣言インデント + 1」文字。それより深い空白は本文（またはテーブルの最初のセル）の一部 |
| Title | なし（先頭空白も本文） |
| 空白のみの行 | **ノードなし** |

空白のみの行は Lezer の木に現れないため、`indentRangeForLine(tree, lineFrom, lineText)` が
「木に `Indent` があればそれを使い、無ければ空白のみの行として範囲を再構成する」。
空バレット（Enter で解除する挙動）の判定などはこの関数を使う。

## 6. インラインレベル

### 6.1 ディスパッチ順序

| 順 | 登録名 | rule | 記法 |
| --- | --- | --- | --- |
| 1 | `AspenDecoration` | `decoration.ts` | `[* x]` `[/ x]` `[*/ x]` |
| 2 | `AspenBlank` | `blank.ts` | `[ ]`（空白のみの角括弧） |
| 3 | `AspenBracket` | `bracket.ts` | 上記以外の `[...]` すべて |
| 4 | `AspenInlineCode` | `inlineCode.ts` | `` `code` `` |
| 5 | `AspenHashTag` | `hashTag.ts` | `#tag` |
| 6 | `AspenBareUrl` | `bareUrl.ts` | `https://...`（括弧なしの URL） |

順序には意味がある。`[* x]` が WikiLink に、`[ ]` が WikiLink になってしまわないよう、**特殊な角括弧を先に、汎用の `bracket.ts` を後に**置いている。

parse 関数の契約（`(cx: InlineContext, next: number, pos: number) => number`）:

- `next` は `pos` の文字コード。自分の担当でなければ **`-1`**。
- 成功したら `cx.addElement(cx.elt(name, from, to, children))` で登録し、**消費した終端位置**を返す。
- `-1` の場合、Lezer は1文字進めて次の位置から再試行する（例: `[[unterminated]` は先頭の `[` が失敗しても、2つ目の `[` から WikiLink として拾われる）。
- 子要素は位置の昇順・非重複で渡す。`cx.parser.parseInline(text, offset)` の `offset` は `text[0]` の**ドキュメント上の絶対位置**。
- 角括弧系は同一行内のみ（改行に到達したら `-1`）。
- 対応する `]` より前にインラインコード（閉じの `` ` `` があるもの）が始まる角括弧は、装飾・リンクを含めすべてプレーン文字列として扱う（`decoration.ts` と `bracket.ts` が `rules/bracketCode.ts` の `bracketContainsCode` で `-1` を返す）。例: ``[* `]` `` は `[* ` と code(`]`)。Go 側 `internal/parser/bracket.go` も同じ規則。
- 同様に、対応する `]` より前に Blank（`[ ]`）が現れる角括弧もプレーン文字列として扱い、Blank だけがノードになる（`[x[ ]]` は `[x` + Blank + `]`）。先に始まった方が勝つので、コード内の Blank はコードのまま。Blank の mark は両端の括弧で、カーソルが触れていない間は括弧が隠れて空白だけが見える。CSS 装飾はない。

### 6.2 Decoration（`rules/decoration.ts`）

`[<記号>+ 本文]`。現在の記号は `*`（Bold）と `/`（Italic）のみ。

- Lezer のノード型は静的で「Bold+Italic」を動的に作れないため、**記号ごとに別ノードを作り、同じ範囲を入れ子にして組み合わせを表現**する。
- 入れ子の順序はソース上の記号の順に関係なく固定（`MARKS` 配列の順 = 外側が先）。`[*/ x]` と `[/* x]` は同じ木になる。
- 開閉の mark（`isMark`）を持つのは**最も外側のノードだけ**。内側のラッパーは同じ本文範囲を包み、自分の `revealStyle` クラスを当てるためだけに存在する。

```
[*/ [Link]]  →  Bold(BoldMark, Italic(WikiLink(WikiLinkMark, WikiLinkMark)), BoldMark)
```

- `BoldMark` は `[* `（末尾の空白を含む）と `]`。本文は `parseInline` で再帰解析され、角括弧の深さを数えるので `[* [Link] text]` も成立する。
- 記号の直後に空白が無い（`[**]`）、本文が空の場合は `-1` を返し、後続の rule（WikiLink など）に委ねる。

### 6.3 角括弧の分類（`rules/bracket.ts`）

構造は「**最初の `]` を見つけ → 中身を分類 → ノードを作る**」。中身に `[` を含む単一括弧はリンクにならず、先頭の `[` はプレーン文字になって内側の `[...]` が改めて解析される（`[x [y]]` は `[x ` + link(y) + `]`）。例外は URL 付きのラベル付きリンク。装飾と `[[ ]]` の閉じ方は下記。数式 `[$ ...]` だけは従来どおりネストを数える。
分類は純粋関数 `decideBracketNodeType(content)`（Lezer 非依存でテスト可能）が担う。

`[[` で始まれば `parseStrong`、そうでなければ `parseSingleBracket`。

`decideBracketNodeType` の判定順（上から先勝ち）:

| 順 | 条件（`content` = 括弧の中身） | 種別 | ノード |
| --- | --- | --- | --- |
| 1 | `$ ` で始まる | Math | `Math`（葉） |
| 2 | `名前.icon` / `名前.icon*N` | Icon | `Icon`（葉） |
| 3 | `/project` / `/project/page` | ProjectLink | `ProjectLink(Mark, Mark)` |
| 4 | 全体・先頭トークン・末尾トークンのいずれかが座標（`N35.6,E139.7[,Z14]`） | GoogleMap | `GoogleMap`（葉） |
| 5 | スペース無し・画像URL | Image | `Image`（葉） |
| 6 | スペース無し・画像でないURL | ExternalLink | `ExternalLink(Mark, Mark)` |
| 7 | スペースがちょうど1つで、両側がURLかつ少なくとも一方が画像 | LinkedImage | `LinkedImage`（葉） |
| 8 | 先頭トークンが画像でないURL | ExternalLink（ラベル = 残り） | `ExternalLink(Mark, ...ラベル, Mark)` |
| 9 | 末尾トークンがURL | ExternalLink（ラベル = 末尾以外） | 同上 |
| 10 | それ以外 | WikiLink | `WikiLink(Mark, Mark)` |

- URL とラベルの区切りは EMAScript の空白（`\s`）1文字で、全角スペースやタブも含む（scrapbox-parser 互換）。Go 側 `internal/parser/decide.go` も同じ。
- 「URL」= `://` を含み `new URL()` で解釈できるもの。「画像URL」= Gyazo か、URL 末尾（クエリ・フラグメントを除く直前）の拡張子が画像（png, jpg, gif, svg, webp など）。`...&s=10.png` や `...#.png` のように拡張子をクエリ側に足した URL も画像になる（Scrapbox 互換）。
- 添付ファイルのパス `@/<recordId>/<filename>`（オリジンなし。アップロード時にこの形で挿入される）は、拡張子が画像なら画像URLとして扱う。`<img>` の `src` への解決は `lib/models/attachmentPath.ts` の `resolveImageSrc` が唯一の場所。画像でない拡張子は通常の WikiLink になる。Go 側 `internal/parser/decide.go` も同じ。
- ラベル付き ExternalLink のラベルは**プレーン文字列**（`[` を含んでよい。中のリンクやハッシュタグは解析しない）。URL が先頭のとき（`[https://e.com a [b]]`）は連続する `]` の最後で閉じ、URL が末尾のとき（`[x https://e.com/[y]`）は最初の `]` で閉じる。
- Decoration の中身はインライン解析される。入れ子にできるのはリンク系だけ（deco・strong は入れ子にならず、`[* [* a]]` は deco(link(`* a`))）。閉じは「入れ子のノードに食われていない最初の `]`」で、無ければ最後の入れ子ノードの `]` を閉じに奪い返す（`[* a [b]` は deco(`a [b`)）。
- Strong（`[[ ]]`）の閉じは `]` の連続の最後の2つ（`[[a]]]` は strong(`a]`)）。中身にはリンクだけを含められ、孤立した `[` や deco を含むと strong にならない。中身が `<deco文字>+ ` で始まる場合（`[[* a]]`）も strong ではなく deco になる。
- ラベル付き ExternalLink では、URL 側の mark が URL とその直後（直前）の空白まで広がる。`[https://e.com label]` の開き mark は `[https://e.com `、`[label https://e.com]` の閉じ mark は ` https://e.com]`。これによりカーソルが触れていない間はラベルだけが表示される。ラベルなし（`[https://e.com]`）の mark は括弧1文字ずつのまま。
- `parseStrong`（`[[...]]`）: 中身が Image なら `StrongImage`、Icon なら `StrongIcon`、それ以外はインライン解析。`StrongMark` は `[[` と `]]`（各2文字）。`[[]]` や閉じ括弧が揃わない場合は `-1`。

`decideBracketNodeType` は `externalLinkNavigation.ts`（href の取り出し）と `imageWidget.ts`（src の取り出し）からも使われる。href/src はノード属性としては保存されず、**ノードのソーステキストから再計算**する設計。

### 6.4 その他のインライン

| rule | 仕様 |
| --- | --- |
| `blank.ts` | `[` と `]` の間が空白のみ（1文字以上）→ `Blank(BlankMark, BlankMark)` |
| `inlineCode.ts` | 同一行内の `` ` `` のペア。中身は空でも可 → `Code(CodeMark, CodeMark)` |
| `hashTag.ts` | インライン範囲の先頭か空白の直後の `#` から → `HashTag`（葉）。空白、ノードになる `[`、閉じのあるコードスパンの `` ` `` で終わる。単独の `]`、ノードにならない `[`、`#` 単体、単語途中の `#` は対象外（行き先はプレーン文字）。decoration/strong の内側では `]` でも終わる |

## 7. ノード一覧

`index.ts` の `defineNodes` に対応。`Paragraph` は `@lezer/markdown` 標準のノードを再利用している。

**ブロック系**

| ノード | 子 | `revealStyle` | 備考 |
| --- | --- | --- | --- |
| `Title` | なし | — | 1行目 |
| `Paragraph` | `Indent?`, インライン | — | 1行につき1つ |
| `Quote` | `Indent?`, `QuoteMark`, インライン | `quote` | `QuoteMark` は `isMark` |
| `CodeBlock` | `Indent?`, `CodeBlockMark`, `Indent`… | — | 言語ハイライトは入れ子パース（§9） |
| `Table` / `TableRow` / `TableCell` | §4.5 | — | セルの中身はインライン |
| `Indent` | なし | — | `isIndent` |

**インライン系**

| ノード | 子 | `revealStyle` | 備考 |
| --- | --- | --- | --- |
| `Bold` / `Italic` | Mark, 本文, Mark | `deco-*` / `deco-/` | 入れ子で組み合わせる。`Bold` は `level level-N` も付き、N は開き mark の `*` の数（最大10。`syntaxReveal.ts`） |
| `Code` | `CodeMark` ×2 | `code hilight` | |
| `WikiLink` | `WikiLinkMark` ×2 | `page-link` | クリックで内部遷移 |
| `ExternalLink` | Mark, ラベル, Mark | `link` | クリックで新規タブ。下線付き |
| `ProjectLink` | Mark ×2 | `page-link` | ナビゲーション未実装 |
| `Strong` | `StrongMark`, 本文, `StrongMark` | `strong` | |
| `Image` / `LinkedImage` | なし | `image` | `hideContent`。`imageWidget` が画像を描画 |
| `StrongImage` | なし | — | 範囲は括弧を含まない URL のみ |
| `StrongIcon` / `Icon` / `GoogleMap` / `Math` | なし | — | 現状は見た目の特別扱いなし |
| `HashTag` | なし | `page-link` | mark を持たないので常に表示 |
| `Blank` | `BlankMark` ×2 | `blank` | 括弧が mark。触れていない間は空白だけが見える |
| `BareUrl` | なし | `link` | 括弧なしの URL。クリックで新規タブ。`]` の手前で終わる |

## 8. NodeProp と表示層（`nodeProps.ts`）

パーサは「どう見せるか」を持たず、ノード型にタグを付けるだけ。表示層はタグを見て**記法を知らずに**汎用処理する。

| NodeProp | 意味 | 主な消費者 |
| --- | --- | --- |
| `revealStyle` | 値の CSS クラスをノード範囲全体に常時適用する。ノードが「reveal 対象」であることの目印 | `syntaxReveal.ts` |
| `isMark` | 区切り文字ノード。カーソルがノードに触れていない間だけ隠す | `syntaxReveal.ts` |
| `hideContent` | 触れていない間はノード範囲全体を隠す（Image 系） | `syntaxReveal.ts` |
| `isIndent` | `Indent` ノードの目印 | `indent.ts` |

Obsidian 風のライブプレビュー: カーソルがノードに**触れていない**間は mark を隠して装飾だけを見せ、触れた（選択が重なった）瞬間に生の記法を見せる。

構文木を読む主なモジュール:

| モジュール | 読むノード |
| --- | --- |
| `plugins/decorations/syntaxReveal.ts` | `revealStyle` を持つ全ノード |
| `plugins/decorations/hangingIndent.ts` | `Indent`（`indentRangeForLine` 経由）、`CodeBlock`（本文はバレットにしない） |
| `plugins/decorations/codeBlockLines.ts` | `CodeBlock` |
| `plugins/decorations/imageWidget.ts` | `Image`, `LinkedImage`, `StrongImage` |
| `plugins/interactions/wikiLinkNavigation.ts` | `WikiLink` |
| `plugins/interactions/externalLinkNavigation.ts` | `ExternalLink` |
| `plugins/interactions/bulletEnter.ts` | `Indent`, `CodeBlock` |

## 9. コードブロックの入れ子言語（`codeLanguages.ts`）

- `parser.configure({ wrap })` に `parseMixed` ベースの `codeLanguageWrap` を渡している。
- `CodeBlock` ごとに、宣言行のメタデータ（`code:main.rs(rust)` の括弧内、なければ `code:typescript` の全体）を `@codemirror/language-data` のカタログで検索する。
- 言語は**初回使用時に動的 import**。読み込み完了までは木を作らないパーサで包み（本文はプレーン表示）、完了後に再パースされる。
- 入れ子パースの対象範囲は、宣言行の次の行から `CodeBlock` の終端まで。

## 10. 新しい記法の追加手順

3点セット + テスト。

1. **`rules/` に parse 関数を書く**（§4.1 / §6.1 の契約に従う）
   - 単一行ブロック: `lineBlock.ts` の `LineBlockKind` と接頭辞判定に種別を足し、`quote.ts` を雛形に `parseLineBlock` を呼ぶだけの rule を書く。
   - 複数行ブロック: `codeBlock.ts` / `table.ts` を雛形に `startsIndentedBlock` + `consumeIndentedLines` を使う。
   - インライン: `hashTag.ts`（葉）、`inlineCode.ts`（mark 付き）、`decoration.ts`（再帰・入れ子）のいずれかを雛形にする。
2. **`index.ts` に登録する**
   - `defineNodes` にノード名（block なら `{ name, block: true }`）と、mark 用のノード名を追加。
   - `parseBlock` / `parseInline` に追加。**配列内の位置が優先順位**。ブロックは Paragraph より前、インラインは汎用の `bracket.ts` との前後関係に注意。
   - 隠したい区切り文字があれば `isMark`、装飾クラスを当てたければ `revealStyle`（Image のように全体を隠すなら `hideContent`）に追加。
   - 他モジュールから参照するなら `export const Xxx = node("Xxx")` を追加（ノードは同一性で比較される）。
3. **見た目が必要なら** `editorTheme.ts` に `revealStyle` で指定したクラスの CSS を足す。クリック動作が必要なら `wikiLinkNavigation.ts` を参考にする。
4. **`index.test.ts` にテストを足す**（§11）。
5. `plan.md` の記法カバレッジ表のステータスを更新する。

## 11. テストとデバッグ

**テスト**

```
cd frontend && bun run test   # vitest
```

- `index.test.ts` は `aspenSyntaxLanguage.parser.parse(...).toString()` の文字列（例 `Document(Paragraph(WikiLink(WikiLinkMark,WikiLinkMark)))`）を assert する。
- 1行目はタイトルとして解釈されるため、ヘルパー `tree()` が先頭に `T\n` を付け、結果から `Title` を取り除いている。本文の記法だけをテストしたいときはこのヘルパーを使う。
- 位置や行番号に依存するルール（Title など）は、`title.test.ts` の `reparse()` のように**編集後のインクリメンタル再パース**も検証する。
- 入力ケースの出典は `scrapbox-parser/test/**`、構造的なエッジケース（ネスト括弧など）は `cosy` のテスト。

**デバッグ**

ブラウザのコンソールで、現在開いているエディタの構文木を JSON で出力できる（`debug.ts`）。

```
aspenDebug.dumpTree()
```

各ノードは位置ではなく**ソーステキスト**付きで出力される。

## 12. 注意点・既知の制約

- **配列の順序 = 優先順位。** `parseBlock` / `parseInline` の並びを変えると挙動が変わる。特に Title は先頭、Paragraph は最後（ブロック）、`bracket.ts` は特殊な角括弧の後（インライン）。
- **空白のみの行は木に現れない。** インデント情報が必要なら `indentRangeForLine` を使う（§5）。
- **空行はコード/テーブルブロックを終了させる。**（インデント0 ≤ 宣言インデントのため）
- **Decoration は `*` と `/` のみ。** `-` や `_` などの記号は未対応（`[- x]` は WikiLink になる）。
- **未実装のブロック記法:** Helpfeel（`? `）、CommandLine（`$ `/`% `）、NumberList（`1. `）。該当行は現状 Paragraph になる。
- **Icon / GoogleMap / Math / StrongIcon / ProjectLink** は木にノードとして現れるが、見た目・動作は未実装。
- **export したノード名がグローバルを隠す。** `Math` と `Image` は JS のグローバル（`Math`, `Image` コンストラクタ）と同名。import したファイル内ではグローバル側が使えなくなる。
- **`codeLanguages.ts` とインデント付きコードブロック（要確認）。**
  - `readInfo` / `codeRange` は `CodeBlock` の `firstChild` を宣言行の mark だと仮定している。しかしインデント付きの宣言（`\tcode:ts`）では `firstChild` が `Indent` になる（`index.test.ts` の `CodeBlock(Indent,CodeBlockMark,Indent)` を参照）。コードを読む限り、この場合は言語を検出できず、シンタックスハイライトが効かない。
  - ファイル冒頭コメントの「declaration as its only child」も `Indent` 導入前の記述で古い。
  - 入れ子パースの対象範囲には、各本文行の先頭 `Indent`（宣言インデント + 1 文字）も含まれる。
  - 修正する場合は `firstChild` ではなく `CodeBlockMark` を名前で探す形にするのが素直。
