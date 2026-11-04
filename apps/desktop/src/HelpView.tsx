import HelpEn from "./HelpEn";
import HelpJa from "./HelpJa";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";
import { useFocusLayer } from "./Modal";

/// Full-page help. The body is long-form prose with inline emphasis and
/// diagrams, so each language has its own component rather than a dictionary
/// of fragments.
///
/// It is a page, not a dialog, but it covers the app: it renders outside
/// `#root`, which goes inert behind it, and Escape returns from it.
export default function HelpView(props: { onClose: () => void }) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useFocusLayer(ref, { onEscape: props.onClose });
  return createPortal(
    <div ref={ref} className="help-view">
      <header className="toolbar">
        <button onClick={props.onClose}>{t("help.back")}</button>
        <span className="file-name">{t("help.title")}</span>
      </header>
      <div className="help-scroll">
        <div className="help-body">
          {language === "ja" ? <HelpJa /> : <HelpEn />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
