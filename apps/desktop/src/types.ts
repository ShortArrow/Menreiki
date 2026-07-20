export interface AppConfig {
  theme: "light" | "dark";
  inference: { base_url: string; model: string };
}

export interface ProjectSettings {
  detectors?: string[] | null;
}

export interface ProjectInfo {
  projectDir: string;
  fileName: string;
  sha256: string;
  pageCount: number;
  analyzed: boolean;
}

export type AnalysisScope =
  | "all"
  | "resume"
  | "render-only"
  | "ocr-only"
  | "detect-only";

export interface AnalyzeOutcome {
  cancelled: boolean;
  project: ProjectInfo;
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
}

export interface ReviewDecisions {
  findings: { category: string; text: string; action: string; value: string }[];
  texts: { text: string; action: string; value: string }[];
  regions: {
    rect: Rect;
    action: string;
    page: number | null;
    drawn_on: number;
  }[];
}

export type RuleAction =
  | { type: "keep" }
  | { type: "remove" }
  | { type: "mask" }
  | { type: "replace"; value: string };

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
