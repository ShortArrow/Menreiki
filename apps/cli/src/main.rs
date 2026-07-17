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
    },
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
    /// Rebuild a PDF from the (transformed) page images
    Export {
        /// Project directory created by `import`
        project: PathBuf,
        /// Resolution the page images were rendered at
        #[arg(long, default_value_t = 300)]
        dpi: u32,
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
        } => {
            menreiki_project::clear_analysis(&project).map_err(|error| error.to_string())?;
            let rasterizer = menreiki_adapter_pdfium::PdfiumRasterizer::new(&pdfium_library_dir())
                .map_err(|error| error.to_string())?;
            let page_count =
                menreiki_project::analyze(&project, &rasterizer, dpi, &mut |page_index, total| {
                    eprint!("\rrendering page {} / {total}...", page_index + 1);
                })
                .map_err(|error| error.to_string())?;
            eprintln!();
            println!(
                "rendered {page_count} pages into {}",
                project.join(menreiki_project::PAGES_DIR).display()
            );

            let ocr_engine = ocr_engine(&ocr_language)?;
            let ocr_count =
                menreiki_project::ocr_pages(&project, &ocr_engine, &mut |page_index, total| {
                    eprint!("\rrecognizing page {} / {total}...", page_index + 1);
                })
                .map_err(|error| error.to_string())?;
            eprintln!();
            println!(
                "recognized text on {ocr_count} pages into {}",
                project.join(menreiki_project::OCR_DIR).display()
            );

            menreiki_project::detect_pages(&project, &menreiki_detect::builtin_rules())
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
            Ok(())
        }
        Command::Findings { project } => {
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
        Command::Export { project, dpi } => {
            let output = menreiki_project::export_pdf(&project, dpi)
                .map_err(|error| error.to_string())?;
            println!("exported {}", output.display());
            Ok(())
        }
        Command::Audit {
            project,
            policy,
            deny_wordlist,
            ocr_language,
        } => {
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

/// Directory holding the pdfium dynamic library: `MENREIKI_PDFIUM_PATH` if
/// set, otherwise `vendor/pdfium` relative to the working directory.
fn pdfium_library_dir() -> PathBuf {
    std::env::var_os("MENREIKI_PDFIUM_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("vendor/pdfium"))
}
