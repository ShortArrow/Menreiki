# Menreiki

**意味を残して、面を替える。** — Local-first document de-identification, pseudonymization and generalization workbench.

Menreikiは、PDFや画像に含まれる人物名、組織名、製品名、型式、所在地、管理番号などをローカル環境で検出し、人間のレビューを経て削除・マスキング・仮名化・一般化するオープンソースツールです。同一対象の表記揺れを一貫した仮称へ置換することで、意味や関係性を残したまま外部へ共有可能な派生文書を生成します。

> **ステータス: ベータ（Windows専用）。** 検出は完全ではありません。出力の公開可否は必ず人間が最終確認してください。監査のPassは「設定された検査を通過した」ことを意味し、絶対的な安全を保証するものではありません。

## 特徴

- **ローカルファースト** — 解析・OCR・変換・監査のすべてがローカルで完結し、ネットワークへ接続しません。
- **検出** — 正規表現（メール・電話・URL・IPアドレス・日付・郵便番号）、日本語名ヒューリスティック（組織・部署・人物・地名）、ページ間反復レイアウト（ヘッダー・フッター・ページ番号）、利用者辞書。OCRの誤認（かな同形字・ダッシュ類似字・字間スペース）を許容してマッチします。
- **レビューGUI** — 三分割画面でページ画像上の検出箇所を確認し、候補ごとに保持・マスキング・消去・置換を判断。文字列検索、矩形選択（ページ単位／全ページ、適用前の全ページプレビュー付き）、判断の自動保存。
- **安全な出力** — 変換済みページ画像だけから新規PDFを構築するため、元PDFのテキストレイヤー・メタデータ・注釈・添付・スクリプトは構造的に混入しません。
- **監査** — 出力を再OCRし、変換対象の文字列が残っていないかを照合。残存があれば座標付きで報告し、CLIでは終了コード非0になります。

## 必要環境

- Windows 11（Windows OCRの日本語言語パックが必要）
- [Rust](https://rustup.rs/)（stable）と Node.js 20+
- [Typst](https://typst.app/)（テスト文書の生成に使用、任意）

## セットアップ

```powershell
# pdfiumランタイムを取得（vendor/pdfium/ に配置されます）
pwsh scripts/fetch-pdfium.ps1

# テストフィクスチャを生成（OCR用画像とダミーPDF）
pwsh scripts/make-test-documents.ps1

# ビルド（このリポジトリでは並列度を抑えることを推奨）
cargo build -j 2

# デスクトップアプリ
cd apps/desktop
npm install
npm run tauri dev
```

開発サーバーは、ターミナルで Ctrl+C せず**アプリのウィンドウを閉じて終了**してください。Windows では Ctrl+C だと cmd のバッチ中断となり、Vite 開発サーバーが port 1420 を掴んだまま残ります（次回の起動が失敗します）。残ってしまった場合は port 1420 を使う node プロセスを終了してください。

## CLI

```text
menreiki import  confidential.pdf                  # プロジェクト作成
menreiki analyze <project> [--resume] [--only render|ocr|detect]
menreiki search  <project> "株式会社アルファ技研"   # 文字列の出現を列挙
menreiki findings <project>                        # 検出候補の一覧
menreiki apply   <project> --policy policy.yaml    # 変換の適用
menreiki export  <project>                         # output/sanitized.pdf を再構築
menreiki audit   <project> --policy policy.yaml [--deny-wordlist words.txt]
```

ポリシーの例は [examples/policy-dummy-spec.yaml](examples/policy-dummy-spec.yaml) を参照してください。

## ローカルLLM / VLM（任意）

ローカルの言語モデルを接続すると、次の補助機能が使えます。いずれもモデルの出力は候補・提案（参考情報）であり、レビュアーが採用しない限り何も適用されません。

- **LLM検出** — OCRテキストから文脈依存の機密候補を抽出（GUI: 再解析…→LLM検出、CLI: `menreiki analyze <project> --only llm --llm-model <モデル>`）
- **VLM検出** — ページ画像を確認し、図表・スクリーンショット・ロゴ内の候補も抽出。OCRに写っていない候補は「位置未特定」のページ全体候補として残ります（visionモデルが必要）
- **仮称・一般化の提案** — Entityの仮称欄と置換値欄の✨ボタンで、「特定の型式 → Cortex-M7系マイクロコントローラA」のように意味を残した置換候補を提案

設定は `~/.config/menreiki/config.toml`:

```toml
[inference]
base_url = "http://localhost:11434/v1"   # OpenAI互換エンドポイント（既定はOllama）
model = "qwen3"                           # 使用するモデル（VLM検出はvisionモデルを指定）
```

llama.cpp server / Ollama / LM Studio / mistral.rs はいずれもこのAPI形式で接続できます。

**接続先はこのマシン（localhost / 127.0.0.1 / ::1）に限定されています。** 機密文書のテキストが外部へ送信されない性質をクライアントの構造で保証するためで、リモートのURLは設定しても拒否されます。GPUサーバー（NVIDIA DGX Spark等）でモデルを動かす場合は、SSHポートフォワードで接続してください:

```powershell
ssh -N -L 11434:localhost:11434 user@gpu-server
```

これによりリモートのモデルがこのPCのlocalhostとして見え、原文は暗号化されたトンネルの中だけを通ります。hostsファイルの書き換えや平文のポート転送は、機密テキストが平文でネットワークを流れるため使わないでください。

## テスト

```powershell
cargo test --workspace -j 2      # ユニット・統合テスト（OCR/pdfium実機を含む）
cd apps/desktop; npm run e2e     # 実アプリを操作するPlaywright E2E
```

## リポジトリ構成

```text
apps/desktop/    Tauriデスクトップアプリ（レビューGUI）
apps/cli/        CLI
crates/          コアクレート（core, project, detect, ocr, render, policy, audit, …）
adapters/        交換可能な実装（pdfium, windows-ocr）
test-documents/  生成可能なテストフィクスチャ（実在の名称は含めない）
schemas/ docs/   スキーマとドキュメント
```

検出エンジン・OCR・PDFレンダラーはアダプターとして交換可能な設計です。製品要求の全体は [docs/PRD.jp.md](docs/PRD.jp.md) を参照してください。

## ライセンス

以下のいずれかのライセンスを選択できます。

- MIT License（[LICENSE-MIT](LICENSE-MIT)）
- Apache License, Version 2.0（[LICENSE-APACHE](LICENSE-APACHE)）

このリポジトリへの意図的な貢献は、追加の条件なく上記デュアルライセンスで提供されるものとします。
