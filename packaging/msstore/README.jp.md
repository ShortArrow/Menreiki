# Microsoft Store 配布

Store 配布の最大の利点: **パッケージは Store が署名する**ため、コード署名
証明書なしで SmartScreen 警告のない配布経路になる。

## 1. Partner Center 登録（1回だけ・ブラウザ操作）

1. [Partner Center](https://partner.microsoft.com/dashboard) で
   開発者アカウントを登録（個人: 約$19 買い切り）。
2. 「新しい製品 → MSIX または PWA アプリ」でアプリ名 **Menreiki** を予約。
3. 製品管理 → **製品 ID** ページで次の3つの値を控える:
   - `Package/Identity/Name`（例: `12345ShortArrow.Menreiki`）
   - `Package/Identity/Publisher`（例: `CN=xxxxxxxx-xxxx-...`）
   - `PublisherDisplayName`

## 2. リポジトリへ識別値を設定

GitHub の **Settings → Secrets and variables → Actions → Variables** に:

| Variable | 値 |
|---|---|
| `MSSTORE_IDENTITY_NAME` | Package/Identity/Name |
| `MSSTORE_PUBLISHER` | Package/Identity/Publisher |
| `MSSTORE_PUBLISHER_DISPLAY` | PublisherDisplayName |

以後、タグリリースの build ジョブが `menreiki-X.Y.Z-x64.msix` を成果物に
含める。ローカルで作る場合:

```powershell
$env:MSSTORE_IDENTITY_NAME = "..."; $env:MSSTORE_PUBLISHER = "CN=..."
$env:MSSTORE_PUBLISHER_DISPLAY = "..."
.\scripts\build-msix.ps1          # ビルドから / -SkipBuild で既存exeを使用
```

## 3. 提出

1. Partner Center の申請ページへ **無署名の .msix をアップロード**
   （署名は Store が行う。識別値が一致しないと弾かれる）。
2. ストア掲載情報を入力:
   - **プライバシーポリシーURL**（必須）:
     `https://github.com/ShortArrow/Menreiki/blob/main/docs/PRIVACY.md`
   - 説明・スクリーンショット（1366×768 以上を1枚以上）・年齢区分の申告
3. **審査担当者向けメモ（Notes for certification）**に
   [certification-notes.md](certification-notes.md) の本文を貼り付ける。
   Menreiki は文書を取り込まないと何も始まらないため、これが無いと
   テスターが主要機能に到達できず **10.3.3 App Is Testable** で差し戻される
   （初回提出はこれで一度落ちた）。ホーム画面の「サンプルを開いて試す」
   ボタンで外部ファイル無しに機能へ到達できる旨を英文で案内している。
4. 審査へ提出（Win32 full-trust アプリ。初回審査は数日かかることがある）。

## ローカルでの動作確認（任意）

無署名 MSIX はそのままインストールできない。自己署名でテストする場合:

```powershell
New-SelfSignedCertificate -Type Custom -Subject "CN=00000000-0000-0000-0000-000000000000" `
  -KeyUsage DigitalSignature -FriendlyName MenreikiDev `
  -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
# signtool sign /fd SHA256 /a out\msix\Menreiki_*.msix → 証明書を信頼ストアへ → ダブルクリックでインストール
```

確認ポイント: 起動・`.mnrk` の関連付け・pdfium 読み込み（exe隣接）・
設定の保存（MSIX の AppData 仮想化配下でも動作すること）。
