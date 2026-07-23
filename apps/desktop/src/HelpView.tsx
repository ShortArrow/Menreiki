/// Full-page help: what each element of the review screen is for and how
/// data flows between them — the map a first-time reviewer needs.
export default function HelpView(props: { onClose: () => void }) {
  return (
    <div className="help-view">
      <header className="toolbar">
        <button onClick={props.onClose}>← レビューに戻る</button>
        <span className="file-name">ヘルプ — 画面の対応関係とデータの流れ</span>
      </header>
      <div className="help-scroll">
        <div className="help-body">
        <h2>全体の流れ</h2>
        <p>
          Menreiki のレビューは「候補を集める → 判断してルールにする →
          適用して出力する → 監査で確認する」の一方向の流れです。
          すべての操作は最終的に<b>適用予定ルール</b>へ合流します。
        </p>
        <div className="help-flow">
          <div className="row">
            <span className="node">自動検出（解析・辞書・LLM/VLM）</span>
            <span className="node">検索</span>
            <span className="node">ここを検出（矩形）</span>
          </div>
          <span className="arrow">↓ 候補になる</span>
          <div className="row">
            <span className="node strong">検出候補</span>
          </div>
          <span className="arrow">↓ 判断（保持/マスク/消去/置換）・Entityへ統合</span>
          <div className="row">
            <span className="node">Entity（表記揺れ→仮称）</span>
            <span className="node">検索ルール</span>
            <span className="node">領域ルール（消去/マスク矩形）</span>
          </div>
          <span className="arrow">↓ 合流</span>
          <div className="row">
            <span className="node strong">適用予定ルール</span>
          </div>
          <span className="arrow">↓ 適用ボタン</span>
          <div className="row">
            <span className="node">変換後ページ画像（変換後を表示）</span>
          </div>
          <span className="arrow">↓</span>
          <div className="row">
            <span className="node">PDF出力 / Markdown出力</span>
            <span className="node">監査（出力を再OCRして残存チェック）</span>
          </div>
          <span className="arrow">↓</span>
          <div className="row">
            <span className="node strong">結果</span>
          </div>
        </div>

        <h2>検出データの状態遷移（位置と文字列）</h2>
        <p>
          1つの検出データは<span className="inline-badge pos">位置</span>と
          <span className="inline-badge txt">文字列</span>の2つの情報を持ちます。
          どの状態でどちらが保持され、どこで一旦失われ、いつ再解決されるかの図です。
        </p>
        <div className="help-flow">
          <div className="row">
            <span className="node">
              ページ画像<span className="badge pos">位置</span>
            </span>
          </div>
          <span className="arrow">↓ OCR</span>
          <div className="row">
            <span className="node">
              単語ボックス<span className="badge pos">位置</span>
              <span className="badge txt">文字列</span>
            </span>
          </div>
          <span className="arrow">
            ↓ 自動検出・ここを検出（手動）・LLM照合
          </span>
          <div className="row">
            <span className="node strong">
              検出候補<span className="badge pos">位置</span>
              <span className="badge txt">文字列</span>
            </span>
            <span className="node">
              VLM位置未特定<span className="badge lost">位置</span>
              <span className="badge txt">文字列</span>
            </span>
          </div>
          <span className="arrow">↓ 判断・Entity・検索・辞書（位置はここで一旦捨てられる）</span>
          <div className="row">
            <span className="node">
              ルール / Entity表記 / 辞書語
              <span className="badge lost">位置</span>
              <span className="badge txt">文字列</span>
            </span>
            <span className="node">
              無視リスト<span className="badge txt">文字列×分類</span>
            </span>
          </div>
          <span className="arrow">
            ↓ 適用 = 位置の再解決（結合OCRの文字一致 ＋ 同名候補の矩形）
          </span>
          <div className="row">
            <span className="node strong">
              edit<span className="badge pos">位置</span>
              <span className="badge txt">変換内容</span>
            </span>
          </div>
          <span className="arrow">↓ ページ画像へ焼き込み</span>
          <div className="row">
            <span className="node">
              変換後画像<span className="badge pos">位置</span>
            </span>
          </div>
          <span className="arrow">↓ 監査 = 出力を再OCRして残存を照合</span>
          <div className="row">
            <span className="node">
              残存箇所<span className="badge pos">位置</span>
              <span className="badge txt">文字列</span>
            </span>
          </div>
        </div>
        <p>
          ポイント: ルール・Entity・辞書は<b>文字列だけ</b>を持ち、位置は適用の
          瞬間に再解決されます。文字一致に加えて<b>同じ文字列の候補が持つ矩形</b>も
          使われるため、「ここを検出」でピン留めした位置はOCRが誤読していても
          適用に反映されます。VLMの位置未特定候補だけは矩形が無いため適用できず、
          「ここを検出」で囲み直すかマスク領域で対処します。
        </p>

        <h2>右ペインの各セクション</h2>
        <table className="help-table">
          <tbody>
            <tr>
              <th>出力前確認</th>
              <td>
                未判断の候補数・判断済み数・適用予定ルール数のサマリ。
                出力を共有する前にゼロ確認する場所です。
              </td>
            </tr>
            <tr>
              <th>文字列で検索</th>
              <td>
                本文から語を探す入口。ヒットした語は「置換/マスク/消去ルールに追加」
                「Entityとして登録」「辞書に登録」へ変換できます。
                ✨ボタンでローカルLLMに検出すべき語を提案させることもできます。
              </td>
            </tr>
            <tr>
              <th>検出候補</th>
              <td>
                自動検出＋手動指定の候補一覧（同じ語は1行に集約、p.3+2 は他ページにも
                出現の意味）。行のボタンで判断すると<b>適用予定ルール</b>に入ります。
                「E」で Entity へ、「無視」でこのプロジェクトから除外。
                行クリックでメインビューの該当箇所へジャンプします。
              </td>
            </tr>
            <tr>
              <th>Entity</th>
              <td>
                同一対象の表記揺れ（株式会社アルファ技研／アルファ技研／アルファ…）を
                1つの<b>仮称</b>へまとめる仕組み。登録された全表記が文書全体で仮称への
                置換ルールになります。✨で仮称の提案、⇤≡⇥で置換文字の揃え、
                「→辞書」で代表表記を辞書へ。
              </td>
            </tr>
            <tr>
              <th>適用予定ルール</th>
              <td>
                「適用」ボタンが実行する内容の一覧。Entity・判断済み候補・検索ルール・
                領域ルールがここに合流します。置換は置換後文字列と揃えを指定できます。
              </td>
            </tr>
            <tr>
              <th>辞書</th>
              <td>
                プロジェクト辞書。登録した語は<b>以後の解析で自動検出</b>されます
                （候補の種）。「E」で Entity 化もできます。
              </td>
            </tr>
            <tr>
              <th>結果</th>
              <td>
                適用のサマリ、PDF/Markdown の出力先パス、監査の Pass/Fail と
                残存箇所（クリックでジャンプ）を表示します。
              </td>
            </tr>
          </tbody>
        </table>

        <h2>メインビューの矩形</h2>
        <table className="help-table">
          <tbody>
            <tr>
              <th>オレンジ枠</th>
              <td>
                検出候補の位置。クリックすると右ペインの該当行へスクロールして
                点滅します（右ペインの行クリックの逆方向）。
              </td>
            </tr>
            <tr>
              <th>紫枠</th>
              <td>検索のヒット位置。</td>
            </tr>
            <tr>
              <th>領域ルールの矩形</th>
              <td>
                消去/マスクで描いた領域。クリックで削除できます。全ページ適用の
                領域は「プレビュー」で各ページの中身を確認してから適用してください。
              </td>
            </tr>
            <tr>
              <th>適用予定を重ねる</th>
              <td>
                変換後の見た目（黒塗り・マスク・置換文字）をページ上でプレビュー
                するトグル。置換文字の長さ・揃えの確認に使います。
              </td>
            </tr>
          </tbody>
        </table>

        <h2>矩形選択モード（ビューア上部）</h2>
        <table className="help-table">
          <tbody>
            <tr>
              <th>なし</th>
              <td>矩形操作オフ。候補矩形のクリックナビゲーションが有効。</td>
            </tr>
            <tr>
              <th>消去 / マスク</th>
              <td>
                ドラッグで<b>座標ベースの領域ルール</b>を作成（文字列に依存しない）。
                適用範囲は「全ページ」または「このページ」。ヘッダー・ロゴ・印影など
                位置が固定のものに向きます。
              </td>
            </tr>
            <tr>
              <th>ここを検出</th>
              <td>
                囲んだ箇所の文字を読み取り（切り出しOCR→ページ語→VLM の順）、
                <b>その座標に手動候補としてピン留め</b>します。検出バーから
                マスク/消去/置換/Entity/辞書へ即変換でき、「既存候補へ」で
                既存グループの検出漏れとして統合できます。モードは連続使用できます。
              </td>
            </tr>
          </tbody>
        </table>

        <h2>再解析メニュー</h2>
        <table className="help-table">
          <tbody>
            <tr>
              <th>すべて（最初から）</th>
              <td>解析成果物を破棄し、画像化→OCR→検出をやり直します。</td>
            </tr>
            <tr>
              <th>続きから再開</th>
              <td>完了済みページをスキップして残りを処理します。</td>
            </tr>
            <tr>
              <th>このページのみ再解析</th>
              <td>表示中のページだけを強制的に再処理します。</td>
            </tr>
            <tr>
              <th>画像化のみ / OCRのみ＋検出 / 検出のみ</th>
              <td>
                部分工程の再実行。検出器や辞書・無視リストを変えた後は
                「検出のみ」が最速です（自動でも走ります）。
              </td>
            </tr>
            <tr>
              <th>LLM検出 / VLM検出</th>
              <td>
                ローカルモデルによる補助候補（参考情報）。VLM はページ画像を見るため
                図・ロゴ内の文字も拾えますが、OCRに無い語は位置未特定になります
                （その場合は「ここを検出」かマスク領域で対処）。
              </td>
            </tr>
          </tbody>
        </table>

        <h2>変換ボタンの行き先マップ</h2>
        <p>
          各所の変換ボタンを押すと、その項目が「どこから → どこへ」動くかの一覧です。
        </p>
        <table className="help-table convert-table">
          <thead>
            <tr>
              <th>場所・ボタン</th>
              <th>移動</th>
              <th>補足</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>候補行: 保持/マスク/消去/置換</th>
              <td>
                <span className="from">検出候補</span> ⟶{" "}
                <span className="to">適用予定ルール</span>
              </td>
              <td>再クリックまたは「解除」で候補に戻る</td>
            </tr>
            <tr>
              <th>候補行: E</th>
              <td>
                <span className="from">検出候補</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td>全表記が置換ルールとして適用予定へ流れる</td>
            </tr>
            <tr>
              <th>候補行: 無視</th>
              <td>
                <span className="from">検出候補</span> ⟶{" "}
                <span className="to">無視リスト</span>
              </td>
              <td>その語×分類のみ除外。⚙設定で解除できる</td>
            </tr>
            <tr>
              <th>検索: ◯◯ルールに追加</th>
              <td>
                <span className="from">検索語</span> ⟶{" "}
                <span className="to">適用予定ルール</span>
              </td>
              <td>文書全体のテキストルールになる</td>
            </tr>
            <tr>
              <th>検索: Entityとして登録</th>
              <td>
                <span className="from">検索語</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td></td>
            </tr>
            <tr>
              <th>検索/検出バー: 辞書に登録</th>
              <td>
                <span className="from">語</span> ⟶{" "}
                <span className="to">辞書</span> ⟶{" "}
                <span className="to">検出候補</span>
              </td>
              <td>辞書登録後、再解析で候補として自動検出される</td>
            </tr>
            <tr>
              <th>検出バー: マスク/消去/置換</th>
              <td>
                <span className="from">検出テキスト</span> ⟶{" "}
                <span className="to">適用予定ルール</span>
              </td>
              <td></td>
            </tr>
            <tr>
              <th>検出バー: 既存候補へ</th>
              <td>
                <span className="from">検出テキスト</span> ⟶{" "}
                <span className="to">検出候補の既存グループ</span>
              </td>
              <td>検出漏れとして合流し、判断を共有する</td>
            </tr>
            <tr>
              <th>ルール行: E</th>
              <td>
                <span className="from">適用予定ルール</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td>元のルール/判断は自動で解除される</td>
            </tr>
            <tr>
              <th>辞書行: E</th>
              <td>
                <span className="from">辞書</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td>辞書には残る</td>
            </tr>
            <tr>
              <th>Entity: →辞書</th>
              <td>
                <span className="from">Entity</span> ⟶{" "}
                <span className="to">辞書</span>
              </td>
              <td>代表表記を登録。Entityには残る</td>
            </tr>
          </tbody>
        </table>

        <h2>覚えておくと速い操作</h2>
        <ul>
          <li>Ctrl+ホイール: 拡大縮小（カーソル位置基準）／ Shift+ホイール: 左右スクロール</li>
          <li>「スクロールでページ送り」: ページ端でさらにスクロールするとページがめくれます</li>
          <li>ペイン境界はドラッグで幅変更（設定は保存されます）</li>
          <li>判断ボタンは再クリックで未判断に戻ります</li>
          <li>誤検出は候補行の「無視」— その語×分類だけをこのプロジェクトから除外します</li>
        </ul>
        </div>
      </div>
    </div>
  );
}
