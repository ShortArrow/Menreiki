import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  analyzeProject,
  applyPolicy,
  auditProject,
  exportProject,
  listFindings,
  searchProject,
} from "./api";
import PageViewer, { DrawMode } from "./PageViewer";
import RegionThumb from "./RegionThumb";
import type {
  ApplySummary,
  AuditReport,
  Finding,
  PageFindings,
  Policy,
  PolicyRule,
  ProjectInfo,
  Rect,
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
    case "done":
      return "解析が完了しました";
    default:
      return progress.stage;
  }
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
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);

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

  function runAnalyze() {
    void run("解析中…", async () => {
      const updated = await analyzeProject(project.projectDir);
      props.onProjectChange(updated);
      setFindings(await listFindings(project.projectDir));
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
  }, [decidedEntries, textRules, regionRules]);

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
    });
  }

  function runAudit() {
    void run("再検査中…", async () => {
      setAudit(await auditProject(project.projectDir, policy));
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
        {!project.analyzed && (
          <button
            className="primary"
            onClick={runAnalyze}
            disabled={busy !== null}
          >
            解析を実行
          </button>
        )}
        <span className="spacer" />
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
        <button onClick={runAudit} disabled={busy !== null || !hasRenders}>
          監査
        </button>
      </header>

      {(busy || progress || error) && (
        <div className="statusbar">
          {busy && <span className="status">{progress ?? busy}</span>}
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
              {index + 1}
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
              </div>
            )}
          </section>

          <section>
            <h2>適用予定ルール（{policy.rules.length}件）</h2>
            <div className="rule-list">
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
                    <input
                      className="replace-input"
                      placeholder="置換後"
                      value={entry.decision.value}
                      onChange={(event) =>
                        setDecisionValue(entry.key, event.target.value)
                      }
                    />
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
                      title={finding.text}
                      onClick={() => jumpTo(pageIndex, finding)}
                    >
                      <span className="page-tag">p.{pageIndex + 1}</span>
                      <span className={`category-tag cat-${finding.category}`}>
                        {finding.category}
                      </span>
                      <span className="finding-text">{finding.text}</span>
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
