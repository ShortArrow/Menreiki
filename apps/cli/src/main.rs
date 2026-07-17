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
        Command::Analyze { project, dpi } => {
            let rasterizer = menreiki_adapter_pdfium::PdfiumRasterizer::new(&pdfium_library_dir())
                .map_err(|error| error.to_string())?;
            let page_count = menreiki_project::analyze(&project, &rasterizer, dpi)
                .map_err(|error| error.to_string())?;
            println!(
                "rendered {page_count} pages into {}",
                project.join(menreiki_project::PAGES_DIR).display()
            );

            let ocr_engine =
                menreiki_adapter_windows_ocr::WindowsOcrEngine::from_user_profile_languages()
                    .map_err(|error| error.to_string())?;
            let ocr_count = menreiki_project::ocr_pages(&project, &ocr_engine)
                .map_err(|error| error.to_string())?;
            println!(
                "recognized text on {ocr_count} pages into {}",
                project.join(menreiki_project::OCR_DIR).display()
            );
            Ok(())
        }
    }
}

fn default_project_dir(input: &Path) -> PathBuf {
    input.with_extension("menreiki")
}

/// Directory holding the pdfium dynamic library: `MENREIKI_PDFIUM_PATH` if
/// set, otherwise `vendor/pdfium` relative to the working directory.
fn pdfium_library_dir() -> PathBuf {
    std::env::var_os("MENREIKI_PDFIUM_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("vendor/pdfium"))
}
