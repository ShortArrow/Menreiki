import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  importDocument,
  openProject,
  openSample,
  registerFileAssociation,
} from "./api";
import { useI18n } from "./i18n";
import type { ProjectInfo } from "./types";

export default function HomeView(props: {
  onOpened: (project: ProjectInfo) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<ProjectInfo | null>) {
    setBusy(label);
    setError(null);
    try {
      const project = await action();
      if (project) props.onOpened(project);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(null);
    }
  }

  function pickDocument() {
    void run(t("home.importing"), async () => {
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
    });
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
      {error && <p className="error">{error}</p>}
      <p className="note">{t("home.localOnly")}</p>
      <button
        className="link-button"
        onClick={() => {
          setError(null);
          setNotice(null);
          registerFileAssociation()
            .then(() => setNotice(t("home.associated")))
            .catch((failure) => setError(String(failure)));
        }}
      >
        {t("home.associate")}
      </button>
      {notice && <p className="status">{notice}</p>}
    </div>
  );
}
