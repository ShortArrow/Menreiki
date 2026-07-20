//! Menreiki CLI.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "menreiki",
    version,
    about = "Local-first document de-identification workbench"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Import a document into a new Menreiki project
    Import {
        /// Document to import (PDF, PNG, JPEG)
        input: PathBuf,
        /// Project directory to create (defaults to `<input>.menreiki` beside the input)
        #[arg(long)]
        project: Option<PathBuf>,
    },
    /// Render every page of a project's source document into page images
    Analyze {
        /// Project directory created by `import`
        project: PathBuf,
        /// Render resolution in dots per inch
        #[arg(long, default_value_t = 300)]
        dpi: u32,
        /// BCP-47 tag of the OCR language (falls back to profile languages)
        #[arg(long, default_value = "ja")]
        ocr_language: String,
        /// Keep existing per-page results and continue where a previous
        /// run stopped, instead of starting from a clean slate
        #[arg(long)]
        resume: bool,
        /// Run a single stage only. "llm" (text) and "vlm" (page images,
        /// needs a vision model) ask a local model for extra candidates
        /// and never run unless requested here
        #[arg(long, value_parser = ["render", "ocr", "detect", "llm", "vlm"])]
        only: Option<String>,
        /// OpenAI-compatible local endpoint for the llm stage
        #[arg(long, default_value = "http://localhost:11434/v1")]
        llm_url: String,
        /// Model name for the llm stage (e.g. an Ollama model tag)
        #[arg(long, default_value = "")]
        llm_model: String,
        /// Detector groups to turn off (repeatable), e.g. --disable phone-jp
        /// --disable date. See `list-detectors` for the ids
        #[arg(long)]
        disable: Vec<String>,
    },
    /// List the available detector group ids
    ListDetectors,
    /// List the findings detected in a project
    Findings {
        /// Project directory created by `import`
        project: PathBuf,
    },
    /// Find every occurrence of a string across the document
    Search {
        /// Project directory created by `import`
        project: PathBuf,
        /// String to look for in the OCR results
        text: String,
    },
    /// Apply an anonymization policy, producing transformed page images
    Apply {
        /// Project directory created by `import`
        project: PathBuf,
        /// Policy YAML describing what to transform and how
        #[arg(long)]
        policy: PathBuf,
        /// Font used to draw replacement text
        #[arg(long, default_value = r"C:\Windows\Fonts\msgothic.ttc")]
        font: PathBuf,
    },
    /// Rebuild the sanitized outputs from the (transformed) page images
    Export {
        /// Project directory created by `import`
        project: PathBuf,
        /// Resolution the page images were rendered at
        #[arg(long, default_value_t = 300)]
        dpi: u32,
        /// Output to produce
        #[arg(long, default_value = "pdf", value_parser = ["pdf", "markdown", "all"])]
        format: String,
        /// BCP-47 tag of the OCR language used for the Markdown rendition
        #[arg(long, default_value = "ja")]
        ocr_language: String,
    },
    /// Re-inspect the transformed pages for residual identifying text
    Audit {
        /// Project directory created by `import`
        project: PathBuf,
        /// Policy whose transformed texts must no longer appear
        #[arg(long)]
        policy: Option<PathBuf>,
        /// File with one additional forbidden term per line
        #[arg(long)]
        deny_wordlist: Option<PathBuf>,
        /// BCP-47 tag of the OCR language (falls back to profile languages)
        #[arg(long, default_value = "ja")]
        ocr_language: String,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Import { input, project } => {
            let project_dir = project.unwrap_or_else(|| default_project_dir(&input));
            let manifest = menreiki_project::import(&input, &project_dir)
                .map_err(|error| error.to_string())?;
            println!(
                "imported {} into {}",
                manifest.source().file_name(),
                project_dir.display()
            );
            Ok(())
        }
        Command::Analyze {
            project,
            dpi,
            ocr_language,
            resume,
            only,
            llm_url,
            llm_model,
            disable,
        } => {
            let project = menreiki_project::resolve_project_dir(&project);
            let stage = |name: &str| {
                only.as_deref()
                    .map_or(name != "llm" && name != "vlm", |chosen| chosen == name)
            };
            if !resume && only.is_none() {
                menreiki_project::clear_analysis(&project).map_err(|error| error.to_string())?;
            }

            if stage("render") {
                let rasterizer = rasterizer_for(&project)?;
                let page_count = menreiki_project::analyze(
                    &project,
                    rasterizer.as_ref(),
                    dpi,
                    resume,
                    &mut |page_index, total| {
                        eprint!("\rrendering page {} / {total}...", page_index + 1);
                        true
                    },
                )
                .map_err(|error| error.to_string())?;
                eprintln!();
                println!(
                    "rendered {page_count} pages into {}",
                    project.join(menreiki_project::PAGES_DIR).display()
                );
            }

            if stage("ocr") {
                let ocr_engine = ocr_engine(&ocr_language)?;
                let ocr_count = menreiki_project::ocr_pages(
                    &project,
                    &ocr_engine,
                    resume,
                    &mut |page_index, total| {
                        eprint!("\rrecognizing page {} / {total}...", page_index + 1);
                        true
                    },
                )
                .map_err(|error| error.to_string())?;
                eprintln!();
                println!(
                    "recognized text on {ocr_count} pages into {}",
                    project.join(menreiki_project::OCR_DIR).display()
                );
            }

            if stage("ocr") || stage("detect") {
                let mut rules = menreiki_lang_ja::preset().without(&disable).into_rules();
                let dictionary = menreiki_project::load_dictionary(&project)
                    .map_err(|error| error.to_string())?;
                rules.extend(menreiki_project::dictionary_rules(&dictionary));
                menreiki_project::detect_pages(&project, &rules)
                    .map_err(|error| error.to_string())?;
                let total_findings: usize = menreiki_project::load_findings(&project)
                    .map_err(|error| error.to_string())?
                    .iter()
                    .map(|page| page.findings.len())
                    .sum();
                println!(
                    "detected {total_findings} findings into {}",
                    project.join(menreiki_project::FINDINGS_DIR).display()
                );
            }

            if stage("llm") || stage("vlm") {
                let client = menreiki_inference::InferenceClient::new(&llm_url, &llm_model)
                    .map_err(|error| error.to_string())?;
                let mut progress = |page_index: u16, total: u16| {
                    eprint!("\rquerying model for page {} / {total}...", page_index + 1);
                    true
                };
                let pages = if stage("vlm") {
                    menreiki_project::vlm_detect_pages(&project, &client, &mut progress)
                } else {
                    menreiki_project::llm_detect_pages(&project, &client, &mut progress)
                }
                .map_err(|error| error.to_string())?;
                eprintln!();
                println!("model-assisted detection updated findings on {pages} pages");
            }
            Ok(())
        }
        Command::ListDetectors => {
            for id in menreiki_lang_ja::preset().ids() {
                println!("{id}");
            }
            Ok(())
        }
        Command::Findings { project } => {
            let project = menreiki_project::resolve_project_dir(&project);
            let pages = menreiki_project::load_findings(&project)
                .map_err(|error| error.to_string())?;
            let mut total = 0;
            for page in &pages {
                for finding in &page.findings {
                    total += 1;
                    println!(
                        "page {:>3}  [{}]  {}",
                        page.page_index + 1,
                        finding.category,
                        finding.text
                    );
                }
            }
            println!("{total} findings");
            Ok(())
        }
        Command::Search { project, text } => {
            let project = menreiki_project::resolve_project_dir(&project);
            let pages = menreiki_project::search_text(&project, &text)
                .map_err(|error| error.to_string())?;
            let mut total = 0;
            for page in &pages {
                for finding in &page.findings {
                    total += 1;
                    println!(
                        "page {:>3}  at ({:.0}, {:.0})  {}",
                        page.page_index + 1,
                        finding.rect.x,
                        finding.rect.y,
                        finding.text
                    );
                }
            }
            println!("{total} matches");
            Ok(())
        }
        Command::Apply {
            project,
            policy,
            font,
        } => {
            let project = menreiki_project::resolve_project_dir(&project);
            let policy = menreiki_policy::load_policy(&policy).map_err(|error| error.to_string())?;
            let summary = menreiki_project::apply(&project, &policy, &font)
                .map_err(|error| error.to_string())?;
            println!(
                "applied {} edits across {} pages into {}",
                summary.edit_count,
                summary.page_count,
                project.join(menreiki_project::RENDERS_DIR).display()
            );
            Ok(())
        }
        Command::Export {
            project,
            dpi,
            format,
            ocr_language,
        } => {
            let project = menreiki_project::resolve_project_dir(&project);
            let wants = |kind: &str| format == kind || format == "all";
            if wants("pdf") {
                let output = menreiki_project::export_pdf(&project, dpi)
                    .map_err(|error| error.to_string())?;
                println!("exported {}", output.display());
            }
            if wants("markdown") {
                let engine = ocr_engine(&ocr_language)?;
                let output = menreiki_project::export_markdown(
                    &project,
                    &engine,
                    &mut |page_index, total| {
                        eprint!("\rrecognizing page {} / {total}...", page_index + 1);
                    },
                )
                .map_err(|error| error.to_string())?;
                eprintln!();
                println!("exported {}", output.display());
            }
            Ok(())
        }
        Command::Audit {
            project,
            policy,
            deny_wordlist,
            ocr_language,
        } => {
            let project = menreiki_project::resolve_project_dir(&project);
            let policy = policy
                .map(|path| menreiki_policy::load_policy(&path))
                .transpose()
                .map_err(|error| error.to_string())?;
            let extra_terms = deny_wordlist
                .map(|path| {
                    std::fs::read_to_string(&path)
                        .map(|text| text.lines().map(str::to_string).collect::<Vec<_>>())
                })
                .transpose()
                .map_err(|error| error.to_string())?
                .unwrap_or_default();
            let engine = ocr_engine(&ocr_language)?;

            let report =
                menreiki_project::audit_output(&project, policy.as_ref(), &extra_terms, &engine)
                    .map_err(|error| error.to_string())?;
            for residual in &report.residuals {
                println!(
                    "page {:>3}  residual [{}]  {}",
                    residual.page, residual.term, residual.text
                );
            }
            println!(
                "audit: {:?} ({} terms checked on {} pages), report at {}",
                report.verdict,
                report.checked_terms,
                report.page_count,
                menreiki_project::audit_report_path(&project).display()
            );
            match report.verdict {
                menreiki_audit::Verdict::Pass => Ok(()),
                menreiki_audit::Verdict::Fail => Err(format!(
                    "{} residual(s) found; the output must not be shared",
                    report.residuals.len()
                )),
            }
        }
    }
}

fn default_project_dir(input: &Path) -> PathBuf {
    input.with_extension("menreiki")
}

/// The pdfium build embedded at compile time, so the CLI works as a single
/// file with no installation step.
static EMBEDDED_PDFIUM: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../vendor/pdfium/pdfium.dll"));

/// The rasterizer matching the project's source document: single images
/// (PNG, JPEG) pass through as one-page documents, everything else goes
/// through pdfium.
fn rasterizer_for(
    project: &Path,
) -> Result<Box<dyn menreiki_render::DocumentRasterizer>, String> {
    let manifest = menreiki_project::load_manifest(project).map_err(|error| error.to_string())?;
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

/// The requested OCR language, or the profile languages (with a warning)
/// when that language pack is not installed.
fn ocr_engine(language: &str) -> Result<menreiki_adapter_windows_ocr::WindowsOcrEngine, String> {
    menreiki_adapter_windows_ocr::WindowsOcrEngine::from_language(language).or_else(|error| {
        eprintln!(
            "warning: OCR language '{language}' is unavailable ({error}); \
             falling back to the profile languages"
        );
        menreiki_adapter_windows_ocr::WindowsOcrEngine::from_user_profile_languages()
            .map_err(|error| error.to_string())
    })
}

