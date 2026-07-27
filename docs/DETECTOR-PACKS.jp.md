# 検出パック形式

検出パックは、業種別の検出内容（正規表現ルールと用語）をまとめた
**データのみのJSONファイル**（`*.mnrkpack.json`）である
（[ADR-016](adr/016-detector-packs.jp.md)）。コードは含まないため、
中身を読めばすべて監査できる。

## 取り込みと効果

設定画面の「検出パック」から取り込む。取り込まれたパックは
アプリ全体（全プロジェクトの解析）に参加し、検出候補には
`pack:<name>` の出典が付く。取り込み時に検証され、不正なパック
（パターンが壊れている等）は拒否される。

## 形式

```json
{
  "name": "manufacturing-jp",
  "displayName": "製造業（日本）検出パック",
  "version": "1.0.0",
  "publisher": "発行者名",
  "description": "説明",
  "rules": [
    { "category": "model-number", "pattern": "MNR-\\d{4}", "note": "任意の説明" }
  ],
  "words": [
    { "category": "organization", "text": "猫埼電工" }
  ]
}
```

| フィールド | 必須 | 内容 |
|---|---|---|
| `name` | ✓ | スラッグ（英小文字・数字・ハイフン）。インストール時のファイル名・出典表示に使う |
| `displayName` | ✓ | 表示名 |
| `version` | ✓ | パックのバージョン文字列 |
| `publisher` |  | 発行者 |
| `description` |  | 説明 |
| `rules[]` | ※ | 正規表現ルール。`category`＋`pattern`（Rust regex 構文）。`(?P<keep>…)` 名前付きグループで報告範囲を絞れる |
| `words[]` | ※ | リテラル語。ユーザー辞書と同じ**OCR揺らぎ耐性**（字間スペース・かな同形字・ダッシュ類）で照合される |
| `signature` |  | 予約フィールド（署名付き配布フェーズで検証を実装。現在は未検証） |

※ `rules` と `words` の少なくとも一方が必要。

未知のフィールドは無視される（前方互換）。例:
[examples/packs/sample-fictional.mnrkpack.json](../examples/packs/sample-fictional.mnrkpack.json)

## 作法

- **実在の個人名を配布パックに含めない**（プライバシー）。公知の
  法人名・公的機関名のリスト（企業名鑑・病院名簿等）は公開情報であり
  含めてよい（[ADR-017](adr/017-default-vs-paid-content-boundary.jp.md)）。
  このリポジトリ内のサンプル・フィクスチャは従来どおり架空名のみ。
- カテゴリ名は既存のもの（organization / person / model-number 等）に
  合わせると、候補UIのフィルタや判断がそのまま機能する。

## 本体デフォルトとの境界

何を本体に同梱し、何をパックにするかは
[ADR-017](adr/017-default-vs-paid-content-boundary.jp.md) の3テスト
（安全底線・垂直性・キュレーション価値）で判断する。検出エンジンの
機能は恒久的に無料であり、パックが担うのはデータ（検出内容）のみ。

## 現状の制限（将来課題）

- プロジェクト単位の有効/無効切り替えは未実装（取り込む＝全体で有効）。
- CLI (`menreiki analyze`) はパックを読まない（デスクトップのみ）。
- 署名検証は未実装（`signature` は予約のみ）。
