# Tailwind → プレーンCSS 移行計画

Cardpodでは、Cosenseのスタイルを参考にするためにTailwindとは相性が悪い。CosenseのスタイルはSCSSで作られており、BEMのような命名規則を持たず、素の短い名前を親クラスの下にネストして使う流儀。現在は、バニラCSSでもネストが使える。

## 前提と方針

- **Tailwindを入れたまま、1コンポーネントずつ置換**する。途中でビルドが壊れず、いつでも止められる。
- 置換した単位でコミットする（1コンポーネント＝1コミット）。
- 新規スタイルは今日からプレーンCSSで書く。**増やさないこと**が最優先。
- 公開スタイルはすべて `@layer components`、ネストは1段まで。

## Phase 0: 棚卸しと土台（コードはほぼ触らない）

1. **使用状況の棚卸し**: ユーティリティを使っているtsxを洗い出す。
   `grep -rlE 'class="[^"]*\b(flex|px-|py-|text-|bg-|border|rounded|gap-)' frontend/src --include=*.tsx`
   ファイルごとのクラス数を数え、着手順の根拠にする。
2. **Stylelint導入**: `max-nesting-depth: 1`、未使用クラス検出、色リテラル禁止（トークン経由のみ）。以降の置換が機械的に検証される。
3. **リセットCSSを先に自作**: `base.css` に、Tailwind preflight相当の最小限（`box-sizing: border-box`、margin 0、`button/input` の `font: inherit`、`img` の `display: block; max-width: 100%`、リストのスタイル除去）を書く。Tailwindが生きている間は二重になるが無害。**これを後回しにすると最終段で見た目が一斉に崩れる**。
4. **CSS変数ブリッジの整理**: `@theme inline` の `--color-*` は、プレーンCSSでは `var(--color-border)` で直接使える。まず `--color-bg: var(--body-bg)` 系のエイリアスの扱いを決める（公開トークンを直接使うか、アプリ内エイリアスを `:root` に残すか）。  
=> 公開トークンを直接使う。--color-* の別名は Phase 5 で @theme と一緒に消す

5. **ファイル配置の決定**: `styles/components/<部品>.css`、1部品1ファイル。`index.css` にimportを足していく。

```shell

asano@spica:~/projects/cardpod/frontend (main *%)
19:51 % cd .. && scripts/tailwind_inventory.sh | head
   47 src/components/layout/Sidebar.tsx
   46 src/components/layout/TopBar.tsx
   45 src/features/md2sb/Md2sb.tsx
   37 src/pages/admin/ApiDocs.tsx
   37 src/pages/Login.tsx
   28 src/components/layout/MainLayout.tsx
   21 src/pages/pots/PotForm.tsx
   20 src/components/Logo.tsx
   18 src/components/layout/UserMenu.tsx
   17 src/components/layout/SidebarPotList.tsx
19:25 % cd frontend && bun run lint:css
$ stylelint "src/**/*.css"

src/styles/components/alert.css
  33:14  ⚠  Disallowed hex color "#000"     color-no-hex
  60:23  ⚠  Disallowed hex color "#d9edf7"  color-no-hex
  62:12  ⚠  Disallowed hex color "#31708f"  color-no-hex
  66:23  ⚠  Disallowed hex color "#dff0d8"  color-no-hex
  68:12  ⚠  Disallowed hex color "#3c763d"  color-no-hex

src/styles/components/card-grid.css
  139:12  ⚠  Disallowed hex color "#342d9c"  color-no-hex
  162:34  ⚠  Disallowed hex color "#e9eaeb"  color-no-hex
  162:43  ⚠  Disallowed hex color "#4a4d55"  color-no-hex

src/styles/components/menu.css
  40:12  ⚠  Disallowed hex color "#dc3545"  color-no-hex

src/styles/components/quick-launch.css
  7:30  ⚠  Disallowed hex color "#363c49"  color-no-hex
```

## Phase 1: すでに混在している共通部品（効果が最大）

何度も使われる部品を先に直すと、後続の置換が楽になる。

| 順 | 対象 | 理由 |
|---|---|---|
| 1 | `.btn` / `.icon-btn`（`controls.css`） | すでにCSS化済みだが `@apply` を使用。素のCSSに書き換え、`SaveButton` の直書きも `.btn` 系に統合 |
| 2 | `menu.css` と `ActionsMenu` / `UserMenu` / `ThemePresetToggle` / `QuickLaunch` | クラスは既にある。残りのユーティリティ（`flex-1`、`flex items-center`）を除去 |
| 3 | ダイアログ4種（`PromptDialog`/`ConfirmDialog`/`QueryDialog`/`ComboboxDialog`） | 構造がほぼ同一。`.dialog`, `.dialog-overlay`, `.dialog-content`, `.dialog-title` などを共通化して一括で置換。重複が最も多い箇所 |
| 4 | `Loading`、`PageAlert` | 小さく独立。`Loading` はスピナーを `loading.css` に |

## Phase 2: レイアウト骨格

`MainLayout`、`TopBar`、`Sidebar`、`SidebarPotList`、`Footer`、`PotIcon`、`Logo`。

- ここは `fixed`/`z-index`/`backdrop-blur`/レスポンシブ（`md:hidden`, `hidden md:block`）が集中する。メディアクエリへの書き換えを要する。
- `z-index` の値はこの時点で**一覧化して変数化**（`--z-topbar` など）。散在するz-indexは詳細度と並ぶ混乱の元。
- ブレークポイントは1か所（`@custom-media` は未対応ブラウザがあるので、素直に `768px` を共通コメントで管理）。
  => `components/layout.css` の冒頭コメントで管理（768px = md、1024px = lg）。`search.css` の `.navbar-form` も同じ値。
- z-index は `theme/default.css` の `--z-*` に一覧化済み（sidebar-backdrop 20 / sidebar 30 / topbar 40 / popup 50 / footer 300 / page-menu 300）。TopBar の高さは `--topbar-height`。`editorTheme.ts` のエディタ内部の z-index と、`card-grid.css` の局所的な値は対象外。
- 開閉・ドラッグ中の状態クラスは `data-open` / `data-dragging` に置換済み（Sidebar, SidebarPotList）。

## Phase 3: ページ単位

1. `PotList` / `PotForm` / `PotGridItem`
2. `CardList` / `CardItem`（`card-grid.css` は既に大半が完成。残りの `opacity-40`、`col-span-full h-px` を除去）
3. `CardForm` / `RelatedCards`（`page-menu` の `flex flex-col gap-0.5` など）
4. `Login`、`ApiDocs`、`Md2sb`（管理系は最後。壊れても影響が小さい）

各ページで、`classList={{ "opacity-40": ... }}` のような状態クラスは `.dragging` や `[data-dragging]` に置換。

=> 完了。状態クラスは `data-dragging`（CardItem, PotGridItem）、`data-quiet`（PotForm）、`data-hidden`（CardForm の `.page-menu`）に置換済み。
- 共通部品は `components/form.css`（`.input`, `.input-mono`, `.form-error`）。ページ固有は `pots.css`, `login.css`, `admin.css`。
- `card-grid.css` に `.card-grid-sentinel`, `.card-grid-item .cover-fallback`, `.card-grid-item .actions` を追加。`page.css` の `.col-page` / `.page-menu` はレイアウトを自身に取り込んだ。
- `RelatedCards.tsx` にはユーティリティが無く、変更なし。
- 残り: `DraftCardEditor.tsx` のエラー文と `noteEditor/index.tsx` の `page min-w-0 flex-1` / `editor text-text outline-none`（Phase 4 で扱う）。

## Phase 4: エディタ周辺の確認

`editorTheme.ts` と `titleLineHighlight.ts` は既にTailwindではない。ただし次を確認する。

- `titleLineHighlight.ts` に `editorTheme` が**重複定義**されている（`index.tsx` が import するのは `editorTheme.ts` 側）。この移行のついでに片方を削除。
- `var(--color-*)` を使っている箇所が、エイリアス整理（Phase 0-4）後も解決されること。

=> 完了。
- `titleLineHighlight.ts` の重複 `editorTheme` を削除（`editorTheme.ts` が唯一の定義）。
- `editorTheme.ts` が読む `--color-border` / `--color-hover-bg` は `:root` に直接宣言された app トークンで、別名ではない。Phase 5 後も解決される。`@theme inline` 内の `--color-border: var(--color-border)` のような自己参照は、Phase 5 で `:root` に書き換えるときに**移さない**（移すと循環参照になる）。
- Phase 3 の残りを置換: `noteEditor/index.tsx`（`.page` / `.editor`）と `DraftCardEditor.tsx`（エラー文は `.form-error`）。`flex-1 min-w-0` と `mb-4` は親の `.col-page` 側（`page.css`）に置いた。`outline-none` はフォーカスされない要素への指定で、CodeMirror 側は `editorTheme.ts` の `&.cm-focused` が処理済みのため削除。
- 未対応: `editorTheme.ts` の色リテラル（`#342d9c` は `--code-color`、`#dc3545` は `--danger-color` に対応）。Stylelint の対象外（TS）なので、必要になったらトークン化する。
- 確認: `scripts/tailwind_inventory.sh` が 0 件になること（Phase 5 の前提）。残っていた 3 件（`Logo.tsx` のコメント中の `text-2xl` と `font-size` スタイルキー、`RelatedCards.tsx` の `grid` クラス）は誤検出だった。コメントは書き換え、`grid` と `font-size` はスクリプトの除外リストに追加した。

## Phase 5: Tailwind撤去

すべてのtsxからユーティリティが消えたことを確認してから実施する。

1. 確認: Phase 0 の grep が0件。
2. `index.css` の `@import "tailwindcss"` を削除。
3. `default.css` の `@theme` / `@theme inline` / `@custom-variant` を通常の `:root` に書き換え（`--font-*`、`--shadow-*` は `:root` へ）。
4. `base.css` の `@apply` を素のCSSに。
5. `vite.config.ts` から `@tailwindcss/vite` と `cssMinify: "esbuild"` の回避策を削除（Lightning CSSが復活するので、ビルド出力で順序崩れがないか確認）。
6. `package.json` から `tailwindcss` / `@tailwindcss/vite` を削除。
7. `CLAUDE.md` のスタイル規約を更新（Tailwind言及の削除、新ルールの記載）。

=> 完了。
- `index.css` は `@layer preset, base, components;` を自前で宣言する（Tailwind が宣言していた順序の代わり）。
- `default.css` の `@theme` / `@theme inline` / `@custom-variant` を削除し、`--font-*` と `--shadow-*` は `@layer preset` の `:root` に移した。`--color-bg` などの別名は未使用のため削除した。
- `base.css` の `body` は `@apply` を素のCSSに書き換えた。
- `vite.config.ts` から `@tailwindcss/vite` と `cssMinify: "esbuild"` を削除した。
- `stylelint.config.js` の Tailwind 用 `ignoreAtRules` を削除した。`scripts/tailwind_inventory.sh` は削除した。

## 各ステップの検証

- **見た目**: ライト/ダーク、`default`/`blue` プリセット、モバイル幅（639px以下）の3軸で確認。
- **機械的**: `bun run typecheck`、`bun run lint`、Stylelint、`bun run test`（`tokens.test.ts` が通ること）。
- **ビルド**: 本番ビルドでも確認（過去にminifyで順序が変わった前例があるため、Phase 1と5の後は必ず）。

## 注意点（落とし穴）

- **Preflightの欠落**: Phase 0-3 で防ぐ。特に `button` の背景・枠線、`h1`〜`h3` のmargin、`ul` のlist-style。
- **Kobalteの `data-*` 属性**: `data-[highlighted]:` は `[data-highlighted]` セレクタへ。`menu.css` に既に例がある。
- **`dark:` バリアント**: 現状未使用だが、`light-dark()` に統一されているので問題なし。
- **`space-x-*` や `divide-*`**: 使っている箇所があれば、親側で `gap` に置換（CLAUDE.mdの「親から制御」方針とも合う）。

## 着手の最初の一歩

Phase 0 の 1（棚卸し）と 3（リセットCSS）、2（Stylelint）の3点を1つのPRにまとめるのが良いと思います。棚卸しの結果で、Phase 1〜3の順序を実データに合わせて調整できます。棚卸しのスクリプト作成から、こちらで進めましょうか。
