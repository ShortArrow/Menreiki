import { useEffect, useState } from "react";
import {
  getConfig,
  getProjectSettings,
  listDetectors,
  listModels,
  setConfig,
  setProjectSettings,
} from "./api";
import type { IgnoreEntry } from "./types";

/// Settings dialog: project-scoped detector selection (persisted in the
/// project.mnrk) and app-level local-LLM configuration (config.toml).
export default function SettingsView(props: {
  projectDir: string;
  onClose: () => void;
  onDetectorsChanged: () => void;
}) {
  const [allDetectors, setAllDetectors] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [ignored, setIgnored] = useState<IgnoreEntry[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
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
        setIgnored(settings.ignored ?? []);
        setBaseUrl(config.inference.base_url);
        setModel(config.inference.model);
        setReady(true);
        void refreshModels(config.inference.base_url);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectDir]);

  /// Asks the endpoint which models it serves, so the field below can offer
  /// them. A failure (endpoint down, no server) is shown as a hint, not an
  /// error — the user can always type the name by hand.
  async function refreshModels(url: string) {
    const target = url.trim();
    if (!target) return;
    setLoadingModels(true);
    setModelsError(null);
    try {
      setModels(await listModels(target));
    } catch (failure) {
      setModels([]);
      setModelsError(String(failure));
    } finally {
      setLoadingModels(false);
    }
  }

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
        ignored,
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
            <h2>無視する語（このプロジェクト）</h2>
            <p className="hint">
              誤検出をここに入れると、この文書では検出候補になりません。候補行の
              「無視」ボタンからも追加できます。
            </p>
            {ignored.length === 0 ? (
              <p className="status">なし</p>
            ) : (
              <div className="text-rules">
                {ignored.map((entry, index) => {
                  const text =
                    typeof entry === "string" ? entry : entry.text;
                  const scope =
                    typeof entry === "string" ? "すべて" : entry.category;
                  return (
                    <div key={`${text}-${scope}-${index}`} className="text-rule">
                      <span className="chip-action">{scope}</span>
                      <span className="rule-text" title={text}>
                        {text}
                      </span>
                      <button
                        onClick={() =>
                          setIgnored((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
                onBlur={(event) => void refreshModels(event.target.value)}
              />
            </label>
            <label className="field">
              モデル
              <div className="field-row combo">
                <span className="combo-input-wrap">
                  <input
                    value={model}
                    placeholder="qwen3（VLM検出は vision モデル）"
                    onChange={(event) => setModel(event.target.value)}
                  />
                  {model && (
                    <button
                      type="button"
                      className="combo-clear"
                      title="クリア"
                      onClick={() => setModel("")}
                    >
                      ×
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  title="検出済みモデルの一覧から選ぶ"
                  onClick={() => {
                    setModelFilter("");
                    setModelMenuOpen((open) => !open);
                  }}
                >
                  ▾
                </button>
                <button
                  type="button"
                  onClick={() => void refreshModels(baseUrl)}
                  disabled={loadingModels}
                >
                  {loadingModels ? "取得中…" : "再取得"}
                </button>
                {modelMenuOpen && (
                  <>
                    <div
                      className="menu-backdrop"
                      onClick={() => setModelMenuOpen(false)}
                    />
                    <div className="menu combo-popover">
                      <input
                        autoFocus
                        placeholder="絞り込み（選択値には影響しません）"
                        value={modelFilter}
                        onChange={(event) =>
                          setModelFilter(event.target.value)
                        }
                      />
                      {models
                        .filter((id) =>
                          id
                            .toLowerCase()
                            .includes(modelFilter.trim().toLowerCase()),
                        )
                        .map((id) => (
                          <button
                            key={id}
                            type="button"
                            className={id === model ? "current" : undefined}
                            onClick={() => {
                              setModel(id);
                              setModelMenuOpen(false);
                            }}
                          >
                            {id}
                          </button>
                        ))}
                      {models.length === 0 && (
                        <span className="hint">
                          候補がありません（「再取得」をお試しください）
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </label>
            <p className="hint">
              {loadingModels
                ? "モデルを取得しています…"
                : modelsError
                  ? `モデル一覧を取得できませんでした（エンドポイントが起動しているか確認してください）。名前は手入力もできます。`
                  : models.length > 0
                    ? `${models.length} 個のモデルを検出。▾で一覧から選択、手入力も可能です。`
                    : "候補はありません。名前を手入力してください。"}
            </p>
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
