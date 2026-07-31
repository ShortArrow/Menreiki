import { ChevronDown, X } from "./icons";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getConfig,
  getProjectSettings,
  importDetectorPack,
  listDetectorPacks,
  listDetectors,
  listModels,
  removeDetectorPack,
  setConfig,
  setProjectSettings,
} from "./api";
import {
  resolveLanguage,
  useI18n,
  type Language,
  type LanguagePreference,
} from "./i18n";
import type { IgnoreEntry, PackInfo } from "./types";

/// Settings dialog: project-scoped detector selection (persisted in the
/// project.mnrk) and app-level configuration — UI language and the optional
/// local LLM (config.toml).
export default function SettingsView(props: {
  projectDir: string;
  onClose: () => void;
  onDetectorsChanged: () => void;
  onLanguageChange: (language: Language) => void;
}) {
  const { t } = useI18n();
  const [uiLanguage, setUiLanguage] = useState<LanguagePreference>("auto");
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
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [packError, setPackError] = useState<string | null>(null);

  useEffect(() => {
    void listDetectorPacks()
      .then(setPacks)
      .catch(() => {});
  }, []);

  /// Imports a pack file (validated by the backend) and refreshes the list;
  /// packs apply to every project's next detection run.
  async function importPack() {
    setPackError(null);
    const file = await open({
      multiple: false,
      filters: [
        { name: t("settings.packFilter"), extensions: ["json", "mnrkpack"] },
      ],
    });
    if (typeof file !== "string") return;
    try {
      await importDetectorPack(file);
      setPacks(await listDetectorPacks());
      props.onDetectorsChanged();
    } catch (failure) {
      setPackError(String(failure));
    }
  }

  async function removePack(name: string) {
    try {
      await removeDetectorPack(name);
      setPacks(await listDetectorPacks());
      props.onDetectorsChanged();
    } catch (failure) {
      setPackError(String(failure));
    }
  }

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
        setUiLanguage(config.ui_language);
        setBaseUrl(config.inference.base_url);
        setModel(config.inference.model);
        setReady(true);
        void refreshModels(config.inference.base_url, { quiet: true });
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectDir]);

  /// Asks the endpoint which models it serves, so the field below can offer
  /// them. The LLM is optional, so a failure (endpoint down, no server) is
  /// only worth mentioning when the user asked for the fetch — the automatic
  /// fetch on open stays quiet, otherwise the dialog greets everyone without
  /// a local server with what reads like a broken required dependency.
  async function refreshModels(url: string, options?: { quiet: boolean }) {
    const target = url.trim();
    if (!target) return;
    setLoadingModels(true);
    setModelsError(null);
    try {
      setModels(await listModels(target));
    } catch (failure) {
      setModels([]);
      if (!options?.quiet) setModelsError(String(failure));
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
        ui_language: uiLanguage,
        inference: { base_url: baseUrl.trim(), model: model.trim() },
      });
      props.onLanguageChange(resolveLanguage(uiLanguage));
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
          <h2>{t("settings.title")}</h2>
          <button onClick={props.onClose}>{t("settings.close")}</button>
        </div>
        <div className="modal-body">
          <section>
            <h2>{t("settings.language")}</h2>
            <p className="hint">{t("settings.languageHint")}</p>
            <select
              value={uiLanguage}
              aria-label={t("settings.language")}
              onChange={(event) =>
                setUiLanguage(event.target.value as LanguagePreference)
              }
            >
              <option value="auto">{t("settings.languageAuto")}</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </section>

          <section>
            <h2>{t("settings.detectors")}</h2>
            <p className="hint">{t("settings.detectorsHint")}</p>
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
            <h2>{t("settings.ignored")}</h2>
            <p className="hint">{t("settings.ignoredHint")}</p>
            {ignored.length === 0 ? (
              <p className="status">{t("settings.ignoredEmpty")}</p>
            ) : (
              <div className="text-rules">
                {ignored.map((entry, index) => {
                  const text =
                    typeof entry === "string" ? entry : entry.text;
                  const scope =
                    typeof entry === "string"
                      ? t("settings.ignoredAllCategories")
                      : entry.category;
                  return (
                    <div key={`${text}-${scope}-${index}`} className="text-rule">
                      <span className="chip-action">{scope}</span>
                      <span className="rule-text" title={text}>
                        {text}
                      </span>
                      <button
                        aria-label={t("settings.ignoredRemove")}
                        onClick={() =>
                          setIgnored((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2>{t("settings.llm")}</h2>
            <p className="hint">{t("settings.llmHint")}</p>
            <label className="field">
              {t("settings.endpoint")}
              <input
                value={baseUrl}
                placeholder="http://localhost:11434/v1"
                onChange={(event) => setBaseUrl(event.target.value)}
                onBlur={(event) => void refreshModels(event.target.value)}
              />
            </label>
            <label className="field">
              {t("settings.model")}
              <div className="field-row combo">
                <span className="combo-input-wrap">
                  <input
                    value={model}
                    placeholder={t("settings.modelPlaceholder")}
                    onChange={(event) => setModel(event.target.value)}
                  />
                  {model && (
                    <button
                      type="button"
                      className="combo-clear"
                      title={t("settings.clear")}
                      aria-label={t("settings.clear")}
                      onClick={() => setModel("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  title={t("settings.modelListTitle")}
                  aria-label={t("settings.openModelList")}
                  onClick={() => {
                    setModelFilter("");
                    setModelMenuOpen((open) => !open);
                  }}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void refreshModels(baseUrl)}
                  disabled={loadingModels}
                >
                  {loadingModels
                    ? t("settings.refreshing")
                    : t("settings.refresh")}
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
                        placeholder={t("settings.modelFilter")}
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
                          {t("settings.noModelCandidates")}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </label>
            <p className="hint">
              {loadingModels
                ? t("settings.loadingModels")
                : modelsError
                  ? t("settings.modelsFailed")
                  : models.length > 0
                    ? t("settings.modelsFound", { count: models.length })
                    : t("settings.modelsNone")}
            </p>
          </section>

          <section>
            <h2>{t("settings.packs")}</h2>
            <p className="hint">{t("settings.packsHint")}</p>
            {packs.length === 0 && (
              <p className="hint">{t("settings.packsEmpty")}</p>
            )}
            {packs.map((pack) => (
              <div key={pack.name} className="rule-entry">
                <span className="category-tag">{pack.version}</span>
                <span className="rule-target" title={pack.description}>
                  <span className="finding-text">
                    {pack.displayName}
                    {t("settings.packSummary", {
                      rules: pack.ruleCount,
                      words: pack.wordCount,
                      publisher: pack.publisher
                        ? t("settings.packPublisher", {
                            name: pack.publisher,
                          })
                        : "",
                    })}
                  </span>
                </span>
                <button
                  aria-label={t("settings.packRemove")}
                  onClick={() => void removePack(pack.name)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <div className="field-row">
              <button type="button" onClick={() => void importPack()}>
                {t("settings.packImport")}
              </button>
            </div>
            {packError && <p className="error">{packError}</p>}
          </section>

          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="primary" onClick={save} disabled={!ready || saving}>
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
