import HelpEn from "./HelpEn";
import HelpJa from "./HelpJa";
import { useI18n } from "./i18n";

/// Full-page help. The body is long-form prose with inline emphasis and
/// diagrams, so each language has its own component rather than a dictionary
/// of fragments.
export default function HelpView(props: { onClose: () => void }) {
  const { t, language } = useI18n();
  return (
    <div className="help-view">
      <header className="toolbar">
        <button onClick={props.onClose}>{t("help.back")}</button>
        <span className="file-name">{t("help.title")}</span>
      </header>
      <div className="help-scroll">
        <div className="help-body">
          {language === "ja" ? <HelpJa /> : <HelpEn />}
        </div>
      </div>
    </div>
  );
}
