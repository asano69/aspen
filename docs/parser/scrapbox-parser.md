## scrapbox-parserは「ランタイム依存」ではなく「仕様書 + テストオラクル」として使うべき

理由は3つあります。

1. **パース方式が根本的に別物**
   scrapbox-parserは`convertToNodes(text, opts)`が正規表現でマッチした位置の`left`/`right`を再帰的に`convertToNodes`し直す、文字列全体を毎回舐め直す非インクリメンタルな設計（`creator.ts`参照）。一方Aspenパーサは`@lezer/markdown`の`parseInline(cx, next, pos)` / `parseBlock(cx, line)`ベースで、CodeMirrorの差分再パース・`syntaxTree()`・`Decoration`機構すべてに乗っかっている。scrapbox-parserの出力（プレーンJSオブジェクトツリー）をCodeMirrorの`syntaxReveal.ts`や`hangingIndent.ts`が要求する`NodeType`/`SyntaxNode`に変換するアダプタを書くコストは、最初からLezerルールとして書き直すコストとほぼ変わらないか、むしろ高くつきます。

2. **拡張できない**
   `block/node/index.ts`の`combineNodeParsers(...)`は固定配列。独自構文を挟むには結局この配列を直接編集する＝実質フォークになるので、「ライブラリとして依存」のメリットがほぼ消えます。

3. **テスト資産は超一級**
   `test/line/*.test.ts` + snapshotは、空文字・全角スペース・入れ子の`[`・decoration 11個目のオーバーフローなど、正規表現ベース実装が踏んだであろうエッジケースが大量に揃っています。ここが一番の価値なので、実装は捨てても**テストケース（入力文字列と期待される意味）は移植する**のが最も費用対効果が高い。

## 構造対応表

| scrapbox-parser | Aspenパーサでの相当物 |
|---|---|
| `convertToNodes`の配列順（precedence） | `parseInline`配列の順序（同じ思想。幸い1:1で移せる） |
| `NodeCreator`が`match[0]`の`left`/`right`を再帰処理 | `cx.addElement(cx.elt(name, from, to, children))`で子ノードを明示的に積む |
| `opts.nested` / `opts.quoted` / `opts.context` | Lezerには無いので、ルール関数内で`cx`から親コンテキストを判定するか、`table`用は別のトークナイザ関数にする（`Table.ts`のセルは`context: "table"`で装飾を丸ごと止めている＝そのままPlainNodeにフォールバックする設計） |
| `packRows` → Title/CodeBlock/Table/Lineへの事前分類 | `parseBlock`ルール（`fencedCode.ts`が既にこの型）。行頭一致→複数行スキャン→終端行で確定、のパターンを流用 |
| 独自ASTノード型 | `defineNodes`に型追加 + `revealStyle`/`isMark`propで装飾指定 |

既存の`fencedCode.ts`が「行頭で開始条件を見て、`cx.nextLine()`で閉じ条件までスキャンする」パターンをすでに確立しているので、`table:` / `code:`（インデントで閉じる版）もこの型で書けます。

## 実装の優先順位（依存関係が少ない順）

**フェーズ1: 単純な行内デコレーション系（既存rulesと同じ形）**
- `HashTagNode`（`#tag`）— 正規表現一発、既存構造そのまま流用可能
- `BlankNode`（`[ ]`）
- `CodeNode`は既存（Aspenの`` `code` ``と同一）

**フェーズ2: 汎用Decoration機構への一般化**
現状Aspenの`Bold`は`[* text]`固定です。scrapbox本家は`[!"#%&'()*+,-./{|}<>_~]`のどれでも良い汎用Decorationで、`*`の個数で強調レベルが変わる（`*-1`〜`*-10`）。ここは「Boldを潰してDecorationに一般化し、Boldはdecoration文字`*`の特殊表示」として実装するか判断が必要です。**簡潔さ優先なら、まず`*`だけ強度なしで対応し、他の記号は将来の別PRに回す**のが現実的だと思います（全部一度に対応するとテストケース数が爆発する）。

**フェーズ3: 角括弧の多義性解決（一番の難所）**
scrapboxでは`[...]`の中身によって以下すべてに化けます：
- `[title]` → 内部リンク（Aspenの`WikiLink`と同型）
- `[http://...]` → 外部リンク or 画像（拡張子で判定）
- `[title http://...]` / `[http://... title]` → リンク+ラベル
- `[N35..,E139..]` → GoogleMap
- `[x.icon]` → Icon
- `[[...]]`（二重括弧）→ StrongImage/StrongIcon/Strong

scrapbox-parser側は「正規表現の優先順位配列」で解決しています（`convertToNodes`内の並び：Blank→Decoration→Formula→StrongImage→StrongIcon→Strong→Image→ExternalLink→Icon→GoogleMap→InternalLink→HashTag）。これは`parseInline`配列の順序としてそのまま移植可能ですが、Lezerの`parseInline`は「先頭文字コードで自分の担当か判定してから中身を検査」という形が普通なので、`[`始まりの判定はcodeLanguages.tsのような別関数に切り出して、1箇所で分岐させたほうが見通しが良いです（`decideBracketNodeType(cx, pos)`のようなディスパッチャ）。

**フェーズ4: 行スコープの構文**
- `NumberListNode`（`1. text`）
- `CommandLineNode`（`$ cmd`）
- `HelpfeelNode`（`? text`）
- `QuoteNode`（`> text`）

いずれも「行頭パターン＋残りを再帰的にinline parse」という同じ形なので、`parseBlock`側で1行だけ消費して、中身をmixed parseで委譲する形になります（`WikiLink`のようなinline要素ではなく、`FencedCode`寄りの「行全体を包むブロック要素」）。

**フェーズ5: 複数行ブロック（Table / CodeBlock）**
`fencedCode.ts`のnextLine()パターンを流用しつつ、終端条件が「明示的な```」ではなく「インデントが戻る」になる点だけ差し替え。

## テスト移植の具体的なやり方

`scrapbox-parser/test/line/*.test.ts`の入力文字列だけを抜き出し、期待値はscrapbox-parserのAST構造ではなく、**Aspenパーサの`.toString()`表現**（`index.test.ts`が既にやっている形）に書き換えて新規に書き起こす。スナップショットファイル自体は移植せず、「この入力文字列がこのノード種別としてパースされるべき」という**意図だけ**を引き継ぐイメージです。

```ts
// 例：hashTag.test.ts の意図を移植
it("Simple hashTag", () => {
  expect(tree("#tag")).toBe("Document(Paragraph(HashTag))");
});
it("Only `#` is not hashTag", () => {
  expect(tree("#")).toBe("Document(Paragraph)");
});
```

## 独自構文との共存

`parseInline`/`parseBlock`配列に追加する形なので、scrapbox互換ルールと独自ルールは同じ配列の中で優先順位を明示的に決められます（これがscrapbox-parser自体にはできなかった点）。既存の`WikiLink`（Aspen独自の`[title]`ナビゲーション付き）や`Bold`（`[* text]`）はそのまま活かして、scrapbox完全互換が必要な部分だけ追加していくのが一番手戻りが少ないはずです。

まずどこから着手したいですか？ 個人的には**フェーズ1（HashTag）**が一番リスクが低く、既存の`rules/`ディレクトリの型をそのまま複製できるので足慣らしに向いていると思います。
