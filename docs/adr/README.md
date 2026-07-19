# Architecture Decision Records

Menreikiのアーキテクチャ決定の記録。運用ルールは [ADR-000](000-adr-policy.md) を参照。

| ADR | タイトル | 日付 |
| --- | --- | --- |
| [000](000-adr-policy.md) | アーキテクチャ決定を記録する | 2026-07-19 |
| [001](001-gui-stack-tauri.md) | GUIはTypeScript + Tauriで実装する | 2026-07-17 |
| [002](002-windows-ocr-first.md) | OCRの第一実装はWindows OCRとし、言語は明示指定する | 2026-07-17 |
| [003](003-pdf-rebuild-from-pixels.md) | 出力PDFは変換済みページ画像のみから自前構築する | 2026-07-17 |
| [004](004-ocr-tolerant-matching.md) | ユーザー文字列の照合はOCR誤認を許容する形で行う | 2026-07-17 |
| [005](005-clean-slate-analysis.md) | 解析はクリーンスレート実行を既定とし、再開・ステージ実行を明示操作にする | 2026-07-18 |
| [006](006-local-llm-thin-client.md) | ローカルLLM統合はOpenAI互換ローカルAPIへの薄いクライアントで行う | 2026-07-17 |
| [007](007-dual-license.md) | MIT OR Apache-2.0のデュアルライセンスで公開する | 2026-07-18 |
| [008](008-project-format-folder-with-mnrk.md) | プロジェクトはフォルダ形式とし、project.mnrkを開く入口にする | 2026-07-19 |
| [009](009-portable-single-binary.md) | ポータブル単一バイナリを主配布形態とし、pdfiumを埋め込む | 2026-07-19 |
| [010](010-remote-inference-via-ssh-tunnel.md) | リモート推論はSSHトンネルで接続し、TLSは強制しない | 2026-07-19 |
