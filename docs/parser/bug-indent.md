## 問題の所在

Aspenのパーサ（`@lezer/markdown`ベース）には、**「インデント」を統一的に扱う概念が構文木レベルに存在しません**。インデント判定は複数の場所にバラバラに実装されていて、しかも互いに矛盾しています。

### 1. パーサ層（構文木）にインデントの概念がない

`parser/aspen/index.ts`の`defineNodes`を見ると、`CodeBlock` / `Table` / `Quote` / `Bold` / `Italic` などのノード型はあっても、`BulletList`のような「箇条書き」ノードや、行ごとの「インデント深度」を保持する仕組みは一切ありません。

比較として：
- **scrapbox-parser**の`Row.ts`は`parseToRows`で全行に対し`/^\s+/`で`indent`を計算し、`Line.ts`がその`indent`を使って箇条書き構造を組んでいます。
- **cosy**の`parser/block.rs`も`input.chars().take_while(|&c| c == ' ').count()`で明示的にインデント長を測ってから分岐します。
- **cache/lezer-md**（本家Markdownパーサ）は`Line.countIndent`でタブストップまで考慮した列位置ベースのインデント計算を持ち、`BulletList`/`ListItem`ノードとして構文木に反映しています。

Aspenにはこれに相当するものが存在しません。

### 2. 「インデントかどうか」の判定はデコレーション層・コマンド層に散らばっている

実際にインデントらしきものを扱っているファイルを洗い出すと、それぞれ別の正規表現で別の文字集合を「インデント」とみなしています。

| ファイル | 役割 | 何を「インデント文字」とみなすか |
|---|---|---|
| `rules/indentedBlock.ts`（`countLeadingTabs`） | `code:`/`table:`の継続行判定（パーサ層・構文木に反映される） | **タブ文字のみ**（`\t`） |
| `plugins/decorations/hangingIndent.ts`（`LEADING_INDENT_RUN_RE`） | 箇条書きの見た目（バレット・ぶら下げインデント）を描画するView Plugin | タブ＋半角スペース＋全角スペース（`/^[\t \u3000]+/`） |
| `plugins/interactions/bulletEnter.ts`（`LEADING_TABS_RE`） | Enterキー押下時に同じ深さで箇条書きを継続するコマンド | **タブ文字のみ**（`/^\t+/`） |

つまり同じ「行頭の空白」という情報について、3箇所がそれぞれ独自に、しかも異なる文字集合で解釈しています。しかも`hangingIndent.ts`と`bulletEnter.ts`はどちらも**構文木を経由せず、生のテキストに直接正規表現をかけている**ビュー層／コマンド層の処理で、パーサとは完全に独立しています。ご指摘の通り「インデントかどうかはパーサではなくデコレーション層が文字を見て自分で判断している」という理解で正しいです。

### 3. コードブロックが壊れている直接の原因

`rules/codeBlock.ts`と`rules/table.ts`はどちらも`indentedBlock.ts`の`consumeIndentedLines`を使って継続行を集めていますが、その内部の`countLeadingTabs`は**タブしか数えません**。

```ts
export function countLeadingTabs(text: string): number {
  let indent = 0;
  while (text[indent] === "\t") indent++;
  return indent;
}
```

なので`code:`行の次の行が半角スペースや全角スペースで始まっていると、`countLeadingTabs`はそこを`0`（インデント無し）と判定し、`consumeIndentedLines`のループの終了条件`countLeadingTabs(line.text) <= indent`が真になって、その時点でコードブロックが終了してしまいます。これが「タブから始まる行だけがコードブロックとして扱われる」不具合の原因です。

### まとめ

- 統一されたインデント測定ロジックはパーサ層に存在しない。
- 3つの異なる場所（`indentedBlock.ts`／`hangingIndent.ts`／`bulletEnter.ts`）がそれぞれ独自の文字集合・独自の正規表現でインデントを「その場しのぎ」で判定している。
- コードブロック/テーブルの継続行判定は、その中でも最も狭い「タブのみ」という定義を使っているため、半角・全角スペースでのインデントを継続行として認識できない。
- 修正するなら、まず「インデント文字として何を認めるか」（タブ／半角スペース／全角スペースのどれを1レベルとみなすか、あるいは列幅換算するか）を一箇所で定義し、`indentedBlock.ts`・`hangingIndent.ts`・`bulletEnter.ts`がそれを共有する形に統一するのが筋が良さそうです（scrapbox-parserやcosyの「まず行ごとにindentを測ってから分岐する」設計が参考になります）。

計画
- まずは、パーサがインデントを正しく扱い、構文木レベルで正しい出力を生成することが重要。
- scrapbox-parserやcosyの「まず行ごとにindentを測ってから分岐する」設計が参考になります）。
- インデント文字として何を認めるかは、scrapbox記法にしたがって、ECMAScript正規表現 /^\s+/ にマッチするものとする。
