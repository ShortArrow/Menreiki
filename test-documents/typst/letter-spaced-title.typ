// ユースケース: 字間スペース付き社名の再構成
//
// 図面表題欄やフッターでは社名が「犬 芝 工 業 株 式 会 社」のように
// 字間を空けて組まれ、OCRが1文字ずつの断片に分解する。検証ポイント:
//   - merge_row_fragments が同一行の1文字断片を1語へ再結合すること
//   - 再結合後に organization として検出されること（footer 扱いにしないこと）
//   - 毎ページ繰り返すフッター社名でも内容分類が優先されること
#set page(
  paper: "a4",
  margin: (top: 2.5cm, bottom: 2.5cm, x: 2cm),
  footer: align(center)[#text(size: 10pt, tracking: 0.8em)[犬芝工業株式会社]],
)
#set text(font: ("Yu Gothic", "MS Gothic"), size: 10.5pt, lang: "ja")

#align(center)[
  #text(size: 20pt, weight: "bold", tracking: 1em)[犬芝工業株式会社]
]
#align(center)[#text(size: 12pt, tracking: 0.5em)[外注仕様書]]

#v(1cm)

= 適用範囲
本仕様書は、犬芝工業株式会社（以下、当社という）が発注する
RX-77 信号変換器の製作に適用する。

= 表題欄
#table(
  columns: 4,
  [図番], [DWG-2026-0031], [作成日], [2026年7月17日],
  [品名], [RX-77 信号変換器], [作成], [犬山次郎],
  [発注元], [#text(tracking: 0.6em)[犬芝工業株式会社]], [確認], [芝田三郎],
)

#pagebreak()

= 製作要領
字間を空けた社名がページをまたいで繰り返されても、
1文字ずつの候補（「犬」「工」「式」など）に分解されないこと。
