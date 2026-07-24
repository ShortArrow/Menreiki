# winget 配布

パッケージID: **ShortArrow.Menreiki**（インストーラは NSIS、`winget install ShortArrow.Menreiki`）

## 初回投稿（1回だけ手動）

winget-releaser（release.yml の `winget` ジョブ）は**既存パッケージの更新専用**
なので、最初のバージョンは wingetcreate で投稿する:

```powershell
# 1. GitHub Release を作る（タグ push で release.yml が作成する）
# 2. インストーラURLからマニフェストを生成・投稿
winget install wingetcreate
wingetcreate new https://github.com/ShortArrow/Menreiki/releases/download/v0.1.0/menreiki-0.1.0-x64-setup.exe
#   - PackageIdentifier: ShortArrow.Menreiki
#   - 内容はこのディレクトリの *.yaml テンプレートを参考に埋める
#   - 最後に「Submit」で microsoft/winget-pkgs へ PR が作られる
```

PR がマージされると `winget install ShortArrow.Menreiki` が有効になる。

## 2回目以降（自動）

1. リポジトリの Secrets に `WINGET_TOKEN` を登録する
   （classic PAT・`public_repo` スコープ。winget-pkgs のフォークと PR 作成に使う）
2. 以後はタグを push するだけ: release.yml が GitHub Release を作成し、
   `winget` ジョブが新バージョンの PR を microsoft/winget-pkgs へ自動送信する。

## テンプレート

このディレクトリの `ShortArrow.Menreiki.*.yaml` は投稿内容の参考テンプレート
（実体は winget-pkgs リポジトリ側で管理され、ここからは自動同期されない）。
