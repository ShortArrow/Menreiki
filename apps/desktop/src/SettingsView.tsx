import { useEffect, useState } from "react";
import {
  getConfig,
  getProjectSettings,
  listDetectors,
  setConfig,
  setProjectSettings,
} from "./api";

/// Settings dialog: project-scoped detector selection (persisted in the
/// project.mnrk) and app-level local-LLM configuration (config.toml).
export default function SettingsView(props: {
  projectDir: string;
  onClose: () => void;
  onDetectorsChanged: () => void;
}) {
  const [allDetectors, setAllDetectors] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listDetectors(),
      getProjectSettings(props.projectDir),
      getConfig(),
    ])
      .then(([ids, settings, config]) => {
        if (cancelled) return;
        setAllDetectors(ids);
        // null / absent means "all detectors".
        setEnabled(new Set(settings.detectors ?? ids));
        setBaseUrl(config.inference.base_url);
        setModel(config.inference.model);
        setReady(true);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectDir]);

  function toggle(id: string) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const allOn = allDetectors.every((id) => enabled.has(id));
      await setProjectSettings(props.projectDir, {
        detectors: allOn ? null : allDetectors.filter((id) => enabled.has(id)),
      });
      const config = await getConfig();
      await setConfig({
        ...config,
        inference: { base_url: baseUrl.trim(), model: model.trim() },
      });
      props.onDetectorsChanged();
      props.onClose();
    } catch (failure) {
      setError(String(failure));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>設定</h2>
          <button onClick={props.onClose}>閉じる</button>
        </div>
        <div className="modal-body">
          <section>
            <h2>このプロジェクトで使う検出器</h2>
            <p className="hint">
              チェックを外した検出器は、この文書では動作しません（project.mnrk に保存）。
            </p>
            <div className="detector-grid">
              {allDetectors.map((id) => (
                <label key={id} className="detector-item">
                  <input
                    type="checkbox"
                    checked={enabled.has(id)}
                    onChange={() => toggle(id)}
                  />
                  {id}
                </label>
              ))}
            </div>
          </section>

          <section>
            <h2>ローカルLLM（アプリ全体）</h2>
            <p className="hint">
              接続先はこのマシンに限定されます（config.toml に保存）。
            </p>
            <label className="field">
              エンドポイント
              <input
                value={baseUrl}
                placeholder="http://localhost:11434/v1"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
            <label className="field">
              モデル
              <input
                value={model}
                placeholder="qwen3（VLM検出は vision モデル）"
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
          </section>

          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="primary" onClick={save} disabled={!ready || saving}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
