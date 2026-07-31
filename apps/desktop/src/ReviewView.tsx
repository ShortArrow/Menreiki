import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Moon,
  Pencil,
  Settings2,
  Sparkles,
  Sun,
  X,
} from "./icons";
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
import { useI18n, type MessageKey, type Language, type Translate } from "./i18n";
import PageViewer, { DrawMode } from "./PageViewer";
import RegionThumb from "./RegionThumb";
import SettingsView from "./SettingsView";
import type {
  AlignOverride,
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

const actionLabel = (t: Translate, action: Exclude<DecisionAction, "keep">) =>
  t(`action.${action}` as MessageKey);

const aliasLabel = (t: Translate, category: string) =>
  category in ALIAS_CATEGORIES
    ? t(`alias.${category}` as MessageKey)
    : t("alias.fallback");

const ALIAS_CATEGORIES = {
  organization: true,
  department: true,
  person: true,
  product: true,
  place: true,
} as const;

interface AnalyzeProgress {
  stage: string;
  page: number | null;
  total: number | null;
}

function progressLabel(t: Translate, progress: AnalyzeProgress): string {
  const pages =
    progress.page === null
      ? ""
      : progress.total === null
        ? t("progress.pageOf", { page: progress.page })
        : t("progress.pageOfTotal", {
            page: progress.page,
            total: progress.total,
          });
  switch (progress.stage) {
    case "render":
    case "ocr":
    case "markdown":
    case "llm":
    case "vlm":
      return t(`progress.${progress.stage}` as MessageKey, { pages });
    case "detect":
      return t("progress.detect");
    case "done":
      return t("progress.done");
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
  const { t } = useI18n();
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
        title={t("review.suggestReplacements")}
        disabled={loading}
        onClick={fetchSuggestions}
      >
        {loading ? "…" : <Sparkles size={13} />}
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
  const { t } = useI18n();
  const current = props.value ?? "center";
  const options: [TextAlign, React.ReactNode, string][] = [
    ["left", <AlignLeft key="l" size={12} />, t("review.alignLeft")],
    ["center", <AlignCenter key="c" size={12} />, t("review.alignCenter")],
    ["right", <AlignRight key="r" size={12} />, t("review.alignRight")],
  ];
  return (
    <span className="align-toggle">
      {options.map(([align, glyph, title]) => (
        <button
          key={align}
          className={current === align ? "align-btn current" : "align-btn"}
          title={title}
          aria-label={title}
          onClick={() => props.onChange(align)}
        >
          {glyph}
        </button>
      ))}
    </span>
  );
}

/// One-click decision buttons (keep/mask/erase/replace) with the current state
/// highlighted; clicking the active one clears the decision. The same control
/// everywhere a target can be judged, replacing per-place dropdowns.
function DecisionButtons(props: {
  value: DecisionAction | undefined;
  onChange: (action: DecisionAction | "undecided") => void;
}) {
  const { t } = useI18n();
  const options: [DecisionAction, string][] = [
    ["keep", t("action.keep")],
    ["mask", t("action.mask")],
    ["erase", t("action.erase")],
    ["replace", t("action.replace")],
  ];
  return (
    <span className="decision-buttons">
      {options.map(([action, label]) => (
        <button
          key={action}
          className={
            props.value === action ? "decision-btn current" : "decision-btn"
          }
          title={
            props.value === action
              ? t("action.release", { action: label })
              : label
          }
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

/// Viewport-fixed placement for a popover anchored to `anchor`, opening
/// upward when the space below is short. position:fixed escapes the
/// overflow clipping of scrollable lists (the findings list cut off the
/// popover of its last row).
function popoverPosition(anchor: HTMLElement | null): React.CSSProperties {
  if (!anchor) return {};
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  return {
    position: "fixed",
    zIndex: 30,
    top: spaceBelow > 280 ? rect.bottom + 4 : "auto",
    bottom: spaceBelow > 280 ? "auto" : window.innerHeight - rect.top + 4,
    left: "auto",
    right: Math.max(8, window.innerWidth - rect.right),
  };
}

/// In-place entity assignment: a small popover right on the row offering a
/// new entity or any existing one, so consolidating a spelling never requires
/// jumping to a distant bar.
function EntityMenu(props: {
  entities: Entity[];
  label?: string;
  onNew: () => void;
  onAssign: (entityId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  return (
    <span className="entity-menu">
      <button
        ref={anchorRef}
        className="mini"
        title={t("review.toEntity")}
        onClick={() => {
          setMenuStyle(popoverPosition(anchorRef.current));
          setOpen((current) => !current);
        }}
      >
        {props.label ?? "E"}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu entity-popover" style={menuStyle}>
            <button
              onClick={() => {
                setOpen(false);
                props.onNew();
              }}
            >
              {t("review.newEntity")}
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
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
        ref={anchorRef}
        className="mini"
        title={t("review.mergeIntoExisting")}
        onClick={() => {
          setMenuStyle(popoverPosition(anchorRef.current));
          setOpen((current) => !current);
        }}
      >
        {t("review.toExisting")}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div
            className="menu entity-popover group-popover"
            style={menuStyle}
          >
            <input
              autoFocus
              placeholder={t("review.filterCandidates")}
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
              <span className="hint">{t("review.noMatchingCandidates")}</span>
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
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <p className="export-path" title={props.path}>
      <button
        className="mini"
        title={t("review.copyPath")}
        onClick={() => {
          void navigator.clipboard.writeText(props.path).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "✓" : t("review.copy")}
      </button>{" "}
      {t("review.output", { path: props.path })}
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
  /// Bulk alignment for the whole rule (also clears per-occurrence
  /// exceptions); shown for replace rules only.
  onBulkAlign?: (align: TextAlign) => void;
  /// Per-occurrence alignment exception lookup/setter.
  overrideFor?: (page: number, rect: Rect) => TextAlign | undefined;
  onOverride?: (page: number, rect: Rect, align: TextAlign) => void;
}) {
  const { t } = useI18n();
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

  if (!items)
    return <p className="status">{t("review.searchingOccurrences")}</p>;
  if (items.length === 0)
    return <p className="status">{t("review.noOccurrences")}</p>;
  return (
    <div className="rule-crops">
      {props.action === "replace" && props.onBulkAlign && (
        <div className="rule-crops-bulk">
          <span className="hint">{t("review.alignAll")}</span>
          <AlignToggle value={props.align} onChange={props.onBulkAlign} />
        </div>
      )}
      {items.map((item, index) => {
        const effective =
          props.overrideFor?.(item.page, item.rect) ?? props.align ?? "center";
        return (
          <div key={index} className="rule-crop-row">
            <button
              className="rule-crop-jump"
              title={t("review.jumpToOccurrence")}
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
                      effective === "left"
                        ? "flex-start"
                        : effective === "right"
                          ? "flex-end"
                          : "center",
                  }}
                >
                  {props.action === "replace" ? props.value || "■■■" : ""}
                </span>
              </span>
            </button>
            {props.action === "replace" && props.onOverride && (
              <AlignToggle
                value={effective}
                onChange={(align) =>
                  props.onOverride?.(item.page, item.rect, align)
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ReviewView(props: {
  project: ProjectInfo;
  onProjectChange: (project: ProjectInfo) => void;
  onClose: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLanguageChange: (language: Language) => void;
}) {
  const { project } = props;
  const { t } = useI18n();
  const [findings, setFindings] = useState<PageFindings[]>([]);
  const [page, setPage] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [textRules, setTextRules] = useState<TextRule[]>([]);
  const [regionRules, setRegionRules] = useState<RegionRule[]>([]);
  const [alignOverrides, setAlignOverrides] = useState<AlignOverride[]>([]);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [drawScope, setDrawScope] = useState<"all" | "page">("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchHits, setSearchHits] = useState<PageFindings[] | null>(null);
  const [targetSuggestions, setTargetSuggestions] = useState<string[] | null>(
    null,
  );
  const [suggestingTargets, setSuggestingTargets] = useState(false);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [dictionaryEdit, setDictionaryEdit] = useState<{
    original: string;
    draft: string;
  } | null>(null);
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
        setAlignOverrides(saved.align_overrides ?? []);
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
        align_overrides: alignOverrides,
      };
      void saveReviewDecisions(project.projectDir, payload).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [
    decisions,
    textRules,
    regionRules,
    alignOverrides,
    hydrated,
    project.projectDir,
  ]);

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
    const label = aliasLabel(t, category);
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

  /// Renames a dictionary entry in place (remove old, add corrected) and
  /// re-runs detection — the fix-a-typo path, so a small correction never
  /// requires delete-and-retype.
  function saveDictionaryEdit(entry: DictionaryEntry, draft: string) {
    const corrected = draft.trim();
    setDictionaryEdit(null);
    if (!corrected || corrected === entry.text) return;
    void run(t("review.updatingDictionary"), async () => {
      await removeDictionaryEntry(project.projectDir, entry.text);
      setDictionary(
        await addDictionaryEntry(project.projectDir, entry.category, corrected),
      );
      if (project.analyzed) {
        await analyzeProject(project.projectDir, "detect-only");
        setFindings(await listFindings(project.projectDir));
      }
    });
  }

  /// Registers `text` in the project dictionary under `category` and re-runs
  /// detection — the shared path behind every "→辞書" conversion.
  function registerTextToDictionary(category: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    void run(t("review.registeringDictionary"), async () => {
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
      setProgress(progressLabel(t, event.payload));
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
    void run(t("review.analyzing"), async () => {
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
          t("review.analysisCancelled"),
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
    // Per-occurrence alignment exceptions become region-scoped replace rules
    // pushed FIRST: the planner keeps the first of two same-box edits, so
    // these one-spot rules win over the document-wide text rule below.
    const replaceValueByOwner = new Map<string, string>();
    for (const entity of entities) {
      replaceValueByOwner.set(`ent-${entity.id}`, entity.alias || "■■■");
    }
    for (const entry of decidedEntries) {
      if (entry.decision.action === "replace") {
        replaceValueByOwner.set(
          `dec-${entry.key}`,
          entry.decision.value || "■■■",
        );
      }
    }
    for (const rule of textRules) {
      if (rule.action === "replace") {
        replaceValueByOwner.set(`txt-${rule.text}`, rule.value || "■■■");
      }
    }
    for (const override of alignOverrides) {
      const value = replaceValueByOwner.get(override.owner);
      if (value === undefined) continue; // owning rule is gone
      rules.push({
        match: { region: override.rect, pages: [override.page + 1] },
        action: { type: "replace", value, align: override.align },
      });
    }
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
  }, [entities, decidedEntries, textRules, regionRules, alignOverrides]);

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
    void run(t("review.applying"), async () => {
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
    void run(t("review.rebuildingPdf"), async () => {
      setExportPath(await exportProject(project.projectDir, 300, pages));
      // Any joining whitespace lives in the dictionary strings: English pads
      // its sentence, Japanese does not.
      const scopeNote =
        pages && pages.length > 0
          ? t("review.exportedPages", { count: pages.length })
          : "";
      if (undecidedCount > 0) {
        setNotice(
          t("review.undecidedWarning", {
            scope: scopeNote,
            count: undecidedCount,
          }),
        );
      } else if (scopeNote) {
        setNotice(scopeNote);
      }
    });
  }

  function runExportImages() {
    void run(t("review.exportingImages"), async () => {
      setImagesPath(await exportImages(project.projectDir));
      if (undecidedCount > 0) {
        setNotice(
          t("review.undecidedWarning", { scope: "", count: undecidedCount }),
        );
      }
    });
  }

  function runExportMarkdown() {
    void run(t("review.generatingMarkdown"), async () => {
      setMarkdownPath(await exportMarkdown(project.projectDir));
      if (undecidedCount > 0) {
        setNotice(
          t("review.undecidedWarning", { scope: "", count: undecidedCount }),
        );
      }
    });
  }

  function runAudit() {
    void run(t("review.auditing"), async () => {
      setAudit(await auditProject(project.projectDir, policy));
    });
  }

  function runLlmDetect(useImage: boolean) {
    void run(t("review.llmDetecting"), async () => {
      await llmDetect(project.projectDir, useImage);
      setFindings(await listFindings(project.projectDir));
    });
  }

  function runSearch() {
    const text = searchInput.trim();
    if (!text) return;
    void run(t("review.searching"), async () => {
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
    void run(t("review.mergingIntoExisting"), async () => {
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
    void run(t("review.searchingBody"), async () => {
      const hits = await searchProject(project.projectDir, trimmed);
      const first = hits.find((entry) => entry.findings.length > 0);
      if (!first) {
        setNotice(t("review.notFoundInBody", { text: trimmed }));
        return;
      }
      jumpTo(first.page_index, first.findings[0]);
    });
  }

  const sameOccurrence = (
    override: AlignOverride,
    page: number,
    rect: Rect,
  ) =>
    override.page === page &&
    Math.abs(override.rect.x - rect.x) < 2 &&
    Math.abs(override.rect.y - rect.y) < 2;

  function overrideFor(
    owner: string,
    page: number,
    rect: Rect,
  ): TextAlign | undefined {
    return alignOverrides.find(
      (candidate) =>
        candidate.owner === owner && sameOccurrence(candidate, page, rect),
    )?.align;
  }

  function setOccurrenceAlign(
    owner: string,
    page: number,
    rect: Rect,
    align: TextAlign,
  ) {
    setAlignOverrides((current) => [
      ...current.filter(
        (candidate) =>
          !(candidate.owner === owner && sameOccurrence(candidate, page, rect)),
      ),
      { owner, page, rect, align },
    ]);
  }

  /// Bulk alignment resets every per-occurrence exception of the rule.
  function clearOverridesFor(owner: string) {
    setAlignOverrides((current) =>
      current.filter((candidate) => candidate.owner !== owner),
    );
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

  /// Plain page navigation (page list, scroll flip): clears any leftover
  /// jump focus so its scroll target and blink never replay on the new page.
  function goToPage(index: number) {
    setPage(index);
    setFocus(null);
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
    void run(t("review.readingRegion"), async () => {
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
        setProgress(t("review.vlmReadingRegion"));
        const read = await vlmInRegion(project.projectDir, page, rect).catch(
          () => [] as string[],
        );
        text = (read[0] ?? "").trim();
        if (read.length > 1) setNotice(t("review.vlmRead", { texts: read.join(" / ") }));
      }
      if (!text) {
        setNotice(t("review.regionNoText"));
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
    void run(t("review.addingToIgnore"), async () => {
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
    void run(t("review.registeringDictionary"), async () => {
      setDictionary(
        await addDictionaryEntry(project.projectDir, dictionaryCategory, text),
      );
      if (project.analyzed) {
        await analyzeProject(project.projectDir, "detect-only");
        setFindings(await listFindings(project.projectDir));
        setDictionaryNote(t("review.dictionaryRegisteredApplied"));
      } else {
        setDictionaryNote(t("review.dictionaryRegistered"));
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
        <button onClick={props.onClose}>{t("review.home")}</button>
        <span className="file-name" title={project.projectDir}>
          {project.fileName}
        </span>
        {project.analyzed ? (
          <div className="reanalyze-menu">
            <button
              disabled={busy !== null}
              onClick={() => setReanalyzeOpen((open) => !open)}
            >
              {t("review.reanalyze")} <ChevronDown size={13} />
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
                      [
                        "all",
                        t("review.reanalyzeAll"),
                        () => runAnalyze("all"),
                      ],
                      [
                        "resume",
                        t("review.reanalyzeResume"),
                        () => runAnalyze("resume"),
                      ],
                      [
                        "page",
                        t("review.reanalyzePage", { page: page + 1 }),
                        () => runAnalyze("resume", [page]),
                      ],
                      [
                        "render",
                        t("review.reanalyzeRender"),
                        () => runAnalyze("render-only"),
                      ],
                      [
                        "ocr",
                        t("review.reanalyzeOcr"),
                        () => runAnalyze("ocr-only"),
                      ],
                      [
                        "detect",
                        t("review.reanalyzeDetect"),
                        () => runAnalyze("detect-only"),
                      ],
                      [
                        "llm",
                        t("review.reanalyzeLlm"),
                        () => runLlmDetect(false),
                      ],
                      [
                        "vlm",
                        t("review.reanalyzeVlm"),
                        () => runLlmDetect(true),
                      ],
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
              title={t("review.resumeHint")}
            >
              {t("review.resume")}
            </button>
            <button
              onClick={() => runAnalyze("all")}
              disabled={busy !== null}
            >
              {t("review.fromScratch")}
            </button>
          </>
        ) : (
          <button
            className="primary"
            onClick={() => runAnalyze("all")}
            disabled={busy !== null}
          >
            {t("review.runAnalysis")}
          </button>
        )}
        <span className="spacer" />
        <button
          onClick={() => setSettingsOpen(true)}
          disabled={busy !== null}
          title={t("review.settingsTitle")}
        >
          <Settings2 size={14} /> {t("review.settings")}
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRendered}
            disabled={!hasRenders}
            onChange={(event) => setShowRendered(event.target.checked)}
          />
          {t("review.showTransformed")}
        </label>
        <button
          className="primary"
          onClick={runApply}
          disabled={busy !== null || policy.rules.length === 0}
        >
          {t("review.apply", { count: policy.rules.length })}
        </button>
        <div className="reanalyze-menu">
          <button
            onClick={() => setExportMenuOpen((open) => !open)}
            disabled={busy !== null || !hasRenders}
          >
            {t("review.exportPdf")} <ChevronDown size={13} />
          </button>
          {exportMenuOpen && (
            <>
              <div
                className="menu-backdrop"
                onClick={() => setExportMenuOpen(false)}
              />
              <div className="menu export-menu">
                <button onClick={() => runExport()}>
                  {t("review.exportAllPages")}
                </button>
                <div className="export-range">
                  <label className="hint">
                    {t("review.pageRangePlaceholder")}
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
                    {t("review.exportSelectedPages")}
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
          {t("review.exportMarkdown")}
        </button>
        <button
          onClick={runExportImages}
          disabled={busy !== null || !hasRenders}
          title={t("review.exportImagesTitle")}
        >
          {t("review.exportImages")}
        </button>
        <button onClick={runAudit} disabled={busy !== null || !hasRenders}>
          {t("review.audit")}
        </button>
        <button
          className="theme-button"
          onClick={() => setHelpOpen(true)}
          title={t("review.helpTitle")}
        >
          <CircleHelp size={16} />
        </button>
        <button
          className="theme-button"
          onClick={props.onToggleTheme}
          title={t("app.toggleTheme")}
        >
          {props.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      {(busy || progress || error || notice) && (
        <div className="statusbar">
          {busy && <span className="status">{progress ?? busy}</span>}
          {(busy === t("review.analyzing") ||
            busy === t("review.llmDetecting")) && (
            <button onClick={() => void cancelAnalysis()}>
              {t("review.cancel")}
            </button>
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
            title={t("review.thumbOverlayTitle")}
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
            {t("review.position")}
          </label>
          {Array.from({ length: project.pageCount }, (_, index) => (
            <button
              key={index}
              ref={index === page ? currentPageRef : undefined}
              className={
                index === page ? "page-button current" : "page-button"
              }
              onClick={() => goToPage(index)}
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
          title={t("review.resizeLeftPane")}
        />

        <main className="viewer-pane">
          <div className="viewer-toolbar">
            <span>{t("review.rectSelect")}</span>
            {(["none", "erase", "mask", "detect"] as DrawMode[]).map((mode) => (
              <button
                key={mode}
                className={drawMode === mode ? "mode current" : "mode"}
                onClick={() => setDrawMode(mode)}
              >
                {mode === "none"
                  ? t("review.drawNone")
                  : mode === "detect"
                    ? t("review.drawDetect")
                    : actionLabel(t, mode)}
              </button>
            ))}
            {(drawMode === "erase" || drawMode === "mask") && (
              <>
                <span>{t("review.scope")}</span>
                {(["all", "page"] as const).map((scope) => (
                  <button
                    key={scope}
                    className={drawScope === scope ? "mode current" : "mode"}
                    onClick={() => setDrawScope(scope)}
                  >
                    {scope === "all"
                      ? t("review.scopeAll")
                      : t("review.scopeThisPage")}
                  </button>
                ))}
                <span className="hint">{t("review.dragToAddRegion")}</span>
              </>
            )}
            {drawMode === "detect" && (
              <span className="hint">{t("review.dragToDetect")}</span>
            )}
            <span className="spacer" />
            <label
              className="toggle"
              title={t("review.scrollPagingTitle")}
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
              {t("review.scrollPaging")}
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showRulePreview}
                onChange={(event) => setShowRulePreview(event.target.checked)}
              />
              {t("review.overlayPending")}
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
            onPageChange={goToPage}
          />
        </main>

        <div
          className="pane-gutter"
          onPointerDown={(event) => startResize("right", event)}
          title={t("review.resizeRightPane")}
        />

        <aside className="side-pane">
          <section className="section-precheck">
            <h2>{t("review.preflight")}</h2>
            <div className={undecidedCount > 0 ? "precheck warn" : "precheck ok"}>
              <span>
                {t("review.undecidedCount", { count: undecidedCount })}
              </span>
              <span>{t("review.decidedCount", { count: decidedCount })}</span>
              <span>
                {t("review.pendingRules", { count: policy.rules.length })}
              </span>
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
                  <span className="chip-action">{t("review.detected")}</span>
                  <button
                    className="finding-text detected-jump"
                    title={t("review.jumpTo", { text: detectedTarget.text })}
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
                    title={t("review.close")}
                    aria-label={t("review.close")}
                    onClick={() => setDetectedTarget(null)}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="detected-actions">
                  <button
                    onClick={() => {
                      addSearchRule("mask");
                      setDetectedTarget(null);
                    }}
                  >
                    {t("action.mask")}
                  </button>
                  <button
                    onClick={() => {
                      addSearchRule("erase");
                      setDetectedTarget(null);
                    }}
                  >
                    {t("action.erase")}
                  </button>
                  <button
                    onClick={() => {
                      addSearchRule("replace");
                      setDetectedTarget(null);
                    }}
                  >
                    {t("action.replace")}
                  </button>
                  <EntityMenu
                    entities={entities}
                    label={t("review.toEntityShort")}
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
                    {t("review.toDictionary")}
                  </button>
                </div>
              </div>
            )}
            <h2>{t("review.searchByText")}</h2>
            <div className="search-row">
              <input
                value={searchInput}
                placeholder={t("review.searchPlaceholder")}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
              />
              <button onClick={runSearch} disabled={busy !== null}>
                {t("review.search")}
              </button>
            </div>
            <div className="suggest-targets">
              <button
                className="mini"
                title={t("review.suggestTargetsTitle")}
                onClick={runSuggestTargets}
                disabled={suggestingTargets || busy !== null}
              >
                {suggestingTargets ? (
                  t("review.suggesting")
                ) : (
                  <>
                    <Sparkles size={13} /> {t("review.suggestTargets")}
                  </>
                )}
              </button>
              {targetSuggestions?.length === 0 && (
                <span className="hint">{t("review.noSuggestions")}</span>
              )}
              {targetSuggestions && targetSuggestions.length > 0 && (
                <div className="target-chips">
                  {targetSuggestions.map((term) => (
                    <button
                      key={term}
                      className="variant-chip suggest"
                      title={t("review.searchThisWord")}
                      onClick={() => {
                        setSearchInput(term);
                        void run(t("review.searching"), async () => {
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
                <p>{t("review.searchHits", { count: searchHitCount })}</p>
                {searchHitCount > 0 && (
                  <div className="search-actions">
                    <button
                      onClick={() =>
                        createEntity(dictionaryCategory, searchInput)
                      }
                    >
                      {t("review.registerEntity")}
                    </button>
                    <button onClick={() => addSearchRule("replace")}>
                      {t("review.addReplaceRule")}
                    </button>
                    <button onClick={() => addSearchRule("mask")}>
                      {t("review.addMaskRule")}
                    </button>
                    <button onClick={() => addSearchRule("erase")}>
                      {t("review.addEraseRule")}
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
                    <option value="organization">
                      {t("review.categoryOrganization")}
                    </option>
                    <option value="department">
                      {t("review.categoryDepartment")}
                    </option>
                    <option value="person">
                      {t("review.categoryPerson")}
                    </option>
                    <option value="product">
                      {t("review.categoryProduct")}
                    </option>
                    <option value="place">{t("review.categoryPlace")}</option>
                    <option value="custom">{t("review.categoryOther")}</option>
                  </select>
                  <button onClick={registerToDictionary} disabled={busy !== null}>
                    {t("review.registerDictionary")}
                  </button>
                </div>
                {dictionaryNote && <p className="status">{dictionaryNote}</p>}
              </div>
            )}
          </section>

          {dictionary.length > 0 && (
            <section className="section-dictionary">
              <h2>{t("review.dictionary", { count: dictionary.length })}</h2>
              <div className="rule-list">
                {dictionary.map((entry) => (
                  <div key={entry.text} className="rule-entry">
                    <span className="category-tag">{entry.category}</span>
                    {dictionaryEdit?.original === entry.text ? (
                      <>
                        <input
                          className="replace-input"
                          autoFocus
                          value={dictionaryEdit.draft}
                          onChange={(event) =>
                            setDictionaryEdit({
                              original: entry.text,
                              draft: event.target.value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter")
                              saveDictionaryEdit(entry, dictionaryEdit.draft);
                            if (event.key === "Escape") setDictionaryEdit(null);
                          }}
                        />
                        <button
                          className="mini"
                          title={t("review.save")}
                          aria-label={t("review.save")}
                          disabled={busy !== null}
                          onClick={() =>
                            saveDictionaryEdit(entry, dictionaryEdit.draft)
                          }
                        >
                          <Check size={12} />
                        </button>
                        <button
                          className="mini"
                          title={t("review.undo")}
                          aria-label={t("review.undo")}
                          onClick={() => setDictionaryEdit(null)}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="rule-target"
                          title={t("review.jumpTo", { text: entry.text })}
                          onClick={() => jumpToText(entry.text)}
                        >
                          <span className="finding-text">{entry.text}</span>
                        </button>
                        <button
                          className="mini"
                          title={t("review.editText")}
                          aria-label={t("review.editText")}
                          onClick={() =>
                            setDictionaryEdit({
                              original: entry.text,
                              draft: entry.text,
                            })
                          }
                        >
                          <Pencil size={12} />
                        </button>
                      </>
                    )}
                    <EntityMenu
                      entities={entities}
                      onNew={() => createEntity(entry.category, entry.text)}
                      onAssign={(id) => addVariant(id, entry.text)}
                    />
                    <button
                      onClick={() => {
                        void run(t("review.removingFromDictionary"), async () => {
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
                      {t("review.delete")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="section-rules">
            <h2>
              {t("review.pendingRulesHeading", { count: policy.rules.length })}
            </h2>
            <div className="rule-list">
              {entities
                .filter((entity) => entity.variants.length > 0)
                .map((entity) => (
                  <div key={entity.id} className="rule-block">
                    <div className="rule-entry">
                      <button
                        className="mini"
                        title={t("review.toggleCrops")}
                        onClick={() => toggleRuleExpansion(`ent-${entity.id}`)}
                      >
                        {expandedRules.has(`ent-${entity.id}`) ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>
                      <span className="chip-action">{t("action.replace")}</span>
                      <span
                        className="rule-target"
                        title={entity.variants.join(
                          t("review.variantSeparator"),
                        )}
                      >
                        <span className="category-tag">Entity</span>
                        <span className="finding-text">
                          {t("review.variantsToAlias", {
                            count: entity.variants.length,
                            alias: entity.alias || t("review.aliasUnset"),
                          })}
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
                        onBulkAlign={(align) => {
                          setEntities((current) =>
                            current.map((candidate) =>
                              candidate.id === entity.id
                                ? { ...candidate, align }
                                : candidate,
                            ),
                          );
                          clearOverridesFor(`ent-${entity.id}`);
                        }}
                        overrideFor={(page, rect) =>
                          overrideFor(`ent-${entity.id}`, page, rect)
                        }
                        onOverride={(page, rect, align) =>
                          setOccurrenceAlign(
                            `ent-${entity.id}`,
                            page,
                            rect,
                            align,
                          )
                        }
                      />
                    )}
                  </div>
                ))}
              {decidedEntries.map((entry) => (
                <div key={entry.key} className="rule-block">
                <div className="rule-entry">
                  <button
                    className="mini"
                    title={t("review.toggleCrops")}
                    onClick={() => toggleRuleExpansion(`dec-${entry.key}`)}
                  >
                    {expandedRules.has(`dec-${entry.key}`) ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </button>
                  <span className="chip-action">
                    {actionLabel(
                      t,
                      entry.decision.action as Exclude<DecisionAction, "keep">,
                    )}
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
                        placeholder={t("review.replacementPlaceholder")}
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
                    {t("review.release")}
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
                    onBulkAlign={(align) => {
                      setDecisionAlign(entry.key, align);
                      clearOverridesFor(`dec-${entry.key}`);
                    }}
                    overrideFor={(page, rect) =>
                      overrideFor(`dec-${entry.key}`, page, rect)
                    }
                    onOverride={(page, rect, align) =>
                      setOccurrenceAlign(`dec-${entry.key}`, page, rect, align)
                    }
                  />
                )}
                </div>
              ))}

              {textRules.map((rule, index) => (
                <div key={`text-${index}`} className="rule-block">
                <div className="rule-entry">
                  <button
                    className="mini"
                    title={t("review.toggleCrops")}
                    onClick={() => toggleRuleExpansion(`txt-${rule.text}`)}
                  >
                    {expandedRules.has(`txt-${rule.text}`) ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </button>
                  <span className="chip-action">
                    {actionLabel(t, rule.action)}
                  </span>
                  <button
                    className="rule-target"
                    title={t("review.jumpTo", { text: rule.text })}
                    onClick={() => jumpToText(rule.text)}
                  >
                    <span className="category-tag">{t("review.searchTag")}</span>
                    <span className="finding-text">{rule.text}</span>
                  </button>
                  {rule.action === "replace" && (
                    <>
                      <input
                        className="replace-input"
                        placeholder={t("review.replacementPlaceholder")}
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
                    {t("review.delete")}
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
                    onBulkAlign={(align) => {
                      setTextRuleAlign(index, align);
                      clearOverridesFor(`txt-${rule.text}`);
                    }}
                    overrideFor={(page, rect) =>
                      overrideFor(`txt-${rule.text}`, page, rect)
                    }
                    onOverride={(page, rect, align) =>
                      setOccurrenceAlign(`txt-${rule.text}`, page, rect, align)
                    }
                  />
                )}
                </div>
              ))}

              {regionRules.map((rule, index) => (
                <div key={`region-${index}`} className="rule-entry region">
                  <div className="rule-entry-main">
                    <span className="chip-action">
                      {actionLabel(t, rule.action)}
                    </span>
                    <button
                      className="rule-target"
                      title={t("review.jumpToRegion")}
                      onClick={() =>
                        jumpToRect(
                          rule.scope === "all" ? rule.drawnOn : rule.scope,
                          rule.rect,
                        )
                      }
                    >
                      <span className="category-tag">{t("review.regionTag")}</span>
                      <span className="finding-text">
                        {rule.scope === "all"
                          ? t("review.scopeAll")
                          : t("review.regionPageOnly", {
                              page: rule.scope + 1,
                            })}
                      </span>
                    </button>
                    {rule.scope === "all" && (
                      <button onClick={() => setPreviewRegion(index)}>
                        {t("review.preview")}
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setRegionRules((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      {t("review.delete")}
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
                  {t("review.rulesEmpty")}
                </p>
              )}
              {policy.rules.length > 0 && (
                <button onClick={clearAllRules}>
                  {t("review.clearAllRules")}
                </button>
              )}
            </div>
          </section>

          <section className="section-entity">
            <h2>{t("review.entities", { count: entities.length })}</h2>
            <div className="entity-list">
              {entities.map((entity) => (
                <div key={entity.id} className="entity-card">
                  <div className="entity-head">
                    <span className="category-tag">{entity.category}</span>
                    <input
                      className="alias-input"
                      value={entity.alias}
                      placeholder={t("review.aliasPlaceholder")}
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
                      title={t("review.registerRepresentative")}
                      disabled={busy !== null || entity.variants.length === 0}
                      onClick={() =>
                        registerTextToDictionary(
                          entity.category,
                          entity.variants[0],
                        )
                      }
                    >
                      {t("review.toDictionaryArrow")}
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
                      {t("review.delete")}
                    </button>
                  </div>
                  <div className="entity-variants">
                    {entity.variants.map((variant) => (
                      <span key={variant} className="variant-chip">
                        <button
                          className="chip-text"
                          title={t("review.jumpTo", { text: variant })}
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
                          aria-label={t("review.removeVariant")}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  {(entitySuggestions[entity.id]?.length ?? 0) > 0 && (
                    <div className="entity-suggestions">
                      <span className="hint">{t("review.similarVariants")}</span>
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
                  {t("review.entitiesEmpty")}
                </p>
              )}
            </div>
          </section>

          <section className="findings-section">
            <h2>
              {t("review.candidates", {
                count: dedupedFindings.length,
                suffix:
                  filteredFindings.length !== flatFindings.length
                    ? t("review.candidatesAll", {
                        count: flatFindings.length,
                      })
                    : filteredFindings.length !== dedupedFindings.length
                      ? t("review.candidatesFiltered", {
                          count: filteredFindings.length,
                        })
                      : "",
              })}
            </h2>
            <div className="finding-filter">
              <input
                value={findingFilter}
                placeholder={t("review.candidateFilter")}
                onChange={(event) => setFindingFilter(event.target.value)}
              />
              <select
                value={findingCategoryFilter}
                onChange={(event) =>
                  setFindingCategoryFilter(event.target.value)
                }
              >
                <option value="all">{t("review.allCategories")}</option>
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
                {t("review.undecidedOnly")}
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
                      title={t("review.excludeFromDetection", {
                        text: finding.text,
                        category: finding.category,
                      })}
                      onClick={() => ignoreFinding(finding)}
                    >
                      {t("review.ignore")}
                    </button>
                  </div>
                );
              })}
              {flatFindings.length === 0 && (
                <p className="status">
                  {project.analyzed
                    ? t("review.noCandidates")
                    : t("review.runAnalysisForCandidates")}
                </p>
              )}
              {flatFindings.length > 0 && filteredFindings.length === 0 && (
                <p className="status">{t("review.noMatchingFilter")}</p>
              )}
            </div>
          </section>

          <section className="results-section">
            <h2>{t("review.results")}</h2>
            {applySummary && (
              <p>
                {t("review.applied", {
                  edits: applySummary.edit_count,
                  pages: applySummary.page_count,
                })}
              </p>
            )}
            {applySummary && appliedEdits.length > 0 && (
              <div className="applied-list">
                {appliedEdits.map((edit, index) => (
                  <div key={index} className="applied-row">
                    <button
                      className="page-tag"
                      title={t("review.jumpToSpot")}
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
                      {actionLabel(t, edit.action)}
                    </span>
                    <button
                      className="applied-pair"
                      title={t("review.jumpToOccurrence")}
                      onClick={() => jumpToRect(edit.page, edit.rect)}
                    >
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
                    </button>
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
                  {t("review.auditResult", {
                    verdict: audit.verdict === "pass" ? "Pass" : "Fail",
                    terms: audit.checked_terms,
                    pages: audit.page_count,
                  })}
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
                    {t("review.residual", {
                      page: residual.page,
                      term: residual.term,
                      text: residual.text,
                    })}
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
          onLanguageChange={props.onLanguageChange}
          onDetectorsChanged={() => {
            if (project.analyzed) {
              void run(t("review.redetecting"), async () => {
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
                {t("review.regionPreview", {
                  pages: project.pageCount,
                  action: actionLabel(
                    t,
                    regionRules[previewRegion].action,
                  ),
                })}
              </h2>
              <button onClick={() => setPreviewRegion(null)}>
                {t("review.close")}
              </button>
            </div>
            <p className="status">
              {t("review.regionPreviewHint")}
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
