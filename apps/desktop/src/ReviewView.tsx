import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  addDictionaryEntry,
  analyzeProject,
  applyPolicy,
  auditProject,
  cancelAnalysis,
  countMatches,
  exportMarkdown,
  getProjectSettings,
  setProjectSettings,
  exportImages,
  exportProject,
  listAppliedEdits,
  listDictionary,
  listEntities,
  listFindings,
  llmDetect,
  loadReviewDecisions,
  pageImageUrl,
  removeDictionaryEntry,
  saveEntities,
  saveReviewDecisions,
  addManualFinding,
  readRegion,
  removeManualFinding,
  searchProject,
  suggestEntityVariants,
  suggestReplacements,
  suggestTargets,
  textInRegion,
  vlmInRegion,
} from "./api";
import HelpView from "./HelpView";
import PageViewer, { DrawMode } from "./PageViewer";
import RegionThumb from "./RegionThumb";
import SettingsView from "./SettingsView";
import type {
  AnalysisScope,
  AppliedEdit,
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
  TextAlign,
} from "./types";

type DecisionAction = "keep" | "erase" | "mask" | "replace";

interface Decision {
  action: DecisionAction;
  value: string;
  align?: TextAlign;
}

interface TextRule {
  text: string;
  action: Exclude<DecisionAction, "keep">;
  value: string;
  align?: TextAlign;
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
  /// Approximate rect positions painted over the thumbnail (findings and
  /// region rules), for an at-a-glance map of where candidates sit.
  marks?: { rect: Rect; kind: "finding" | "region" }[];
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    null,
  );

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
  return (
    <span className="thumb-wrap">
      <img
        className="thumb"
        src={url}
        loading="lazy"
        alt=""
        onLoad={(event) =>
          setNatural({
            w: event.currentTarget.naturalWidth,
            h: event.currentTarget.naturalHeight,
          })
        }
      />
      {natural &&
        props.marks?.map((mark, index) => {
          // Whole-page rects (location-unknown candidates) would tint the
          // entire thumbnail; skip them.
          if (
            mark.rect.width >= natural.w * 0.85 &&
            mark.rect.height >= natural.h * 0.85
          )
            return null;
          return (
            <span
              key={index}
              className={`thumb-mark ${mark.kind}`}
              style={{
                left: `${(mark.rect.x / natural.w) * 100}%`,
                top: `${(mark.rect.y / natural.h) * 100}%`,
                width: `${(mark.rect.width / natural.w) * 100}%`,
                height: `${(mark.rect.height / natural.h) * 100}%`,
              }}
            />
          );
        })}
    </span>
  );
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

/// Parses a print-style page selection ("1-3, 5, 8") into sorted, unique
/// 0-based page indices, clamped to the document. Invalid or out-of-range
/// parts are ignored so a stray character never aborts the export.
function parsePageRanges(input: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bounds = trimmed.split("-").map((n) => Number.parseInt(n, 10));
    const [from, to] =
      bounds.length === 2 ? bounds : [bounds[0], bounds[0]];
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    for (let p = Math.min(from, to); p <= Math.max(from, to); p++) {
      if (p >= 1 && p <= pageCount) pages.add(p - 1);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

const PANE_WIDTHS_KEY = "menreiki.paneWidths";
const DEFAULT_PANE_WIDTHS = { left: 108, right: 360 };

function loadPaneWidths(): { left: number; right: number } {
  try {
    const raw = localStorage.getItem(PANE_WIDTHS_KEY);
    if (raw) return { ...DEFAULT_PANE_WIDTHS, ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return DEFAULT_PANE_WIDTHS;
}

/// Left/center/right placement picker for a replacement, shown next to the
/// replace value so the reviewer can align a substitute of a different length
/// to the original's edge. Center is the default.
function AlignToggle(props: {
  value: TextAlign | undefined;
  onChange: (align: TextAlign) => void;
}) {
  const current = props.value ?? "center";
  const options: [TextAlign, string, string][] = [
    ["left", "⇤", "左揃え"],
    ["center", "≡", "中央揃え"],
    ["right", "⇥", "右揃え"],
  ];
  return (
    <span className="align-toggle">
      {options.map(([align, glyph, title]) => (
        <button
          key={align}
          className={current === align ? "align-btn current" : "align-btn"}
          title={title}
          onClick={() => props.onChange(align)}
        >
          {glyph}
        </button>
      ))}
    </span>
  );
}

/// One-click decision buttons (保持/マスク/消去/置換) with the current state
/// highlighted; clicking the active one clears back to 未判断. The same
/// control everywhere a target can be judged, replacing per-place dropdowns.
function DecisionButtons(props: {
  value: DecisionAction | undefined;
  onChange: (action: DecisionAction | "undecided") => void;
}) {
  const options: [DecisionAction, string][] = [
    ["keep", "保持"],
    ["mask", "マスク"],
    ["erase", "消去"],
    ["replace", "置換"],
  ];
  return (
    <span className="decision-buttons">
      {options.map(([action, label]) => (
        <button
          key={action}
          className={
            props.value === action ? "decision-btn current" : "decision-btn"
          }
          title={props.value === action ? `${label}を解除` : label}
          onClick={() =>
            props.onChange(props.value === action ? "undecided" : action)
          }
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/// In-place entity assignment: a small popover right on the row offering
/// 新規Entity or any existing entity, so consolidating a spelling never
/// requires jumping to a distant bar.
function EntityMenu(props: {
  entities: Entity[];
  label?: string;
  onNew: () => void;
  onAssign: (entityId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="entity-menu">
      <button
        className="mini"
        title="Entityへ（表記揺れを1つの仮称へ統合）"
        onClick={() => setOpen((current) => !current)}
      >
        {props.label ?? "E"}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu entity-popover">
            <button
              onClick={() => {
                setOpen(false);
                props.onNew();
              }}
            >
              ＋ 新規Entity
            </button>
            {props.entities.map((entity) => (
              <button
                key={entity.id}
                onClick={() => {
                  setOpen(false);
                  props.onAssign(entity.id);
                }}
              >
                → {entity.alias || entity.variants[0]}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/// Popover that assigns a just-detected box to an existing candidate group
/// (category + text) — "this is a missed occurrence of that finding". Groups
/// related to the read text rank first; the filter narrows long lists.
function FindingGroupMenu(props: {
  groups: { category: string; text: string }[];
  seed: string;
  onPick: (group: { category: string; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const strip = (value: string) => value.replace(/[\s　]/g, "");
  const seed = strip(props.seed);
  const query = strip(filter).toLowerCase();
  const related = (group: { text: string }) => {
    const text = strip(group.text);
    return text.includes(seed) || seed.includes(text) ? 0 : 1;
  };
  const listed = (
    query
      ? props.groups.filter((group) =>
          strip(group.text).toLowerCase().includes(query),
        )
      : [...props.groups].sort((a, b) => related(a) - related(b))
  ).slice(0, 30);
  return (
    <span className="entity-menu">
      <button
        className="mini"
        title="既存の検出候補グループの検出漏れとして統合する"
        onClick={() => setOpen((current) => !current)}
      >
        既存候補へ
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu entity-popover group-popover">
            <input
              autoFocus
              placeholder="候補を絞り込み"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {listed.map((group) => (
              <button
                key={`${group.category}|${group.text}`}
                onClick={() => {
                  setOpen(false);
                  props.onPick(group);
                }}
              >
                <span className="category-tag">{group.category}</span>{" "}
                {group.text}
              </button>
            ))}
            {listed.length === 0 && (
              <span className="hint">一致する候補がありません</span>
            )}
          </div>
        </>
      )}
    </span>
  );
}

interface DetectedTarget {
  text: string;
  category: string;
  page: number;
  rect: Rect;
}

const stripWs = (value: string) => value.replace(/[\s　]/g, "");

/// An exported path with a copy-to-clipboard button.
function ExportPathLine(props: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="export-path" title={props.path}>
      <button
        className="mini"
        title="パスをコピー"
        onClick={() => {
          void navigator.clipboard.writeText(props.path).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "✓" : "コピー"}
      </button>{" "}
      出力: {props.path}
    </p>
  );
}

/// Accordion body of a pending rule: every occurrence of the rule's texts in
/// the document as a before → simulated-after crop pair. The after side
/// paints the rule's outcome (erase/mask fill, replacement text with its
/// alignment) over the same crop, so the result is previewable before 適用.
/// Clicking a pair jumps the main view to that spot.
function RuleCropsPanel(props: {
  projectDir: string;
  texts: string[];
  action: Exclude<DecisionAction, "keep">;
  value: string;
  align?: TextAlign;
  pinned: { page: number; rect: Rect }[];
  onJump: (page: number, rect: Rect) => void;
}) {
  const [items, setItems] = useState<{ page: number; rect: Rect }[] | null>(
    null,
  );
  const pinnedRef = useRef(props.pinned);
  pinnedRef.current = props.pinned;
  const textsRef = useRef(props.texts);
  textsRef.current = props.texts;
  const textsKey = props.texts.join("|");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seen = new Set<string>();
      const found: { page: number; rect: Rect }[] = [];
      const push = (page: number, rect: Rect) => {
        const key = `${page}|${Math.round(rect.x)}|${Math.round(rect.y)}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ page, rect });
        }
      };
      for (const pin of pinnedRef.current) push(pin.page, pin.rect);
      for (const text of textsRef.current) {
        if (!text.trim()) continue;
        const hits = await searchProject(props.projectDir, text).catch(
          () => [],
        );
        for (const page of hits) {
          for (const finding of page.findings) {
            push(page.page_index, finding.rect);
          }
        }
      }
      found.sort((a, b) => a.page - b.page || a.rect.y - b.rect.y);
      if (!cancelled) setItems(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.projectDir, textsKey]);

  if (!items) return <p className="status">出現箇所を検索中…</p>;
  if (items.length === 0)
    return (
      <p className="status">
        本文中に出現箇所が見つかりません（位置未特定の可能性）
      </p>
    );
  return (
    <div className="rule-crops">
      {items.map((item, index) => (
        <button
          key={index}
          className="rule-crop-row"
          title="クリックで該当箇所へジャンプ"
          onClick={() => props.onJump(item.page, item.rect)}
        >
          <span className="page-tag">p.{item.page + 1}</span>
          <RegionThumb
            projectDir={props.projectDir}
            pageIndex={item.page}
            rect={item.rect}
            maxWidth={140}
            maxHeight={40}
          />
          <span className="applied-arrow">→</span>
          <span className="after-sim">
            <RegionThumb
              projectDir={props.projectDir}
              pageIndex={item.page}
              rect={item.rect}
              maxWidth={140}
              maxHeight={40}
            />
            <span
              className={`after-overlay ${props.action}`}
              style={{
                justifyContent:
                  props.align === "left"
                    ? "flex-start"
                    : props.align === "right"
                      ? "flex-end"
                      : "center",
              }}
            >
              {props.action === "replace" ? props.value || "■■■" : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function ReviewView(props: {
  project: ProjectInfo;
  onProjectChange: (project: ProjectInfo) => void;
  onClose: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
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
  const [targetSuggestions, setTargetSuggestions] = useState<string[] | null>(
    null,
  );
  const [suggestingTargets, setSuggestingTargets] = useState(false);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [dictionaryCategory, setDictionaryCategory] = useState("organization");
  const [dictionaryNote, setDictionaryNote] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesHydrated, setEntitiesHydrated] = useState(false);
  const [entitySuggestions, setEntitySuggestions] = useState<
    Record<string, string[]>
  >({});
  const [entityCounts, setEntityCounts] = useState<Record<string, number>>({});
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportPagesInput, setExportPagesInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ rect: Rect; nonce: number } | null>(
    null,
  );
  const [previewRegion, setPreviewRegion] = useState<number | null>(null);
  const [showRulePreview, setShowRulePreview] = useState(true);
  const [scrollPageFlip, setScrollPageFlip] = useState(
    () => localStorage.getItem("menreiki.scrollPageFlip") === "1",
  );
  const [showThumbMarks, setShowThumbMarks] = useState(
    () => localStorage.getItem("menreiki.thumbMarks") !== "0",
  );
  const [findingFilter, setFindingFilter] = useState("");
  const [findingCategoryFilter, setFindingCategoryFilter] = useState("all");
  const [findingUndecidedOnly, setFindingUndecidedOnly] = useState(false);
  const [paneWidths, setPaneWidths] = useState(loadPaneWidths);
  const panesRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef<HTMLButtonElement>(null);
  const searchSectionRef = useRef<HTMLElement>(null);
  const [searchFlash, setSearchFlash] = useState(false);
  const [detectedTarget, setDetectedTarget] = useState<DetectedTarget | null>(
    null,
  );
  const findingRowRefs = useRef(new Map<string, HTMLDivElement>());
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const [showRendered, setShowRendered] = useState(false);
  const [hasRenders, setHasRenders] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);
  const [appliedEdits, setAppliedEdits] = useState<AppliedEdit[]>([]);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [markdownPath, setMarkdownPath] = useState<string | null>(null);
  const [imagesPath, setImagesPath] = useState<string | null>(null);
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
            align: finding.align,
          };
        }
        setDecisions(record);
        setTextRules(
          saved.texts.map((text) => ({
            text: text.text,
            action: text.action as Exclude<DecisionAction, "keep">,
            value: text.value,
            align: text.align,
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
            align: decision.align,
          };
        }),
        texts: textRules.map((rule) => ({
          text: rule.text,
          action: rule.action,
          value: rule.value,
          align: rule.align,
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
    void refreshEntityMeta(entity);
  }

  function addVariant(entityId: string, text: string) {
    const target = entities.find((entity) => entity.id === entityId);
    if (!target || target.variants.includes(text)) return;
    const updated = { ...target, variants: [...target.variants, text] };
    setEntities((current) =>
      current.map((entity) => (entity.id === entityId ? updated : entity)),
    );
    void refreshEntityMeta(updated);
  }

  /// Registers `text` in the project dictionary under `category` and re-runs
  /// detection — the shared path behind every "→辞書" conversion.
  function registerTextToDictionary(category: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    void run("辞書に登録中…", async () => {
      setDictionary(
        await addDictionaryEntry(project.projectDir, category, trimmed),
      );
      if (project.analyzed) {
        await analyzeProject(project.projectDir, "detect-only");
        setFindings(await listFindings(project.projectDir));
      }
    });
  }

  useEffect(() => {
    const unlisten = listen<AnalyzeProgress>("analyze-progress", (event) => {
      setProgress(progressLabel(event.payload));
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // Each page's candidates are written as its OCR finishes; refresh the list
  // so findings appear mid-run instead of only when analysis completes.
  useEffect(() => {
    const unlisten = listen<{ page: number }>("page-detected", () => {
      void listFindings(project.projectDir)
        .then((loaded) => setFindings(loaded))
        .catch(() => {});
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [project.projectDir]);

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

  function runAnalyze(scope: AnalysisScope, pages?: number[]) {
    void run("解析中…", async () => {
      if ((scope === "all" || scope === "resume") && !pages) {
        setSearchHits(null);
        setAudit(null);
        setApplySummary(null);
        setAppliedEdits([]);
        setExportPath(null);
        setImagesPath(null);
        setHasRenders(false);
        setShowRendered(false);
        setHighlightKey(null);
        setFocus(null);
      }
      const outcome = await analyzeProject(
        project.projectDir,
        scope,
        300,
        "ja",
        pages,
      );
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

  const findingCategories = useMemo(
    () =>
      [...new Set(flatFindings.map(({ finding }) => finding.category))].sort(),
    [flatFindings],
  );

  const filteredFindings = useMemo(() => {
    const needle = findingFilter.trim().toLowerCase();
    return flatFindings.filter(({ pageIndex, finding }) => {
      if (
        findingCategoryFilter !== "all" &&
        finding.category !== findingCategoryFilter
      )
        return false;
      if (findingUndecidedOnly && decisions[findingKey(finding)]) return false;
      if (!needle) return true;
      return (
        finding.text.toLowerCase().includes(needle) ||
        finding.category.toLowerCase().includes(needle) ||
        `p.${pageIndex + 1}`.includes(needle)
      );
    });
  }, [
    flatFindings,
    findingFilter,
    findingCategoryFilter,
    findingUndecidedOnly,
    decisions,
  ]);

  // Collapse identical candidates (same category + text) into one row with an
  // occurrence count. Decisions are keyed by category+text and already apply
  // document-wide, so 37 repeated "footer 社" rows only need one entry; the
  // page overlays still show every instance.
  const dedupedFindings = useMemo(() => {
    const byKey = new Map<
      string,
      { pageIndex: number; finding: Finding; count: number }
    >();
    for (const item of filteredFindings) {
      const key = findingKey(item.finding);
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else byKey.set(key, { ...item, count: 1 });
    }
    return [...byKey.values()];
  }, [filteredFindings]);

  // Every candidate group (category + text) in the document, for assigning a
  // boxed detection to an existing group as a missed occurrence.
  const candidateGroups = useMemo(() => {
    const byKey = new Map<string, { category: string; text: string }>();
    for (const { finding } of flatFindings) {
      const key = findingKey(finding);
      if (!byKey.has(key))
        byKey.set(key, { category: finding.category, text: finding.text });
    }
    return [...byKey.values()];
  }, [flatFindings]);

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
      align?: TextAlign,
    ) => {
      if (!text || seenTexts.has(text)) return;
      seenTexts.add(text);
      rules.push({
        match: { text },
        action:
          action === "replace"
            ? { type: "replace", value: value || "■■■", align: align ?? "center" }
            : action === "mask"
              ? { type: "mask" }
              : { type: "remove" },
      });
    };
    for (const entity of entities) {
      for (const variant of entity.variants) {
        pushTextRule(variant, "replace", entity.alias, entity.align);
      }
    }
    for (const entry of decidedEntries) {
      pushTextRule(
        entry.finding.text,
        entry.decision.action as Exclude<DecisionAction, "keep">,
        entry.decision.value,
        entry.decision.align,
      );
    }
    for (const rule of textRules) {
      pushTextRule(rule.text, rule.action, rule.value, rule.align);
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

  /// Text → pending transformation, so the viewer can paint what each
  /// finding on the page will become (green replace / blue mask / red erase),
  /// mirroring the text rules the policy will apply.
  const previewByText = useMemo(() => {
    const map = new Map<
      string,
      { action: DecisionAction; value: string; align?: TextAlign }
    >();
    for (const entity of entities) {
      for (const variant of entity.variants) {
        if (!map.has(variant))
          map.set(variant, {
            action: "replace",
            value: entity.alias,
            align: entity.align,
          });
      }
    }
    for (const entry of decidedEntries) {
      if (!map.has(entry.finding.text))
        map.set(entry.finding.text, {
          action: entry.decision.action,
          value: entry.decision.value,
          align: entry.decision.align,
        });
    }
    for (const rule of textRules) {
      if (!map.has(rule.text))
        map.set(rule.text, {
          action: rule.action,
          value: rule.value,
          align: rule.align,
        });
    }
    return map;
  }, [entities, decidedEntries, textRules]);

  useEffect(() => {
    try {
      localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify(paneWidths));
    } catch {
      // best-effort; a full/blocked storage just loses the preference
    }
  }, [paneWidths]);

  // Keep the current page's thumbnail in view in the left pane whenever the
  // page changes — including jumps triggered from the right pane.
  useEffect(() => {
    currentPageRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [page]);

  /// Drags a separator: `side` picks which pane grows, clamped so neither
  /// pane collapses nor crowds out the viewer in the middle.
  function startResize(side: "left" | "right", event: React.PointerEvent) {
    event.preventDefault();
    const panes = panesRef.current;
    if (!panes) return;
    const startX = event.clientX;
    const startWidths = paneWidths;
    const total = panes.clientWidth;
    (event.target as Element).setPointerCapture(event.pointerId);

    function onMove(move: PointerEvent) {
      const delta = move.clientX - startX;
      setPaneWidths((current) => {
        if (side === "left") {
          const left = Math.round(startWidths.left + delta);
          const max = total - startWidths.right - 320;
          return { ...current, left: Math.min(Math.max(80, left), Math.max(80, max)) };
        }
        const right = Math.round(startWidths.right - delta);
        const max = total - startWidths.left - 320;
        return { ...current, right: Math.min(Math.max(240, right), Math.max(240, max)) };
      });
    }
    function onUp(up: PointerEvent) {
      (event.target as Element).releasePointerCapture(up.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function runApply() {
    void run("変換を適用中…", async () => {
      const summary = await applyPolicy(project.projectDir, policy);
      setApplySummary(summary);
      setAppliedEdits(
        await listAppliedEdits(project.projectDir).catch(() => []),
      );
      setHasRenders(true);
      setShowRendered(true);
      setVersion((current) => current + 1);
      setAudit(null);
    });
  }

  function runExport(pages?: number[]) {
    setExportMenuOpen(false);
    void run("PDFを再構築中…", async () => {
      setExportPath(await exportProject(project.projectDir, 300, pages));
      const scopeNote =
        pages && pages.length > 0
          ? `${pages.length} ページを出力しました。`
          : "";
      if (undecidedCount > 0) {
        setNotice(
          `${scopeNote}未判断の候補が ${undecidedCount} 種類残っています。出力を共有する前に確認してください。`,
        );
      } else if (scopeNote) {
        setNotice(scopeNote);
      }
    });
  }

  function runExportImages() {
    void run("画像を出力中…", async () => {
      setImagesPath(await exportImages(project.projectDir));
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

  /// Scrolls the search block into view and flashes it, so the reviewer sees
  /// where a just-detected result landed in the right pane.
  function revealSearch() {
    searchSectionRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
    setSearchFlash(true);
    window.setTimeout(() => setSearchFlash(false), 1200);
  }

  /// "Detect this": read what the reviewer boxed on the page and drop it into
  /// search. OCR text is used when present; a box over a figure/logo/rotated
  /// label OCR could not read falls back to the vision model, whose result is
  /// located by the box the reviewer drew.
  /// Surfaces a detected target: its text becomes the active search string
  /// (so its other occurrences are listed) and the target bar's one-click
  /// actions (replace/mask/erase/entity/dictionary/group) operate on it,
  /// with the box coordinates kept for jumping and re-assignment.
  function offerTarget(target: DetectedTarget) {
    setDetectedTarget(target);
    setSearchInput(target.text);
    revealSearch();
  }

  /// Re-labels the just-detected box as a missed occurrence of an existing
  /// candidate group: the misread stand-in is removed and the box is pinned
  /// with the group's text, so it joins that row and shares its decision.
  function assignDetectedToGroup(group: { category: string; text: string }) {
    const target = detectedTarget;
    if (!target) return;
    void run("既存候補へ統合中…", async () => {
      await removeManualFinding(
        project.projectDir,
        target.page,
        target.category,
        target.text,
      ).catch(() => {});
      await addManualFinding(
        project.projectDir,
        target.page,
        target.rect,
        group.category,
        group.text,
      );
      setFindings(await listFindings(project.projectDir));
      setDetectedTarget(null);
      setHighlightKey(`${group.category}|::|${group.text}`);
    });
  }

  /// Jumps the main view to the first occurrence of `text` in the document —
  /// the generic jump for right-pane items that carry no coordinates of their
  /// own (text rules, dictionary entries, entity spellings).
  function jumpToText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    void run("本文を検索中…", async () => {
      const hits = await searchProject(project.projectDir, trimmed);
      const first = hits.find((entry) => entry.findings.length > 0);
      if (!first) {
        setNotice(`「${trimmed}」は本文中に見つかりませんでした`);
        return;
      }
      jumpTo(first.page_index, first.findings[0]);
    });
  }

  function toggleRuleExpansion(key: string) {
    setExpandedRules((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function jumpToRect(page: number, rect: Rect) {
    setPage(page);
    setFocus((current) => ({ rect, nonce: (current?.nonce ?? 0) + 1 }));
  }

  /// Occurrence pins from currently loaded findings whose text matches one of
  /// `texts` — gives the crops panel the manually boxed rects OCR search
  /// cannot find. Location-unknown (whole-page VLM) findings are excluded.
  function pinnedFor(texts: string[]) {
    const needles = texts.map(stripWs);
    return flatFindings
      .filter(
        ({ finding }) =>
          needles.includes(stripWs(finding.text)) &&
          !finding.note?.startsWith("位置未特定"),
      )
      .map(({ pageIndex, finding }) => ({ page: pageIndex, rect: finding.rect }));
  }

  /// Scrolls the findings list to the row for `finding` and flashes it — the
  /// reverse direction of jumpTo, for clicks on rects in the main view.
  function revealFindingRow(finding: Finding) {
    const key = findingKey(finding);
    setHighlightKey(key);
    findingRowRefs.current
      .get(key)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setFlashKey(key);
    window.setTimeout(() => setFlashKey(null), 1300);
  }

  // The mode stays active afterwards (like erase/mask), so several spots can
  // be boxed in a row without re-selecting it.
  function detectRegion(rect: Rect) {
    void run("領域を読み取り中…", async () => {
      // The box is ground truth for both position and extent. Read its text
      // with a dedicated OCR pass on the (padded, upscaled) crop; fall back
      // to the whole-page words in the box, then to the vision model.
      let text = (
        await readRegion(project.projectDir, page, rect).catch(() => "")
      ).trim();
      if (!text) {
        text = (
          await textInRegion(project.projectDir, page, rect).catch(() => "")
        ).trim();
      }
      if (!text) {
        setProgress("OCRで読めない領域をVLMで読み取り中…");
        const read = await vlmInRegion(project.projectDir, page, rect).catch(
          () => [] as string[],
        );
        text = (read[0] ?? "").trim();
        if (read.length > 1) setNotice(`VLM読取: ${read.join(" / ")}`);
      }
      if (!text) {
        setNotice("この領域からは文字を取得できませんでした。");
        return;
      }
      // Pin the candidate at the exact box, so it appears in 検出候補 with
      // the reviewer's own coordinates even if page OCR misread the text.
      await addManualFinding(
        project.projectDir,
        page,
        rect,
        dictionaryCategory,
        text,
      ).catch(() => {});
      setFindings(await listFindings(project.projectDir).catch(() => findings));
      setSearchHits(
        await searchProject(project.projectDir, text).catch(() => null),
      );
      offerTarget({ text, category: dictionaryCategory, page, rect });
    });
  }

  /// Asks the local model which sensitive terms it would look for in this
  /// document; the reviewer picks one to search and turn into a rule.
  function runSuggestTargets() {
    setSuggestingTargets(true);
    setTargetSuggestions(null);
    setError(null);
    suggestTargets(project.projectDir)
      .then((terms) => setTargetSuggestions(terms))
      .catch((failure) => setError(String(failure)))
      .finally(() => setSuggestingTargets(false));
  }

  function ignoreFinding(finding: Finding) {
    void run("無視リストに追加中…", async () => {
      const settings = await getProjectSettings(project.projectDir);
      const ignored = settings.ignored ?? [];
      // Scope the ignore to this finding's category, so the same text found
      // under another category is unaffected.
      const already = ignored.some(
        (entry) =>
          typeof entry === "object" &&
          entry.text === finding.text &&
          entry.category === finding.category,
      );
      if (!already) {
        await setProjectSettings(project.projectDir, {
          ...settings,
          ignored: [
            ...ignored,
            { text: finding.text, category: finding.category },
          ],
        });
      }
      if (project.analyzed) {
        await analyzeProject(project.projectDir, "detect-only");
        setFindings(await listFindings(project.projectDir));
      }
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
      [key]: { ...current[key], action: current[key]?.action ?? "replace", value },
    }));
  }

  function setDecisionAlign(key: string, align: TextAlign) {
    setDecisions((current) => ({
      ...current,
      [key]: {
        action: current[key]?.action ?? "replace",
        value: current[key]?.value ?? "",
        align,
      },
    }));
  }

  function setTextRuleAlign(index: number, align: TextAlign) {
    setTextRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, align } : rule)),
    );
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
                      [
                        "page",
                        `このページ（p.${page + 1}）のみ再解析`,
                        () => runAnalyze("resume", [page]),
                      ],
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
        <div className="reanalyze-menu">
          <button
            onClick={() => setExportMenuOpen((open) => !open)}
            disabled={busy !== null || !hasRenders}
          >
            PDF出力 ▾
          </button>
          {exportMenuOpen && (
            <>
              <div
                className="menu-backdrop"
                onClick={() => setExportMenuOpen(false)}
              />
              <div className="menu export-menu">
                <button onClick={() => runExport()}>すべてのページを出力</button>
                <div className="export-range">
                  <label className="hint">
                    ページ指定（例: 1-3, 5, 8）
                  </label>
                  <input
                    value={exportPagesInput}
                    placeholder={`1-${project.pageCount}`}
                    onChange={(event) => setExportPagesInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        const pages = parsePageRanges(
                          exportPagesInput,
                          project.pageCount,
                        );
                        if (pages.length > 0) runExport(pages);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const pages = parsePageRanges(
                        exportPagesInput,
                        project.pageCount,
                      );
                      if (pages.length > 0) runExport(pages);
                    }}
                  >
                    選択ページを出力
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <button
          onClick={runExportMarkdown}
          disabled={busy !== null || !hasRenders}
        >
          Markdown出力
        </button>
        <button
          onClick={runExportImages}
          disabled={busy !== null || !hasRenders}
          title="変換後ページをPNG画像として output/images/ に出力"
        >
          画像出力
        </button>
        <button onClick={runAudit} disabled={busy !== null || !hasRenders}>
          監査
        </button>
        <button
          className="theme-button"
          onClick={() => setHelpOpen(true)}
          title="ヘルプ（各要素の対応関係とデータの流れ）"
        >
          ❓
        </button>
        <button
          className="theme-button"
          onClick={props.onToggleTheme}
          title="テーマを切り替える"
        >
          {props.theme === "dark" ? "☀" : "🌙"}
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

      <div
        className="panes"
        ref={panesRef}
        style={{
          gridTemplateColumns: `${paneWidths.left}px 6px minmax(0, 1fr) 6px ${paneWidths.right}px`,
        }}
      >
        <nav className="page-list">
          <label
            className="thumb-toggle"
            title="検出候補と領域ルールのおおよその位置をサムネイルに重ねる"
          >
            <input
              type="checkbox"
              checked={showThumbMarks}
              onChange={(event) => {
                setShowThumbMarks(event.target.checked);
                localStorage.setItem(
                  "menreiki.thumbMarks",
                  event.target.checked ? "1" : "0",
                );
              }}
            />
            位置
          </label>
          {Array.from({ length: project.pageCount }, (_, index) => (
            <button
              key={index}
              ref={index === page ? currentPageRef : undefined}
              className={
                index === page ? "page-button current" : "page-button"
              }
              onClick={() => setPage(index)}
            >
              <PageThumb
                projectDir={project.projectDir}
                pageIndex={index}
                version={version}
                marks={
                  showThumbMarks
                    ? [
                        ...(
                          findings.find(
                            (entry) => entry.page_index === index,
                          )?.findings ?? []
                        ).map((finding) => ({
                          rect: finding.rect,
                          kind: "finding" as const,
                        })),
                        ...regionRules
                          .filter(
                            (rule) =>
                              rule.scope === "all" || rule.scope === index,
                          )
                          .map((rule) => ({
                            rect: rule.rect,
                            kind: "region" as const,
                          })),
                      ]
                    : undefined
                }
              />
              <span className="page-number">{index + 1}</span>
              {(findings.find((entry) => entry.page_index === index)?.findings
                .length ?? 0) > 0 && <span className="dot" />}
            </button>
          ))}
        </nav>

        <div
          className="pane-gutter"
          onPointerDown={(event) => startResize("left", event)}
          title="ドラッグで左ペインの幅を変更"
        />

        <main className="viewer-pane">
          <div className="viewer-toolbar">
            <span>矩形選択:</span>
            {(["none", "erase", "mask", "detect"] as DrawMode[]).map((mode) => (
              <button
                key={mode}
                className={drawMode === mode ? "mode current" : "mode"}
                onClick={() => setDrawMode(mode)}
              >
                {mode === "none"
                  ? "なし"
                  : mode === "erase"
                    ? "消去"
                    : mode === "mask"
                      ? "マスク"
                      : "ここを検出"}
              </button>
            ))}
            {(drawMode === "erase" || drawMode === "mask") && (
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
            {drawMode === "detect" && (
              <span className="hint">
                検出したい箇所をドラッグで囲むと、その文字を検出対象にします
              </span>
            )}
            <span className="spacer" />
            <label
              className="toggle"
              title="ページ下端/上端でさらにスクロールすると次/前のページへ"
            >
              <input
                type="checkbox"
                checked={scrollPageFlip}
                onChange={(event) => {
                  setScrollPageFlip(event.target.checked);
                  localStorage.setItem(
                    "menreiki.scrollPageFlip",
                    event.target.checked ? "1" : "0",
                  );
                }}
              />
              スクロールでページ送り
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showRulePreview}
                onChange={(event) => setShowRulePreview(event.target.checked)}
              />
              適用予定を重ねる
            </label>
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
            rulePreview={showRulePreview ? previewByText : null}
            focusRect={focus?.rect ?? null}
            focusNonce={focus?.nonce ?? 0}
            onRegion={(rect) => {
              if (drawMode === "detect") {
                detectRegion(rect);
                return;
              }
              setRegionRules((current) => [
                ...current,
                {
                  rect,
                  action: drawMode === "mask" ? "mask" : "erase",
                  scope: drawScope === "all" ? "all" : page,
                  drawnOn: page,
                },
              ]);
            }}
            onRegionRemove={(index) =>
              setRegionRules((current) =>
                current.filter((_, i) => i !== index),
              )
            }
            onFindingClick={revealFindingRow}
            pageCount={project.pageCount}
            scrollPageFlip={scrollPageFlip}
            onPageChange={setPage}
          />
        </main>

        <div
          className="pane-gutter"
          onPointerDown={(event) => startResize("right", event)}
          title="ドラッグで右ペインの幅を変更"
        />

        <aside className="side-pane">
          <section className="section-precheck">
            <h2>出力前確認</h2>
            <div className={undecidedCount > 0 ? "precheck warn" : "precheck ok"}>
              <span>未判断の候補: {undecidedCount} 種類</span>
              <span>判断済み: {decidedCount} 種類</span>
              <span>適用予定ルール: {policy.rules.length} 件</span>
            </div>
          </section>

          <section
            ref={searchSectionRef}
            className={
              searchFlash ? "section-search reveal-flash" : "section-search"
            }
          >
            {detectedTarget && (
              <div className="detected-target">
                <div className="detected-head">
                  <span className="chip-action">検出</span>
                  <button
                    className="finding-text detected-jump"
                    title={`${detectedTarget.text}（クリックで該当箇所へ）`}
                    onClick={() => {
                      setPage(detectedTarget.page);
                      setFocus((current) => ({
                        rect: detectedTarget.rect,
                        nonce: (current?.nonce ?? 0) + 1,
                      }));
                    }}
                  >
                    {detectedTarget.text}
                  </button>
                  <button
                    className="mini"
                    title="閉じる"
                    onClick={() => setDetectedTarget(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="detected-actions">
                  <button
                    onClick={() => {
                      addSearchRule("mask");
                      setDetectedTarget(null);
                    }}
                  >
                    マスク
                  </button>
                  <button
                    onClick={() => {
                      addSearchRule("erase");
                      setDetectedTarget(null);
                    }}
                  >
                    消去
                  </button>
                  <button
                    onClick={() => {
                      addSearchRule("replace");
                      setDetectedTarget(null);
                    }}
                  >
                    置換
                  </button>
                  <EntityMenu
                    entities={entities}
                    label="Entityへ"
                    onNew={() => {
                      createEntity(dictionaryCategory, detectedTarget.text);
                      setDetectedTarget(null);
                    }}
                    onAssign={(id) => {
                      addVariant(id, detectedTarget.text);
                      setDetectedTarget(null);
                    }}
                  />
                  <FindingGroupMenu
                    groups={candidateGroups.filter(
                      (group) =>
                        group.text !== detectedTarget.text ||
                        group.category !== detectedTarget.category,
                    )}
                    seed={detectedTarget.text}
                    onPick={assignDetectedToGroup}
                  />
                  <button
                    disabled={busy !== null}
                    onClick={() => {
                      registerTextToDictionary(
                        dictionaryCategory,
                        detectedTarget.text,
                      );
                      setDetectedTarget(null);
                    }}
                  >
                    辞書へ
                  </button>
                </div>
              </div>
            )}
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
            <div className="suggest-targets">
              <button
                className="mini"
                title="ローカルLLMに、この文書で検出すべき機密語の候補を提案させる"
                onClick={runSuggestTargets}
                disabled={suggestingTargets || busy !== null}
              >
                {suggestingTargets ? "提案中…" : "✨ AIに検出対象を提案させる"}
              </button>
              {targetSuggestions?.length === 0 && (
                <span className="hint">提案はありませんでした</span>
              )}
              {targetSuggestions && targetSuggestions.length > 0 && (
                <div className="target-chips">
                  {targetSuggestions.map((term) => (
                    <button
                      key={term}
                      className="variant-chip suggest"
                      title="クリックでこの語を検索"
                      onClick={() => {
                        setSearchInput(term);
                        void run("検索中…", async () => {
                          setSearchHits(
                            await searchProject(project.projectDir, term),
                          );
                        });
                      }}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              )}
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
            <section className="section-dictionary">
              <h2>辞書（{dictionary.length}件）</h2>
              <div className="rule-list">
                {dictionary.map((entry) => (
                  <div key={entry.text} className="rule-entry">
                    <span className="category-tag">{entry.category}</span>
                    <button
                      className="rule-target"
                      title={`${entry.text}（クリックで該当箇所へ）`}
                      onClick={() => jumpToText(entry.text)}
                    >
                      <span className="finding-text">{entry.text}</span>
                    </button>
                    <EntityMenu
                      entities={entities}
                      onNew={() => createEntity(entry.category, entry.text)}
                      onAssign={(id) => addVariant(id, entry.text)}
                    />
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

          <section className="section-rules">
            <h2>適用予定ルール（{policy.rules.length}件）</h2>
            <div className="rule-list">
              {entities
                .filter((entity) => entity.variants.length > 0)
                .map((entity) => (
                  <div key={entity.id} className="rule-block">
                    <div className="rule-entry">
                      <button
                        className="mini"
                        title="出現箇所のビフォー/アフターを開閉"
                        onClick={() => toggleRuleExpansion(`ent-${entity.id}`)}
                      >
                        {expandedRules.has(`ent-${entity.id}`) ? "▾" : "▸"}
                      </button>
                      <span className="chip-action">置換</span>
                      <span className="rule-target" title={entity.variants.join("、")}>
                        <span className="category-tag">Entity</span>
                        <span className="finding-text">
                          {entity.variants.length}表記 → {entity.alias || "（仮称未設定）"}
                        </span>
                      </span>
                    </div>
                    {expandedRules.has(`ent-${entity.id}`) && (
                      <RuleCropsPanel
                        projectDir={project.projectDir}
                        texts={entity.variants}
                        action="replace"
                        value={entity.alias}
                        align={entity.align}
                        pinned={pinnedFor(entity.variants)}
                        onJump={jumpToRect}
                      />
                    )}
                  </div>
                ))}
              {decidedEntries.map((entry) => (
                <div key={entry.key} className="rule-block">
                <div className="rule-entry">
                  <button
                    className="mini"
                    title="出現箇所のビフォー/アフターを開閉"
                    onClick={() => toggleRuleExpansion(`dec-${entry.key}`)}
                  >
                    {expandedRules.has(`dec-${entry.key}`) ? "▾" : "▸"}
                  </button>
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
                      <AlignToggle
                        value={entry.decision.align}
                        onChange={(align) => setDecisionAlign(entry.key, align)}
                      />
                    </>
                  )}
                  <EntityMenu
                    entities={entities}
                    onNew={() => {
                      createEntity(entry.finding.category, entry.finding.text);
                      setDecision(entry.key, "undecided");
                    }}
                    onAssign={(id) => {
                      addVariant(id, entry.finding.text);
                      setDecision(entry.key, "undecided");
                    }}
                  />
                  <button onClick={() => setDecision(entry.key, "undecided")}>
                    解除
                  </button>
                </div>
                {expandedRules.has(`dec-${entry.key}`) && (
                  <RuleCropsPanel
                    projectDir={project.projectDir}
                    texts={[entry.finding.text]}
                    action={
                      entry.decision.action as Exclude<DecisionAction, "keep">
                    }
                    value={entry.decision.value}
                    align={entry.decision.align}
                    pinned={pinnedFor([entry.finding.text])}
                    onJump={jumpToRect}
                  />
                )}
                </div>
              ))}

              {textRules.map((rule, index) => (
                <div key={`text-${index}`} className="rule-block">
                <div className="rule-entry">
                  <button
                    className="mini"
                    title="出現箇所のビフォー/アフターを開閉"
                    onClick={() => toggleRuleExpansion(`txt-${rule.text}`)}
                  >
                    {expandedRules.has(`txt-${rule.text}`) ? "▾" : "▸"}
                  </button>
                  <span className="chip-action">
                    {ACTION_LABELS[rule.action]}
                  </span>
                  <button
                    className="rule-target"
                    title={`${rule.text}（クリックで該当箇所へ）`}
                    onClick={() => jumpToText(rule.text)}
                  >
                    <span className="category-tag">検索</span>
                    <span className="finding-text">{rule.text}</span>
                  </button>
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
                      <AlignToggle
                        value={rule.align}
                        onChange={(align) => setTextRuleAlign(index, align)}
                      />
                    </>
                  )}
                  <EntityMenu
                    entities={entities}
                    onNew={() => {
                      createEntity(dictionaryCategory, rule.text);
                      setTextRules((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                    onAssign={(id) => {
                      addVariant(id, rule.text);
                      setTextRules((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                  />
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
                {expandedRules.has(`txt-${rule.text}`) && (
                  <RuleCropsPanel
                    projectDir={project.projectDir}
                    texts={[rule.text]}
                    action={rule.action}
                    value={rule.value}
                    align={rule.align}
                    pinned={pinnedFor([rule.text])}
                    onJump={jumpToRect}
                  />
                )}
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

          <section className="section-entity">
            <h2>Entity（{entities.length}件）</h2>
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
                    <AlignToggle
                      value={entity.align}
                      onChange={(align) =>
                        setEntities((current) =>
                          current.map((candidate) =>
                            candidate.id === entity.id
                              ? { ...candidate, align }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <button
                      className="mini"
                      title="代表表記を辞書に登録（以後の解析で自動検出）"
                      disabled={busy !== null || entity.variants.length === 0}
                      onClick={() =>
                        registerTextToDictionary(
                          entity.category,
                          entity.variants[0],
                        )
                      }
                    >
                      →辞書
                    </button>
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
                        <button
                          className="chip-text"
                          title={`${variant}（クリックで該当箇所へ）`}
                          onClick={() => jumpToText(variant)}
                        >
                          {variant}
                        </button>
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
            <h2>
              検出候補（{dedupedFindings.length}種
              {filteredFindings.length !== flatFindings.length
                ? ` / 全${flatFindings.length}件`
                : filteredFindings.length !== dedupedFindings.length
                  ? ` / ${filteredFindings.length}件`
                  : ""}
              ）
            </h2>
            <div className="finding-filter">
              <input
                value={findingFilter}
                placeholder="絞り込み（語・分類・p.3）"
                onChange={(event) => setFindingFilter(event.target.value)}
              />
              <select
                value={findingCategoryFilter}
                onChange={(event) =>
                  setFindingCategoryFilter(event.target.value)
                }
              >
                <option value="all">すべての分類</option>
                {findingCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={findingUndecidedOnly}
                  onChange={(event) =>
                    setFindingUndecidedOnly(event.target.checked)
                  }
                />
                未判断のみ
              </label>
            </div>
            <div className="findings-list">
              {dedupedFindings.map(({ pageIndex, finding, count }, index) => {
                const key = findingKey(finding);
                const decision = decisions[key];
                return (
                  <div
                    key={index}
                    ref={(element) => {
                      if (element) findingRowRefs.current.set(key, element);
                      else findingRowRefs.current.delete(key);
                    }}
                    className={[
                      "finding-row",
                      highlightKey === key ? "highlight" : "",
                      decision ? "decided" : "",
                      flashKey === key ? "reveal-flash" : "",
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
                      <span className="page-tag">
                        p.{pageIndex + 1}
                        {count > 1 ? `+${count - 1}` : ""}
                      </span>
                      <span className={`category-tag cat-${finding.category}`}>
                        {finding.category}
                      </span>
                      <span className="finding-text">{finding.text}</span>
                    </button>
                    <DecisionButtons
                      value={decision?.action}
                      onChange={(action) => setDecision(key, action)}
                    />
                    <EntityMenu
                      entities={entities}
                      onNew={() => createEntity(finding.category, finding.text)}
                      onAssign={(id) => addVariant(id, finding.text)}
                    />
                    <button
                      className="mini"
                      title={`「${finding.text}」を ${finding.category} の検出から除外`}
                      onClick={() => ignoreFinding(finding)}
                    >
                      無視
                    </button>
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
              {flatFindings.length > 0 && filteredFindings.length === 0 && (
                <p className="status">絞り込み条件に一致する候補はありません</p>
              )}
            </div>
          </section>

          <section className="results-section">
            <h2>結果</h2>
            {applySummary && (
              <p>
                適用済み: {applySummary.edit_count} 箇所 /{" "}
                {applySummary.page_count} ページ
              </p>
            )}
            {applySummary && appliedEdits.length > 0 && (
              <div className="applied-list">
                {appliedEdits.map((edit, index) => (
                  <div key={index} className="applied-row">
                    <button
                      className="page-tag"
                      title="該当箇所へジャンプ"
                      onClick={() => {
                        setPage(edit.page);
                        setFocus((current) => ({
                          rect: edit.rect,
                          nonce: (current?.nonce ?? 0) + 1,
                        }));
                      }}
                    >
                      p.{edit.page + 1}
                    </button>
                    <span className="chip-action">
                      {edit.action === "replace"
                        ? "置換"
                        : edit.action === "mask"
                          ? "マスク"
                          : "消去"}
                    </span>
                    <span className="applied-pair">
                      <RegionThumb
                        projectDir={project.projectDir}
                        pageIndex={edit.page}
                        rect={edit.rect}
                        maxWidth={150}
                        maxHeight={44}
                      />
                      <span className="applied-arrow">→</span>
                      <RegionThumb
                        projectDir={project.projectDir}
                        pageIndex={edit.page}
                        rect={edit.rect}
                        maxWidth={150}
                        maxHeight={44}
                        rendered
                        version={version}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {exportPath && <ExportPathLine path={exportPath} />}
            {markdownPath && <ExportPathLine path={markdownPath} />}
            {imagesPath && <ExportPathLine path={imagesPath} />}
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

      {helpOpen && <HelpView onClose={() => setHelpOpen(false)} />}

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
