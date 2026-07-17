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
