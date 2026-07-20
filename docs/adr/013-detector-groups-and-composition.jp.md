# ADR-013: 検出器を名前付きグループにし、合成・選択可能にする

- ステータス: 承認済み
- 日付: 2026-07-20

## 文脈

検出は三層（ADR-012）に分けたが、消費側は `menreiki-lang-ja::builtin_rules()`
という不透明な束を唯一の権威として呼んでいた。これでは次の要求に応えられない。

- 電話・IPなど検出器ごとの個別ON/OFF
- 各パックが自己完結のために汎用検出器（IP等）を同梱した場合の二重検出
- 言語軸ではなくドメイン軸のパック（例: 世界の住所）を、言語パックに埋め込まず
  差し込みたい

これらは本来「パッケージング（クレート）」ではなく「合成と選択」の関心事であり、
マイクロクレート化ではなく検出器に識別子を与えて合成・フィルタする仕組みで解く。

## 決定

- 検出器を名前付きの `DetectorGroup`（安定id ＋ ルール群）にする。idは選択の
  ハンドルで、findingのcategoryとは独立させる。よって `phone-jp` と
  `phone-intl` は別グループだが、どちらも category は `phone`
- エンジン（`menreiki-detect`）に中立の `DetectorSet` を置く。複数パックの
  グループを順に合成し、**同一idは先勝ちでスキップ**（自己完結パックの汎用
  検出器を二重に走らせない。上書きは「先に置く」で明示）。`without(ids)` で
  グループ単位のON/OFF、`ids()` でUI/CLI向けの一覧、`into_rules()` で
  `detect_page` へ渡す
- 各パックは `groups()` を提供するだけ。`menreiki-lang-ja` は権威ではなく、
  `preset()`（日本語グループ＋universalグループの合成）という既定合成を返す。
  `builtin_rules()` は `preset().into_rules()` の別名として残す
- 電話は書式で振り分ける: 国際（+国番号）は universal の `phone-intl`、国内
  （0始まり）は lang-ja の `phone-jp`
- ON/OFFの永続先: CLIは `--disable <id>`（`list-detectors` でid一覧）、
  デスクトップは config.toml の `[detection] disabled`

## 帰結

- 「言語パック」は特別なモノリスではなく、合成の成果になった。universal は
  特権を失い、将来のドメインパック（world-address 等）は独立クレートとして
  `DetectorSet` に差し込める
- GUI上の検出器トグルUIは次段（バックエンドの `list_detectors` と
  `[detection] disabled` は用意済み）
- 動的なレジストリ登録機構は見送り。静的合成で足りる
