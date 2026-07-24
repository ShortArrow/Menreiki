import {
  BadgeCheck,
  FileText,
  PenLine,
  Printer,
  ScanSearch,
} from "./icons";

/// Full-page help, written for reviewers who are not IT specialists: what
/// the tool does, the basic 5-step workflow, task-based recipes, and a plain
/// glossary up front; the technical diagrams (data flow, state transitions,
/// grouping model) are kept but folded away under "しくみを詳しく".
export default function HelpView(props: { onClose: () => void }) {
  return (
    <div className="help-view">
      <header className="toolbar">
        <button onClick={props.onClose}>← レビューに戻る</button>
        <span className="file-name">ヘルプ</span>
      </header>
      <div className="help-scroll">
        <div className="help-body">
          <h2>Menreiki は何をする道具？</h2>
          <p>
            書類（PDFや画像）の中にある「外に見せたくない言葉」——会社名・人名・
            型番・住所・電話番号など——にアプリが印をつけ、
            <b>あなたが1つずつ確認してから</b>、黒塗り・白塗り・別の言葉への
            置き換えをした新しいPDFを作ります。
            <b>元のファイルは一切変更されません。</b>
            すべてこのパソコンの中だけで処理され、外部には何も送信されません。
          </p>

          <div className="help-flow simple">
            <div className="row">
              <span className="node">
                <FileText size={15} /> 書類を取り込む
              </span>
              <span className="arrow-h">→</span>
              <span className="node">
                <ScanSearch size={15} /> 解析で印がつく
              </span>
              <span className="arrow-h">→</span>
              <span className="node strong">
                <PenLine size={15} /> あなたが決める
              </span>
              <span className="arrow-h">→</span>
              <span className="node">
                <Printer size={15} /> 適用して出力
              </span>
              <span className="arrow-h">→</span>
              <span className="node">
                <BadgeCheck size={15} /> 消し残りチェック
              </span>
            </div>
          </div>

          <h2>4つの決め方</h2>
          <p>候補の言葉ひとつひとつに、次のどれかを選びます。</p>
          <div className="decide-demo">
            <div className="decide-item">
              <span className="demo-before">秘密</span>
              <span className="arrow-h">→</span>
              <span className="demo-after keep">秘密</span>
              <span className="decide-label">保持（そのまま）</span>
            </div>
            <div className="decide-item">
              <span className="demo-before">秘密</span>
              <span className="arrow-h">→</span>
              <span className="demo-after mask">██</span>
              <span className="decide-label">マスク（黒塗り）</span>
            </div>
            <div className="decide-item">
              <span className="demo-before">秘密</span>
              <span className="arrow-h">→</span>
              <span className="demo-after erase"> </span>
              <span className="decide-label">消去（跡を残さない）</span>
            </div>
            <div className="decide-item">
              <span className="demo-before">秘密</span>
              <span className="arrow-h">→</span>
              <span className="demo-after replace">別名A</span>
              <span className="decide-label">置換（言い換え）</span>
            </div>
          </div>

          <h2>いちばん大事な考え方 — 同じ相手は1つの仮名に（Entity）</h2>
          <div className="entity-demo">
            <div className="entity-demo-sources">
              <span className="demo-before">株式会社アルファ技研</span>
              <span className="demo-before">アルファ技研</span>
              <span className="demo-before">アルファ</span>
            </div>
            <span className="arrow-h big">→</span>
            <span className="node strong">Entity</span>
            <span className="arrow-h big">→</span>
            <span className="demo-after replace">すべて「開発会社A」に</span>
          </div>
          <p>
            書き方が違っても同じ相手なら、Entityにまとめると文書全体で同じ
            仮名になります。読み手には「同じ会社の話」だと伝わったまま、
            それがどこの会社かは分からなくなります。
          </p>

          <h2>基本の使い方（5ステップ）</h2>
          <ol className="help-steps">
            <li>
              <b>「解析を実行」を押す</b> — アプリが書類を読み取り、
              隠した方がよさそうな言葉に<b>オレンジの枠</b>をつけます。
            </li>
            <li>
              <b>右側の「検出候補」を上から確認</b> — 各言葉をどうするか
              ボタンで決めます。
              <b>保持</b>=そのまま残す ／ <b>マスク</b>=黒塗り ／
              <b>消去</b>=白塗り（跡を残さない）／ <b>置換</b>=別の言葉に
              置き換え。間違って印がついた言葉は<b>「無視」</b>で外せます。
            </li>
            <li>
              <b>「適用」を押す</b> — 決めた内容が紙面に反映されます。
              ツールバーの「変換後を表示」で仕上がりを確認できます。
            </li>
            <li>
              <b>「PDF出力」を押す</b> — 新しいPDFが作られます
              （Markdown・画像でも出力できます）。
            </li>
            <li>
              <b>「監査」を押す</b> — 出来上がりをアプリがもう一度読み直し、
              消したはずの言葉が残っていないか最終チェックします。
            </li>
          </ol>

          <h2>やりたいこと別の操作</h2>
          <table className="help-table">
            <tbody>
              <tr>
                <th>アプリが見つけていない言葉を隠したい</th>
                <td>
                  右側の「文字列で検索」に入力して検索し、出てきたボタンで
                  ルール化します。紙面上で場所が分かっているなら、
                  「矩形選択: <b>ここを検出</b>」でその部分を囲むだけでもOKです。
                </td>
              </tr>
              <tr>
                <th>
                  同じ会社が色々な書き方で出てくる
                  <br />
                  （株式会社アルファ技研 / アルファ技研 / アルファ）
                </th>
                <td>
                  候補行の「E」で<b>Entity</b>（同一対象のまとめ）に登録します。
                  どの書き方も文書全体で<b>同じ仮名</b>（例:
                  開発会社A）に置き換わるので、読み手には関係が伝わったまま、
                  相手が誰かは分からなくなります。
                </td>
              </tr>
              <tr>
                <th>ロゴ・印影・図の中の文字を消したい</th>
                <td>
                  「矩形選択: <b>消去</b> または <b>マスク</b>」でその場所を
                  ドラッグして囲みます。文字としてではなく<b>場所（座標）</b>で
                  消すので、読み取れない画像にも効きます。全ページ同じ位置に
                  あるヘッダー等は「全ページ」を選ぶと一括です。
                </td>
              </tr>
              <tr>
                <th>毎回の書類に出てくる社名を次回から自動で見つけたい</th>
                <td>
                  「辞書に登録」します。以後の解析で自動的に候補になります。
                </td>
              </tr>
              <tr>
                <th>どこがどう変わるのか、適用前に確認したい</th>
                <td>
                  適用予定ルールの各行の開閉ボタンを開くと、出現箇所ごとの
                  <b>変換前 → 変換後</b>の切り抜きが見られます。クリックで
                  その場所へジャンプします。ビューア上部の「適用予定を重ねる」
                  でも紙面上に直接プレビューできます。
                </td>
              </tr>
              <tr>
                <th>適用した結果を確認したい</th>
                <td>
                  「結果」に変換前 → 変換後の切り抜き一覧が出ます。
                  クリックでその場所へジャンプします。
                </td>
              </tr>
            </tbody>
          </table>

          <h2>言葉の意味</h2>
          <table className="help-table">
            <tbody>
              <tr>
                <th>検出候補</th>
                <td>
                  「隠した方がよいかも」とアプリが<b>提案</b>した言葉の一覧。
                  あくまで提案なので、採用するかはあなたが決めます。
                </td>
              </tr>
              <tr>
                <th>Entity（エンティティ）</th>
                <td>
                  「書き方は違うが同じ相手」をまとめる入れ物。まとめた表記は
                  すべて1つの仮名に置き換わります。
                </td>
              </tr>
              <tr>
                <th>辞書</th>
                <td>この書類・プロジェクトで自動的に探してほしい言葉のリスト。</td>
              </tr>
              <tr>
                <th>適用予定ルール</th>
                <td>
                  「適用」ボタンが実行する作業リスト。候補への判断・Entity・
                  検索・囲んだ領域は、最終的にすべてここに集まります。
                </td>
              </tr>
              <tr>
                <th>監査</th>
                <td>
                  出来上がりをアプリが読み直して消し残りを探す最終チェック。
                  Pass でも、公開前の最終確認は必ず人の目で行ってください。
                </td>
              </tr>
              <tr>
                <th>OCR</th>
                <td>
                  画像から文字を読み取る機能（コピー機の文字認識と同じもの）。
                  読み間違いもあるため、候補の文字が少し欠けることがあります。
                </td>
              </tr>
              <tr>
                <th>LLM検出 / VLM検出</th>
                <td>
                  ローカルAI（このPC内で動く人工知能）に文章やページ画像を
                  見せて、見落としを提案させる補助機能。結果は候補に載るだけで、
                  勝手に消したりはしません。
                </td>
              </tr>
            </tbody>
          </table>

          <h2>画面の見かた</h2>
          <table className="help-table">
            <tbody>
              <tr>
                <th>左: ページ一覧</th>
                <td>
                  サムネイルの色付きマークは候補・領域のおおよその位置
                  （上の「位置」で表示切替）。オレンジの点は候補があるページ。
                </td>
              </tr>
              <tr>
                <th>中央: 紙面</th>
                <td>
                  オレンジ枠=候補（クリックすると右側の該当行が光ります）、
                  紫枠=検索ヒット。Ctrl+ホイールで拡大縮小、
                  「スクロールでページ送り」をオンにするとホイールでめくれます。
                </td>
              </tr>
              <tr>
                <th>右: 作業リスト</th>
                <td>
                  上から「出力前確認（残作業の数）→ 検索 → 検出候補 → Entity →
                  適用予定ルール → 辞書 → 結果」。作業の流れと同じ並びです。
                </td>
              </tr>
            </tbody>
          </table>

          <h2>知っておくと安心</h2>
          <ul>
            <li>元のPDF・画像は読み取るだけで、書き換えません。</li>
            <li>
              出力PDFは変換後の<b>画像だけ</b>から作り直すため、黒塗りの下に
              文字データが残る、という事故は構造上起きません。
            </li>
            <li>処理はすべてこのPC内で完結し、ネットワークに送信されません。</li>
            <li>
              候補への判断や囲んだ領域は自動保存されます。アプリを閉じても
              続きから再開できます。
            </li>
            <li>
              <b>プロジェクトフォルダ（.menreiki）自体は機密です。</b>
              中に原本のコピーと読み取った全文が入っているため、出力PDFとは
              別物として保管し、不要になったら確実に削除してください。
            </li>
            <li>
              出力の公開可否の最終判断は、必ず人の目で行ってください。
              監査のPassは「設定した検査を通過した」ことの確認であり、
              安全の証明ではありません。
            </li>
          </ul>

          <h2>しくみを詳しく（読みたい人だけ）</h2>

          <details className="help-details">
            <summary>データの流れ（全体図）</summary>
            <p>
              すべての操作は最終的に<b>適用予定ルール</b>へ合流します。
            </p>
            <div className="help-flow">
              <div className="row">
                <span className="node">自動検出（解析・辞書・LLM/VLM）</span>
                <span className="node">検索</span>
                <span className="node">ここを検出(矩形)</span>
              </div>
              <span className="arrow">↓ 候補になる</span>
              <div className="row">
                <span className="node strong">検出候補</span>
              </div>
              <span className="arrow">
                ↓ 判断（保持/マスク/消去/置換）・Entityへ統合
              </span>
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
                <span className="node">変換後ページ画像</span>
              </div>
              <span className="arrow">↓</span>
              <div className="row">
                <span className="node">PDF / Markdown / 画像出力</span>
                <span className="node">監査（再読み取りで残存チェック）</span>
              </div>
              <span className="arrow">↓</span>
              <div className="row">
                <span className="node strong">結果</span>
              </div>
            </div>
          </details>

          <details className="help-details">
            <summary>グルーピングの構造（操作がどの範囲に効くか）</summary>
            <p>粒度は3段階の入れ子です。</p>
            <div className="help-tree">
              <div className="tree-node level-0">
                <span className="tree-tag entity-tag">Entity</span>
                「開発会社A」 — 表記揺れの束。置換先は1つの仮称
              </div>
              <div className="tree-node level-1">
                <span className="tree-tag group-tag">候補グループ</span>
                分類 × 文字列（organization ×「株式会社アルファ技研」）
              </div>
              <div className="tree-node level-2">
                <span className="tree-tag occ-tag">出現</span> p.1 —
                位置つきの1件（メインビューの矩形1つ）
              </div>
              <div className="tree-node level-2">
                <span className="tree-tag occ-tag">出現</span> p.4
              </div>
              <div className="tree-node level-1">
                <span className="tree-tag group-tag">候補グループ</span>
                organization ×「アルファ技研」
              </div>
              <div className="tree-node level-2">
                <span className="tree-tag occ-tag">出現</span> p.2
              </div>
            </div>
            <table className="help-table">
              <tbody>
                <tr>
                  <th>出現</th>
                  <td>位置＋文字列を持つ1件。ジャンプ・切り抜きの単位。</td>
                </tr>
                <tr>
                  <th>候補グループ</th>
                  <td>
                    「分類 × 文字列」が同じ出現の集まり。IDは分類と文字列の組で、
                    位置は含まれません。検出候補リストの1行がこれで、「p.3+2」は
                    他ページにも出現がある印。
                    <b>判断・無視・「既存候補へ」統合は文書全体に効きます</b>
                    （特定の1箇所だけ扱いたいときはマスク領域を使います）。
                  </td>
                </tr>
                <tr>
                  <th>Entity</th>
                  <td>複数の候補グループを1つの仮称へ束ねる最上位。</td>
                </tr>
              </tbody>
            </table>
            <p>
              同じ文字列に複数の指定が重なった場合は1つに集約されます（優先順:
              <b>Entity ＞ 候補の判断 ＞ 検索ルール</b>）。
            </p>
          </details>

          <details className="help-details">
            <summary>検出データの状態遷移（位置と文字列）</summary>
            <p>
              1つの検出データは<span className="inline-badge pos">位置</span>と
              <span className="inline-badge txt">文字列</span>を持ちます。
              どの状態でどちらが保持され、どこで一旦失われ、いつ再解決されるか。
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
              <span className="arrow">↓ 自動検出・ここを検出・LLM照合</span>
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
              <span className="arrow">
                ↓ 判断・Entity・検索・辞書（位置はここで一旦捨てられる）
              </span>
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
              ポイント: ルール・Entity・辞書は<b>文字列だけ</b>を持ち、位置は
              適用の瞬間に再解決されます。「ここを検出」でピン留めした位置は
              OCRが誤読していても適用に反映されます。VLMの位置未特定候補だけは
              矩形が無いため適用できず、「ここを検出」で囲み直すかマスク領域で
              対処します。
            </p>
          </details>

          <details className="help-details">
            <summary>変換ボタンの行き先マップ</summary>
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
                  <td>その語×分類のみ除外。設定画面で解除できる</td>
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
          </details>

          <details className="help-details">
            <summary>矩形選択モードと再解析メニュー</summary>
            <table className="help-table">
              <tbody>
                <tr>
                  <th>なし</th>
                  <td>矩形操作オフ。候補矩形のクリックナビゲーションが有効。</td>
                </tr>
                <tr>
                  <th>消去 / マスク</th>
                  <td>
                    ドラッグで座標ベースの領域ルールを作成（文字列に依存しない）。
                    適用範囲は「全ページ」または「このページ」。
                  </td>
                </tr>
                <tr>
                  <th>ここを検出</th>
                  <td>
                    囲んだ箇所の文字を読み取り（切り出し読取→ページ語→VLM の順）、
                    その座標に手動候補としてピン留め。検出バーから即変換でき、
                    「既存候補へ」で既存グループの検出漏れとして統合できます。
                  </td>
                </tr>
                <tr>
                  <th>再解析: すべて / 続きから / このページのみ</th>
                  <td>
                    やり直しの範囲を選べます。検出器や辞書を変えた後は
                    「検出のみ」が最速（多くの場合自動でも走ります）。
                  </td>
                </tr>
                <tr>
                  <th>再解析: LLM検出 / VLM検出</th>
                  <td>
                    ローカルAIによる補助候補。VLMはページ画像を見るため図中の
                    文字も拾えますが、読み取り位置が無い語は「位置未特定」に
                    なります。
                  </td>
                </tr>
              </tbody>
            </table>
            <ul>
              <li>Ctrl+ホイール: 拡大縮小 ／ Shift+ホイール: 左右スクロール</li>
              <li>ペイン境界はドラッグで幅変更（保存されます）</li>
              <li>判断ボタンは再クリックで未判断に戻ります</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
