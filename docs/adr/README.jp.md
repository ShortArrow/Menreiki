# Architecture Decision Records

Menreikiのアーキテクチャ決定の記録。運用ルールは [ADR-000](000-adr-policy.jp.md) を参照。

| ADR | タイトル | 日付 |
| --- | --- | --- |
| [000](000-adr-policy.jp.md) | アーキテクチャ決定を記録する | 2026-07-19 |
| [001](001-gui-stack-tauri.jp.md) | GUIはTypeScript + Tauriで実装する | 2026-07-17 |
| [002](002-windows-ocr-first.jp.md) | OCRの第一実装はWindows OCRとし、言語は明示指定する | 2026-07-17 |
| [003](003-pdf-rebuild-from-pixels.jp.md) | 出力PDFは変換済みページ画像のみから自前構築する | 2026-07-17 |
| [004](004-ocr-tolerant-matching.jp.md) | ユーザー文字列の照合はOCR誤認を許容する形で行う | 2026-07-17 |
| [005](005-clean-slate-analysis.jp.md) | 解析はクリーンスレート実行を既定とし、再開・ステージ実行を明示操作にする | 2026-07-18 |
| [006](006-local-llm-thin-client.jp.md) | ローカルLLM統合はOpenAI互換ローカルAPIへの薄いクライアントで行う | 2026-07-17 |
| [007](007-dual-license.jp.md) | MIT OR Apache-2.0のデュアルライセンスで公開する | 2026-07-18 |
| [008](008-project-format-folder-with-mnrk.jp.md) | プロジェクトはフォルダ形式とし、project.mnrkを開く入口にする | 2026-07-19 |
| [009](009-portable-single-binary.jp.md) | ポータブル単一バイナリを主配布形態とし、pdfiumを埋め込む | 2026-07-19 |
| [010](010-remote-inference-via-ssh-tunnel.jp.md) | リモート推論はSSHトンネルで接続し、TLSは強制しない | 2026-07-19 |
| [011](011-japanese-first-and-doc-language-tags.jp.md) | 当面は日本語文書に集中し、ドキュメントは言語タグ付きファイル名にする | 2026-07-19 |
| [012](012-detection-layering.jp.md) | 検出をエンジン／言語非依存パック／言語パックの三層に分ける | 2026-07-20 |
| [013](013-detector-groups-and-composition.jp.md) | 検出器を名前付きグループにし、合成・選択可能にする | 2026-07-20 |
| [014](014-settings-tiers.jp.md) | 設定を「アプリ／プロジェクト／一時状態」の三層に分ける | 2026-07-20 |
