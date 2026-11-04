import { useI18n } from "./i18n";

/// Asked before an export while candidates are still undecided. It states the
/// fact and the count, then hands the decision back to the reviewer: it never
/// blocks the export (ADR-015 — detection over-collects on purpose, and the
/// release decision is the human's).
///
/// Focus starts on "back to review" so that repeated Enter in the page-range
/// field cannot slip through to an export.
export default function ExportConfirmDialog(props: {
  undecidedCount: number;
  busy: boolean;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal export-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-confirm-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onCancel();
          }
        }}
      >
        <h2 id="export-confirm-title">{t("review.exportConfirmTitle")}</h2>
        <p>
          {t("review.exportConfirmBody", { count: props.undecidedCount })}
        </p>
        <div className="modal-actions">
          <button autoFocus onClick={props.onCancel}>
            {t("review.exportConfirmBack")}
          </button>
          <button disabled={props.busy} onClick={props.onProceed}>
            {t("review.exportConfirmProceed")}
          </button>
        </div>
      </div>
    </div>
  );
}
