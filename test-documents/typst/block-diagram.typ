// ユースケース: 機能ブロック図
//
// 「○○受信部」「○○生成回路」のような機能ブロック名は部署検出器と
// 構造上区別できず誤検出になる。矢印に沿った語のマッピング誤りで
// 横に細長い誤矩形が出ることもあった。検証ポイント:
//   - ブロック名の誤検出は「無視」（カテゴリ付き除外）で抑制できること
//   - 矢印をまたいで語が結合した page 幅級の細長い矩形が出ないこと
//   - 凡例（本装置/信号など）が繰り返し候補として暴れないこと
#set page(paper: "a4", margin: (top: 2.5cm, bottom: 2.5cm, x: 2cm))
#set text(font: ("Yu Gothic", "MS Gothic"), size: 10.5pt, lang: "ja")

#align(center)[#text(size: 14pt, weight: "bold")[信号処理装置 機能ブロック図]]

#v(0.8cm)

#let blk(label) = rect(inset: 8pt, stroke: 1pt)[#align(center)[#label]]

#grid(
  columns: (1fr, auto, 1fr),
  column-gutter: 6pt,
  row-gutter: 14pt,
  blk[操舵指令\ 受信部], [#align(horizon)[→ 操舵指令 →]], blk[操舵指令信号\ 生成部],
  blk[画像信号\ 受信部], [#align(horizon)[→ 赤外線画像 →]], blk[発射指令\ 生成回路],
  blk[舵角信号\ 受信部], [#align(horizon)[→ ステータス →]], blk[引抜模擬\ 回路],
)

#v(1cm)

凡例:
#table(
  columns: 2,
  [記号], [意味],
  [実線枠], [本装置],
  [破線枠], [外部装置],
  [→], [信号],
  [⇔], [光ファイバー],
)

本図の設計担当は 犬芝工業株式会社 技術開発部 犬山次郎。
