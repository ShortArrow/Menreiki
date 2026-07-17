use std::fs;
use std::path::Path;

use menreiki_core::{EditStyle, Finding, PageEdit};
use menreiki_policy::{plan_page_edits, PlanError, Policy};
use menreiki_render::{apply_edits, load_font, EditError, FontVec};
use serde::Serialize;

use crate::detect::{load_findings, LoadFindingsError};
use crate::layout::{page_image_path, page_render_path, plan_path, DECISIONS_DIR, RENDERS_DIR};
use crate::ocr::{load_ocr_pages, LoadOcrError};

/// Result of applying a policy.
#[derive(Debug, Serialize)]
pub struct ApplySummary {
    pub page_count: u16,
    pub edit_count: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum ApplyError {
    #[error(transparent)]
    Ocr(#[from] LoadOcrError),
    #[error(transparent)]
    Findings(#[from] LoadFindingsError),
    #[error(transparent)]
    Plan(#[from] PlanError),
    #[error(transparent)]
    Edit(#[from] EditError),
    #[error("page image could not be read: {0}")]
    ReadPage(std::io::Error),
    #[error("output could not be written: {0}")]
    Write(std::io::Error),
}

#[derive(Serialize)]
struct PlanPage<'a> {
    page: u32,
    edits: &'a [PageEdit],
}

/// Applies an anonymization policy: expands it into per-page edits, records
/// the plan under `decisions/plan.json`, and writes transformed page images
/// to `renders/`. Every page is rendered, edited or not, so `renders/` is
/// always a complete transformed document.
pub fn apply(
    project_dir: &Path,
    policy: &Policy,
    font_path: &Path,
) -> Result<ApplySummary, ApplyError> {
    let ocr_pages = load_ocr_pages(project_dir)?;
    let findings_by_page = findings_by_page(project_dir, ocr_pages.len())?;
    let plans = plan_page_edits(policy, &ocr_pages, &findings_by_page)?;

    fs::create_dir_all(project_dir.join(DECISIONS_DIR)).map_err(ApplyError::Write)?;
    let plan_pages: Vec<PlanPage> = plans
        .iter()
        .enumerate()
        .map(|(index, edits)| PlanPage {
            page: index as u32 + 1,
            edits,
        })
        .collect();
    let plan_json =
        serde_json::to_string_pretty(&plan_pages).expect("plan is always serializable");
    fs::write(plan_path(project_dir), plan_json).map_err(ApplyError::Write)?;

    let font = load_font_if_needed(&plans, font_path)?;
    fs::create_dir_all(project_dir.join(RENDERS_DIR)).map_err(ApplyError::Write)?;
    for (page_index, edits) in plans.iter().enumerate() {
        let page_index = page_index as u16;
        let png =
            fs::read(page_image_path(project_dir, page_index)).map_err(ApplyError::ReadPage)?;
        let rendered = apply_edits(&png, edits, font.as_ref())?;
        fs::write(page_render_path(project_dir, page_index), rendered)
            .map_err(ApplyError::Write)?;
    }

    Ok(ApplySummary {
        page_count: plans.len() as u16,
        edit_count: plans.iter().map(Vec::len).sum(),
    })
}

fn findings_by_page(
    project_dir: &Path,
    page_count: usize,
) -> Result<Vec<Vec<Finding>>, LoadFindingsError> {
    let stored = load_findings(project_dir)?;
    let mut by_page = vec![Vec::new(); page_count];
    for page in stored {
        if usize::from(page.page_index) < page_count {
            by_page[usize::from(page.page_index)] = page.findings;
        }
    }
    Ok(by_page)
}

fn load_font_if_needed(
    plans: &[Vec<PageEdit>],
    font_path: &Path,
) -> Result<Option<FontVec>, EditError> {
    let needed = plans
        .iter()
        .flatten()
        .any(|edit| matches!(edit.style, EditStyle::ReplaceText { .. }));
    if needed {
        Ok(Some(load_font(font_path)?))
    } else {
        Ok(None)
    }
}
