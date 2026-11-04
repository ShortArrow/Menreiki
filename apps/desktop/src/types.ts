export interface AppConfig {
  theme: "light" | "dark";
  ui_language: "auto" | "ja" | "en";
  inference: { base_url: string; model: string };
}

export type IgnoreEntry = string | { text: string; category: string };

export interface ProjectSettings {
  detectors?: string[] | null;
  ignored?: IgnoreEntry[];
}

export interface ProjectInfo {
  projectDir: string;
  fileName: string;
  sha256: string;
  pageCount: number;
  analyzed: boolean;
}

/// What `import_document` rejects with. `sameSource` is null when either
/// the existing project or the input could not be read.
export type ImportFailure =
  | {
      kind: "projectExists";
      path: string;
      sameSource: boolean | null;
      existingFileName: string | null;
    }
  | { kind: "other"; message: string };

export type AnalysisScope =
  | "all"
  | "resume"
  | "render-only"
  | "ocr-only"
  | "detect-only";

/// Which OCR language a run asked for and which one the engine used.
/// `fellBack` is true when the requested language pack was unavailable and
/// the profile languages were used instead.
export interface OcrLanguageStatus {
  requested: string;
  used: string;
  fellBack: boolean;
}

export interface AnalyzeOutcome {
  cancelled: boolean;
  project: ProjectInfo;
  /// Present only when the run reached the OCR stage.
  ocr: OcrLanguageStatus | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Finding {
  category: string;
  text: string;
  rect: Rect;
  detector: string;
  note?: string | null;
}

export interface PageFindings {
  page_index: number;
  findings: Finding[];
}

export interface DictionaryEntry {
  category: string;
  text: string;
}

export interface Entity {
  id: string;
  category: string;
  alias: string;
  variants: string[];
  align?: TextAlign;
}

export interface AlignOverride {
  owner: string;
  page: number;
  rect: Rect;
  align: TextAlign;
}

export interface ReviewDecisions {
  findings: {
    category: string;
    text: string;
    action: string;
    value: string;
    align?: TextAlign;
  }[];
  texts: { text: string; action: string; value: string; align?: TextAlign }[];
  regions: {
    rect: Rect;
    action: string;
    page: number | null;
    drawn_on: number;
  }[];
  align_overrides?: AlignOverride[];
}

export type TextAlign = "left" | "center" | "right";

export type RuleAction =
  | { type: "keep" }
  | { type: "remove" }
  | { type: "mask" }
  | { type: "replace"; value: string; align?: TextAlign };

export interface PolicyRule {
  name?: string;
  match: {
    category?: string;
    text?: string;
    region?: Rect;
    pages?: "all" | number[];
  };
  action: RuleAction;
}

export interface Policy {
  rules: PolicyRule[];
}

export interface ApplySummary {
  page_count: number;
  edit_count: number;
}

export interface AppliedEdit {
  page: number;
  rect: Rect;
  action: "erase" | "mask" | "replace";
  text?: string | null;
}

export interface PackInfo {
  name: string;
  displayName: string;
  version: string;
  publisher: string;
  description: string;
  ruleCount: number;
  wordCount: number;
}

export interface Residual {
  page: number;
  term: string;
  text: string;
  rect: Rect;
}

export interface AuditReport {
  verdict: "pass" | "fail";
  checked_terms: number;
  page_count: number;
  residuals: Residual[];
}

export interface AuditOutcome {
  report: AuditReport;
  ocr: OcrLanguageStatus;
}

/// Codes the backend attaches to errors the UI explains in its own words
/// (see `src-tauri/src/ui_error.rs`).
export type ErrorCode =
  | "audit.noTerms"
  | "inference.modelMissing"
  | "inference.invalidUrl"
  | "inference.notLocal"
  | "inference.request";

/// The shape a coded command rejects with. `detail` is the backend's own
/// message, shown as is when `code` is null.
export interface UiError {
  code: ErrorCode | null;
  detail: string;
}
