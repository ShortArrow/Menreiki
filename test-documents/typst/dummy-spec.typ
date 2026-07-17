// 匿名化処理の評価用ダミー文書。
// 実在しない会社・人物・製品で構成した「機密文書らしい」報告書。
// 盛り込んである検出対象:
//   組織名(表記揺れ含む) / 人物名 / 型式 / メール / 電話 / 郵便番号+住所 /
//   日付 / 金額 / IPアドレス / ホスト名 / URL / 文書番号 / シリアル番号 /
//   全ページ共通フッター(社名+ページ番号) / 機密区分ヘッダー
#set page(
  paper: "a4",
  margin: (top: 2.5cm, bottom: 2.5cm, x: 2cm),
  header: align(center)[#text(size: 9pt, fill: red)[機密 CONFIDENTIAL]],
  footer: context [
    #set text(size: 9pt)
    #align(center)[株式会社アルファ技研 — #counter(page).display() / #counter(page).final().first()]
  ],
)
#set text(font: ("Yu Gothic", "MS Gothic"), size: 10.5pt, lang: "ja")
#set heading(numbering: "1.1")

#align(center)[#text(size: 16pt, weight: "bold")[ZX-140 制御装置 評価試験報告書]]
#align(center)[文書番号: AG-2026-0715　版: 1.2]

= 概要
本書は、株式会社ベータ電機から受領した ZX-140 制御装置について、株式会社アルファ技研 横浜第一試験場で実施した評価試験の結果を報告するものである。

- 試験実施日: 2026年7月17日
- 試験担当者: 田中太郎（技術開発部）
- 連絡先: taro.tanaka\@alpha-giken.example.co.jp / 045-123-4567
- 所在地: 〒231-0001 神奈川県横浜市中区港町1-2-3

= 試験対象
#table(
  columns: 2,
  [項目], [内容],
  [装置名], [ZX-140 制御装置],
  [製造元], [株式会社ベータ電機],
  [シリアル番号], [SN-24070331],
  [主制御MCU], [STM32H750VBT6],
  [ファームウェア], [v2.4.1 (build 20260703)],
)

#pagebreak()

= 試験環境
- 試験場所: 横浜第一試験場 第3実験棟
- 監視サーバー: 192.168.10.21（ホスト名: alpha-test-03）
- 記録システム: https://intra.alpha-giken.example.co.jp/zx140/results
- CAN通信: FDCAN1 を使用し 1 Mbps で通信

= 試験結果
応答時間の実測値は 0.973 ミリ秒であり、要求仕様の 1 ミリ秒以内を満たした。

#table(
  columns: 3,
  [試験項目], [結果], [判定],
  [起動時間], [412 ms], [合格],
  [応答時間], [0.973 ms], [合格],
  [連続稼働], [72時間 異常なし], [合格],
)

= 費用
本試験の実施費用は ¥1,274,500 であり、発注書 PO-2026-1187 に基づき株式会社ベータ電機へ請求する。

#pagebreak()

= 所見
アルファ社としては、ZX-140 の量産適用に技術的な支障はないと判断する。詳細は田中まで問い合わせのこと。

= 承認
#table(
  columns: 3,
  [作成], [確認], [承認],
  [田中太郎], [佐藤花子], [鈴木一郎],
)
