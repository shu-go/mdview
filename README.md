# mdview

Go + [Wails v3](https://v3.wails.io/) 製の Markdown ビューアー（Windows / macOS / Linux）。

- タブと入れ子ペイン、複数ウィンドウ（タブをウィンドウ外へドラッグ）
- ファイル一覧（ディレクトリー毎）と見出しアウトラインのサイドバー
- ファイル変更の自動再読み込みと差分表示（初回読み込み時 / 基準時点との比較）
- less / lv ライクなキー操作、通常・正規表現検索
- GitHub emoji、Mermaid（[pele](https://pele.run)）、Callouts、フロントマター、シンタックスハイライト
- ライト / ダーク / システム配色、フォント・ズーム・本文幅、ユーザー CSS

機能ごとの状況は [docs/STATUS.md](docs/STATUS.md)、設計判断は [docs/adr](docs/adr) を参照。

## 使い方

```
mdview [FILE|FOLDER]...
```

すでに起動している場合は、最後にアクティブだったウィンドウで開きます（シングルインスタンス）。
ファイルやフォルダーはウィンドウへのドラッグ＆ドロップ、`Ctrl+O` / `Ctrl+Shift+O` でも開けます。

主なキー（`F1` で一覧）:

| キー | 動作 |
|------|------|
| `j` `k` / `Space` `b` / `d` `u` | 行 / ページ / 半ページ スクロール（`5j` のように回数指定可） |
| `g` `G` / `50p` | 先頭 / 末尾 / 50% 位置 |
| `{` `}` | 前 / 次の見出し |
| `/` `?` `n` `N` / `Alt+/` | 検索 / 正規表現検索 |
| `]` `[` / `D` / `B` | 次 / 前の変更箇所、差分オン/オフ（直近のモード）、基準を更新 |
| `t` `T` / `q` | 次 / 前のタブ、タブを閉じる |
| `Ctrl+\` `Ctrl+Shift+\` | 右 / 下に分割 |
| `Ctrl+B` / `o` | サイドバー表示切替 / ファイル→見出し→検索 |
| `Ctrl` `+` `-` `0`、`Ctrl`+ホイール / `(` `)` | ズーム / 本文幅 |
| `Ctrl+Shift+G` | 全ファイル検索（サイドバー SEARCH） |
| `Ctrl+Q` | 終了 |
| `v` | 外部エディターで開く（表示中の行） |

## 設定

設定は `mdview.json` に保存されます。実行ファイルと同じ場所にあればそれを、無ければ
ユーザー設定ディレクトリー（Windows: `%APPDATA%\mdview\mdview.json`）を使います。

外部エディターはコマンドラインで指定し、`{file}` と `{line}` が置換されます。

```
code -g "{file}:{line}"
"C:\Program Files\Vim\vim91\gvim.exe" +{line} "{file}"
```

### CSS カスタマイズ

設定 > Custom CSS > **Export template…** で備え付けの CSS を書き出し、編集して Custom CSS に
指定します（保存すると自動で反映）。クラス名は `mdv-` 接頭辞のハイフン区切り階層です。

```
.mdv-app > .mdv-toolbar, .mdv-main, .mdv-statusbar
.mdv-sidebar > .mdv-sidebar-files-group > .mdv-sidebar-files-item
.mdv-pane > .mdv-pane-tabs > .mdv-pane-tab
.mdv-doc > .mdv-content            （描画された Markdown）
.mdv-callout-note, .mdv-code, .mdv-mermaid, .mdv-frontmatter, .mdv-diff-ins / .mdv-diff-del
```

状態は `.is-active` `.is-hidden` `.is-current` などで表し、配色は `--mdv-color-*` 変数で変えられます。

## 開発

必要なもの: Go 1.26+, Node.js, `wails3` CLI。

```
wails3 dev              # 開発モード
wails3 build            # bin/mdview(.exe)
go test ./...           # Go のテスト
cd frontend && npm test # フロントエンドのテスト（vitest）
go run ./tools/chromacss > frontend/src/styles/highlight.css  # ハイライト CSS の再生成
```

UI テスト用に、開発ビルド（`go build` など `production` タグなし）を環境変数
`MDVIEW_REMOTE_DEBUG_PORT=9222` 付きで起動すると（Windows）WebView2 のリモートデバッグ（CDP）ポートが開きます。
製品ビルド（`wails3 build`）では無効です。
