# ADR-014: 設定を「アプリ／プロジェクト／一時状態」の三層に分ける

- ステータス: 承認済み
- 日付: 2026-07-20

## 文脈

設定の置き場所が場当たり的になりつつあった。テーマ・LLM接続先・検出器選択が
すべてアプリ全体設定（config.toml）に集まり、「その文書だけに関わる設定」と
「全プロジェクト共通の好み」と「保存する必要のない一時状態」の区別が曖昧だった。

## 決定

設定を性質で三層に分け、置き場所を固定する。

- **アプリ設定 → `~/.config/menreiki/config.toml`**: 全プロジェクト共通の
  ユーザーの好み・マシン資源。テーマ、ローカルLLMの接続先とモデル
- **プロジェクト設定 → `project.mnrk`**: その文書に固有で、文書と一緒に
  持ち運ぶべき設定。`settings.detectors`（このプロジェクトが使う検出器の
  allow-list。`None`＝既定の全検出器、`Some`＝明示した検出器だけ）。将来
  OCR言語やDPIもここに入りうる
- **一時状態 → `~/.config/menreiki/session.json`**: 設定として保持する
  必要はないが復元すると便利なUI状態。ウィンドウ位置・サイズ・最大化

検出器選択を allow-list（deny-listでなく）にした理由: 未指定の
プロジェクトには常に全検出器（後から追加された新検出器も）が適用され安全。
明示的にリストを書いたプロジェクトだけ選んだものに絞られる。

## 帰結

- 「どの検出器を使うか」は `config.toml` から `project.mnrk` の
  `settings.detectors` へ移した
- 旧 `project.mnrk`（settings欄なし）は serde の default で読め、`None`＝
  全検出器として扱われる
- 操作系: CLIは `menreiki detectors <project> --set <id> / --all`、
  デスクトップは `get_project_settings` / `set_project_settings`。選べる
  id一覧は `list-detectors`（ADR-013）
