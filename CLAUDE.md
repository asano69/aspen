# Overview

- Cardpodは、シングルユーザ向けの、汎用カード型、Federated Wikiだ。
- Cardpodは、使用者が各々、好きなように情報環境をデザインできるように配慮する。
- ポッドと呼ばれるWebサイトのような単位でWikiページをまとめる。各ポッドには個別のGitリポジトリが存在し、バージョン管理やミラーすることができる。
- 電子辞書のように、あるキーワードについて複数の辞書を並行して検索し、検索結果を合成表示する。
- 各ユーザは他人のポッドのページを参考にしつつ、必要な部分だけ自分のページにコピーできる。出典はつけるべきだが強制はしない。
- バックエンドはGo、フロントエンドはSolid.jsを使い、SPAとして作る。純粋関数の二重実装は問題ではない。（ただし、よくテストし結果が常に同じになるようにすること）



## 機能

- 1ポットにつき10万ページは対応できるようにする
- アウトライン編集機能
- 全文検索
- ピン留めカードの簡易的な整理機能
- Git連携によるバージョン管理
- Git連携によるミラーリング


## Rules

- 後方互換性は維持しなくてよい。
- データベースのマイグレーションはPocketBaseのWEB UIから行うのでマイグレーションコードを作成する必要はない。
- When fixing bugs, add a failing regression test first.
- All errors are user-facing, so messages should be clear.
- Keep functions small and focused.
- Module files should re-export what's needed, hide implementation details.
- 変更内容を Codex形式(Search/Replace形式)で出力してください。
例）
```
mathweb/flask/app.py
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
```
- ファイルを削除・移動するときはrm・mvコマンドで提示する。
- 全コードを書き直すときは、古いファイルをSearch/Replaceせずに削除して、新規ファイルとして出力する。
例)
internal/parser/links_test.go (new file)
```go
package parser
import (
	"slices"
	"testing"
)
```

- jsxにおいて、return の先頭にコメント（{/*...*/} ）を置く場合は Fragment （<>...</>）で囲まなければならない。
- 機械的な置換にはperl言語を使ってください


## スタイル規約
- スタイルはプレーンCSSで書く。ユーティリティクラス（Tailwind等）は使わない。
- 公開クラスは styles/components/*.css に1部品1ファイルで置く。すべて `@layer components` の中に書き、ネストは1段まで（Stylelintで検証）。
- ユーザCSS（styles/user.css）の対象になるのは、公開クラスと公開トークン（styles/tokens.txt）のみ。
- 色は `var(--...)` のトークン経由で使う。色リテラルは styles/theme/*.css に限る。
- 状態は `data-*` 属性で表す（`data-open`, `data-dragging` など）。
- marginのような親/兄弟レイアウトに影響するスタイルは、子ではなく親側（`gap` など）で指定する。
- z-index は `--z-*` トークンを使う。

## Tech Stack
### backend
- Go 1.26.0 (1.27はライブラリ非対応)
- PocketBase v0.39+
- centrifugal/centrifuge v0.39+
- go-git
- blevesearch/bleve

### frontend
- Solid.js v1.9
- Dexie.js
- CodeMirror6
- sigma.js v4
- googlechrome/workbox
- Kobalte v0.13+
- Plain CSS / CSS Module
- clauderic/dnd-kit v0.5.0
- jamiebuilds/tinykeys v4.0+


## 備考
- 設計は、docs/architectureを参照する。
- アプリ名はCardpotからCardpodに変更しました。
