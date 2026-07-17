import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ApplySummary,
  AuditReport,
  DictionaryEntry,
  PageFindings,
  Policy,
  ProjectInfo,
} from "./types";

export function getConfig() {
  return invoke<AppConfig>("get_config");
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

export function analyzeProject(project: string, dpi = 300, ocrLanguage = "ja") {
  return invoke<ProjectInfo>("analyze_project", { project, dpi, ocrLanguage });
}

export function listFindings(project: string) {
  return invoke<PageFindings[]>("list_findings", { project });
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

export function exportProject(project: string, dpi = 300) {
  return invoke<string>("export_project", { project, dpi });
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
