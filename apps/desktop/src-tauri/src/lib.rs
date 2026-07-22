//! Menreiki desktop backend: Tauri commands wrapping the workflow crates.
//!
//! Every command works on a project directory created by `import`. Long
//! operations run on a blocking thread and report progress through the
//! `analyze-progress` event.

mod settings;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Set to true by `cancel_analysis`; analysis loops stop between pages.
struct AnalysisCancel(Arc<AtomicBool>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo {
    project_dir: String,
    file_name: String,
    sha256: String,
    page_count: u16,
    analyzed: bool,
}

fn project_info(project_dir: &Path) -> Result<ProjectInfo, String> {
    let manifest =
        menreiki_project::load_manifest(project_dir).map_err(|error| error.to_string())?;
    let mut page_count: u16 = 0;
    while menreiki_project::page_image_path(project_dir, page_count).exists() {
        page_count += 1;
    }
    let analyzed = menreiki_project::page_findings_path(project_dir, 0).exists();
    Ok(ProjectInfo {
        project_dir: project_dir.display().to_string(),
        file_name: manifest.source().file_name().to_string(),
        sha256: manifest.source().sha256_hex().to_string(),
        page_count,
        analyzed,
    })
}

/// The pdfium build embedded at compile time, so the desktop app works as
/// a single portable file with no installation step.
static EMBEDDED_PDFIUM: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../vendor/pdfium/pdfium.dll"));

/// The rasterizer matching the project's source document: single images
/// (PNG, JPEG) pass through as one-page documents, everything else goes
/// through pdfium.
fn rasterizer_for(
    project_dir: &Path,
) -> Result<Box<dyn menreiki_render::DocumentRasterizer>, String> {
    let manifest =
        menreiki_project::load_manifest(project_dir).map_err(|error| error.to_string())?;
    let name = manifest.source().file_name().to_lowercase();
    if name.ends_with(".png") || name.ends_with(".jpg") || name.ends_with(".jpeg") {
        Ok(Box::new(menreiki_render::ImageRasterizer))
    } else {
        let library_dir = menreiki_adapter_pdfium::library_dir(Some(EMBEDDED_PDFIUM))
            .map_err(|error| error.to_string())?;
        Ok(Box::new(
            menreiki_adapter_pdfium::PdfiumRasterizer::new(&library_dir)
                .map_err(|error| error.to_string())?,
        ))
    }
}

/// The requested OCR language, or the profile languages when that language
/// pack is not installed.
fn ocr_engine(
    language: &str,
) -> Result<menreiki_adapter_windows_ocr::WindowsOcrEngine, String> {
    menreiki_adapter_windows_ocr::WindowsOcrEngine::from_language(language).or_else(|_| {
        menreiki_adapter_windows_ocr::WindowsOcrEngine::from_user_profile_languages()
            .map_err(|error| error.to_string())
    })
}

fn default_font_path() -> PathBuf {
    PathBuf::from(r"C:\Windows\Fonts\msgothic.ttc")
}

/// Registers the `.mnrk` file association for the current user (no
/// administrator rights needed) — the portable single-file distribution
/// has no installer to do it.
#[tauri::command]
fn register_file_association() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .display()
        .to_string();
    let classes = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Software\\Classes")
        .map_err(|error| error.to_string())?
        .0;

    let extension = classes
        .create_subkey(".mnrk")
        .map_err(|error| error.to_string())?
        .0;
    extension
        .set_value("", &"Menreiki.Project")
        .map_err(|error| error.to_string())?;

    let prog_id = classes
        .create_subkey("Menreiki.Project")
        .map_err(|error| error.to_string())?
        .0;
    prog_id
        .set_value("", &"Menreiki Project")
        .map_err(|error| error.to_string())?;
    prog_id
        .create_subkey("DefaultIcon")
        .map_err(|error| error.to_string())?
        .0
        .set_value("", &format!("\"{exe}\",0"))
        .map_err(|error| error.to_string())?;
    prog_id
        .create_subkey("shell\\open\\command")
        .map_err(|error| error.to_string())?
        .0
        .set_value("", &format!("\"{exe}\" \"%1\""))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_config() -> settings::Config {
    settings::load_config()
}

/// The ids of the detector groups available to choose from, for a settings UI.
#[tauri::command]
fn list_detectors() -> Vec<String> {
    menreiki_lang_ja::preset()
        .ids()
        .iter()
        .map(|id| id.to_string())
        .collect()
}

#[tauri::command]
fn get_project_settings(project: String) -> Result<menreiki_project::ProjectSettings, String> {
    menreiki_project::load_project_settings(Path::new(&project)).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_project_settings(
    project: String,
    settings: menreiki_project::ProjectSettings,
) -> Result<(), String> {
    menreiki_project::save_project_settings(Path::new(&project), &settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_config(config: settings::Config) -> Result<(), String> {
    settings::save_config(&config)
}

/// The project directory passed on the command line, if any — lets the app
/// (and automated smoke tests) open straight into review.
#[tauri::command]
fn initial_project() -> Option<ProjectInfo> {
    let arg = std::env::args().nth(1)?;
    project_info(&menreiki_project::resolve_project_dir(Path::new(&arg))).ok()
}

#[tauri::command]
fn import_document(input: String, project: Option<String>) -> Result<ProjectInfo, String> {
    let input = PathBuf::from(input);
    let project_dir = project
        .map(PathBuf::from)
        .unwrap_or_else(|| input.with_extension("menreiki"));
    menreiki_project::import(&input, &project_dir).map_err(|error| error.to_string())?;
    project_info(&project_dir)
}

#[tauri::command]
fn open_project(project: String) -> Result<ProjectInfo, String> {
    project_info(&menreiki_project::resolve_project_dir(Path::new(&project)))
}

/// Which parts of the analysis pipeline a run executes.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AnalysisScope {
    All,
    Resume,
    RenderOnly,
    OcrOnly,
    DetectOnly,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeOutcome {
    cancelled: bool,
    project: ProjectInfo,
}

/// Builds the project's detection rules from its selected detectors and
/// dictionary — shared by the full pass and the per-page streaming pass.
fn build_detection_rules(
    project_dir: &Path,
) -> Result<Vec<menreiki_detect::RegexRule>, String> {
    let selection = menreiki_project::load_project_settings(project_dir)
        .map_err(|error| error.to_string())?
        .detectors;
    let set = menreiki_lang_ja::preset();
    let set = match &selection {
        Some(ids) => set.only(ids),
        None => set,
    };
    let mut rules = set.into_rules();
    let dictionary =
        menreiki_project::load_dictionary(project_dir).map_err(|error| error.to_string())?;
    rules.extend(menreiki_project::dictionary_rules(&dictionary));
    Ok(rules)
}

fn run_detection(project_dir: &Path) -> Result<(), String> {
    let rules = build_detection_rules(project_dir)?;
    menreiki_project::detect_pages(project_dir, &rules)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_analysis(state: tauri::State<'_, AnalysisCancel>) {
    state.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn analyze_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalysisCancel>,
    project: String,
    dpi: u32,
    ocr_language: String,
    scope: AnalysisScope,
    pages: Option<Vec<u16>>,
) -> Result<AnalyzeOutcome, String> {
    let cancel = state.0.clone();
    cancel.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        let project_dir = PathBuf::from(&project);
        let pages = pages.filter(|list| !list.is_empty());
        let page_scope = pages.as_deref();
        let emit = |stage: &str, page: Option<u16>, total: Option<u16>| {
            let _ = app.emit(
                "analyze-progress",
                serde_json::json!({ "stage": stage, "page": page, "total": total }),
            );
        };
        let outcome = |cancelled: bool| -> Result<AnalyzeOutcome, String> {
            Ok(AnalyzeOutcome {
                cancelled,
                project: project_info(&project_dir)?,
            })
        };
        let resume = matches!(scope, AnalysisScope::Resume);
        let render = matches!(
            scope,
            AnalysisScope::All | AnalysisScope::Resume | AnalysisScope::RenderOnly
        );
        let ocr = matches!(
            scope,
            AnalysisScope::All | AnalysisScope::Resume | AnalysisScope::OcrOnly
        );

        // A full run starts clean; a page-scoped run keeps the other pages.
        if matches!(scope, AnalysisScope::All) && page_scope.is_none() {
            menreiki_project::clear_analysis(&project_dir).map_err(|error| error.to_string())?;
        }

        if render {
            emit("render", None, None);
            let rasterizer = rasterizer_for(&project_dir)?;
            let result = menreiki_project::analyze(
                &project_dir,
                rasterizer.as_ref(),
                dpi,
                resume,
                page_scope,
                &mut |page_index, total| {
                    emit("render", Some(page_index + 1), Some(total));
                    !cancel.load(Ordering::Relaxed)
                },
            );
            match result {
                Ok(_) => {}
                Err(menreiki_project::AnalyzeError::Cancelled) => return outcome(true),
                Err(error) => return Err(error.to_string()),
            }
        }

        if ocr {
            emit("ocr", None, None);
            let engine = ocr_engine(&ocr_language)?;
            // Detect each page as its OCR lands, so candidates appear in the
            // UI mid-run; the full pass below adds cross-page layout findings.
            let stream_rules = build_detection_rules(&project_dir)?;
            let result = menreiki_project::ocr_pages(
                &project_dir,
                &engine,
                resume,
                page_scope,
                &mut |page_index, total| {
                    emit("ocr", Some(page_index + 1), Some(total));
                    if menreiki_project::detect_single_page(
                        &project_dir,
                        page_index,
                        &stream_rules,
                    )
                    .is_ok()
                    {
                        let _ = app.emit("page-detected", serde_json::json!({ "page": page_index }));
                    }
                    !cancel.load(Ordering::Relaxed)
                },
            );
            match result {
                Ok(_) => {}
                Err(menreiki_project::OcrPagesError::Cancelled) => return outcome(true),
                Err(error) => return Err(error.to_string()),
            }
        }

        emit("detect", None, None);
        run_detection(&project_dir)?;

        emit("done", None, None);
        outcome(false)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Asks the configured local model for extra candidates on every page.
/// Requires `[inference]` in the user config; the endpoint is restricted
/// to this machine by the inference client itself.
#[tauri::command]
async fn llm_detect_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalysisCancel>,
    project: String,
    use_image: bool,
) -> Result<u16, String> {
    let cancel = state.0.clone();
    cancel.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let config = settings::load_config();
        let client = menreiki_inference::InferenceClient::new(
            &config.inference.base_url,
            &config.inference.model,
        )
        .map_err(|error| {
            format!(
                "{error}（~/.config/menreiki/config.toml の [inference] に base_url と model を設定してください）"
            )
        })?;
        let project_dir = PathBuf::from(&project);
        let stage = if use_image { "vlm" } else { "llm" };
        let mut progress = |page_index: u16, total: u16| {
            let _ = app.emit(
                "analyze-progress",
                serde_json::json!({
                    "stage": stage,
                    "page": page_index + 1,
                    "total": total,
                }),
            );
            !cancel.load(Ordering::Relaxed)
        };
        let result = if use_image {
            menreiki_project::vlm_detect_pages(&project_dir, &client, &mut progress)
        } else {
            menreiki_project::llm_detect_pages(&project_dir, &client, &mut progress)
        };
        match result {
            Ok(pages) => Ok(pages),
            Err(menreiki_project::LlmDetectError::Cancelled) => Ok(0),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Lists the models the local endpoint offers, so the settings UI can present
/// them as a dropdown instead of asking the user to type a name. `base_url`
/// is whatever the user has entered (still restricted to this machine).
#[tauri::command]
async fn list_models(base_url: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        menreiki_inference::list_models(&base_url).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Asks the configured local model for replacement suggestions (alias or
/// generalization) for one expression. Advisory only — the reviewer picks.
#[tauri::command]
async fn suggest_replacements(
    text: String,
    category: String,
    context: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = settings::load_config();
        let client = menreiki_inference::InferenceClient::new(
            &config.inference.base_url,
            &config.inference.model,
        )
        .map_err(|error| {
            format!(
                "{error}（~/.config/menreiki/config.toml の [inference] に base_url と model を設定してください）"
            )
        })?;
        menreiki_inference::suggest_replacements(&client, &text, &category, &context)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Asks the local model to propose sensitive terms worth detecting in this
/// document — advisory targets the reviewer can search for and turn into
/// rules, distinct from writing findings directly. Returns unique candidate
/// strings from a bounded sample of the document's OCR text.
#[tauri::command]
async fn suggest_targets(project: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = settings::load_config();
        let client = menreiki_inference::InferenceClient::new(
            &config.inference.base_url,
            &config.inference.model,
        )
        .map_err(|error| {
            format!(
                "{error}（~/.config/menreiki/config.toml の [inference] に base_url と model を設定してください）"
            )
        })?;
        let pages =
            menreiki_project::load_ocr_pages(Path::new(&project)).map_err(|error| error.to_string())?;
        let mut sample = String::new();
        for page in &pages {
            sample.push_str(&page.text());
            sample.push('\n');
            if sample.len() > 6000 {
                break;
            }
        }
        let mut seen = std::collections::HashSet::new();
        let targets = menreiki_inference::detect_candidates(&client, &sample)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|candidate| candidate.text)
            .filter(|text| !text.trim().is_empty() && seen.insert(text.clone()))
            .collect();
        Ok(targets)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn list_findings(project: String) -> Result<Vec<menreiki_project::PageFindings>, String> {
    menreiki_project::load_findings(Path::new(&project)).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_review_decisions(
    project: String,
) -> Result<menreiki_project::ReviewDecisions, String> {
    menreiki_project::load_decisions(Path::new(&project)).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_review_decisions(
    project: String,
    decisions: menreiki_project::ReviewDecisions,
) -> Result<(), String> {
    menreiki_project::save_decisions(Path::new(&project), &decisions)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_entities(project: String) -> Result<Vec<menreiki_entity::Entity>, String> {
    menreiki_project::load_entities(Path::new(&project)).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_entities(
    project: String,
    entities: Vec<menreiki_entity::Entity>,
) -> Result<(), String> {
    menreiki_project::save_entities(Path::new(&project), &entities)
        .map_err(|error| error.to_string())
}

/// Spellings among the detected findings that plausibly belong to the
/// entity but are not registered as variants yet.
#[tauri::command]
fn suggest_entity_variants(
    project: String,
    entity: menreiki_entity::Entity,
) -> Result<Vec<String>, String> {
    let findings =
        menreiki_project::load_findings(Path::new(&project)).map_err(|error| error.to_string())?;
    let mut texts: Vec<String> = findings
        .into_iter()
        .flat_map(|page| page.findings)
        .map(|finding| finding.text)
        .collect();
    texts.sort();
    texts.dedup();
    Ok(menreiki_entity::suggest_variants(
        &entity,
        texts.iter().map(String::as_str),
    ))
}

/// Document-wide occurrence count for each text, using the same
/// OCR-tolerant matching as search.
#[tauri::command]
fn count_matches(project: String, texts: Vec<String>) -> Result<Vec<u32>, String> {
    let project_dir = Path::new(&project);
    let mut counts = Vec::new();
    for text in &texts {
        let pages = menreiki_project::search_text(project_dir, text)
            .map_err(|error| error.to_string())?;
        counts.push(
            pages
                .iter()
                .map(|page| page.findings.len() as u32)
                .sum::<u32>(),
        );
    }
    Ok(counts)
}

#[tauri::command]
fn list_dictionary(
    project: String,
) -> Result<Vec<menreiki_project::DictionaryEntry>, String> {
    menreiki_project::load_dictionary(Path::new(&project)).map_err(|error| error.to_string())
}

#[tauri::command]
fn add_dictionary_entry(
    project: String,
    category: String,
    text: String,
) -> Result<Vec<menreiki_project::DictionaryEntry>, String> {
    menreiki_project::add_dictionary_entry(
        Path::new(&project),
        menreiki_project::DictionaryEntry { category, text },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_dictionary_entry(
    project: String,
    text: String,
) -> Result<Vec<menreiki_project::DictionaryEntry>, String> {
    menreiki_project::remove_dictionary_entry(Path::new(&project), &text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_project(
    project: String,
    text: String,
) -> Result<Vec<menreiki_project::PageFindings>, String> {
    menreiki_project::search_text(Path::new(&project), &text).map_err(|error| error.to_string())
}

/// Text the OCR recognized inside a page rectangle, in reading order — the
/// seed for "detect this" when the reviewer boxes a spot on the page instead
/// of typing the string.
#[tauri::command]
fn text_in_region(
    project: String,
    page: u16,
    rect: menreiki_core::Rect,
) -> Result<String, String> {
    let pages =
        menreiki_project::load_ocr_pages(Path::new(&project)).map_err(|error| error.to_string())?;
    let ocr = pages
        .get(page as usize)
        .ok_or_else(|| "ページが範囲外です".to_string())?;
    // Keep the OCR's own reading order (lines top-to-bottom, words in sequence).
    // Re-sorting by coordinates scrambles a single line whose glyph tops vary
    // by a pixel or two, producing gibberish like "芝株重業式社犬工".
    let mut text = String::new();
    for line in &ocr.lines {
        for word in &line.words {
            if rects_overlap(&word.rect, &rect) {
                text.push_str(&word.text);
            }
        }
    }
    Ok(text)
}

fn rects_overlap(a: &menreiki_core::Rect, b: &menreiki_core::Rect) -> bool {
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/// Reads a page rectangle with the vision model — the "detect this" path for a
/// figure, logo, or rotated label OCR could not read. The position is the box
/// the reviewer drew, so unlike whole-page VLM detection the result is located.
#[tauri::command]
async fn vlm_in_region(
    project: String,
    page: u16,
    rect: menreiki_core::Rect,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = settings::load_config();
        let client = menreiki_inference::InferenceClient::new(
            &config.inference.base_url,
            &config.inference.model,
        )
        .map_err(|error| {
            format!(
                "{error}（~/.config/menreiki/config.toml の [inference] に base_url と model を設定してください）"
            )
        })?;
        let png = std::fs::read(menreiki_project::page_image_path(Path::new(&project), page))
            .map_err(|error| error.to_string())?;
        let image = image::load_from_memory(&png).map_err(|error| error.to_string())?;
        let (iw, ih) = (image.width(), image.height());
        let x = rect.x.max(0.0) as u32;
        let y = rect.y.max(0.0) as u32;
        if x >= iw || y >= ih {
            return Err("領域がページ外です".to_string());
        }
        let crop = image.crop_imm(x, y, (rect.width.max(1.0) as u32).min(iw - x), (rect.height.max(1.0) as u32).min(ih - y));
        let mut buffer = Vec::new();
        crop.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        Ok(menreiki_inference::detect_candidates_in_image(&client, &buffer)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|candidate| candidate.text)
            .filter(|text| !text.trim().is_empty())
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Absolute path of a page image; `rendered` selects the transformed image
/// under `renders/` instead of the original under `pages/`.
#[tauri::command]
fn page_image(project: String, page_index: u16, rendered: bool) -> Result<String, String> {
    let project_dir = Path::new(&project);
    let path = if rendered {
        menreiki_project::page_render_path(project_dir, page_index)
    } else {
        menreiki_project::page_image_path(project_dir, page_index)
    };
    if !path.exists() {
        return Err(format!("page image not found: {}", path.display()));
    }
    Ok(path.display().to_string())
}

#[tauri::command]
async fn apply_policy(
    project: String,
    policy: serde_json::Value,
) -> Result<menreiki_project::ApplySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let policy: menreiki_policy::Policy =
            serde_json::from_value(policy).map_err(|error| error.to_string())?;
        menreiki_project::apply(Path::new(&project), &policy, &default_font_path())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Rebuilds the PDF. `pages` (0-based) selects which pages to include; an
/// empty/None selection exports every page.
#[tauri::command]
async fn export_project(
    project: String,
    dpi: u32,
    pages: Option<Vec<u16>>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pages = pages.filter(|list| !list.is_empty());
        menreiki_project::export_pdf(Path::new(&project), dpi, pages.as_deref())
            .map(|path| path.display().to_string())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn export_markdown(
    app: tauri::AppHandle,
    project: String,
    ocr_language: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = ocr_engine(&ocr_language)?;
        menreiki_project::export_markdown(
            Path::new(&project),
            &engine,
            &mut |page_index, total| {
                let _ = app.emit(
                    "analyze-progress",
                    serde_json::json!({
                        "stage": "markdown",
                        "page": page_index + 1,
                        "total": total,
                    }),
                );
            },
        )
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn audit_project(
    project: String,
    policy: Option<serde_json::Value>,
    extra_terms: Vec<String>,
    ocr_language: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let policy: Option<menreiki_policy::Policy> = policy
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| error.to_string())?;
        let engine = ocr_engine(&ocr_language)?;
        let report = menreiki_project::audit_output(
            Path::new(&project),
            policy.as_ref(),
            &extra_terms,
            &engine,
        )
        .map_err(|error| error.to_string())?;
        serde_json::to_value(&report).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn restore_window_placement(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = settings::load_session().window else {
        return;
    };
    if state.maximized {
        let _ = window.maximize();
    } else {
        let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
        let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
    }
}

fn save_window_placement(window: &tauri::Window) {
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let _ = settings::save_session(&settings::Session {
        window: Some(settings::WindowState {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized: window.is_maximized().unwrap_or(false),
        }),
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AnalysisCancel(Arc::new(AtomicBool::new(false))))
        .setup(|app| {
            restore_window_placement(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                save_window_placement(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            register_file_association,
            get_config,
            set_config,
            list_detectors,
            get_project_settings,
            set_project_settings,
            initial_project,
            load_review_decisions,
            save_review_decisions,
            list_entities,
            save_entities,
            suggest_entity_variants,
            count_matches,
            list_dictionary,
            add_dictionary_entry,
            remove_dictionary_entry,
            import_document,
            open_project,
            analyze_project,
            cancel_analysis,
            llm_detect_project,
            list_models,
            suggest_replacements,
            suggest_targets,
            list_findings,
            search_project,
            text_in_region,
            vlm_in_region,
            page_image,
            apply_policy,
            export_project,
            export_markdown,
            audit_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
