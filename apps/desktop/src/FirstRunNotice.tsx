const ACK_KEY = "menreiki.acknowledged.v1";

/// Whether the one-time usage notice still needs to be shown. Bumping the
/// key suffix (v1 → v2) re-shows it if the terms materially change.
export function needsAcknowledgement(): boolean {
  return localStorage.getItem(ACK_KEY) !== "1";
}

/// First-launch acknowledgement: the reviewer confirms they understand the
/// three points that the license and QUALITY.jp.md make in prose — detection
/// is not exhaustive, a passing audit is not proof of safety, and the release
/// decision is theirs. Not a contract; a deliberate, one-time reminder so the
/// responsibility boundary is seen, not just documented.
export default function FirstRunNotice(props: { onAcknowledge: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal first-run">
        <h2>ご利用の前に</h2>
        <p>
          Menreiki は書類の匿名化を<b>支援</b>する道具です。安全な公開の
          可否は、最終的にあなたの確認にかかっています。次の3点をご理解の
          うえでお使いください。
        </p>
        <ul className="first-run-points">
          <li>
            <b>検出は完全ではありません。</b>
            隠すべき言葉を見落とすことがあります（手書き・画像内文字・
            特殊なレイアウトなどは特に）。候補は上から必ず確認してください。
          </li>
          <li>
            <b>監査の「Pass」は安全の証明ではありません。</b>
            設定した検査を通過したという意味です。公開の前には必ず
            人の目で最終確認してください。
          </li>
          <li>
            <b>プロジェクトフォルダ（.menreiki）は機密です。</b>
            中に原本のコピーと読み取った全文が入っています。出力PDFとは
            別に、アクセス制御と確実な削除を行ってください。
          </li>
        </ul>
        <p className="first-run-fineprint">
          本ソフトウェアは現状有姿（AS IS）で提供され、いかなる保証も
          しません。保証範囲と責任分担の詳細はドキュメントの
          「品質保証と責任範囲」を参照してください。
        </p>
        <div className="modal-actions">
          <button
            className="primary"
            onClick={() => {
              localStorage.setItem(ACK_KEY, "1");
              props.onAcknowledge();
            }}
          >
            理解しました
          </button>
        </div>
      </div>
    </div>
  );
}
