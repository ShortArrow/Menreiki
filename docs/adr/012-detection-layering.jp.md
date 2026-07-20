# ADR-012: 検出をエンジン／言語非依存パック／言語パックの三層に分ける

- ステータス: 承認済み
- 日付: 2026-07-20

## 文脈

検出ルールは当初 `menreiki-detect` の1クレートに、正規表現エンジンと
日本語固有の知識が混在していた。i18nを見据える（ADR-011）と、言語知識が
エンジンやcoreへ染み出さない構造をコンパイラに強制させたい。また検出
対象には軸の異なる3種類がある:

- エンジン: ルールの適用と座標写像。言語を問わない機構
- 言語非依存の識別子: メール、URL、IPアドレス、MACアドレス、国際電話
  （+国番号のE.164形式）。書式が万国共通
- ロケール固有の識別子: 組織/部署/人物/地名の綴りと文法、国内電話
  （0始まり）、郵便番号（〒）、和暦日付、かな同形字の折り畳み

## 決定

検出を3つのクレートに分ける。

- `menreiki-detect` — 言語非依存のエンジン。`RegexRule`（post-filter
  フック付き）、`detect_page`、`detect_repeated_lines`、座標写像。特定
  言語の名前を一切知らない
- `menreiki-detect-universal` — 書式が言語に依存しない識別子の検出器。
  `universal_rules()`
- `menreiki-lang-ja` — 日本語固有の全知識。`builtin_rules()`（内部で
  universal を合成）、`literal_rule`/`dictionary_rule`（OCR揺れ許容）、
  境界フィルタとstopwordのpost-filter

電話番号は書式で振り分ける: 国際表記（+国番号）は universal、国内表記
（0始まり・カッコ市外局番）は lang-ja。どちらも category は phone。

## 帰結

- 「エンジンは言語を知らない」がクレート境界で保証される
- 将来 `menreiki-lang-en` は universal を再利用し、英語の綴り・敬称・
  各国の国内電話形式だけを足せばよい
- 消費側（audit / policy / project / cli / desktop）は、エンジンから
  `detect_page`、言語パックから `*_rule` を取る
