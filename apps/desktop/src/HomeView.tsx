import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { importDocument, openProject } from "./api";
import type { ProjectInfo } from "./types";

export default function HomeView(props: {
  onOpened: (project: ProjectInfo) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    void run("取り込み中…", async () => {
      const file = await open({
        multiple: false,
        filters: [
          { name: "文書", extensions: ["pdf", "png", "jpg", "jpeg"] },
        ],
      });
      if (typeof file !== "string") return null;
      return importDocument(file);
    });
  }

  function pickProject() {
    void run("読み込み中…", async () => {
      const dir = await open({ directory: true });
      if (typeof dir !== "string") return null;
      return openProject(dir);
    });
  }

  return (
    <div className="home">
      <h1>Menreiki</h1>
      <p className="tagline">意味を残して、面を替える。</p>
      <div className="home-actions">
        <button onClick={pickDocument} disabled={busy !== null}>
          文書を取り込む（PDF / PNG / JPEG）
        </button>
        <button onClick={pickProject} disabled={busy !== null}>
          既存のプロジェクトを開く
        </button>
      </div>
      {busy && <p className="status">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <p className="note">
        すべての処理はローカルで実行されます。ネットワークへは接続しません。
      </p>
    </div>
  );
}
