import { useId } from "react";
import { useI18n } from "./i18n";
import Modal from "./Modal";

/// Asked before an export while candidates are still undecided. It states the
/// fact and the count, then hands the decision back to the reviewer: it never
/// blocks the export (ADR-015 — detection over-collects on purpose, and the
/// release decision is the human's).
///
/// Focus starts on "back to review" so that repeated Enter in the page-range
/// field cannot slip through to an export. Escape and a backdrop click cancel.
export default function ExportConfirmDialog(props: {
  undecidedCount: number;
  busy: boolean;
  onCancel: () => void;
  onProceed: () => void;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <Modal
      titleId={titleId}
      className="export-confirm"
      onDismiss={props.onCancel}
      fallbackFocus={props.fallbackFocus}
    >
      <h2 id={titleId}>{t("review.exportConfirmTitle")}</h2>
      <p>{t("review.exportConfirmBody", { count: props.undecidedCount })}</p>
      <div className="modal-actions">
        <button autoFocus onClick={props.onCancel}>
          {t("review.exportConfirmBack")}
        </button>
        <button disabled={props.busy} onClick={props.onProceed}>
          {t("review.exportConfirmProceed")}
        </button>
      </div>
    </Modal>
  );
}
