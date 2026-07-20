import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  addDictionaryEntry,
  analyzeProject,
  applyPolicy,
  auditProject,
  cancelAnalysis,
  countMatches,
  exportMarkdown,
  exportProject,
  listDictionary,
  listEntities,
  listFindings,
  llmDetect,
  loadReviewDecisions,
  pageImageUrl,
  removeDictionaryEntry,
  saveEntities,
  saveReviewDecisions,
  searchProject,
  suggestEntityVariants,
  suggestReplacements,
} from "./api";
import PageViewer, { DrawMode } from "./PageViewer";
import RegionThumb from "./RegionThumb";
import SettingsView from "./SettingsView";
import type {
  AnalysisScope,
  ApplySummary,
  AuditReport,
  DictionaryEntry,
  Entity,
  Finding,
  PageFindings,
  Policy,
  PolicyRule,
  ProjectInfo,
  Rect,
  ReviewDecisions,
} from "./types";

type DecisionAction = "keep" | "erase" | "mask" | "replace";

interface Decision {
  action: DecisionAction;
  value: string;
}

interface TextRule {
  text: string;
  action: Exclude<DecisionAction, "keep">;
  value: string;
}

interface RegionRule {
  rect: Rect;
  action: "erase" | "mask";
  /** "all" or the 0-based page index the rule is limited to. */
  scope: "all" | number;
  /** 0-based page the rectangle was drawn on, for thumbnails. */
  drawnOn: number;
}

const findingKey = (finding: Finding) =>
  `${finding.category}|::|${finding.text}`;

const ACTION_LABELS: Record<Exclude<DecisionAction, "keep">, string> = {
  erase: "消去",
  mask: "マスク",
  replace: "置換",
};

const ALIAS_LABELS: Record<string, string> = {
  organization: "組織",
  department: "部署",
  person: "人物",
  product: "製品",
  place: "地名",
};

interface AnalyzeProgress {
  stage: string;
  page: number | null;
  total: number | null;
}

function progressLabel(progress: AnalyzeProgress): string {
  const pages =
    progress.page === null
      ? ""
      : progress.total === null
        ? `（${progress.page}ページ目）`
        : `（${progress.page} / ${progress.total}ページ）`;
  switch (progress.stage) {
    case "render":
      return `ページを画像化しています…${pages}`;
    case "ocr":
      return `OCRを実行しています…${pages}`;
    case "detect":
      return "機密候補を検出しています…";
    case "markdown":
      return `Markdownを生成しています…${pages}`;
    case "llm":
      return `ローカルLLMで候補を探しています…${pages}`;
    case "vlm":
      return `ローカルVLMがページ画像を確認しています…${pages}`;
    case "done":
      return "解析が完了しました";
    default:
      return progress.stage;
  }
}

function PageThumb(props: {
  projectDir: string;
  pageIndex: number;
  version: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pageImageUrl(props.projectDir, props.pageIndex, false)
      .then((base) => {
        if (!cancelled) setUrl(`${base}?v=${props.version}`);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectDir, props.pageIndex, props.version]);

  if (!url) {
    return <span className="thumb-placeholder" />;
  }
  return <img className="thumb" src={url} loading="lazy" alt="" />;
}

function AliasSuggest(props: {
  text: string;
  category: string;
  onPick: (value: string) => void;
}) {
  const [items, setItems] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fetchSuggestions() {
    setLoading(true);
    setError(null);
    setItems(null);
    suggestReplacements(props.text, props.category)
      .then((loaded) => setItems(loaded))
      .catch((failure) => setError(String(failure)))
      .finally(() => setLoading(false));
  }

  return (
    <span className="suggest-wrap">
      <button
        className="mini"
        title="ローカルLLMに置換候補を提案させる（意味を残した仮称・一般化）"
        disabled={loading}
        onClick={fetchSuggestions}
      >
        {loading ? "…" : "✨"}
      </button>
      {items?.map((suggestion) => (
        <button
          key={suggestion}
          className="variant-chip suggest"
          onClick={() => {
            props.onPick(suggestion);
            setItems(null);
          }}
        >
          {suggestion}
        </button>
      ))}
      {error && <span className="error suggest-error">{error}</span>}
    </span>
  );
}

export default function ReviewView(props: {
  project: ProjectInfo;
  onProjectChange: (project: ProjectInfo) => void;
  onClose: () => void;
}) {
  const { project } = props;
  const [findings, setFindings] = useState<PageFindings[]>([]);
  const [page, setPage] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [textRules, setTextRules] = useState<TextRule[]>([]);
  const [regionRules, setRegionRules] = useState<RegionRule[]>([]);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [drawScope, setDrawScope] = useState<"all" | "page">("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchHits, setSearchHits] = useState<PageFindings[] | null>(null);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [dictionaryCategory, setDictionaryCategory] = useState("organization");
  const [dictionaryNote, setDictionaryNote] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesHydrated, setEntitiesHydrated] = useState(false);
  const [entitySuggestions, setEntitySuggestions] = useState<
    Record<string, string[]>
  >({});
  const [entityCounts, setEntityCounts] = useState<Record<string, number>>({});
  const [assignTarget, setAssignTarget] = useState<{
    category: string;
    text: string;
  } | null>(null);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ rect: Rect; nonce: number } | null>(
    null,
  );
  const [previewRegion, setPreviewRegion] = useState<number | null>(null);
  const [showRendered, setShowRendered] = useState(false);
  const [hasRenders, setHasRenders] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [markdownPath, setMarkdownPath] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadReviewDecisions(project.projectDir)
      .then((saved) => {
        if (cancelled) return;
        const record: Record<string, Decision> = {};
        for (const finding of saved.findings) {
          record[`${finding.category}|::|${finding.text}`] = {
            action: finding.action as DecisionAction,
            value: finding.value,
          };
        }
        setDecisions(record);
        setTextRules(
          saved.texts.map((text) => ({
            text: text.text,
            action: text.action as Exclude<DecisionAction, "keep">,
            value: text.value,
          })),
        );
        setRegionRules(
          saved.regions.map((region) => ({
            rect: region.rect,
            action: region.action as "erase" | "mask",
            scope: region.page === null ? "all" : region.page,
            drawnOn: region.drawn_on,
          })),
        );
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectDir]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const payload: ReviewDecisions = {
        findings: Object.entries(decisions).map(([key, decision]) => {
          const [category, ...rest] = key.split("|::|");
          return {
            category,
            text: rest.join("|::|"),
            action: decision.action,
            value: decision.value,
          };
        }),
        texts: textRules.map((rule) => ({
          text: rule.text,
          action: rule.action,
          value: rule.value,
        })),
        regions: regionRules.map((rule) => ({
          rect: rule.rect,
          action: rule.action,
          page: rule.scope === "all" ? null : rule.scope,
          drawn_on: rule.drawnOn,
        })),
      };
      void saveReviewDecisions(project.projectDir, payload).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [decisions, textRules, regionRules, hydrated, project.projectDir]);

  useEffect(() => {
    if (!project.analyzed) return;
    let cancelled = false;
    listFindings(project.projectDir)
      .then((loaded) => {
        if (!cancelled) setFindings(loaded);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectDir, project.analyzed]);

  useEffect(() => {
    let cancelled = false;
    listDictionary(project.projectDir)
      .then((entries) => {
        if (!cancelled) setDictionary(entries);
      })
      .catch(() => {});
    listEntities(project.projectDir)
      .then((loaded) => {
        if (cancelled) return;
        setEntities(loaded);
        setEntitiesHydrated(true);
        for (const entity of loaded) void refreshEntityMeta(entity);
      })
      .catch(() => {
        if (!cancelled) setEntitiesHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectDir]);

  useEffect(() => {
    if (!entitiesHydrated) return;
    const timer = setTimeout(() => {
      void saveEntities(project.projectDir, entities).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [entities, entitiesHydrated, project.projectDir]);

  async function refreshEntityMeta(entity: Entity) {
    try {
      const [suggestions, counts] = await Promise.all([
        suggestEntityVariants(project.projectDir, entity),
        countMatches(project.projectDir, entity.variants),
      ]);
      setEntitySuggestions((current) => ({
        ...current,
        [entity.id]: suggestions,
      }));
      setEntityCounts((current) => {
        const next = { ...current };
        entity.variants.forEach((variant, index) => {
          next[variant] = counts[index];
        });
        return next;
      });
    } catch {
      // meta is best-effort; the entity itself is already saved
    }
  }

  function createEntity(category: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const label = ALIAS_LABELS[category] ?? "対象";
    const sameCategory = entities.filter(
      (entity) => entity.category === category,
    ).length;
    const suffix =
      sameCategory < 26
        ? String.fromCharCode(65 + sameCategory)
        : String(sameCategory + 1);
    const entity: Entity = {
      id: `${category}-${Date.now()}`,
      category,
      alias: `${label}${suffix}`,
      variants: [trimmed],
    };
    setEntities((current) => [...current, entity]);
    setAssignTarget(null);
    void refreshEntityMeta(entity);
  }

  function addVariant(entityId: string, text: string) {
    const target = entities.find((entity) => entity.id === entityId);
    if (!target || target.variants.includes(text)) {
      setAssignTarget(null);
      return;
    }
    const updated = { ...target, variants: [...target.variants, text] };
    setEntities((current) =>
      current.map((entity) => (entity.id === entityId ? updated : entity)),
    );
    setAssignTarget(null);
    void refreshEntityMeta(updated);
  }

  useEffect(() => {
    const unlisten = listen<AnalyzeProgress>("analyze-progress", (event) => {
      setProgress(progressLabel(event.payload));
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await action();
    } catch (failure) {
      setError(String(failure));
      return null;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function runAnalyze(scope: AnalysisScope) {
    void run("解析中…", async () => {
      if (scope === "all" || scope === "resume") {
        setSearchHits(null);
        setAudit(null);
        setApplySummary(null);
        setExportPath(null);
        setHasRenders(false);
        setShowRendered(false);
        setHighlightKey(null);
        setFocus(null);
      }
      const outcome = await analyzeProject(project.projectDir, scope);
      props.onProjectChange(outcome.project);
      setFindings(await listFindings(project.projectDir).catch(() => []));
      setVersion((current) => current + 1);
      if (outcome.cancelled) {
        setNotice(
          "解析をキャンセルしました。「解析を再開」で続きから実行できます。",
        );
      }
    });
  }

  const flatFindings = useMemo(
    () =>
      findings.flatMap((pageFindings) =>
        pageFindings.findings.map((finding) => ({
          pageIndex: pageFindings.page_index,
          finding,
        })),
      ),
    [findings],
  );

  const decidedEntries = useMemo(() => {
    const unique = new Map<string, Finding>();
    for (const { finding } of flatFindings) {
      const key = findingKey(finding);
      if (!unique.has(key)) unique.set(key, finding);
    }
    return [...unique.entries()]
      .filter(([key]) => {
        const decision = decisions[key];
        return decision && decision.action !== "keep";
      })
      .map(([key, finding]) => ({
        key,
        finding,
        decision: decisions[key],
      }));
  }, [flatFindings, decisions]);

  const policy: Policy = useMemo(() => {
    const rules: PolicyRule[] = [];
    const seenTexts = new Set<string>();
    const pushTextRule = (
      text: string,
      action: Exclude<DecisionAction, "keep">,
      value: string,
    ) => {
      if (!text || seenTexts.has(text)) return;
      seenTexts.add(text);
      rules.push({
        match: { text },
        action:
          action === "replace"
            ? { type: "replace", value: value || "■■■" }
            : action === "mask"
              ? { type: "mask" }
              : { type: "remove" },
      });
    };
    for (const entity of entities) {
      for (const variant of entity.variants) {
        pushTextRule(variant, "replace", entity.alias);
      }
    }
    for (const entry of decidedEntries) {
      pushTextRule(
        entry.finding.text,
        entry.decision.action as Exclude<DecisionAction, "keep">,
        entry.decision.value,
      );
    }
    for (const rule of textRules) {
      pushTextRule(rule.text, rule.action, rule.value);
    }
    for (const region of regionRules) {
      rules.push({
        match: {
          region: region.rect,
          pages: region.scope === "all" ? "all" : [region.scope + 1],
        },
        action:
          region.action === "mask" ? { type: "mask" } : { type: "remove" },
      });
    }
    return { rules };
  }, [entities, decidedEntries, textRules, regionRules]);

  function runApply() {
    void run("変換を適用中…", async () => {
      const summary = await applyPolicy(project.projectDir, policy);
      setApplySummary(summary);
      setHasRenders(true);
      setShowRendered(true);
      setVersion((current) => current + 1);
      setAudit(null);
    });
  }

  function runExport() {
    void run("PDFを再構築中…", async () => {
      setExportPath(await exportProject(project.projectDir));
      if (undecidedCount > 0) {
        setNotice(
          `未判断の候補が ${undecidedCount} 種類残っています。出力を共有する前に確認してください。`,
        );
      }
    });
  }

  function runExportMarkdown() {
    void run("Markdownを生成中…", async () => {
      setMarkdownPath(await exportMarkdown(project.projectDir));
      if (undecidedCount > 0) {
        setNotice(
          `未判断の候補が ${undecidedCount} 種類残っています。出力を共有する前に確認してください。`,
        );
      }
    });
  }

  function runAudit() {
    void run("再検査中…", async () => {
      setAudit(await auditProject(project.projectDir, policy));
    });
  }

  function runLlmDetect(useImage: boolean) {
    void run("LLM検出中…", async () => {
      await llmDetect(project.projectDir, useImage);
      setFindings(await listFindings(project.projectDir));
    });
  }

  function runSearch() {
    const text = searchInput.trim();
    if (!text) return;
    void run("検索中…", async () => {
      setSearchHits(await searchProject(project.projectDir, text));
    });
  }

  function addSearchRule(action: Exclude<DecisionAction, "keep">) {
    const text = searchInput.trim();
    if (!text) return;
    setTextRules((current) => [
      ...current.filter((rule) => rule.text !== text),
      { text, action, value: "" },
    ]);
  }

  function registerToDictionary() {
    const text = searchInput.trim();
    if (!text) return;
    void run("辞書に登録中…", async () => {
      setDictionary(
        await addDictionaryEntry(project.projectDir, dictionaryCategory, text),
      );
      if (project.analyzed) {
        await analyzeProject(project.projectDir, "detect-only");
        setFindings(await listFindings(project.projectDir));
        setDictionaryNote("登録し、検出候補へ反映しました。");
      } else {
        setDictionaryNote("登録しました。解析すると検出候補に反映されます。");
      }
    });
  }

  function jumpTo(pageIndex: number, finding: Finding) {
    setPage(pageIndex);
    setHighlightKey(findingKey(finding));
    setFocus((current) => ({
      rect: finding.rect,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }

  const visibleRegions = regionRules
    .map((rule, index) => ({ ...rule, index }))
    .filter((rule) => rule.scope === "all" || rule.scope === page);

  const uniqueFindingKeys = useMemo(
    () => new Set(flatFindings.map(({ finding }) => findingKey(finding))),
    [flatFindings],
  );
  const decidedCount = [...uniqueFindingKeys].filter(
    (key) => decisions[key],
  ).length;
  const undecidedCount = uniqueFindingKeys.size - decidedCount;

  const currentPageSearchHits =
    searchHits?.find((entry) => entry.page_index === page)?.findings ?? [];
  const currentPageFindings = (
    findings.find((entry) => entry.page_index === page)?.findings ?? []
  ).concat(currentPageSearchHits);

  const searchHitCount =
    searchHits?.reduce((sum, entry) => sum + entry.findings.length, 0) ?? null;

  function setDecision(key: string, action: DecisionAction | "undecided") {
    setDecisions((current) => {
      const next = { ...current };
      if (action === "undecided") {
        delete next[key];
      } else {
        next[key] = { action, value: current[key]?.value ?? "" };
      }
      return next;
    });
  }

  function setDecisionValue(key: string, value: string) {
    setDecisions((current) => ({
      ...current,
      [key]: { action: current[key]?.action ?? "replace", value },
    }));
  }

  function clearAllRules() {
    setDecisions({});
    setTextRules([]);
    setRegionRules([]);
  }

  return (
    <div className="review">
      <header className="toolbar">
        <button onClick={props.onClose}>← ホーム</button>
        <span className="file-name" title={project.projectDir}>
          {project.fileName}
        </span>
        {project.analyzed ? (
          <div className="reanalyze-menu">
            <button
              disabled={busy !== null}
              onClick={() => setReanalyzeOpen((open) => !open)}
            >
              再解析… ▾
            </button>
            {reanalyzeOpen && (
              <>
                <div
                  className="menu-backdrop"
                  onClick={() => setReanalyzeOpen(false)}
                />
                <div className="menu">
                  {(
                    [
                      ["all", "すべて（最初から）", () => runAnalyze("all")],
                      ["resume", "続きから再開", () => runAnalyze("resume")],
                      ["render", "画像化のみ", () => runAnalyze("render-only")],
                      ["ocr", "OCRのみ＋検出", () => runAnalyze("ocr-only")],
                      ["detect", "検出のみ", () => runAnalyze("detect-only")],
                      ["llm", "LLM検出（テキスト・実験的）", () => runLlmDetect(false)],
                      ["vlm", "VLM検出（ページ画像・実験的）", () => runLlmDetect(true)],
                    ] as [string, string, () => void][]
                  ).map(([key, label, action]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setReanalyzeOpen(false);
                        action();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : project.pageCount > 0 ? (
          <>
            <button
              className="primary"
              onClick={() => runAnalyze("resume")}
              disabled={busy !== null}
              title="完了済みのページをスキップして続きから解析します"
            >
              解析を再開
            </button>
            <button
              onClick={() => runAnalyze("all")}
              disabled={busy !== null}
            >
              最初から
            </button>
          </>
        ) : (
          <button
            className="primary"
            onClick={() => runAnalyze("all")}
            disabled={busy !== null}
          >
            解析を実行
          </button>
        )}
        <span className="spacer" />
        <button
          onClick={() => setSettingsOpen(true)}
          disabled={busy !== null}
          title="設定（検出器・ローカルLLM）"
        >
          ⚙ 設定
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRendered}
            disabled={!hasRenders}
            onChange={(event) => setShowRendered(event.target.checked)}
          />
          変換後を表示
        </label>
        <button
          className="primary"
          onClick={runApply}
          disabled={busy !== null || policy.rules.length === 0}
        >
          適用（{policy.rules.length}ルール）
        </button>
        <button onClick={runExport} disabled={busy !== null || !hasRenders}>
          PDF出力
        </button>
        <button
          onClick={runExportMarkdown}
          disabled={busy !== null || !hasRenders}
        >
          Markdown出力
        </button>
        <button onClick={runAudit} disabled={busy !== null || !hasRenders}>
          監査
        </button>
      </header>

      {(busy || progress || error || notice) && (
        <div className="statusbar">
          {busy && <span className="status">{progress ?? busy}</span>}
          {(busy === "解析中…" || busy === "LLM検出中…") && (
            <button onClick={() => void cancelAnalysis()}>キャンセル</button>
          )}
          {notice && <span className="status">{notice}</span>}
          {error && <span className="error">{error}</span>}
        </div>
      )}

      <div className="panes">
        <nav className="page-list">
          {Array.from({ length: project.pageCount }, (_, index) => (
            <button
              key={index}
              className={
                index === page ? "page-button current" : "page-button"
              }
              onClick={() => setPage(index)}
            >
              <PageThumb
                projectDir={project.projectDir}
                pageIndex={index}
                version={version}
              />
              <span className="page-number">{index + 1}</span>
              {(findings.find((entry) => entry.page_index === index)?.findings
                .length ?? 0) > 0 && <span className="dot" />}
            </button>
          ))}
        </nav>

        <main className="viewer-pane">
          <div className="viewer-toolbar">
            <span>矩形選択:</span>
            {(["none", "erase", "mask"] as DrawMode[]).map((mode) => (
              <button
                key={mode}
                className={drawMode === mode ? "mode current" : "mode"}
                onClick={() => setDrawMode(mode)}
              >
                {mode === "none" ? "なし" : mode === "erase" ? "消去" : "マスク"}
              </button>
            ))}
            {drawMode !== "none" && (
              <>
                <span>適用範囲:</span>
                {(["all", "page"] as const).map((scope) => (
                  <button
                    key={scope}
                    className={drawScope === scope ? "mode current" : "mode"}
                    onClick={() => setDrawScope(scope)}
                  >
                    {scope === "all" ? "全ページ" : "このページ"}
                  </button>
                ))}
                <span className="hint">ドラッグで領域ルールを追加</span>
              </>
            )}
          </div>
          <PageViewer
            projectDir={project.projectDir}
            pageIndex={page}
            rendered={showRendered && hasRenders}
            version={version}
            findings={currentPageFindings}
            regions={visibleRegions}
            highlightKey={highlightKey}
            findingKey={findingKey}
            drawMode={drawMode}
            focusRect={focus?.rect ?? null}
            focusNonce={focus?.nonce ?? 0}
            onRegion={(rect) =>
              setRegionRules((current) => [
                ...current,
                {
                  rect,
                  action: drawMode === "mask" ? "mask" : "erase",
                  scope: drawScope === "all" ? "all" : page,
                  drawnOn: page,
                },
              ])
            }
            onRegionRemove={(index) =>
              setRegionRules((current) =>
                current.filter((_, i) => i !== index),
              )
            }
          />
        </main>

        <aside className="side-pane">
          <section>
            <h2>文字列で検索</h2>
            <div className="search-row">
              <input
                value={searchInput}
                placeholder="例: 株式会社アルファ技研"
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
              />
              <button onClick={runSearch} disabled={busy !== null}>
                検索
              </button>
            </div>
            {searchHitCount !== null && (
              <div className="search-result">
                <p>{searchHitCount} 件見つかりました</p>
                {searchHitCount > 0 && (
                  <div className="search-actions">
                    <button
                      onClick={() =>
                        createEntity(dictionaryCategory, searchInput)
                      }
                    >
                      Entityとして登録
                    </button>
                    <button onClick={() => addSearchRule("replace")}>
                      置換ルールに追加
                    </button>
                    <button onClick={() => addSearchRule("mask")}>
                      マスクルールに追加
                    </button>
                    <button onClick={() => addSearchRule("erase")}>
                      消去ルールに追加
                    </button>
                  </div>
                )}
                <ul className="hit-list">
                  {searchHits?.flatMap((entry) =>
                    entry.findings.map((finding, index) => (
                      <li key={`${entry.page_index}-${index}`}>
                        <button
                          onClick={() => jumpTo(entry.page_index, finding)}
                        >
                          p.{entry.page_index + 1} {finding.text}
                        </button>
                      </li>
                    )),
                  )}
                </ul>
                <div className="dictionary-register">
                  <select
                    value={dictionaryCategory}
                    onChange={(event) =>
                      setDictionaryCategory(event.target.value)
                    }
                  >
                    <option value="organization">組織名</option>
                    <option value="department">部署名</option>
                    <option value="person">人物名</option>
                    <option value="product">製品名</option>
                    <option value="place">地名</option>
                    <option value="custom">その他</option>
                  </select>
                  <button onClick={registerToDictionary} disabled={busy !== null}>
                    辞書に登録（以後の解析で自動検出）
                  </button>
                </div>
                {dictionaryNote && <p className="status">{dictionaryNote}</p>}
              </div>
            )}
          </section>

          {dictionary.length > 0 && (
            <section>
              <h2>辞書（{dictionary.length}件）</h2>
              <div className="rule-list">
                {dictionary.map((entry) => (
                  <div key={entry.text} className="rule-entry">
                    <span className="category-tag">{entry.category}</span>
                    <span className="rule-target" title={entry.text}>
                      <span className="finding-text">{entry.text}</span>
                    </span>
                    <button
                      onClick={() => {
                        void run("辞書から削除中…", async () => {
                          setDictionary(
                            await removeDictionaryEntry(
                              project.projectDir,
                              entry.text,
                            ),
                          );
                          if (project.analyzed) {
                            await analyzeProject(
                              project.projectDir,
                              "detect-only",
                            );
                            setFindings(await listFindings(project.projectDir));
                          }
                        });
                      }}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2>適用予定ルール（{policy.rules.length}件）</h2>
            <div className="rule-list">
              {entities
                .filter((entity) => entity.variants.length > 0)
                .map((entity) => (
                  <div key={entity.id} className="rule-entry">
                    <span className="chip-action">置換</span>
                    <span className="rule-target" title={entity.variants.join("、")}>
                      <span className="category-tag">Entity</span>
                      <span className="finding-text">
                        {entity.variants.length}表記 → {entity.alias || "（仮称未設定）"}
                      </span>
                    </span>
                  </div>
                ))}
              {decidedEntries.map((entry) => (
                <div key={entry.key} className="rule-entry">
                  <span className="chip-action">
                    {
                      ACTION_LABELS[
                        entry.decision.action as Exclude<DecisionAction, "keep">
                      ]
                    }
                  </span>
                  <button
                    className="rule-target"
                    title={entry.finding.text}
                    onClick={() => {
                      const location = flatFindings.find(
                        ({ finding }) => findingKey(finding) === entry.key,
                      );
                      if (location) jumpTo(location.pageIndex, location.finding);
                    }}
                  >
                    <span className="category-tag">
                      {entry.finding.category}
                    </span>
                    <span className="finding-text">{entry.finding.text}</span>
                  </button>
                  {entry.decision.action === "replace" && (
                    <>
                      <input
                        className="replace-input"
                        placeholder="置換後"
                        value={entry.decision.value}
                        onChange={(event) =>
                          setDecisionValue(entry.key, event.target.value)
                        }
                      />
                      <AliasSuggest
                        text={entry.finding.text}
                        category={entry.finding.category}
                        onPick={(value) => setDecisionValue(entry.key, value)}
                      />
                    </>
                  )}
                  <button onClick={() => setDecision(entry.key, "undecided")}>
                    解除
                  </button>
                </div>
              ))}

              {textRules.map((rule, index) => (
                <div key={`text-${index}`} className="rule-entry">
                  <span className="chip-action">
                    {ACTION_LABELS[rule.action]}
                  </span>
                  <span className="rule-target" title={rule.text}>
                    <span className="category-tag">検索</span>
                    <span className="finding-text">{rule.text}</span>
                  </span>
                  {rule.action === "replace" && (
                    <>
                      <input
                        className="replace-input"
                        placeholder="置換後"
                        value={rule.value}
                        onChange={(event) =>
                          setTextRules((current) =>
                            current.map((entry, i) =>
                              i === index
                                ? { ...entry, value: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                      <AliasSuggest
                        text={rule.text}
                        category="other"
                        onPick={(value) =>
                          setTextRules((current) =>
                            current.map((entry, i) =>
                              i === index ? { ...entry, value } : entry,
                            ),
                          )
                        }
                      />
                    </>
                  )}
                  <button
                    onClick={() =>
                      setTextRules((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    削除
                  </button>
                </div>
              ))}

              {regionRules.map((rule, index) => (
                <div key={`region-${index}`} className="rule-entry region">
                  <div className="rule-entry-main">
                    <span className="chip-action">
                      {ACTION_LABELS[rule.action]}
                    </span>
                    <button
                      className="rule-target"
                      onClick={() =>
                        setPage(rule.scope === "all" ? rule.drawnOn : rule.scope)
                      }
                    >
                      <span className="category-tag">領域</span>
                      <span className="finding-text">
                        {rule.scope === "all"
                          ? "全ページ"
                          : `p.${rule.scope + 1} のみ`}
                      </span>
                    </button>
                    {rule.scope === "all" && (
                      <button onClick={() => setPreviewRegion(index)}>
                        プレビュー
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setRegionRules((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      削除
                    </button>
                  </div>
                  <RegionThumb
                    projectDir={project.projectDir}
                    pageIndex={rule.scope === "all" ? rule.drawnOn : rule.scope}
                    rect={rule.rect}
                    maxWidth={320}
                    maxHeight={72}
                  />
                </div>
              ))}

              {policy.rules.length === 0 && (
                <p className="status">
                  候補の判断・検索・矩形選択でルールを作成します
                </p>
              )}
              {policy.rules.length > 0 && (
                <button onClick={clearAllRules}>すべて解除</button>
              )}
            </div>
          </section>

          <section>
            <h2>Entity（{entities.length}件）</h2>
            {assignTarget && (
              <div className="assign-bar">
                <span className="finding-text" title={assignTarget.text}>
                  「{assignTarget.text}」を追加:
                </span>
                <button
                  onClick={() =>
                    createEntity(assignTarget.category, assignTarget.text)
                  }
                >
                  新規Entity
                </button>
                {entities.map((entity) => (
                  <button
                    key={entity.id}
                    onClick={() => addVariant(entity.id, assignTarget.text)}
                  >
                    → {entity.alias || entity.variants[0]}
                  </button>
                ))}
                <button onClick={() => setAssignTarget(null)}>×</button>
              </div>
            )}
            <div className="entity-list">
              {entities.map((entity) => (
                <div key={entity.id} className="entity-card">
                  <div className="entity-head">
                    <span className="category-tag">{entity.category}</span>
                    <input
                      className="alias-input"
                      value={entity.alias}
                      placeholder="仮称"
                      onChange={(event) =>
                        setEntities((current) =>
                          current.map((candidate) =>
                            candidate.id === entity.id
                              ? { ...candidate, alias: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <AliasSuggest
                      text={entity.variants[0] ?? entity.alias}
                      category={entity.category}
                      onPick={(value) =>
                        setEntities((current) =>
                          current.map((candidate) =>
                            candidate.id === entity.id
                              ? { ...candidate, alias: value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <button
                      onClick={() =>
                        setEntities((current) =>
                          current.filter(
                            (candidate) => candidate.id !== entity.id,
                          ),
                        )
                      }
                    >
                      削除
                    </button>
                  </div>
                  <div className="entity-variants">
                    {entity.variants.map((variant) => (
                      <span key={variant} className="variant-chip">
                        <span title={variant}>{variant}</span>
                        {entityCounts[variant] !== undefined && (
                          <span className="variant-count">
                            ×{entityCounts[variant]}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            const updated = {
                              ...entity,
                              variants: entity.variants.filter(
                                (candidate) => candidate !== variant,
                              ),
                            };
                            setEntities((current) =>
                              current.map((candidate) =>
                                candidate.id === entity.id
                                  ? updated
                                  : candidate,
                              ),
                            );
                            void refreshEntityMeta(updated);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {(entitySuggestions[entity.id]?.length ?? 0) > 0 && (
                    <div className="entity-suggestions">
                      <span className="hint">類似表記の候補:</span>
                      {entitySuggestions[entity.id].map((suggestion) => (
                        <button
                          key={suggestion}
                          className="variant-chip suggest"
                          onClick={() => addVariant(entity.id, suggestion)}
                        >
                          ＋ {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {entities.length === 0 && (
                <p className="status">
                  検索結果の「Entityとして登録」や候補行の「E」から、表記揺れを1つの仮称へまとめられます
                </p>
              )}
            </div>
          </section>

          <section className="findings-section">
            <h2>検出候補（{flatFindings.length}件）</h2>
            <div className="findings-list">
              {flatFindings.map(({ pageIndex, finding }, index) => {
                const key = findingKey(finding);
                const decision = decisions[key];
                return (
                  <div
                    key={index}
                    className={[
                      "finding-row",
                      highlightKey === key ? "highlight" : "",
                      decision ? "decided" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      className="finding-label"
                      title={
                        finding.note
                          ? `${finding.text}\n${finding.note}`
                          : finding.text
                      }
                      onClick={() => jumpTo(pageIndex, finding)}
                    >
                      <span className="page-tag">p.{pageIndex + 1}</span>
                      <span className={`category-tag cat-${finding.category}`}>
                        {finding.category}
                      </span>
                      <span className="finding-text">{finding.text}</span>
                    </button>
                    <button
                      className="mini"
                      title="Entityへ追加（表記揺れの統合）"
                      onClick={() =>
                        setAssignTarget({
                          category: finding.category,
                          text: finding.text,
                        })
                      }
                    >
                      E
                    </button>
                    <select
                      value={decision?.action ?? "undecided"}
                      onChange={(event) =>
                        setDecision(
                          key,
                          event.target.value as DecisionAction | "undecided",
                        )
                      }
                    >
                      <option value="undecided">未判断</option>
                      <option value="keep">保持</option>
                      <option value="mask">マスク</option>
                      <option value="erase">消去</option>
                      <option value="replace">置換</option>
                    </select>
                  </div>
                );
              })}
              {flatFindings.length === 0 && (
                <p className="status">
                  {project.analyzed
                    ? "検出候補はありません"
                    : "解析を実行すると候補が表示されます"}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2>出力前確認</h2>
            <div
              className={
                undecidedCount > 0 ? "precheck warn" : "precheck ok"
              }
            >
              <span>未判断の候補: {undecidedCount} 種類</span>
              <span>判断済み: {decidedCount} 種類</span>
              <span>適用予定ルール: {policy.rules.length} 件</span>
            </div>
          </section>

          <section>
            <h2>結果</h2>
            {applySummary && (
              <p>
                適用済み: {applySummary.edit_count} 箇所 /{" "}
                {applySummary.page_count} ページ
              </p>
            )}
            {exportPath && (
              <p className="export-path" title={exportPath}>
                出力: {exportPath}
              </p>
            )}
            {markdownPath && (
              <p className="export-path" title={markdownPath}>
                出力: {markdownPath}
              </p>
            )}
            {audit && (
              <div
                className={
                  audit.verdict === "pass" ? "audit pass" : "audit fail"
                }
              >
                <p className="verdict">
                  監査: {audit.verdict === "pass" ? "Pass" : "Fail"}（
                  {audit.checked_terms}語 / {audit.page_count}ページ）
                </p>
                {audit.residuals.map((residual, index) => (
                  <button
                    key={index}
                    className="residual"
                    onClick={() => {
                      setShowRendered(true);
                      setPage(residual.page - 1);
                      setFocus((current) => ({
                        rect: residual.rect,
                        nonce: (current?.nonce ?? 0) + 1,
                      }));
                    }}
                  >
                    p.{residual.page} 残存 [{residual.term}] {residual.text}
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {settingsOpen && (
        <SettingsView
          projectDir={project.projectDir}
          onClose={() => setSettingsOpen(false)}
          onDetectorsChanged={() => {
            if (project.analyzed) {
              void run("再検出中…", async () => {
                await analyzeProject(project.projectDir, "detect-only");
                setFindings(await listFindings(project.projectDir));
              });
            }
          }}
        />
      )}

      {previewRegion !== null && regionRules[previewRegion] && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewRegion(null)}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>
                領域プレビュー（全{project.pageCount}ページ・
                {ACTION_LABELS[regionRules[previewRegion].action]}）
              </h2>
              <button onClick={() => setPreviewRegion(null)}>閉じる</button>
            </div>
            <p className="status">
              この領域が各ページで何を含むか確認してから適用してください。
            </p>
            <div className="modal-body">
              {Array.from({ length: project.pageCount }, (_, index) => (
                <div key={index} className="preview-row">
                  <span className="page-tag">p.{index + 1}</span>
                  <RegionThumb
                    projectDir={project.projectDir}
                    pageIndex={index}
                    rect={regionRules[previewRegion].rect}
                    maxWidth={520}
                    maxHeight={110}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
