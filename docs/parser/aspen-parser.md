# Aspenパーサのscrapbox記法対応戦略

**レイヤーごとに使い分ける**のが良さそうです。両者ともにCodeMirror(Lezer)のインクリメンタル・文字位置駆動のパース方式とは根本的に設計思想が異なるので、「どちらか一方を丸ごと移植する」という発想自体が合わないと思います。

## インライン記法（文字トリガー型のマッチング）→ scrapbox-parser が近い

現在の`parser/aspen/rules/*.ts`（`bold.ts`, `wikiLink.ts`, `inlineCode.ts`）の実装形は、実はすでにscrapbox-parserの`NodeParser`とほぼ同じ形をしています。

- Lezerの`parseInline`: `(cx, next: 次の文字コード, pos) => number`。特定の文字コードで呼ばれ、その位置からマッチを試み、ノードを1つ確定させて終了位置を返す。
- scrapbox-parserの`createNodeParser`: 正規表現でマッチさせ、マッチ前後を再帰的に`convertToNodes`する。

この「位置固定・正規表現1発・再帰なしで済むところは再帰しない」という設計はLezerにそのまま持ち込みやすいです。一方cosyのwinnowコンビネータは「残り文字列全体を`&mut &str`として渡し歩く」前提で、これはLezerの「今この文字位置で何のノードが始まるか」という呼ばれ方とは相性が悪く、素直に移植すると`InlineContext`の外側にもう一枚パーサ層を被せる二度手間になります。

なので、**アイコン・googleMap・strongImage/strongIcon・table内エスケープなど、記法ごとの正規表現とその優先順位（`convertToNodes`の`rules`配列の並び）は、scrapbox-parserからほぼそのまま持ってこれる**と思います。実際、現状の`index.ts`の`parseBold`/`parseWikiLink`より複雑な記法（decoration, icon\*N, strongImage判定など）を足すときの雛形として一番手数が省けます。

## ブロック分岐・行の継続判定 → cosy の parse_block のほうが構造的に近い

- scrapbox-parserは`Row.ts`→`Pack.ts`で**全行を先に一括で走査してブロックにグルーピング**してから`convertToBlock`する二段階方式（インクリメンタル性ゼロ、常にフルパース前提）。
- cosyの`parse_block`は「現在位置から1ブロック分だけ消費して返す」を`repeat`で繰り返す方式で、`code:`/`table:`の継続行判定もインデント比較で1行ずつ前進します。

Lezerの`parseBlock`コールバックも「現在の行から呼ばれて、自分が担当するブロックなら消費してtrueを返す」という契約なので、**構造的にはcosy側が圧倒的に近い**です。実際、既存の`fencedCode.ts`もこの「1行ずつ`cx.nextLine()`で前進しながら終端を探す」スタイルで書かれていて、cosyの`parse_code_block`とほぼ同型です。table記法を足す際も、cosyの「インデントが浅くなったら終了」というシンプルな継続判定がそのまま参考になります（scrapbox-parserのPack側は「同じインデント以上が続く限り子行として溜め込む」という一括処理なので、Lezerの1行コールバックに書き直す変換コストがかかります）。

## 曖昧性解消ロジック（正しさの参照実装）→ cosy が優秀

以下のような「仕様として地味に面倒な分岐」は、cosyの実装がかなり整理されています：

- `links_and_pages.rs`: `[url1 url2]`のパターンで両端がURLかどうかを見て`LinkedImage`/`WithLabel`/`Page`を振り分けるロジック（`BracketToken::of`で分類してから`match`する形）
- `bracket_content.rs`: `[`/`]`のネストを深さカウンタで処理する`take_bracket_content`（scrapbox-parserは正規表現ベースでネスト対応が弱め）
- `strong.rs`: `[[...]]`の中身がicon/image/url/プレーンテキストのどれかを判定する優先順位

これらはscrapbox-parserの正規表現でも一応再現されていますが、**「なぜその優先順位なのか」というロジックの見通しはcosyのほうが良い**ので、実装時の正しさのクロスチェック用として使うと良さそうです。

## まとめると

| レイヤー | 主参照 | 理由 |
|---|---|---|
| インライン記法の文字トリガー・正規表現 | scrapbox-parser | Lezer `parseInline`と同型（位置固定・単発マッチ） |
| ブロック分岐・行継続判定（code/table/quote） | cosy | Lezer `parseBlock`と同型（1行ずつ前進するストリーミング方式） |
| 曖昧性解消・優先順位ロジックの正しさ検証 | cosy | ロジックの構造が明快で仕様のリファレンスとして読みやすい |
| 拡張ポイントの設計思想（独自構文を後乗せする方法） | 両方参考程度 | `CosyParserExtension`はLezerの`configure({defineNodes, parseInline, parseBlock})`で既に同等のことができているので、trait自体の移植は不要 |

実装を始める際は、まずcosyの`parser/mod.rs`にある記法一覧（block: 22行付近のディスパッチ条件、inline: `alt((...))`の並び）を「サポートすべき記法のチェックリスト」として使い、各記法の正規表現・文字境界処理だけscrapbox-parserの該当ファイルから移すのが一番手戻りが少ないと思います。


---

## scrapbox-paserとlezer再実装パーサの比較


**1. Decorationの構造がそもそも逆**
scrapbox-parserの`decoration`は「1ノードに`rawDecos`（複数文字をまとめた文字列）を持つフラットな形」です。一方Aspenの`rules/decoration.ts`は、**Lezerのノード型が静的にしか定義できない制約のため、あえて`Bold`/`Italic`を入れ子にして表現**しています（`[*/ text]` → `Bold(Italic(...))`）。

**2. Quoteの階層がずれている**
scrapbox-parserでは`quote`は「行の中のインライン要素の1つ」（`{type: "line", nodes: [{type: "quote", nodes: [...]}]}`）として表現されますが、Aspenの`Quote`は`CodeBlock`/`Table`/`Paragraph`と並ぶ**トップレベルのブロック**です

**3. ProjectLinkと"root"の曖昧さ**
scrapbox-parserは、`[/page]`（同一プロジェクト内のroot相対リンク）と`[/project/page]`（他プロジェクトへのクロスリンク）を区別せず、両方`pathType: "root"`に潰しています。

## cosyとlezer再実装パーサの比較

- Aspenの角括弧ディスパッチャ（rules/bracket.ts）は、cosyのparser/bracket.rsの分類構造をそのまま移植したも。BracketKind（Math/Icon/ProjectLink/GoogleMap/Image/ExternalLink/LinkedImage/WikiLink）は、cosyのNode::Link(Link::Page/Url/WithLabel/Project/ProjectPage)・Node::Image・Node::LinkedImageと実質1:1対応。scrapbox-parserは全部を"type": "link"＋pathTypeフィールドに潰しており、WikiLinkとExternalLinkを構造的に分けているAspenの実態とは逆に情報が失われます。

- Decorationも同様：cosyはNode::Decoration { decos: String, nodes }という単一のフラットな型を持ち、JSON化する際に「複数の装飾文字が1つのノードに乗る」という実態を素直に表現できます。scrapbox-parserの"type": "decoration"も実は同じ形（rawDecos/decos配列）なのでここは両者互角ですが、AspenのLezer実装がBold/Italicをネストした別ノードとして生成している点を考えると、JSON出力時に「1つのDecorationノードにdecos文字列を持たせる」cosy式の方が、Lezerの入れ子構造をシンプルな形に潰しやすいです。
