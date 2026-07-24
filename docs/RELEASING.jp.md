# リリース手順

リリースはタグ駆動で、`.github/workflows/release.yml` が全工程を実行する。

## 手順

1. **バージョンを3ファイルで一致させて上げる**（release.yml が不一致を検出して失敗する）:
   - `Cargo.toml`（workspace.package.version）
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/package.json`
2. コミットして push し、CI（Docs parity）を確認する。
3. タグを push する:

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

## release.yml が行うこと

| ジョブ | 内容 |
|---|---|
| test | タグとバージョンの一致検証 → 日本語OCR言語パック導入 → pdfium取得 → `cargo test --workspace --locked`（実OCR・実pdfiumのゲート） |
| build | NSISインストーラ（`tauri build`）と CLI をビルドし、`menreiki-X.Y.Z-x64-setup.exe` ＋ ポータブルzip（desktop/CLI exe・pdfium.dll・ライセンス同梱）を作成 |
| release | 全成果物に SLSA provenance を付与（attest-build-provenance）してから GitHub Release を作成（`--generate-notes`） |
| winget | `WINGET_TOKEN` があれば microsoft/winget-pkgs へ更新PRを自動送信（初回のみ手動投稿 — [packaging/winget/README.jp.md](../packaging/winget/README.jp.md)） |

build ジョブは `MSSTORE_IDENTITY_NAME` などのリポジトリ変数が設定されて
いれば **Microsoft Store 用の無署名 MSIX** も成果物に含める（Store が
署名するため SmartScreen 警告なしで配布できる主経路 —
[packaging/msstore/README.jp.md](../packaging/msstore/README.jp.md)）。

## 補足

- **E2E（Playwright）はリリースゲートに含めていない**（CIランナーでのデスクトップ
  操作は不安定なため）。タグを打つ前にローカルで
  `npx playwright test` を通しておくこと。
- インストーラは無署名。SmartScreen の警告が出るのは既知の制約
  （コード署名証明書の導入は将来課題）。
- 再タグが必要になった場合は Release とタグを削除してからやり直す
  （winget へ送信済みの場合は新しいパッチバージョンで出し直す方が安全）。
