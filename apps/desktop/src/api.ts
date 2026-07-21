import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AnalysisScope,
  AnalyzeOutcome,
  AppConfig,
  ApplySummary,
  AuditReport,
  DictionaryEntry,
  Entity,
  PageFindings,
  Policy,
  ProjectInfo,
  ProjectSettings,
  ReviewDecisions,
} from "./types";

export function getConfig() {
  return invoke<AppConfig>("get_config");
}

export function registerFileAssociation() {
  return invoke<void>("register_file_association");
}

export function listDetectors() {
  return invoke<string[]>("list_detectors");
}

export function getProjectSettings(project: string) {
  return invoke<ProjectSettings>("get_project_settings", { project });
}

export function setProjectSettings(project: string, settings: ProjectSettings) {
  return invoke<void>("set_project_settings", { project, settings });
}

export function setConfig(config: AppConfig) {
  return invoke<void>("set_config", { config });
}

export function initialProject() {
  return invoke<ProjectInfo | null>("initial_project");
}

export function importDocument(input: string, project?: string) {
  return invoke<ProjectInfo>("import_document", {
    input,
    project: project ?? null,
  });
}

export function openProject(project: string) {
  return invoke<ProjectInfo>("open_project", { project });
}

export function analyzeProject(
  project: string,
  scope: AnalysisScope,
  dpi = 300,
  ocrLanguage = "ja",
  pages?: number[],
) {
  return invoke<AnalyzeOutcome>("analyze_project", {
    project,
    dpi,
    ocrLanguage,
    scope,
    pages,
  });
}

export function cancelAnalysis() {
  return invoke<void>("cancel_analysis");
}

export function llmDetect(project: string, useImage = false) {
  return invoke<number>("llm_detect_project", { project, useImage });
}

export function listModels(baseUrl: string) {
  return invoke<string[]>("list_models", { baseUrl });
}

export function suggestReplacements(
  text: string,
  category: string,
  context = "",
) {
  return invoke<string[]>("suggest_replacements", { text, category, context });
}

export function listFindings(project: string) {
  return invoke<PageFindings[]>("list_findings", { project });
}

export function loadReviewDecisions(project: string) {
  return invoke<ReviewDecisions>("load_review_decisions", { project });
}

export function saveReviewDecisions(
  project: string,
  decisions: ReviewDecisions,
) {
  return invoke<void>("save_review_decisions", { project, decisions });
}

export function listEntities(project: string) {
  return invoke<Entity[]>("list_entities", { project });
}

export function saveEntities(project: string, entities: Entity[]) {
  return invoke<void>("save_entities", { project, entities });
}

export function suggestEntityVariants(project: string, entity: Entity) {
  return invoke<string[]>("suggest_entity_variants", { project, entity });
}

export function countMatches(project: string, texts: string[]) {
  return invoke<number[]>("count_matches", { project, texts });
}

export function listDictionary(project: string) {
  return invoke<DictionaryEntry[]>("list_dictionary", { project });
}

export function addDictionaryEntry(
  project: string,
  category: string,
  text: string,
) {
  return invoke<DictionaryEntry[]>("add_dictionary_entry", {
    project,
    category,
    text,
  });
}

export function removeDictionaryEntry(project: string, text: string) {
  return invoke<DictionaryEntry[]>("remove_dictionary_entry", {
    project,
    text,
  });
}

export function searchProject(project: string, text: string) {
  return invoke<PageFindings[]>("search_project", { project, text });
}

export async function pageImageUrl(
  project: string,
  pageIndex: number,
  rendered: boolean,
): Promise<string> {
  const path = await invoke<string>("page_image", {
    project,
    pageIndex,
    rendered,
  });
  return convertFileSrc(path);
}

export function applyPolicy(project: string, policy: Policy) {
  return invoke<ApplySummary>("apply_policy", { project, policy });
}

export function exportProject(
  project: string,
  dpi = 300,
  pages?: number[],
) {
  return invoke<string>("export_project", { project, dpi, pages });
}

export function exportMarkdown(project: string, ocrLanguage = "ja") {
  return invoke<string>("export_markdown", { project, ocrLanguage });
}

export function auditProject(
  project: string,
  policy: Policy | null,
  extraTerms: string[] = [],
  ocrLanguage = "ja",
) {
  return invoke<AuditReport>("audit_project", {
    project,
    policy,
    extraTerms,
    ocrLanguage,
  });
}
