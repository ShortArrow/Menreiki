# ADR-001: GUIはTypeScript + Tauriで実装する

- ステータス: 承認済み
- 日付: 2026-07-17

## 文脈

PRD（docs/PRD.jp.md §20.2）はGUI候補としてTypeScript+Tauri、C#+Avalonia、
C#+WPFを挙げ、決定を実装時に委ねていた。コアはRust（§20.1）で確定して
おり、GUIとコアの接続方式が最初の分岐点だった。

## 決定

TypeScript + Tauri（v2）を採用する。

- Rustコアとプロセス境界なしで直結でき、FFI/IPC層の設計・保守が不要
- 将来のLinux/macOS対応（PRD §19.1）に追加コストが最小
- レビューUI（一覧・プレビュー・差分）はWeb技術の表現力が適する

C#+WPF/AvaloniaはWindows固有機能（COM連携・資格情報ストア等）が必要に
なった時点で、補助プロセスとしての追加を再検討する。

## 帰結

- Node + Rustの二重ツールチェーンが開発環境の前提になる
- 描画はWebView2依存となり、Windows 11では標準搭載のため配布負担はない
- GUIとCLIが同一のRustコア（menreiki-projectほか）を呼ぶため、変換結果は
  両者で一致する
