export interface AppConfig {
  theme: "light" | "dark";
}

export interface ProjectInfo {
  projectDir: string;
  fileName: string;
  sha256: string;
  pageCount: number;
  analyzed: boolean;
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
}

export interface PageFindings {
  page_index: number;
  findings: Finding[];
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
