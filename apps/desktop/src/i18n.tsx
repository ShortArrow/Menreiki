import { createContext, useContext, type ReactNode } from "react";

export type Language = "ja" | "en";

/// What the user picked in the settings dialog. "auto" follows the OS.
export type LanguagePreference = "auto" | Language;

/// Japanese is the source dictionary: it defines the key set, and English
/// below is type-checked against it so a missing translation is a build
/// error rather than a Japanese string leaking into an English UI.
export const ja = {
  "app.toggleTheme": "テーマを切り替える",

  "home.tagline": "意味を残して、面を替える。",
  "home.importing": "取り込み中…",
  "home.opening": "読み込み中…",
  "home.preparingSample": "サンプルを準備中…",
  "home.documentFilter": "文書",
  "home.projectFilter": "Menreikiプロジェクト",
  "home.import": "文書を取り込む（PDF / PNG / JPEG）",
  "home.openProject": "既存のプロジェクトを開く（project.mnrk）",
  "home.openSample": "サンプルを開いて試す（文書の用意は不要）",
  "home.sampleHint":
    "架空のテスト文書で、検出候補の確認・置換・監査までひと通り試せます。",
  "home.localOnly":
    "すべての処理はローカルで実行されます。ネットワークへは接続しません。",
  "home.associate": ".mnrk をこのアプリに関連付ける（ポータブル利用時）",
  "home.associated": ".mnrk をこのアプリに関連付けました。",
  "home.help": "ヘルプ",
  "home.projectExistsSame":
    "この文書のプロジェクトは既にあります（{path}）。続きからレビューできます。",
  "home.projectExistsDifferent":
    "同じ場所に、内容の異なる文書（{fileName}）のプロジェクトがあるため取り込めません（{path}）。入力ファイルの名前を変えてから取り込み直してください。",
  "home.projectExistsUnknown":
    "同じ場所にフォルダが既にあるため取り込めません（{path}）。",
  "home.openExistingProject": "このプロジェクトを開く",

  "viewer.zoomOut": "縮小",
  "viewer.fitWidth": "幅に合わせる",
  "viewer.zoomIn": "拡大",
  "viewer.wheelHint": "Ctrl+ホイールで拡大縮小 / Shift+ホイールで左右",
  "viewer.loading": "ページ画像を読み込み中…",
  "viewer.emptyNotAnalyzed":
    "この文書はまだ解析されていません。解析すると、ページ画像の生成・OCR・候補検出をこの PC 上で行います。",
  "viewer.emptyImagesMissing":
    "ページ画像が見つかりません。最初から解析し直してください（候補は作り直されます。判断・辞書・Entity は残ります）。",
  "viewer.revealFinding": "クリックで右ペインの該当候補を表示",
  "viewer.revealRegionRule": "クリックで右ペインの該当ルールを表示",

  "settings.title": "設定",
  "settings.close": "閉じる",
  "settings.save": "保存",
  "settings.language": "言語 / Language",
  "settings.languageHint": "「自動」はOSの言語に従います。",
  "settings.languageAuto": "自動 / Auto",
  "settings.detectors": "このプロジェクトで使う検出器",
  "settings.detectorsHint":
    "チェックを外した検出器は、この文書では動作しません（project.mnrk に保存）。",
  "detector.organization.label": "会社名・団体名",
  "detector.organization.description":
    "株式会社・有限会社・合同会社が前後に付いた名称や、グループ・ホールディングスなどで終わる名称。例: 株式会社アルファ技研",
  "detector.aliased-name.label": "略称定義（〜と称する）",
  "detector.aliased-name.description":
    "「〜と称する」の直前にある名前。例: （以下「アルファ」と称する）のアルファ",
  "detector.department.label": "部署名",
  "detector.department.description":
    "事業部・本部・支店・研究所など、または部・課・係で終わる名称。例: 第二開発部",
  "detector.person.label": "人名（敬称付き）",
  "detector.person.description":
    "氏・殿・さんが付いた短い名前。例: 田中氏。敬称のない氏名は対象外",
  "detector.place.label": "地名",
  "detector.place.description":
    "都・府・県・市・区・町・村で終わる短い名称と北海道。例: 青葉台市",
  "detector.phone-jp.label": "電話番号（国内）",
  "detector.phone-jp.description":
    "0で始まり、ハイフンか括弧で区切った番号。例: 03-1234-5678。区切りのない数字の並びは対象外",
  "detector.postal-code.label": "郵便番号",
  "detector.postal-code.description":
    "3桁-4桁の番号（〒はなくても可）。例: 123-4567",
  "detector.date.label": "日付（西暦）",
  "detector.date.description":
    "西暦の年月日。例: 2024年4月1日、2024-04-01、2024/04/01。和暦は対象外",
  "detector.email.label": "メールアドレス",
  "detector.email.description": "例: user@example.com",
  "detector.url.label": "URL",
  "detector.url.description": "http または https で始まるアドレス。例: https://example.com/page",
  "detector.ip-address.label": "IPアドレス",
  "detector.ip-address.description": "ドット区切りの4つの数字（IPv4）。例: 192.0.2.10",
  "detector.mac-address.label": "MACアドレス",
  "detector.mac-address.description":
    "コロン区切りの16進数6組。例: 00:1A:2B:3C:4D:5E",
  "detector.phone-intl.label": "電話番号（国際形式）",
  "detector.phone-intl.description":
    "+と国番号で始まる番号。例: +81 3-1234-5678",
  "settings.ignored": "無視する語（このプロジェクト）",
  "settings.ignoredHint":
    "誤検出をここに入れると、この文書では検出候補になりません。候補行の「無視」ボタンからも追加できます。",
  "settings.ignoredEmpty": "なし",
  "settings.ignoredAllCategories": "すべて",
  "settings.ignoredRemove": "無視リストから削除",
  "settings.llm": "ローカルLLM（任意・アプリ全体）",
  "settings.llmHint":
    "設定しなくてもすべての機能を使えます。接続先はこのマシンに限定されます（config.toml に保存）。",
  "settings.endpoint": "エンドポイント",
  "settings.model": "モデル",
  "settings.modelPlaceholder": "qwen3（VLM検出は vision モデル）",
  "settings.clear": "クリア",
  "settings.openModelList": "モデル一覧を開く",
  "settings.modelListTitle": "検出済みモデルの一覧から選ぶ",
  "settings.refresh": "再取得",
  "settings.refreshing": "取得中…",
  "settings.modelFilter": "絞り込み（選択値には影響しません）",
  "settings.noModelCandidates": "候補がありません（「再取得」をお試しください）",
  "settings.loadingModels": "モデルを取得しています…",
  "settings.modelsFailed":
    "モデル一覧を取得できませんでした（エンドポイントが起動しているか確認してください）。名前は手入力もできます。",
  "settings.modelsFound":
    "{count} 個のモデルを検出。一覧ボタンから選択、手入力も可能です。",
  "settings.modelsNone": "候補はありません。名前を手入力してください。",
  "settings.packs": "検出パック（アプリ全体）",
  "settings.packsHint":
    "業種別の検出ルール・用語をまとめたデータファイル（*.mnrkpack.json）。取り込むと全プロジェクトの解析に参加し、候補には pack:名前 として出典が付きます。",
  "settings.packsEmpty": "取り込まれたパックはありません。",
  "settings.packSummary": "（ルール{rules}・語{words}{publisher}）",
  "settings.packPublisher": "・{name}",
  "settings.packRemove": "パックを削除",
  "settings.packRemoveConfirm":
    "{name}（ルール{rules}・語{words}）を以後の全プロジェクトの解析から外します。保存を待たず即時に削除され、元に戻せません。",
  "settings.packRemoveYes": "削除する",
  "settings.packRemoveNo": "やめる",
  "settings.packImport": "パックを取り込む…",
  "settings.packFilter": "検出パック",

  "action.keep": "保持",
  "action.erase": "消去",
  "action.mask": "マスク",
  "action.replace": "置換",
  "action.release": "{action}を解除",

  "alias.organization": "組織",
  "alias.department": "部署",
  "alias.person": "人物",
  "alias.product": "製品",
  "alias.place": "地名",
  "alias.fallback": "対象",

  "progress.pageOf": "（{page}ページ目）",
  "progress.pageOfTotal": "（{page} / {total}ページ）",
  "progress.render": "ページを画像化しています…{pages}",
  "progress.ocr": "OCRを実行しています…{pages}",
  "progress.detect": "機密候補を検出しています…",
  "progress.markdown": "Markdownを生成しています…{pages}",
  "progress.llm": "ローカルLLMで候補を探しています…{pages}",
  "progress.vlm": "ローカルVLMがページ画像を確認しています…{pages}",
  "progress.audit": "再検査しています…{pages}",
  "progress.done": "解析が完了しました",

  "review.suggestReplacements":
    "ローカルLLMに置換候補を提案させる（意味を残した仮称・一般化）",
  "review.alignLeft": "左揃え",
  "review.alignCenter": "中央揃え",
  "review.alignRight": "右揃え",
  "review.toEntity": "Entityへ（表記揺れを1つの仮称へ統合）",
  "review.newEntity": "＋ 新規Entity",
  "review.mergeIntoExisting": "既存の検出候補グループの検出漏れとして統合する",
  "review.toExisting": "既存候補へ",
  "review.source.regex": "正規表現",
  "review.source.dictionary": "辞書",
  "review.source.layout": "繰り返し",
  "review.source.llm": "LLM",
  "review.source.vlm": "VLM",
  "review.source.manual": "手動",
  "review.source.advisory": "参考情報（確定ではありません）",
  "review.filterCandidates": "候補を絞り込み",
  "review.noMatchingCandidates": "一致する候補がありません",
  "review.copyPath": "パスをコピー",
  "review.copy": "コピー",
  "review.output": "出力: {path}",
  "review.projectPath": "プロジェクトフォルダ: {path}",
  "review.reveal": "エクスプローラーで表示",
  "review.revealUnsupported":
    "この OS ではフォルダを開けません（Windows のみ対応）。",
  "review.importedNotice": "プロジェクトフォルダを作成しました: {path}",
  "review.importedCaution":
    "原本のコピーと OCR 全文を含みます。保管場所に注意し、不要になったら削除してください。",
  "review.dismissNotice": "この通知を閉じる",
  "review.searchingOccurrences": "出現箇所を検索中…",
  "review.noOccurrences": "本文中に出現箇所が見つかりません（位置未特定の可能性）",
  "review.alignAll": "全体の揃え（個別指定はリセット）:",
  "review.jumpToOccurrence": "クリックで該当箇所へジャンプ",
  "review.updatingDictionary": "辞書を更新中…",
  "review.registeringDictionary": "辞書に登録中…",
  "review.analyzing": "解析中…",
  "review.analysisCancelled":
    "解析をキャンセルしました。「解析を再開」で続きから実行できます。",
  "review.auditCancelled":
    "監査を中断しました。合否は記録されていません。共有前に監査をやり直してください。",
  "review.applying": "変換を適用中…",
  "review.rebuildingPdf": "PDFを再構築中…",
  "review.exportedPages": "{count} ページを出力しました。",
  "review.undecidedWarning":
    "{scope}未判断の候補が {count} 種類残っています。出力を共有する前に確認してください。",
  "review.emptyReplaceWarning":
    "置換値が空の置換が {count} 件あり、■■■ で出力されました。",
  "review.auditNudge":
    "共有する前に「監査」を実行してください。変換後のページを再OCRし、ポリシーの対象語が残っていないかを照合します。",
  "review.unlocatedWarning":
    "{scope}位置未特定のため判断が適用されていない候補が {count} 種類あります。同じページで「ここを検出」で囲んで割り当てるか、出力を目視で確認してください。",
  "review.exportConfirmTitle": "未判断の候補があります",
  "review.exportConfirmBody":
    "未判断の候補が {count} 種類あります。このまま出力すると、これらは元の表記のまま残る可能性があります。",
  "review.exportConfirmBack": "レビューに戻る",
  "review.exportConfirmProceed": "このまま出力",
  "review.exportingImages": "画像を出力中…",
  "review.generatingMarkdown": "Markdownを生成中…",
  "review.auditing": "再検査中…",
  "review.llmDetecting": "LLM検出中…",
  "review.searching": "検索中…",
  "review.mergingIntoExisting": "既存候補へ統合中…",
  "review.searchingBody": "本文を検索中…",
  "review.notFoundInBody": "「{text}」は本文中に見つかりませんでした",
  "review.readingRegion": "領域を読み取り中…",
  "review.vlmReadingRegion": "OCRで読めない領域をVLMで読み取り中…",
  "review.vlmRead": "VLM読取: {texts}",
  "review.regionNoText": "この領域からは文字を取得できませんでした。",
  "review.regionVlmOffHint":
    "（任意）設定の「ローカルLLM」で VLM を設定すると、OCR で読めない領域も読み取れます。",
  "review.regionReadFailed": "この領域の読み取り中にエラーが発生しました: {errors}",
  "review.stageRegionOcr": "領域OCR",
  "review.stagePageOcr": "ページOCR",
  "review.stageVlm": "VLM",
  "review.addingToIgnore": "無視リストに追加中…",
  "review.ignoredNotice": "「{text}」（{category}）を無視リストに追加しました",
  "review.undoingIgnore": "無視を取り消し中…",
  "review.removingFromDictionary": "辞書から削除中…",
  "review.redetecting": "再検出中…",
  "review.dictionaryRegisteredApplied": "登録し、検出候補へ反映しました。",
  "review.dictionaryRegistered": "登録しました。解析すると検出候補に反映されます。",
  "review.home": "← ホーム",
  "review.decisionsLoadFailed":
    "判断（decisions.json）を読み込めませんでした: {error}\nこの状態での変更は保存されません。ファイルを確認してから、プロジェクトを開き直してください。",
  "review.entitiesLoadFailed":
    "Entity（entities.json）を読み込めませんでした: {error}\nこの状態での変更は保存されません。ファイルを確認してから、プロジェクトを開き直してください。",
  "review.saveSaving": "保存中…",
  "review.saveSaved": "保存済み",
  "review.saveFailed": "保存に失敗しました: {error}",
  "review.discardAndHome": "保存せずにホームへ戻る",
  "review.reanalyze": "再解析…",
  "review.reanalyzeAll": "すべて（最初から）",
  "review.reanalyzeResume": "続きから再開",
  "review.reanalyzePage": "このページ（p.{page}）のみ再解析",
  "review.reanalyzeRender": "画像化のみ",
  "review.reanalyzeOcr": "OCRのみ＋検出",
  "review.reanalyzeDetect": "検出のみ",
  "review.reanalyzeLlm": "LLM検出（テキスト・実験的）",
  "review.reanalyzeVlm": "VLM検出（ページ画像・実験的）",
  "review.reanalyzeLlmSetup": "LLM検出 — 設定で構成…",
  "review.reanalyzeVlmSetup": "VLM検出 — 設定で構成…",
  "review.resumeHint": "完了済みのページをスキップして続きから解析します",
  "review.resume": "解析を再開",
  "review.fromScratch": "最初から",
  "review.runAnalysis": "解析を実行",
  "review.settingsTitle": "設定（検出器・ローカルLLM）",
  "review.settings": "設定",
  "review.showTransformed": "変換後を表示",
  "review.apply": "適用（{count}ルール）",
  "review.unappliedChanges": "未適用の変更があります",
  "review.exportPdf": "PDF出力",
  "review.exportAllPages": "すべてのページを出力",
  "review.pageRangePlaceholder": "ページ指定（例: 1-3, 5, 8）",
  "review.exportSelectedPages": "選択ページを出力",
  "review.exportMarkdown": "Markdown出力",
  "review.exportImagesTitle": "変換後ページをPNG画像として output/images/ に出力",
  "review.exportImages": "画像出力",
  "review.audit": "監査",
  "review.helpTitle": "ヘルプ（各要素の対応関係とデータの流れ）",
  "review.cancel": "キャンセル",
  "review.thumbOverlayTitle":
    "検出候補と領域ルールのおおよその位置をサムネイルに重ねる",
  "review.position": "位置",
  "review.resizeLeftPane": "ドラッグで左ペインの幅を変更",
  "review.rectSelect": "矩形選択:",
  "review.drawNone": "なし",
  "review.drawDetect": "ここを検出",
  "review.scope": "適用範囲:",
  "review.scopeAll": "全ページ",
  "review.scopeThisPage": "このページ",
  "review.dragToAddRegion": "ドラッグで領域ルールを追加",
  "review.dragToDetect":
    "検出したい箇所をドラッグで囲むと、その文字を検出対象にします",
  "review.detectWaitsForAnalysis":
    "解析中は「ここを検出」を使えません。解析が終わってから囲んでください",
  "review.scrollPagingTitle":
    "ページ下端/上端でさらにスクロールすると次/前のページへ",
  "review.scrollPaging": "スクロールでページ送り",
  "review.overlayPending": "適用予定を重ねる",
  "review.resizeRightPane": "ドラッグで右ペインの幅を変更",

  "review.preflight": "出力前確認",
  "review.undecidedCount": "未判断の候補: {count} 種類",
  "review.emptyReplaceCount": "置換値が空の置換: {count} 件（■■■ で出力）",
  "review.decidedCount": "判断済み: {count} 種類",
  "review.decisionGroup": "{category}「{text}」の判定",
  "review.entityCoveredCount": "うち Entity による置換: {count} 種類",
  "review.conflictCount": "競合する置換: {count} 件",
  "review.conflictBadge": "競合",
  "review.conflictTooltip": "Entity『{alias}』の置換が優先されます",
  "review.unlocatedCount": "位置未特定（適用されません）: {count} 種類",
  "review.unlocatedBadge": "位置未特定",
  "review.unlocatedHint":
    "位置未特定: 画像内で検出されましたが、ページ上の位置が分からないため、この判断は適用されません。同じページで「ここを検出」で囲み、このグループに割り当ててください。マスク領域で覆った場合もこの件数は残るので、出力を目視で確認してください。",
  "review.pendingRules": "適用予定ルール: {count} 件",
  "review.detected": "検出",
  "review.jumpTo": "{text}（クリックで該当箇所へ）",
  "review.close": "閉じる",
  "review.toEntityShort": "Entityへ",
  "review.toDictionary": "辞書へ",
  "review.searchByText": "文字列で検索",
  "review.searchPlaceholder": "例: 株式会社アルファ技研",
  "review.search": "検索",
  "review.suggestTargetsTitle":
    "ローカルLLMに、この文書で検出すべき機密語の候補を提案させる",
  "review.suggesting": "提案中…",
  "review.suggestTargets": "AIに検出対象を提案させる",
  "review.noSuggestions": "提案はありませんでした",
  "review.searchThisWord": "クリックでこの語を検索",
  "review.searchHits": "{count} 件見つかりました",
  "review.registerEntity": "Entityとして登録",
  "review.addReplaceRule": "置換ルールに追加",
  "review.addMaskRule": "マスクルールに追加",
  "review.addEraseRule": "消去ルールに追加",
  "review.categoryOrganization": "組織名",
  "review.categoryDepartment": "部署名",
  "review.categoryPerson": "人物名",
  "review.categoryProduct": "製品名",
  "review.categoryPlace": "地名",
  "review.categoryOther": "その他",
  "review.categoryModelNumber": "型式",
  "review.categoryPhone": "電話番号",
  "review.categoryDate": "日付",
  "review.categoryEmail": "メールアドレス",
  "review.categoryUrl": "URL",
  "review.categoryIpAddress": "IPアドレス",
  "review.categoryPostalCode": "郵便番号",
  "review.categoryMacAddress": "MACアドレス",
  "review.categoryIdentifier": "識別子",
  "review.registerDictionary": "辞書に登録（以後の解析で自動検出）",
  "review.dictionary": "辞書（{count}件）",
  "review.save": "保存",
  "review.undo": "取消",
  "review.editText": "文字列を修正",
  "review.delete": "削除",
  "review.regionRemoved": "領域ルールを1件削除しました",
  "review.pendingRulesHeading": "適用予定ルール（{count}件）",
  "review.toggleCrops": "出現箇所のビフォー/アフターを開閉",
  "review.variantsToAlias": "{count}表記 → {alias}",
  "review.variantSeparator": "、",
  "review.aliasUnset": "（仮称未設定）",
  "review.replacementPlaceholder": "置換後",
  "review.findingReplacementLabel": "「{text}」の置換後",
  "review.release": "解除",
  "review.searchTag": "検索",
  "review.jumpToRegion": "クリックで該当領域へジャンプ",
  "review.regionTag": "領域",
  "review.regionPageOnly": "p.{page} のみ",
  "review.preview": "プレビュー",
  "review.rulesEmpty": "候補の判断・検索・矩形選択でルールを作成します",
  "review.clearAllRules": "判断・文字列・矩形ルールを一括解除…",
  "review.clearAllTitle": "判断・文字列・矩形ルールの一括解除",
  "review.clearAllBody":
    "判断 {decisions} 種類（うち保持 {keep} 種類）、文字列ルール {texts} 件、矩形ルール {regions} 件を解除します。Entity と配置の例外は残ります。この操作は元に戻せません。",
  "review.clearAllConfirm": "一括解除する",
  "review.entities": "Entity（{count}件）",
  "review.aliasPlaceholder": "仮称",
  "review.registerRepresentative": "代表表記を辞書に登録（以後の解析で自動検出）",
  "review.toDictionaryArrow": "→辞書",
  "review.removeVariant": "表記を外す",
  "review.confirmDeleteEntity":
    "Entity「{alias}」（表記ゆれ{count}件）を削除しますか？",
  "review.confirmDelete": "削除を確定",
  "review.deletedEntity": "Entity「{alias}」を削除しました",
  "review.removedVariant": "表記「{text}」を外しました",
  "review.removedDictionaryEntry": "辞書から「{text}」を削除しました",
  "review.undoDeletion": "元に戻す",
  "review.dismissUndo": "元に戻す案内を閉じる",
  "review.similarVariants": "類似表記の候補:",
  "review.entitiesEmpty":
    "検索結果の「Entityとして登録」や候補行の「E」から、表記揺れを1つの仮称へまとめられます",
  "review.candidates": "検出候補（{count}種{suffix}）",
  "review.candidatesAll": " / 全{count}件",
  "review.candidatesFiltered": " / {count}件",
  "review.candidateFilter": "絞り込み（語・分類・p.3）",
  "review.allCategories": "すべての分類",
  "review.undecidedOnly": "未判断のみ",
  "review.bulkApplyLabel": "表示中の未判断 {count} 種類に適用:",
  "review.bulkApplyExcluded":
    "位置未特定を含む {count} 種類は対象外。個別に判断してください",
  "review.bulkApplyTitle": "{action}を {count} 種類に一括適用",
  "review.bulkApplyScope":
    "判断は「分類＋文字列」単位で文書全体に効きます。p.1 などで絞り込んでいても、他のページの同じ候補にも及びます。",
  "review.bulkApplyTextWide":
    "マスク／消去は、同じ文字列が別の分類で検出された箇所にも効きます。Entity の置換や別の判断が優先される場合があります。",
  "review.bulkApplyKeepOutput":
    "「保持」した候補は未マスクのまま出力されます。出力は未判断のときと変わりません。",
  "review.bulkApplyKeepCount":
    "これらの候補は、出力前確認の未判断件数から外れます。",
  "review.bulkApplyConfirm": "{action}を {count} 種類に適用",
  "review.excludeFromDetection": "「{text}」を{category}の検出から除外",
  "review.ignore": "無視",
  "review.noCandidates": "検出候補はありません",
  "review.ocrFallbackWarning":
    "日本語のOCR言語パックが見つからないため、{lang} のOCRエンジンで読み取りました。日本語の人名・組織名・地名などはほとんど読み取れず、検出候補にも監査にも出てきません。設定 → 時刻と言語 → 言語と地域 → 日本語 → 言語のオプション → 光学式文字認識 から言語パックを導入し、解析をやり直してください。",
  "review.runAnalysisForCandidates": "解析を実行すると候補が表示されます",
  "review.noMatchingFilter": "絞り込み条件に一致する候補はありません",
  "review.results": "結果",
  "review.applied": "適用済み: {edits} 箇所 / {pages} ページ",
  "review.jumpToSpot": "該当箇所へジャンプ",
  "review.auditResult": "監査: {verdict}（{terms}語 / {pages}ページ）",
  "review.auditVerdictPassWithWarnings": "Pass with warnings",
  "review.auditOcrFallbackWarning":
    "日本語のOCR言語パックが見つからないため、{lang} のOCRエンジンで照合しました。日本語の識別情報が残っていても検出できない可能性があります。言語パックを導入してから解析と監査をやり直してください。",
  "review.auditRegionsUnchecked":
    "領域ルール {count} 件は監査対象外です。『{showTransformed}』で位置を目視確認してください。",
  "review.auditRegionsOnly":
    "監査は文字の再読み取りチェックのため、消去/マスクの矩形は検査しません。『{showTransformed}』で矩形の位置を目視確認してください。",
  "review.auditNoTerms":
    "監査する語がありません。候補を決定するか検索ルールを追加してください。",
  "review.auditPassUndecidedNote":
    "未判断の候補 {count} 種類は、監査の検査語の作成元に含まれていません。",
  "review.residual": "p.{page} 残存 [{term}] {text}",
  "review.regionPreview": "領域プレビュー（全{pages}ページ・{action}）",
  "review.regionPreviewHint":
    "この領域が各ページで何を含むか確認してから適用してください。",

  "help.back": "← 戻る",
  "help.title": "ヘルプ",

  "error.audit.noTerms":
    "監査で照合する語がありません。テキストの置換・マスクを決定していないため、再OCRで照合する対象がありません。矩形で消去・マスクした領域は監査では確認されません。出力画像を目で確認してください。",
  "error.inference.modelMissing":
    "ローカルLLMのモデル名が設定されていません。{settings} → {llm} でモデル名を設定してください。",
  "error.inference.invalidUrl":
    "ローカルLLMのエンドポイントのURLが正しくありません。{settings} → {llm} でエンドポイントを設定してください。",
  "error.inference.notLocal":
    "このマシン以外の推論エンドポイントには接続しません。{settings} → {llm} のエンドポイントには、このマシン上（localhost / 127.0.0.1 / ::1）のURLを設定してください。リモートのGPUを使う場合は、SSHトンネルでlocalhostに転送してください。",
  "error.inference.request":
    "ローカルの推論サーバーに接続できません。起動しているか確認してください。（{detail}）",
} as const;

export type MessageKey = keyof typeof ja;

export const en: Record<MessageKey, string> = {
  "app.toggleTheme": "Toggle theme",

  "home.tagline": "Keep the meaning. Change the face.",
  "home.importing": "Importing…",
  "home.opening": "Opening…",
  "home.preparingSample": "Preparing the sample…",
  "home.documentFilter": "Documents",
  "home.projectFilter": "Menreiki project",
  "home.import": "Import a document (PDF / PNG / JPEG)",
  "home.openProject": "Open an existing project (project.mnrk)",
  "home.openSample": "Try the built-in sample (no document needed)",
  "home.sampleHint":
    "A fictional test document that walks through reviewing candidates, replacing them, and auditing the result.",
  "home.localOnly":
    "Everything runs on this device. The app makes no network connections.",
  "home.associate": "Associate .mnrk with this app (for portable use)",
  "home.associated": ".mnrk is now associated with this app.",
  "home.help": "Help",
  "home.projectExistsSame":
    "A project for this document already exists ({path}). You can continue reviewing it.",
  "home.projectExistsDifferent":
    "Cannot import: a project for a different document ({fileName}) already exists at the same location ({path}). Rename the input file and import it again.",
  "home.projectExistsUnknown":
    "Cannot import: a folder already exists at the same location ({path}).",
  "home.openExistingProject": "Open this project",

  "viewer.zoomOut": "Zoom out",
  "viewer.fitWidth": "Fit width",
  "viewer.zoomIn": "Zoom in",
  "viewer.wheelHint": "Ctrl+wheel to zoom / Shift+wheel to pan",
  "viewer.loading": "Loading the page image…",
  "viewer.emptyNotAnalyzed":
    "This document has not been analyzed yet. Analysis renders the page images, runs OCR and detects candidates on this PC.",
  "viewer.emptyImagesMissing":
    "The page images are missing. Run the analysis again from the start (candidates are rebuilt; your decisions, dictionaries and entities are kept).",
  "viewer.revealFinding": "Click to show this candidate in the right pane",
  "viewer.revealRegionRule": "Click to show this rule in the right pane",

  "settings.title": "Settings",
  "settings.close": "Close",
  "settings.save": "Save",
  "settings.language": "Language / 言語",
  "settings.languageHint": "\"Auto\" follows the language of your OS.",
  "settings.languageAuto": "Auto / 自動",
  "settings.detectors": "Detectors used in this project",
  "settings.detectorsHint":
    "Unchecked detectors do not run on this document (stored in project.mnrk).",
  "detector.organization.label": "Company or organization name",
  "detector.organization.description":
    "Japanese company names with a legal form such as kabushiki kaisha, or names ending in \"group\" or \"holdings\" in Japanese",
  "detector.aliased-name.label": "Defined abbreviation (Japanese contracts)",
  "detector.aliased-name.description":
    "The name right before \"to shosuru\" (hereinafter referred to as), e.g. Alpha in a clause defining \"Alpha\"",
  "detector.department.label": "Department name",
  "detector.department.description":
    "Japanese names ending in a unit word such as division, headquarters, branch, laboratory, bu, ka or kakari",
  "detector.person.label": "Person name (with honorific)",
  "detector.person.description":
    "Short names followed by an honorific (-shi, -san, -dono), e.g. Tanaka-shi. Names without an honorific are not covered",
  "detector.place.label": "Place name",
  "detector.place.description":
    "Short names ending in to, fu, ken, shi, ku, machi or mura in Japanese, plus Hokkaido",
  "detector.phone-jp.label": "Phone number (Japan)",
  "detector.phone-jp.description":
    "Numbers starting with 0, split by hyphens or parentheses, e.g. 03-1234-5678. Unseparated digit runs are not covered",
  "detector.postal-code.label": "Postal code",
  "detector.postal-code.description":
    "Seven digits as NNN-NNNN, with or without the postal mark, e.g. 123-4567",
  "detector.date.label": "Date (Western calendar)",
  "detector.date.description":
    "Year-month-day dates, e.g. 2024-04-01, 2024/04/01 or the Japanese year/month/day form. Japanese era years are not covered",
  "detector.email.label": "Email address",
  "detector.email.description": "e.g. user@example.com",
  "detector.url.label": "URL",
  "detector.url.description":
    "Addresses starting with http or https, e.g. https://example.com/page",
  "detector.ip-address.label": "IP address",
  "detector.ip-address.description":
    "Four dot-separated numbers (IPv4), e.g. 192.0.2.10",
  "detector.mac-address.label": "MAC address",
  "detector.mac-address.description":
    "Six colon-separated hex pairs, e.g. 00:1A:2B:3C:4D:5E",
  "detector.phone-intl.label": "Phone number (international)",
  "detector.phone-intl.description":
    "Numbers starting with + and a country code, e.g. +81 3-1234-5678",
  "settings.ignored": "Ignored words (this project)",
  "settings.ignoredHint":
    "Words listed here never become candidates in this document. The \"ignore\" button on a candidate row adds to this list too.",
  "settings.ignoredEmpty": "None",
  "settings.ignoredAllCategories": "All",
  "settings.ignoredRemove": "Remove from the ignore list",
  "settings.llm": "Local LLM (optional, app-wide)",
  "settings.llmHint":
    "Every feature works without it. The endpoint is restricted to this machine (stored in config.toml).",
  "settings.endpoint": "Endpoint",
  "settings.model": "Model",
  "settings.modelPlaceholder": "qwen3 (image detection needs a vision model)",
  "settings.clear": "Clear",
  "settings.openModelList": "Open the model list",
  "settings.modelListTitle": "Pick from the models found on the endpoint",
  "settings.refresh": "Refresh",
  "settings.refreshing": "Loading…",
  "settings.modelFilter": "Filter (does not change the selection)",
  "settings.noModelCandidates": "No models listed (try \"Refresh\")",
  "settings.loadingModels": "Loading models…",
  "settings.modelsFailed":
    "Could not list models (check that the endpoint is running). You can also type the name by hand.",
  "settings.modelsFound":
    "{count} models found. Pick one from the list button, or type a name.",
  "settings.modelsNone": "No models listed. Type a name instead.",
  "settings.packs": "Detector packs (app-wide)",
  "settings.packsHint":
    "Data files of industry-specific rules and terms (*.mnrkpack.json). An imported pack joins the analysis of every project, and its candidates are attributed as pack:name.",
  "settings.packsEmpty": "No packs imported.",
  "settings.packSummary": " ({rules} rules, {words} words{publisher})",
  "settings.packPublisher": ", {name}",
  "settings.packRemove": "Remove the pack",
  "settings.packRemoveConfirm":
    "Remove {name} ({rules} rules, {words} words) from every project's analysis? It is deleted immediately, without waiting for Save, and cannot be undone.",
  "settings.packRemoveYes": "Delete",
  "settings.packRemoveNo": "Keep",
  "settings.packImport": "Import a pack…",
  "settings.packFilter": "Detector packs",

  "action.keep": "Keep",
  "action.erase": "Erase",
  "action.mask": "Mask",
  "action.replace": "Replace",
  "action.release": "Undo {action}",

  "alias.organization": "Organization",
  "alias.department": "Department",
  "alias.person": "Person",
  "alias.product": "Product",
  "alias.place": "Place",
  "alias.fallback": "Target",

  "progress.pageOf": " (page {page})",
  "progress.pageOfTotal": " (page {page} of {total})",
  "progress.render": "Rendering pages to images…{pages}",
  "progress.ocr": "Running OCR…{pages}",
  "progress.detect": "Detecting sensitive candidates…",
  "progress.markdown": "Generating Markdown…{pages}",
  "progress.llm": "Asking the local LLM for candidates…{pages}",
  "progress.vlm": "The local VLM is reading the page images…{pages}",
  "progress.audit": "Re-checking output…{pages}",
  "progress.done": "Analysis complete",

  "review.suggestReplacements":
    "Ask the local LLM for replacements (aliases and generalizations that keep the meaning)",
  "review.alignLeft": "Align left",
  "review.alignCenter": "Align center",
  "review.alignRight": "Align right",
  "review.toEntity": "To an entity (merge spelling variants into one alias)",
  "review.newEntity": "+ New entity",
  "review.mergeIntoExisting": "Merge as a missed occurrence of an existing group",
  "review.toExisting": "Into existing",
  "review.source.regex": "Regex",
  "review.source.dictionary": "Dictionary",
  "review.source.layout": "Repeated",
  "review.source.llm": "LLM",
  "review.source.vlm": "VLM",
  "review.source.manual": "Manual",
  "review.source.advisory": "Advisory only — not a verdict",
  "review.filterCandidates": "Filter candidates",
  "review.noMatchingCandidates": "No matching candidates",
  "review.copyPath": "Copy the path",
  "review.copy": "Copy",
  "review.output": "Output: {path}",
  "review.projectPath": "Project folder: {path}",
  "review.reveal": "Show in Explorer",
  "review.revealUnsupported":
    "Opening the folder is not supported on this OS (Windows only).",
  "review.importedNotice": "Created the project folder: {path}",
  "review.importedCaution":
    "It contains a copy of the original and the full OCR text. Keep it somewhere safe and delete it when you no longer need it.",
  "review.dismissNotice": "Dismiss this notice",
  "review.searchingOccurrences": "Searching for occurrences…",
  "review.noOccurrences":
    "No occurrence found in the text (the position may be unresolved)",
  "review.alignAll": "Alignment for all (resets per-item choices):",
  "review.jumpToOccurrence": "Click to jump to this occurrence",
  "review.updatingDictionary": "Updating the dictionary…",
  "review.registeringDictionary": "Adding to the dictionary…",
  "review.analyzing": "Analyzing…",
  "review.analysisCancelled":
    "Analysis cancelled. \"Resume analysis\" continues from where it stopped.",
  "review.auditCancelled":
    "Audit cancelled. No verdict was recorded; run the audit again before sharing.",
  "review.applying": "Applying the transformations…",
  "review.rebuildingPdf": "Rebuilding the PDF…",
  "review.exportedPages": "Exported {count} pages. ",
  "review.undecidedWarning":
    "{scope}{count} candidate kinds are still undecided. Review them before sharing the output. ",
  "review.emptyReplaceWarning":
    "{count} replacements have no value and were exported as ■■■. ",
  "review.auditNudge":
    "Run Audit before sharing: it re-OCRs the transformed pages and checks that the policy's terms no longer appear.",
  "review.unlocatedWarning":
    "{scope}{count} candidate kinds have a decision that is not applied because their location is unknown. Box them with \"Detect here\" on the same page and assign them, or check the output visually. ",
  "review.exportConfirmTitle": "Some candidates are undecided",
  "review.exportConfirmBody":
    "{count} candidate kinds are still undecided. If you export now, they may remain in their original form.",
  "review.exportConfirmBack": "Back to review",
  "review.exportConfirmProceed": "Export anyway",
  "review.exportingImages": "Exporting images…",
  "review.generatingMarkdown": "Generating Markdown…",
  "review.auditing": "Re-checking…",
  "review.llmDetecting": "Running LLM detection…",
  "review.searching": "Searching…",
  "review.mergingIntoExisting": "Merging into the existing group…",
  "review.searchingBody": "Searching the text…",
  "review.notFoundInBody": "\"{text}\" was not found in the text",
  "review.readingRegion": "Reading the region…",
  "review.vlmReadingRegion": "Reading the region with the VLM (OCR could not)…",
  "review.vlmRead": "VLM read: {texts}",
  "review.regionNoText": "No text could be read from this region.",
  "review.regionVlmOffHint":
    "(Optional) Set up a VLM under \"Local LLM\" in Settings to read regions that OCR cannot.",
  "review.regionReadFailed": "An error occurred while reading this region: {errors}",
  "review.stageRegionOcr": "Region OCR",
  "review.stagePageOcr": "Page OCR",
  "review.stageVlm": "VLM",
  "review.addingToIgnore": "Adding to the ignore list…",
  "review.ignoredNotice": "Added \"{text}\" ({category}) to the ignore list",
  "review.undoingIgnore": "Undoing the ignore…",
  "review.removingFromDictionary": "Removing from the dictionary…",
  "review.redetecting": "Detecting again…",
  "review.dictionaryRegisteredApplied":
    "Added, and applied to the current candidates.",
  "review.dictionaryRegistered":
    "Added. It will appear in the candidates on the next analysis.",
  "review.home": "← Home",
  "review.decisionsLoadFailed":
    "Could not load the decisions (decisions.json): {error}\nChanges made now will not be saved. Check the file, then reopen the project.",
  "review.entitiesLoadFailed":
    "Could not load the entities (entities.json): {error}\nChanges made now will not be saved. Check the file, then reopen the project.",
  "review.saveSaving": "Saving…",
  "review.saveSaved": "Saved",
  "review.saveFailed": "Save failed: {error}",
  "review.discardAndHome": "Return home without saving",
  "review.reanalyze": "Re-analyze…",
  "review.reanalyzeAll": "Everything (from scratch)",
  "review.reanalyzeResume": "Resume where it stopped",
  "review.reanalyzePage": "This page (p.{page}) only",
  "review.reanalyzeRender": "Rendering only",
  "review.reanalyzeOcr": "OCR and detection only",
  "review.reanalyzeDetect": "Detection only",
  "review.reanalyzeLlm": "LLM detection (text, experimental)",
  "review.reanalyzeVlm": "VLM detection (page images, experimental)",
  "review.reanalyzeLlmSetup": "LLM detection — set up in Settings…",
  "review.reanalyzeVlmSetup": "VLM detection — set up in Settings…",
  "review.resumeHint": "Skips finished pages and continues from there",
  "review.resume": "Resume analysis",
  "review.fromScratch": "From scratch",
  "review.runAnalysis": "Run analysis",
  "review.settingsTitle": "Settings (detectors, local LLM)",
  "review.settings": "Settings",
  "review.showTransformed": "Show the result",
  "review.apply": "Apply ({count} rules)",
  "review.unappliedChanges": "Unapplied changes",
  "review.exportPdf": "Export PDF",
  "review.exportAllPages": "Export every page",
  "review.pageRangePlaceholder": "Pages (e.g. 1-3, 5, 8)",
  "review.exportSelectedPages": "Export the selected pages",
  "review.exportMarkdown": "Export Markdown",
  "review.exportImagesTitle":
    "Export the transformed pages as PNG files under output/images/",
  "review.exportImages": "Export images",
  "review.audit": "Audit",
  "review.helpTitle": "Help (how the pieces relate and how data flows)",
  "review.cancel": "Cancel",
  "review.thumbOverlayTitle":
    "Overlay the approximate positions of candidates and region rules on the thumbnails",
  "review.position": "Positions",
  "review.resizeLeftPane": "Drag to resize the left pane",
  "review.rectSelect": "Rectangle:",
  "review.drawNone": "None",
  "review.drawDetect": "Detect here",
  "review.scope": "Scope:",
  "review.scopeAll": "All pages",
  "review.scopeThisPage": "This page",
  "review.dragToAddRegion": "Drag to add a region rule",
  "review.dragToDetect":
    "Drag around what you want detected to make that text a candidate",
  "review.detectWaitsForAnalysis":
    "Detect here is unavailable during analysis. Draw the box once it finishes",
  "review.scrollPagingTitle":
    "Scrolling past the bottom or top of a page moves to the next or previous one",
  "review.scrollPaging": "Scroll to change pages",
  "review.overlayPending": "Overlay pending changes",
  "review.resizeRightPane": "Drag to resize the right pane",

  "review.preflight": "Before you export",
  "review.undecidedCount": "Undecided: {count} kinds",
  "review.emptyReplaceCount": "Empty replacement values: {count} (exported as ■■■)",
  "review.decidedCount": "Decided: {count} kinds",
  "review.decisionGroup": "Decision for {category} \"{text}\"",
  "review.entityCoveredCount": "Of which replaced by an entity: {count} kinds",
  "review.conflictCount": "Conflicting replacements: {count}",
  "review.conflictBadge": "Conflict",
  "review.conflictTooltip": "The replacement from entity \"{alias}\" takes precedence",
  "review.unlocatedCount": "Location unknown (not applied): {count} kinds",
  "review.unlocatedBadge": "Location unknown",
  "review.unlocatedHint":
    "Location unknown: found in the page image, but its position on the page is unknown, so this decision is not applied. Box it with \"Detect here\" on the same page and assign it to this group. Covering it with a mask region does not clear this count, so check the output visually.",
  "review.pendingRules": "Pending rules: {count}",
  "review.detected": "Detected",
  "review.jumpTo": "{text} (click to jump to it)",
  "review.close": "Close",
  "review.toEntityShort": "To entity",
  "review.toDictionary": "To dictionary",
  "review.searchByText": "Search the text",
  "review.searchPlaceholder": "e.g. Alpha Giken Inc.",
  "review.search": "Search",
  "review.suggestTargetsTitle":
    "Ask the local LLM which sensitive terms this document should hide",
  "review.suggesting": "Thinking…",
  "review.suggestTargets": "Ask AI what to detect",
  "review.noSuggestions": "No suggestions",
  "review.searchThisWord": "Click to search for this word",
  "review.searchHits": "{count} matches found",
  "review.registerEntity": "Register as an entity",
  "review.addReplaceRule": "Add a replace rule",
  "review.addMaskRule": "Add a mask rule",
  "review.addEraseRule": "Add an erase rule",
  "review.categoryOrganization": "Organization name",
  "review.categoryDepartment": "Department name",
  "review.categoryPerson": "Person name",
  "review.categoryProduct": "Product name",
  "review.categoryPlace": "Place name",
  "review.categoryOther": "Other",
  "review.categoryModelNumber": "Model number",
  "review.categoryPhone": "Phone number",
  "review.categoryDate": "Date",
  "review.categoryEmail": "Email address",
  "review.categoryUrl": "URL",
  "review.categoryIpAddress": "IP address",
  "review.categoryPostalCode": "Postal code",
  "review.categoryMacAddress": "MAC address",
  "review.categoryIdentifier": "Identifier",
  "review.registerDictionary": "Add to the dictionary (detected automatically from now on)",
  "review.dictionary": "Dictionary ({count})",
  "review.save": "Save",
  "review.undo": "Cancel",
  "review.editText": "Edit the text",
  "review.delete": "Delete",
  "review.regionRemoved": "Deleted one region rule",
  "review.pendingRulesHeading": "Pending rules ({count})",
  "review.toggleCrops": "Show or hide the before/after of each occurrence",
  "review.variantsToAlias": "{count} spellings → {alias}",
  "review.variantSeparator": ", ",
  "review.aliasUnset": "(alias not set)",
  "review.replacementPlaceholder": "Replacement",
  "review.findingReplacementLabel": "Replacement for \"{text}\"",
  "review.release": "Undo",
  "review.searchTag": "Search",
  "review.jumpToRegion": "Click to jump to this region",
  "review.regionTag": "Region",
  "review.regionPageOnly": "p.{page} only",
  "review.preview": "Preview",
  "review.rulesEmpty":
    "Rules come from deciding on candidates, searching, or drawing a rectangle",
  "review.clearAllRules": "Clear decisions, text and region rules…",
  "review.clearAllTitle": "Clear decisions, text and region rules",
  "review.clearAllBody":
    "This clears {decisions} decisions ({keep} of them Keep), {texts} text rules and {regions} region rules. Entities and alignment overrides are kept. This cannot be undone.",
  "review.clearAllConfirm": "Clear them",
  "review.entities": "Entities ({count})",
  "review.aliasPlaceholder": "Alias",
  "review.registerRepresentative":
    "Add the main spelling to the dictionary (detected automatically from now on)",
  "review.toDictionaryArrow": "→ dictionary",
  "review.removeVariant": "Remove this spelling",
  "review.confirmDeleteEntity":
    "Delete the entity \"{alias}\" ({count} spellings)?",
  "review.confirmDelete": "Confirm delete",
  "review.deletedEntity": "Deleted the entity \"{alias}\"",
  "review.removedVariant": "Removed the spelling \"{text}\"",
  "review.removedDictionaryEntry": "Removed \"{text}\" from the dictionary",
  "review.undoDeletion": "Undo",
  "review.dismissUndo": "Dismiss the undo offer",
  "review.similarVariants": "Similar spellings:",
  "review.entitiesEmpty":
    "\"Register as an entity\" in the search results, or \"E\" on a candidate row, merges spelling variants into one alias",
  "review.candidates": "Candidates ({count} kinds{suffix})",
  "review.candidatesAll": " / {count} total",
  "review.candidatesFiltered": " / {count} shown",
  "review.candidateFilter": "Filter (word, category, p.3)",
  "review.allCategories": "All categories",
  "review.undecidedOnly": "Undecided only",
  "review.bulkApplyLabel": "Apply to the {count} undecided kinds shown:",
  "review.bulkApplyExcluded":
    "{count} kinds with an unresolved position are excluded; decide them one by one",
  "review.bulkApplyTitle": "{action} {count} kinds at once",
  "review.bulkApplyScope":
    "A decision applies per category and text across the whole document. Even when filtered to p.1, it reaches the same candidate on every other page.",
  "review.bulkApplyTextWide":
    "Mask and Erase also reach the same text detected under another category. An entity replacement or another decision may take precedence.",
  "review.bulkApplyKeepOutput":
    "Candidates marked Keep are exported unmasked. The output is the same as when they are undecided.",
  "review.bulkApplyKeepCount":
    "These candidates no longer count as undecided in the pre-export check.",
  "review.bulkApplyConfirm": "Apply {action} to {count} kinds",
  "review.excludeFromDetection": "Exclude \"{text}\" from {category} detection",
  "review.ignore": "Ignore",
  "review.noCandidates": "No candidates",
  "review.ocrFallbackWarning":
    "The Japanese OCR language pack was not found, so the pages were read with the {lang} OCR engine. Japanese names, organizations, and places are mostly not recognized, so they appear neither as candidates nor in the audit. Install the pack from Settings → Time & language → Language & region → Japanese → Language options → Optical character recognition, then run the analysis again.",
  "review.runAnalysisForCandidates": "Run the analysis to see candidates",
  "review.noMatchingFilter": "No candidate matches the filter",
  "review.results": "Result",
  "review.applied": "Applied: {edits} spots across {pages} pages",
  "review.jumpToSpot": "Jump to this spot",
  "review.auditResult": "Audit: {verdict} ({terms} terms / {pages} pages)",
  "review.auditVerdictPassWithWarnings": "Pass with warnings",
  "review.auditOcrFallbackWarning":
    "The Japanese OCR language pack was not found, so the output was checked with the {lang} OCR engine. Japanese identifying text may remain undetected. Install the language pack, then run the analysis and the audit again.",
  "review.auditRegionsUnchecked":
    "{count} region rule(s) are not checked by the audit. Inspect their position with \"{showTransformed}\".",
  "review.auditRegionsOnly":
    "The audit re-reads text only, so erase/mask rectangles are not checked. Inspect their position with \"{showTransformed}\".",
  "review.auditNoTerms":
    "There are no words to audit. Decide some candidates or add a search rule first.",
  "review.auditPassUndecidedNote":
    "The {count} undecided candidate kinds are not among the sources of the audit's search terms.",
  "review.residual": "p.{page} residual [{term}] {text}",
  "review.regionPreview": "Region preview (all {pages} pages, {action})",
  "review.regionPreviewHint":
    "Check what this region covers on each page before applying it.",

  "help.back": "← Back",
  "help.title": "Help",

  "error.audit.noTerms":
    "The audit has no terms to check. No text replacement or mask has been decided, so re-OCR has nothing to look for. Areas erased or masked with a rectangle are not checked by the audit. Inspect the output images by eye.",
  "error.inference.modelMissing":
    "No local LLM model name is set. Set the model name in {settings} → {llm}.",
  "error.inference.invalidUrl":
    "The local LLM endpoint URL is not valid. Set the endpoint in {settings} → {llm}.",
  "error.inference.notLocal":
    "Menreiki does not connect to inference endpoints on other machines. In {settings} → {llm}, enter a valid URL on this machine (localhost / 127.0.0.1 / ::1). To use a remote GPU, forward it to localhost through an SSH tunnel.",
  "error.inference.request":
    "Cannot reach the local inference server. Check that it is running. ({detail})",
};

const dictionaries: Record<Language, Record<MessageKey, string>> = { ja, en };

/// Resolves the stored preference against the OS language: Japanese stays
/// Japanese, every other locale reads English.
export function resolveLanguage(preference: LanguagePreference): Language {
  if (preference !== "auto") return preference;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

/// Display labels for the category IDs the backend, the dictionary and the
/// LLM assist emit. A Map (not an object lookup) so prototype keys such as
/// `constructor` never match.
const CATEGORY_LABELS = new Map<string, MessageKey>([
  ["organization", "review.categoryOrganization"],
  ["department", "review.categoryDepartment"],
  ["person", "review.categoryPerson"],
  ["product", "review.categoryProduct"],
  ["place", "review.categoryPlace"],
  ["custom", "review.categoryOther"],
  ["other", "review.categoryOther"],
  ["search", "review.searchTag"],
  ["model-number", "review.categoryModelNumber"],
  ["phone", "review.categoryPhone"],
  ["date", "review.categoryDate"],
  ["email", "review.categoryEmail"],
  ["url", "review.categoryUrl"],
  ["ip-address", "review.categoryIpAddress"],
  ["postal-code", "review.categoryPostalCode"],
  ["mac-address", "review.categoryMacAddress"],
  ["identifier", "review.categoryIdentifier"],
]);

/// Translates a category ID for display. An ID outside the table (a pack's
/// own category, say) is shown as written: users may add their own
/// categories, and the ID is the only name they have.
export function categoryLabel(t: Translate, category: string): string {
  const key = CATEGORY_LABELS.get(category);
  return key ? t(key) : category;
}

/// Substitutes `{name}` placeholders. An unknown placeholder is left as
/// written, so a typo shows up in the UI instead of silently emptying.
function format(template: string, values?: Record<string, string | number>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

const I18nContext = createContext<{ language: Language; t: Translate }>({
  language: "ja",
  t: (key, values) => format(ja[key], values),
});

export function I18nProvider(props: {
  language: Language;
  children: ReactNode;
}) {
  const dictionary = dictionaries[props.language];
  const value = {
    language: props.language,
    t: ((key, values) => format(dictionary[key], values)) as Translate,
  };
  return (
    <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
