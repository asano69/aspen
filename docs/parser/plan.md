# Aspen パーサ実装計画（統合版）

`docs/parser/aspen-parser.md` と `docs/parser/scrapbox-parser.md` はそれぞれ別の切り口（前者は「cosy を網羅性チェックリストとして使う」、後者は「scrapbox-parser を依存の少ない順にフェーズ分けする」）で書かれていて、そのままでは実装順序が一本化されていない。このドキュメントは両者を統合し、**この順番で実装すれば手戻りが最小になる**という単一のロードマップを示す。

以後、このドキュメントを実装時の唯一の参照先とする。個別記法の細かい正規表現・エッジケースは都度 `scrapbox-parser`（TypeScript, 正規表現ベース）を、記法の網羅漏れチェックは `cosy`（Rust, winnow ベース）を参照する、という役割分担は変えない。

## 0. 参照実装の役割分担

- Lezerパーサとの親和性が高いのはcosyだが、Scrapbox記法パースにおける正確さはscrapbox-parserのほうが優っている。
- cosy を「チェックリストとしてのみ使う」のは誤りで、記法によっては**cosy の方がロジックの正解**になっている箇所がある。用途を1つに決め打ちせず、記法ごとに使い分ける。


| リポジトリ                                                    | 役割                                                                  | 使い方                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sb-spec/cosy`                                                | **① 網羅性チェックリスト**、かつ **② 構造・曖昧性解消ロジックの正解** | ①: `parser/mod.rs` の block ディスパッチ条件と `parser/node.rs` の `alt((...))` の並びを「サポートすべき記法一覧」として使う。②: **block分岐/行継続判定（`parser/block.rs`）と 角括弧の多義性解消（`parser/bracket.rs` 以下一式）は、ロジック構造そのものを移植元にする。** 理由は後述。 |
| `sb-spec/scrapbox-parser`                                     | **③ 単純記法の実装ソース**、かつ **④ 全記法共通のテストケース抽出元** | ③: 依存関係のない単純な行内記法（HashTag, Blank など）は正規表現をそのまま拝借してよい。④: `test/**/*.test.ts` の入力ケースは cosy 由来のロジックで実装した記法も含め、全フェーズで regression test の元ネタとして使う。                                                                 |
| Aspen (`frontend/src/components/noteEditor/parser/aspen`) | **実装先**                                                            | `@lezer/markdown` ベース。既存の `Bold` / `WikiLink` / `Code` / `CodeBlock` と同じ形（`nodeProps` で `revealStyle` / `isMark` を付け、`syntaxReveal.ts` が汎用的に表示制御する）を崩さずに拡張していく。                                                                                 |

### なぜ block分岐・曖昧性解消は cosy を正解とするか

- **block分岐（Phase 0 の設計根拠）**: scrapbox-parser の `Pack.ts` は「全行を先にスキャンして pack にまとめる」事前パス方式で、Lezer の `BlockContext`（行を前から順にストリーム処理しながら、その場で「自分の担当か」を判定する）とは構造が違う。cosy の `parse_block` は「インデント数を数える → prefix で if/else 分岐 → デフォルトは line」という形で、これはそのまま Lezer の `BlockParser` が書くべき形と一致する。**Phase 0 の共通ヘルパーは cosy の `parse_block` の分岐構造を model にする。**
- **角括弧の多義性解消（Phase 3 の設計根拠）**: scrapbox-parser は「正規表現を優先順位配列で並べて先勝ち」方式で、正規表現同士が重なるケース（例: `test/line/formula.test.ts` の「Formula の直後に decoration が続く」ケース）を個別のテストで力業で潰している。これは新しい記法を足すたびに既存の正規表現との衝突を心配する必要があるということで、Aspen のように後から記法を継ぎ足していく前提には向かない。cosy は `bracket_content.rs::take_bracket_content` でネスト深度を数えて正しく `]` の対応を取り、`links_and_pages.rs` では `split_once`/`rsplit_once` でトークンを構造的に分類してから dispatch している。これは優先順位ゲームではなく構造的に曖昧性を解く実装なので、**Phase 3 の角括弧ディスパッチャは cosy のロジックを Lezer 用に移植する。** scrapbox-parser はこのフェーズでは regression test のケース抽出専用に留める（実装ロジックの参照元にはしない）。

上記2箇所以外（Phase 1, Phase 4, Phase 5 の大半）は、cosy 側の実装が Rust/winnow の1行パーサ寄りで Lezer への移植メリットが薄いため、従来通り scrapbox-parser の正規表現を実装ソースとして使う。

## 1. 現状のアーキテクチャ（前提知識）

- `index.ts` が `aspenParser`（`@lezer/markdown` の `parser.configure()`）を組み立てている。CommonMark の block/inline パーサは全部 `remove` してあり、`Paragraph` だけが残っている。
- **inline** 拡張は `parseInline` 配列に `{ name, parse }` を足す形（`rules/bold.ts`, `rules/wikiLink.ts`, `rules/inlineCode.ts`）。`InlineContext` を受け取り、マッチしなければ `-1`、マッチすれば `cx.addElement(...)` で範囲とノードを登録する。
- **block** 拡張は `parseBlock` 配列に `{ name, parse }` を足す形（`rules/fencedCode.ts` のみ現状）。`BlockContext` と `Line` を受け取り、`cx.nextLine()` で複数行を消費できる。
- 表示制御は記法固有のコードを増やさず、`nodeProps.ts` の `revealStyle`（常時スタイルを当てるクラス）と `isMark`（カーソルが触れていない時だけ隠す delimiter）の2つのプロパティだけで `syntaxReveal.ts` が汎用処理している。**新しい記法もこの2プロパティに乗せるだけで表示制御が済む設計を維持する**。
- タイトル行（1行目）は `titleCandidatePlugin.ts` / `titleLineHighlight.ts` が別枠で扱っており、構文パーサとは独立している。

新しい記法を足すときは常に「① rules/ に parse 関数を書く → ② index.ts の `defineNodes` / `parseBlock` or `parseInline` / `props` に登録する → ③ 必要なら `editorTheme.ts` に CSS を足す」という3点セットになる。この型を崩さない。

## 2. 記法カバレッジ・チェックリスト

cosy のディスパッチ順序をそのまま「要件一覧」として転記し、Aspen での現状・対応フェーズを併記する。

### block レベル（cosy: `parser/block.rs` の分岐順）

> **Title（1行目）**: cosy には無く、scrapbox-parser の `Title.ts` / `hasTitle` に相当する。Aspen では常に1行目がカードのタイトルなので、`rules/title.ts` が1行目だけを常に先頭で claim し、以下の分岐は2行目以降にのみ適用される。✅ 実装済み。

| 記法               | 判定条件           | scrapbox-parser 実装 | Aspen 現状                                                                                                                         | 対応フェーズ |
| ------------------ | ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| CodeBlock          | `code:` prefix     | `CodeBlock.ts`       | ✅ 実装済み（`rules/codeBlock.ts`。タブのインデント復帰で終了）                                                                      | —            |
| Table              | `table:` prefix    | `Table.ts`           | ✅ 実装済み（`rules/table.ts`。セルは inline parser に委譲）                                                                         | —            |
| Quote              | `>` prefix         | `QuoteNode.ts`       | ✅ 実装済み（`rules/quote.ts`。本文は再帰的に inline パースされ、`QuoteMark` は他の記法と同じく syntaxReveal で reveal/hide される） | —            |
| Helpfeel           | `? ` prefix        | `HelpfeelNode.ts`    | ❌ 未実装                                                                                                                            | Phase 4      |
| CommandLine        | `$ ` / `% ` prefix | `CommandLineNode.ts` | ❌ 未実装                                                                                                                            | Phase 4      |
| Line（デフォルト） | 上記以外           | `Line.ts`            | ✅ 実装済み（`Paragraph`）                                                                                                           | —            |

### inline レベル（cosy: `parser/node.rs` の `alt()` 順）

| 記法                                        | scrapbox-parser 実装                                         | Aspen 現状                                                             | 対応フェーズ |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------ |
| InlineCode `` `x` ``                        | `CodeNode.ts`                                                | ✅ 実装済み（`rules/inlineCode.ts`）                                     | —            |
| HashTag `#tag`                              | `HashTagNode.ts`                                             | ✅ 実装済み                                                              | —            |
| Blank `[ ]`                                 | `BlankNode.ts`                                               | ✅ 実装済み                                                              | —            |
| NumberList `1. text`                        | `NumberListNode.ts`                                          | ❌ 未実装（行頭パターンなので block 寄り）                               | Phase 4      |
| Decoration `[* x]` `[/ x]` ...              | `DecorationNode.ts`                                          | ✅ 実装済み（`rules/decoration.ts`。`*`/`/` の組み合わせとネストに対応） | —            |
| Formula `[$ x]`                             | `FormulaNode.ts`                                             | ✅ 実装済み                                                              | —            |
| StrongImage / StrongIcon / Strong `[[...]]` | `StrongImageNode.ts` / `StrongIconNode.ts` / `StrongNode.ts` | ✅ 実装済み                                                              | —            |
| Image `[url]`                               | `ImageNode.ts`                                               | ✅ 実装済み                                                              | —            |
| ExternalLink `[url label]`                  | `ExternalLinkNode.ts`                                        | ✅ 実装済み                                                              | —            |
| Icon `[x.icon]`                             | `IconNode.ts`                                                | ✅ 実装済み                                                              | —            |
| GoogleMap `[N35..,E139..]`                  | `GoogleMapNode.ts`                                           | ✅ 実装済み                                                              | —            |
| InternalLink `[title]`                      | `InternalLinkNode.ts`                                        | ✅ 角括弧ディスパッチャに統合済み                                        | —            |

この表が唯一のソース・オブ・トゥルースになる。新しい記法に着手する前に、この表の該当行のステータスを更新すること。

## 3. 実装フェーズ（統合ロードマップ）

依存関係の少ない順に並べる。**Phase 0 は両ドキュメントに明記されていなかったが、Phase 4 に進む前に必須の下準備なので新設した。**

### Phase 0: 行スコープブロックの基盤整備（完了）

Phase 4（Quote / Helpfeel / CommandLine / NumberList）はどれも「行頭パターンを検出し、残りを inline パースに委譲する」という同じ形を取る。複数行ブロックの例とは別に、単一行ブロックの実装例も先に整備しておかないと Phase 4 で毎回車輪の再発明になる。

- **設計の model は cosy の `parser/block.rs` の `parse_block` にする**（0章で述べた通り、事前パス方式の scrapbox-parser `Pack.ts` ではなく）。具体的には次の3ステップの形をそのまま踏襲する：
  1. 行頭の空白を数えて indent を確定する（`parse_block` の `indent_len` 相当）。
  2. prefix を順番に if/else でチェックし、どの block 種別かを決める（`parse_block` の `if input.starts_with(...) else if ... else` の連鎖）。
  3. 該当する block パーサに委譲し、無ければ通常の line（Paragraph）として扱う。
- `rules/` に `lineBlock.ts`（仮）として、この3ステップに対応する共通ヘルパーを用意する。「prefix を除いた残りを inline パースに委譲する」部分は `codeLanguages.ts` の `parseMixed` パターン（`CodeBlock` の中身を別言語パーサに委譲している部分）を参考にし、単一行ブロックの場合は「prefix 以降の残り全部を、外側と同じ `aspenParser` のインライン規則で再帰的に解釈させる」だけでよい。
- 成果物: 単一行ブロック共通ヘルパー1つ + それを使った最小サンプル1つ（例えば `Quote` の骨組みだけ）。

**DoD**: 新しい単一行ブロック記法を1つ追加するのに、rules/ に1ファイル足して登録するだけで済む状態になっていること。かつ、prefix 判定の分岐構造が cosy の `parse_block` と1対1で対応付けられる状態になっていること。

**実施結果**: `rules/lineBlock.ts` に cosy と同順の `code:` → `table:` → `>` → `? ` → `$ `/`% ` のディスパッチを実装した。未対応の種別は Paragraph にフォールスルーさせ、最小の利用例として `rules/quote.ts` を追加した。Quote の本文は `cx.parser.parseInline` に渡すため、既存の Aspen inline 記法をそのまま再帰的に解釈する。

### Phase 1: 単純な行内トークン

依存が無く、既存の `Bold` / `WikiLink` / `InlineCode` と全く同じ形（`InlineContext` を受けて範囲を返すだけ）で実装できるものから着手する。

- **HashTag** (`#tag`)
  - 参照: `scrapbox-parser/src/block/node/HashTagNode.ts` の正規表現とその周辺処理
  - 実装: `rules/hashTag.ts` を新設。`revealStyle` は付けず（`#tag` 自体を隠す必要はない）、リンク色のスタイルだけ当てる。クリックナビゲーションは `wikiLinkNavigation.ts` と同様のパターンで別途追加可能（必須ではない）。
- **Blank** (`[ ]`)
  - 参照: `BlankNode.ts`
  - 実装: `rules/blank.ts`。空白専用の角括弧なので、Phase 3 の角括弧ディスパッチャより前に「中身が空白のみの `[...]`」として先に弾いておくと Phase 3 の実装が単純になる。

**DoD**: `#tag` と `[ ]`（半角/全角スペース、タブ含む）がハイライトされ、`syntaxReveal` の対象外（常時表示でよい記法）として動作する regression test が通ること。テストケースは `scrapbox-parser/test/line/hashTag.test.ts` と `blank.test.ts` の入力をそのまま流用する。

### Phase 2: Decoration の汎用化

現状 `Bold`（`[* text]` 固定）を Decoration に一般化する
使える記号は !"#%&'()*+,-./{|}<>_~（cosy の DECO_CHARS 参照）で、これらを任意個・任意の組み合わせで並べらるようにします。

現状の Bold との違い

いまの rules/bold.ts は：

```ts
if (cx.slice(pos, pos + 3) !== "[* ") return -1;
```

[* という特定の3文字に決め打ちした特殊ケースです。つまり Decoration という一般構文のうち decos === "*" の1点だけを切り出して "Bold" という専用ノードにしている状態で、[/ text] や [- text] は現状マッチせず、素通りして普通の WikiLink/Blank 判定に落ちるか、結局プレーンテキストになります。

「Decoration の汎用化」とは、この決め打ちを外し、

装飾文字クラス（DECO_CHARS）に属する文字が1つ以上 + スペースという条件に緩和する
マッチした装飾文字列（rawDecos）をノードの属性として保持する

- の連続数（* ** **_...）を強度レベル（_-1〜*-10、10個以上は10に丸め）に変換する
  装飾文字の組み合わせ（decos の集合）に応じて CSS を出し分ける（太字・イタリック・取り消し線・下線などを複合適用できるようにする）

Lezer/Aspen パーサでの設計:

- 現状の Bold/BoldMark を単純に Decoration/DecorationMark に改名するだけでは足りません。理由は、decos はノードごとに異なる可変長の属性であり、Lezer の NodeType は静的な種類分けしかできない（revealStyle/isMark は node type 単位のプロパティ）ためです。

- Lezerにおいては、型（クラス）そのものを組み合わせで動的生成することはできない。型名のリストは静的に固定されている制約がある。

そのためこの部分の設計はsb-spec/cahce/lezer-mdの設計を参考にする必要がある。
そこでは、おそらく ネストノードを使っていると思う

```
Italic {
  "*" InlineContent "*"
}

Bold {
  "**" InlineContent "**"
}
```

結果

```
Italic
  Bold
    Text
```

ASTを後段で解釈すると

```
{
  text: "hello",
  marks: ["italic", "bold"]
}
```

へ変換できます。これがlezerらしいやり方だと思う。
その方向性で正しいと思います。実際、これは Lezer/CodeMirror 6 の設計思想そのもの（`@lezer/markdown` の Emphasis/StrongEmphasis も同じ発想）で、CommonMark の ATXHeading1〜6 が「level を動的属性にせず固定個の型で列挙する」のと同じパターンです。ただし cosy/scrapbox の Decoration は CommonMark の emphasis とは構造が少し違うので、そこを踏まえて設計すると詰まらずに済むと思います。

## CommonMark の Emphasis とは前提が違う点

`**a *b* c**` は「別々のデリミタ対」が実際にソース上に複数存在するので、ネストは自然に生まれます（`resolveMarkers` が delimiter を後からマッチングして入れ子にする）。

一方 scrapbox の Decoration は `[*/ text]` のように **1個のブラケットに複数のdeco文字をまとめて書く**記法なので、ソース上のデリミタトークンは実質1個（`"[*/  "` と `"]"`）しかありません。つまりご提案の「ネスト」は、ソースに複数の区切り文字があるから生まれるのではなく、**parse関数側が意図的に合成する**ものです。ここは lezer-markdown の Emphasis とは動機が違うので、コメントに残しておいたほうが後で読む人（未来の自分）が混乱しないと思います。

## だとすると Mark(開始/終了トークン) はどこに付けるか

この違いから、素直に「各マーク型に個別の open/close mark を持たせる」のは無理です（区切り文字が1個しかないので）。設計としては:

- **最も外側のノードだけ**が実際の開始/終了マーカー（`isMark` 付き）を持つ
- **内側にネストしたラッパー型**はマーカーを持たず、同じ range を再度ラップして自分の `revealStyle` クラスを乗せるだけ

`syntaxReveal.ts` は revealStyle が付いたノードを個別に処理するので、内側ラッパーは「マークを持たないノード」として扱われ、常時スタイルが乗った状態になります（＝装飾効果自体は常に見える。cursor で reveal/hide されるのは一番外側のマーカーだけ）。これは既存の実装とも整合します。

## 内部のインライン再帰

現状の `parseBold` は中身を再帰パースしていません（`[* [Link]]` の `[Link]` は解釈されない）。scrapbox 完全対応を優先するなら、cosy の `parse_nodes_no_deco` に相当する処理が必要で、Lezer 的には ATXHeading や Table セルが使っている手法（`cx.parser.parseInline(text.slice(...), offset)` を呼んで子要素配列を得る）がそのまま使えます。

## ラフなスケッチ

```ts
// rules/decoration.ts
// Cosense's visually-defined decoration characters, in a fixed canonical
// nesting order (outermost first). This list is static by design -- Lezer
// node types can't be synthesized per combination, so every recognized
// deco char gets its own node type and combinations are expressed by
// nesting these types around the same source range.
const MARKS = [
  { char: "*", node: "Bold" },
  { char: "/", node: "Italic" },
  { char: "-", node: "Strikethrough" },
  { char: "_", node: "Underline" },
] as const;

export function parseDecoration(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 91 /* [ */) return -1;

  let i = pos + 1;
  while (
    i < cx.end &&
    cx.char(i) !== 32 &&
    cx.char(i) !== 93 &&
    cx.char(i) !== 10
  )
    i++;
  const decos = cx.slice(pos + 1, i);
  if (decos === "" || cx.char(i) !== 32) return -1;

  const contentFrom = i + 1;
  let end = contentFrom;
  while (end < cx.end && cx.char(end) !== 93 && cx.char(end) !== 10) end++;
  if (cx.char(end) !== 93) return -1;

  const active = MARKS.filter((m) => decos.includes(m.char));
  if (active.length === 0) return -1; // no recognized char -> fall through (e.g. to WikiLink)

  // Recurse so nested WikiLink/Code/etc. inside the decoration still parse,
  // mirroring cosy's parse_nodes_no_deco.
  let children = cx.parser.parseInline(cx.slice(contentFrom, end), contentFrom);

  // Nest innermost -> outermost. Inner wrappers carry no marks of their own;
  // they exist purely so their own revealStyle CSS class applies.
  for (let k = active.length - 1; k > 0; k--) {
    children = [cx.elt(active[k].node, contentFrom, end, children)];
  }
  const outer = active[0].node;
  return cx.addElement(
    cx.elt(outer, pos, end + 1, [
      cx.elt(`${outer}Mark`, pos, contentFrom),
      ...children,
      cx.elt(`${outer}Mark`, end, end + 1),
    ]),
  );
}
```

`index.ts` 側は `defineNodes` に `Italic`/`ItalicMark`/`Strikethrough`/`StrikethroughMark`/`Underline`/`UnderlineMark` を足し、`revealStyle`/`isMark` も同様に登録すれば既存の仕組みにそのまま乗ります。

## `*` の連続数（サイズレベル）について

`***text***` のようなレベルは、`Bold1`〜`Bold10` のような型を10個作るのではなく、**単一の `Bold` 型のまま**にして、実際の `*` の個数はビュー層で `view.state.sliceDoc(open.from, open.to)` からその場で数えてCSSに反映するのが良いと思います。型を静的に保つという制約とも相性が良く、シンプルさも保てます。

## 進め方について

`plan.md` の Phase 2 の記述どおり、いきなり全部やると組み合わせ数でテストケースが爆発するので、

1. まず `*` 単体の一般化（decosが `*` のみのケースを Bold として通す。ネスト機構はまだ不要）
2. 2つ目のマーク（`/` など）を追加するタイミングで、上記のネスト機構を導入

という順序が安全だと思います。ネストの複雑さは「同時に組み合わせるマークが2種類以上必要になった瞬間」に初めて要る話なので、それまで持ち込まない方が保守しやすいはずです。

### Phase 3: 角括弧の多義性解決

最難関。`[...]` の中身によって WikiLink / 外部リンク / 画像 / リンク+ラベル / Icon / `[[...]]` の Strong 系に化ける。**ここは 0章で述べた通り、scrapbox-parser の正規表現優先順位配列ではなく、cosy の `parser/bracket.rs` 一式（`bracket_content.rs`, `bracket/links_and_pages.rs`, `bracket/icon.rs`, `bracket/coordinate.rs`, `bracket/math.rs`, `bracket/project_link.rs`）のロジック構造を移植元にする。**

- **括弧の対応取り**: cosy の `bracket_content.rs::take_bracket_content` はネスト深度を数えて正しく対応する `]` を見つける（scrapbox-parser の `[^[\]]*` ベースの正規表現はネストを正しく扱えない）。Lezer 側でも同じ深度カウント方式で中身の範囲を確定させてから分類に入る。既存の `wikiLink.ts` は現状こそ簡易実装だが、Phase 3 ではこの深度カウント方式に置き換える。
- **ディスパッチャ**: `rules/bracket.ts`（仮）に `decideBracketNodeType(content: string): BracketKind` のような純粋関数を用意する。中身を分類する判定ロジックは cosy の `bracket.rs` の `alt((parse_math, parse_icon, parse_project_link, parse_coordinate, parse_links_and_pages(extension)))` の順序と判定条件をそのまま踏襲する（scrapbox-parser の正規表現優先順位配列は使わない）。
- **リンク/画像/ラベルの分類**: cosy の `links_and_pages.rs` は「スペースで区切った最初/最後のトークンを `split_once`/`rsplit_once` で取り出し、それぞれが URL かどうかを `infer_url`（MIME 判定つき）で分類してから組み合わせで dispatch する」という構造的な分類をしている。これを移植する。URL の拡張子/Gyazo 判定など具体的な正規表現の値だけは `scrapbox-parser/src/block/node/ImageNode.ts` / `StrongImageNode.ts` と突き合わせて漏れがないか確認する（値の出典は scrapbox-parser、分類の構造は cosy）。
- `[[...]]`（二重括弧）と `[...]`（単括弧）は開き括弧の数で先に分岐する（`WikiLink` の既存実装 `rules/wikiLink.ts` を土台に、中身の分類だけ `decideBracketNodeType` に委譲する形にリファクタリング）。
- 実装順序（依存の少ない順、cosy の `bracket.rs` の並びに準拠）:
  1. Math (`[$ x]`) — 単純な prefix 判定
  2. Icon (`[x.icon]`) — 単純な suffix 判定
  3. ProjectLink (`[/project/page]`) — Aspen に project 概念が無ければ見送り可（要判断）
  4. Coordinate/GoogleMap（優先度低。時間が余れば対応、なければ見送り可）
  5. links_and_pages 相当（ExternalLink / Image / LinkedImage / ラベル付きリンク / InternalLink）— 一番複雑なので最後
  6. StrongImage / StrongIcon / Strong（`[[...]]`）は cosy の `strong.rs` を参照し、上記の分類ロジックを再利用する形にする
  7. 既存 `WikiLink` を `decideBracketNodeType` 経由に統合

**DoD**: `scrapbox-parser/test/line/{link,image,icon,strongImage,strongIcon,strong,googleMap,formula}.test.ts` の入力ケースを **cosy 由来のロジックで**パースし、少なくとも Node 種別の判定が一致すること（AST の形そのものは Lezer 用に異なってよい）。加えて、ネストした角括弧（`[a [b] c]` のようなケース）が破綻しないこと（scrapbox-parser 単体ベースの実装では見落としがちな観点なので明示的にテストする）。

**実施結果**: `rules/bracket.ts` に cosy の順序（Math → Icon → ProjectLink → Coordinate → links/pages）で分類する純粋ディスパッチャと、ネスト深度で対応する閉じ角括弧を探すスキャナを追加した。単括弧は Formula / Icon / ProjectLink / GoogleMap / Image / ExternalLink / LinkedImage / WikiLink に、二重括弧は Strong / StrongImage / StrongIcon に分類する。URL の画像判定は scrapbox-parser の拡張子・Gyazo ケースも含め、links/pages の first/last token 分類構造は cosy に合わせている。

### Phase 4: 行スコープブロック

Phase 0 で作った共通ヘルパーを使って、prefix 判定＋残りを inline delegate、を1記法ずつ足していく。

- **Quote** (`> text`)
- **Helpfeel** (`? text`)
- **CommandLine** (`$ cmd` / `% cmd`)
- **NumberList** (`1. text`)

実装順は依存の少なさで決める：Quote → Helpfeel → CommandLine → NumberList（NumberList だけ数字の桁数を読む分、正規表現がわずかに複雑）。

各記法につき、参照は `scrapbox-parser/src/block/node/{QuoteNode,HelpfeelNode,CommandLineNode,NumberListNode}.ts` の正規表現をそのまま使う。

**DoD**: 4記法それぞれについて、対応する `scrapbox-parser/test/line/*.test.ts` の入力ケースが期待通りに block 化されること。

**実施結果 (Quote)**: パース自体は Phase 0 の `rules/quote.ts`（共通ヘルパー `lineBlock.ts` 経由）で先行実装済みだったため、Phase 4 では既存の revealable な記法（Bold/Italic/WikiLink など）と足並みを揃える仕上げのみ行った。`index.ts` の `revealStyle`/`isMark` に `Quote`/`QuoteMark` を登録し、`editorTheme.ts` に `.cm-quote` のスタイル（イタリック＋ミュートカラー）を追加。これにより先頭の `>` はカーソルがその行に触れていない間は他の記法と同じく `syntaxReveal.ts` によって隠れる。構造面のテストは `index.test.ts` の既存ケース（`"> [* bold] [page] `code`"` など）でカバー済みのため追加していない。

### Phase 5: 複数行ブロック（Table / CodeBlock）

`cx.nextLine()` パターンを使い、終端条件を「明示的な close マーク」ではなく「タブのインデントレベルが戻ったら終了」にする。

- 参照: `scrapbox-parser/src/block/Table.ts`（タブ区切りでセルを分割し、各セルを再度 inline パースする部分）
- Aspen 版インデントはタブ文字が単位（`bulletEnter.ts` / `hangingIndent.ts` と同じ `\t` 基準）なので、scrapbox 本家のスペースインデントとは前提が異なる点に注意。既存の `LEADING_TABS_RE` と同じ考え方で終端判定する。

`code:` prefix による CodeBlock は Table と同じ「複数行・インデント終端」構造として同時に実装する。Aspen 独自の ` ``` ` フェンス記法は廃止し、以後は Scrapbox / Helpfeel 互換の `code:` 記法だけをコードブロックとして扱う。

**DoD**: `scrapbox-parser/test/table/index.test.ts` のケースが Table として block 化され、`scrapbox-parser/test/codeBlock/index.test.ts` のケースが CodeBlock として block 化されること。セル本文は Aspen の inline 規則で再帰的にパースされ、コード本文は raw text のままであること。

**実施結果**: `rules/indentedBlock.ts` にタブ基準の共通行収集処理を追加し、`rules/table.ts` と `rules/codeBlock.ts` がこれを利用するようにした。`table:` の後続タブ行は `TableRow` / `TableCell` として構造化し、各セルは既存 inline parser に委譲する。`code:` の後続タブ行は raw の `CodeBlock` 本文として保持し、`code:typescript` および `code:main.rs(rust)` のメタデータから既存の遅延言語ハイライトも利用できる。旧 `rules/fencedCode.ts` と ` ``` ` ブロック構文は削除した。

## 4. 各フェーズ共通の進め方

1. 対象記法について、**先にテストケースを Aspen の `*.test.ts` に移植する**（レッドの状態で始める）。既存の `parser/aspen/index.test.ts` や `bulletEnter.test.ts` のように、パース結果のツリー文字列や AST を assert するスタイルに合わせる。ケースの出典は基本 scrapbox-parser の `test/**/*.test.ts` だが、**Phase 0 / Phase 3 に限っては cosy 側の `tests/integration.rs` や `src/parser/bracket/*.rs` 内の `#[cfg(test)]` ケース（特にネスト括弧・複数トークン分類のケース）も必ず含める**。scrapbox-parser 単体では拾えない構造的なエッジケースがそちらにしかないため。
2. `rules/` に parse 関数を実装。既存の `decoration.ts` / `bracket.ts` / `inlineCode.ts` / `codeBlock.ts` のいずれかを雛形にする（inline か block かで選ぶ）。
3. `index.ts` の `defineNodes` / `parseBlock` or `parseInline` / `props`（`revealStyle`, `isMark`）に登録する。
4. 表示が必要なら `editorTheme.ts` に CSS を足す。ナビゲーションが必要なら `wikiLinkNavigation.ts` を参考にする。
5. 2章の記法カバレッジ表のステータスを更新する。

## 5. スコープ外・見送り事項（現時点での判断）

- **Decoration の完全汎用化**（`*` 以外の装飾文字、強調レベル）: Phase 2 で見送りと決定済み。
- **GoogleMap**: 個人〜小規模チーム Wiki というプロダクト特性上、優先度は最低。Phase 3 の最後に時間があれば着手する程度でよい。
- **` ``` ` フェンスによるコードブロック**: `code:` 記法へ完全移行したため非対応。フェンス文字列は通常テキストとして扱う。
- **Aspen 独自拡張構文**: Scrapbox 互換の記法一式（Phase 1〜5）が完了してから着手する。既存記法と衝突しない構文を選ぶこと（例えば `[* text]` は Bold として予約済みなので使わない）。

この5フェーズ＋見送り事項の一覧を守れば、cosy 側のチェックリストと scrapbox-parser 側のフェーズ分けの両方を矛盾なく満たせる。

--
demo：
- https://progfay.github.io/scrapbox-parser
