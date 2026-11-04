import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getConfig,
  importDocument,
  openProject,
  openSample,
  registerFileAssociation,
  setConfig,
} from "./api";
import HelpView from "./HelpView";
import {
  resolveLanguage,
  useI18n,
  type Language,
  type LanguagePreference,
  type Translate,
} from "./i18n";
import type { ImportFailure, ProjectInfo } from "./types";

/// An error to show, plus the project to offer opening when the failure
/// was an import blocked by a project made from the same bytes.
type HomeError = { text: string; openPath?: string };

function isImportFailure(value: unknown): value is ImportFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "projectExists" || value.kind === "other")
  );
}

function describeFailure(failure: unknown, t: Translate): HomeError {
  if (typeof failure === "string") return { text: failure };
  if (!isImportFailure(failure)) return { text: String(failure) };
  if (failure.kind === "other") return { text: failure.message };
  const path = failure.path;
  if (failure.sameSource === true) {
    return { text: t("home.projectExistsSame", { path }), openPath: path };
  }
  if (failure.sameSource === false && failure.existingFileName !== null) {
    return {
      text: t("home.projectExistsDifferent", {
        path,
        fileName: failure.existingFileName,
      }),
    };
  }
  return { text: t("home.projectExistsUnknown", { path }) };
}

export default function HomeView(props: {
  /// `justImported` is true only for a fresh "import a document", so the
  /// review view can say once where the project folder was created.
  onOpened: (project: ProjectInfo, opts: { justImported: boolean }) => void;
  onLanguageChange: (language: Language) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<HomeError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // The stored preference, not the resolved language, so "auto" stays
  // selectable. Null until the config has loaded; the picker is disabled
  // until then so a premature change cannot overwrite unseen settings.
  const [uiLanguage, setUiLanguage] = useState<LanguagePreference | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((config) => {
        if (!cancelled) setUiLanguage(config.ui_language);
      })
      .catch((failure) => {
        if (!cancelled) setError({ text: String(failure) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function changeLanguage(next: LanguagePreference) {
    setUiLanguage(next);
    setError(null);
    // Switch first so the choice is visible at once, then persist. On a save
    // failure the new language stays on screen for this session and the
    // error is shown; the stored preference is unchanged.
    props.onLanguageChange(resolveLanguage(next));
    // Re-read so the rest of the config (theme, inference) is kept as is.
    getConfig()
      .then((config) => setConfig({ ...config, ui_language: next }))
      .catch((failure) => setError({ text: String(failure) }));
  }

  async function run(
    label: string,
    action: () => Promise<ProjectInfo | null>,
    justImported = false,
  ) {
    setBusy(label);
    setError(null);
    try {
      const project = await action();
      if (project) props.onOpened(project, { justImported });
    } catch (failure) {
      setError(describeFailure(failure, t));
    } finally {
      setBusy(null);
    }
  }

  function pickDocument() {
    void run(
      t("home.importing"),
      async () => {
        const file = await open({
          multiple: false,
          filters: [
            {
              name: t("home.documentFilter"),
              extensions: ["pdf", "png", "jpg", "jpeg"],
            },
          ],
        });
        if (typeof file !== "string") return null;
        return importDocument(file);
      },
      true,
    );
  }

  function pickProject() {
    void run(t("home.opening"), async () => {
      const file = await open({
        multiple: false,
        filters: [
          {
            name: t("home.projectFilter"),
            extensions: ["mnrk", "json"],
          },
        ],
      });
      if (typeof file !== "string") return null;
      return openProject(file);
    });
  }

  function loadSample() {
    void run(t("home.preparingSample"), () => openSample());
  }

  return (
    <>
      <div className="home">
        <h1>Menreiki</h1>
        <p className="tagline">{t("home.tagline")}</p>
        <div className="home-actions">
          <button onClick={pickDocument} disabled={busy !== null}>
            {t("home.import")}
          </button>
          <button onClick={pickProject} disabled={busy !== null}>
            {t("home.openProject")}
          </button>
        </div>
        <div className="home-sample">
          <button
            className="sample-button"
            onClick={loadSample}
            disabled={busy !== null}
          >
            {t("home.openSample")}
          </button>
          <p className="hint">{t("home.sampleHint")}</p>
        </div>
        {busy && <p className="status">{busy}</p>}
        {error && <p className="error">{error.text}</p>}
        {error?.openPath && (
          <button
            onClick={() => {
              const path = error.openPath;
              if (path) void run(t("home.opening"), () => openProject(path));
            }}
            disabled={busy !== null}
          >
            {t("home.openExistingProject")}
          </button>
        )}
        <p className="note">{t("home.localOnly")}</p>
        <button
          className="link-button"
          onClick={() => {
            setError(null);
            setNotice(null);
            registerFileAssociation()
              .then(() => setNotice(t("home.associated")))
              .catch((failure) => setError({ text: String(failure) }));
          }}
        >
          {t("home.associate")}
        </button>
        {notice && <p className="status">{notice}</p>}
        <div className="home-preferences">
          <label>
            <span>{t("settings.language")}</span>
            <select
              value={uiLanguage ?? "auto"}
              disabled={uiLanguage === null}
              aria-label={t("settings.language")}
              onChange={(event) =>
                changeLanguage(event.target.value as LanguagePreference)
              }
            >
              <option value="auto">{t("settings.languageAuto")}</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </label>
          <button
            className="link-button"
            onClick={() => setHelpOpen(true)}
            aria-label={t("home.help")}
          >
            {t("home.help")}
          </button>
        </div>
      </div>
      {helpOpen && <HelpView onClose={() => setHelpOpen(false)} />}
    </>
  );
}
