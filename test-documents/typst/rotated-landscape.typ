// ユースケース: 横向きページ＋90度回転ラベル
//
// 図面や大判の表は横向き（landscape）で、枠の縁に社名などが90度回転で
// 組まれることがある。検証ポイント:
//   - 横向きページでも検出矩形の座標がずれないこと
//   - 90度回転した社名（縦に1文字ずつ並ぶ）が前後どちらの読み順でも
//     organization として再構成・検出されること（縦run＋反転読み）
//   - 全面を覆う誤矩形が生成されないこと
#set page(
  paper: "a4",
  flipped: true,
  margin: (top: 2cm, bottom: 2cm, x: 2.5cm),
)
#set text(font: ("Yu Gothic", "MS Gothic"), size: 10.5pt, lang: "ja")

#place(left + horizon, dx: -1.5cm)[
  #rotate(90deg, reflow: true)[
    #text(size: 12pt, tracking: 0.6em)[猫埼電工株式会社]
  ]
]

#align(center)[#text(size: 16pt, weight: "bold")[装置間 接続系統図]]
#align(center)[図番: DWG-2026-0207　第2版]

#v(0.8cm)

#table(
  columns: 4,
  [接続元], [接続先], [信号種別], [備考],
  [制御盤A], [端子箱B], [DC24V], [幹線],
  [端子箱B], [操作卓C], [アナログ信号], [シールド線],
  [操作卓C], [制御盤A], [ステータス], [光ファイバー],
)

作成: 猫田五郎（設計部）　連絡先: 045-987-6543
