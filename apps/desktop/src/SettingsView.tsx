import { ChevronDown, X } from "./icons";
import { useEffect, useId, useRef, useState } from "react";
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
import Modal from "./Modal";
import {
  categoryLabel,
  resolveLanguage,
  useI18n,
  type Language,
  type LanguagePreference,
  type MessageKey,
} from "./i18n";
import type { IgnoreEntry, PackInfo } from "./types";

/// Display text for the built-in detector groups, keyed by the backend id.
/// An id missing here (a group added on the Rust side without a dictionary
/// entry) falls back to showing the bare id.
const DETECTOR_TEXT: Record<
  string,
  { label: MessageKey; description: MessageKey }
> = {
  organization: {
    label: "detector.organization.label",
    description: "detector.organization.description",
  },
  "aliased-name": {
    label: "detector.aliased-name.label",
    description: "detector.aliased-name.description",
  },
  department: {
    label: "detector.department.label",
    description: "detector.department.description",
  },
  person: {
    label: "detector.person.label",
    description: "detector.person.description",
  },
  place: {
    label: "detector.place.label",
    description: "detector.place.description",
  },
  "phone-jp": {
    label: "detector.phone-jp.label",
    description: "detector.phone-jp.description",
  },
  "postal-code": {
    label: "detector.postal-code.label",
    description: "detector.postal-code.description",
  },
  date: {
    label: "detector.date.label",
    description: "detector.date.description",
  },
  email: {
    label: "detector.email.label",
    description: "detector.email.description",
  },
  url: {
    label: "detector.url.label",
    description: "detector.url.description",
  },
  "ip-address": {
    label: "detector.ip-address.label",
    description: "detector.ip-address.description",
  },
  "mac-address": {
    label: "detector.mac-address.label",
    description: "detector.mac-address.description",
  },
  "phone-intl": {
    label: "detector.phone-intl.label",
    description: "detector.phone-intl.description",
  },
};

/// Settings dialog: project-scoped detector selection (persisted in the
/// project.mnrk) and app-level configuration — UI language and the optional
/// local LLM (config.toml).
export default function SettingsView(props: {
  projectDir: string;
  onClose: () => void;
  onDetectorsChanged: () => void;
  onLanguageChange: (language: Language) => void;
  /// Where focus goes on close when the opener can no longer take it (the
  /// save path disables "Settings" by starting a re-detection).
  fallbackFocus?: () => HTMLElement | null;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const modelListButton = useRef<HTMLButtonElement>(null);
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
  // The pack row awaiting delete confirmation. A single slot keeps at most one
  // row in the confirm state; removal is immediate and cannot be undone.
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  // Removing a row (or swapping its buttons for the confirm) unmounts the
  // focused control; these put focus back on a nearby control instead of
  // letting it fall to <body>.
  const packKeepButton = useRef<HTMLButtonElement>(null);
  const packImportButton = useRef<HTMLButtonElement>(null);
  const packList = useRef<HTMLElement>(null);
  const ignoredList = useRef<HTMLDivElement>(null);
  /// Row index whose remove button should take focus after the next render
  /// of the pack list (the next row once one is deleted).
  const focusPackRow = useRef<number | null>(null);
  const focusIgnoredRow = useRef<number | null>(null);

  useEffect(() => {
    if (pendingRemove !== null) {
      packKeepButton.current?.focus();
      return;
    }
    const row = focusPackRow.current;
    if (row === null) return;
    focusPackRow.current = null;
    const buttons =
      packList.current?.querySelectorAll<HTMLButtonElement>(
        "[data-pack-remove]",
      ) ?? [];
    const target =
      buttons.length > 0
        ? buttons[Math.min(row, buttons.length - 1)]
        : packImportButton.current;
    target?.focus();
  }, [packs, pendingRemove]);

  useEffect(() => {
    const row = focusIgnoredRow.current;
    if (row === null) return;
    focusIgnoredRow.current = null;
    const buttons =
      ignoredList.current?.querySelectorAll<HTMLButtonElement>(
        "[data-ignored-remove]",
      ) ?? [];
    // With no row left, focus falls to <body> and the dialog's Tab trap
    // resumes from where the list was.
    if (buttons.length > 0) buttons[Math.min(row, buttons.length - 1)].focus();
  }, [ignored]);

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

  /// Removes the pack at row `index`; the confirm stays up until it is
  /// done, then focus moves to the row that took its place.
  async function removePack(name: string, index: number) {
    setPackError(null);
    try {
      await removeDetectorPack(name);
      const next = await listDetectorPacks();
      focusPackRow.current = index;
      setPacks(next);
      setPendingRemove(null);
      props.onDetectorsChanged();
    } catch (failure) {
      focusPackRow.current = index;
      setPendingRemove(null);
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

  /// Closes the model list and hands focus back to its toggle, so it never
  /// falls to <body> when the focused candidate disappears.
  function closeModelMenu() {
    setModelMenuOpen(false);
    modelListButton.current?.focus();
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
    <Modal
      titleId={titleId}
      onDismiss={props.onClose}
      // Escape peels the innermost layer first: the model list, then the
      // dialog itself.
      onEscape={modelMenuOpen ? closeModelMenu : props.onClose}
      fallbackFocus={props.fallbackFocus}
    >
      <div className="modal-header">
        <h2 id={titleId}>{t("settings.title")}</h2>
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
            {allDetectors.map((id) => {
              const known = Object.prototype.hasOwnProperty.call(
                DETECTOR_TEXT,
                id,
              );
              const text = known ? DETECTOR_TEXT[id] : undefined;
              if (!text) {
                return (
                  <label key={id} className="detector-item">
                    <input
                      type="checkbox"
                      checked={enabled.has(id)}
                      onChange={() => toggle(id)}
                    />
                    {id}
                  </label>
                );
              }
              // Only the display name labels the checkbox; the description
              // is attached as its accessible description and the id stays
              // outside both, for matching the CLI's detector ids.
              const inputId = `detector-${id}-input`;
              const descriptionId = `detector-${id}-description`;
              return (
                <div key={id} className="detector-item">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={enabled.has(id)}
                    onChange={() => toggle(id)}
                    aria-describedby={descriptionId}
                  />
                  <div className="detector-text">
                    <label htmlFor={inputId} className="detector-name">
                      {t(text.label)}
                    </label>
                    <span id={descriptionId} className="detector-description">
                      {t(text.description)}
                    </span>
                    <code className="detector-id">{id}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2>{t("settings.ignored")}</h2>
          <p className="hint">{t("settings.ignoredHint")}</p>
          {ignored.length === 0 ? (
            <p className="status">{t("settings.ignoredEmpty")}</p>
          ) : (
            <div className="text-rules" ref={ignoredList}>
              {ignored.map((entry, index) => {
                const text =
                  typeof entry === "string" ? entry : entry.text;
                const scope =
                  typeof entry === "string"
                    ? t("settings.ignoredAllCategories")
                    : categoryLabel(t, entry.category);
                return (
                  <div key={`${text}-${scope}-${index}`} className="text-rule">
                    <span className="chip-action">{scope}</span>
                    <span className="rule-text" title={text}>
                      {text}
                    </span>
                    <button
                      aria-label={t("settings.ignoredRemove")}
                      data-ignored-remove=""
                      onClick={() => {
                        focusIgnoredRow.current = index;
                        setIgnored((current) =>
                          current.filter((_, i) => i !== index),
                        );
                      }}
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
                ref={modelListButton}
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
                            closeModelMenu();
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

        <section ref={packList}>
          <h2>{t("settings.packs")}</h2>
          <p className="hint">{t("settings.packsHint")}</p>
          {packs.length === 0 && (
            <p className="hint">{t("settings.packsEmpty")}</p>
          )}
          {packs.map((pack, index) => (
            <div key={pack.name} className="rule-entry">
              <span className="category-tag">{pack.version}</span>
              {pendingRemove === pack.name ? (
                <>
                  {/* Plain span, not .finding-text: that class clips to
                      one line, which would hide the "cannot be undone"
                      warning at the end of the sentence. */}
                  <span className="rule-target">
                    <span role="alert">
                      {t("settings.packRemoveConfirm", {
                        name: pack.displayName,
                        rules: pack.ruleCount,
                        words: pack.wordCount,
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void removePack(pack.name, index)}
                  >
                    {t("settings.packRemoveYes")}
                  </button>
                  <button
                    ref={packKeepButton}
                    type="button"
                    onClick={() => {
                      focusPackRow.current = index;
                      setPendingRemove(null);
                    }}
                  >
                    {t("settings.packRemoveNo")}
                  </button>
                </>
              ) : (
                <>
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
                    type="button"
                    aria-label={t("settings.packRemove")}
                    data-pack-remove=""
                    onClick={() => setPendingRemove(pack.name)}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="field-row">
            <button
              ref={packImportButton}
              type="button"
              onClick={() => void importPack()}
            >
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
    </Modal>
  );
}
