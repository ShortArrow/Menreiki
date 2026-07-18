use std::fs;
use std::path::{Path, PathBuf};

use menreiki_core::{PageOcr, Rect};
use menreiki_ocr::{OcrEngine, OcrError};

use crate::layout::{
    page_image_path, page_render_path, sanitized_markdown_path, OUTPUT_DIR,
};

#[derive(Debug, thiserror::Error)]
pub enum MarkdownError {
    #[error("no page images found; run analyze (and apply) first")]
    NoPages,
    #[error("page image could not be read: {0}")]
    Read(std::io::Error),
    #[error(transparent)]
    Ocr(#[from] OcrError),
    #[error("output could not be written: {0}")]
    Write(std::io::Error),
}

/// Writes `output/sanitized.md` and returns its path.
///
/// Like the PDF, the Markdown is built only from what is visible on the
/// (transformed) page images — the pages are re-recognized with `engine`,
/// so text hidden by masks or erasures cannot leak into the output.
/// `on_page` reports per-page progress like the analysis stages.
pub fn export_markdown(
    project_dir: &Path,
    engine: &dyn OcrEngine,
    on_page: &mut dyn FnMut(u16, u16),
) -> Result<PathBuf, MarkdownError> {
    let use_renders = page_render_path(project_dir, 0).exists();
    let page_path = |index: u16| {
        if use_renders {
            page_render_path(project_dir, index)
        } else {
            page_image_path(project_dir, index)
        }
    };

    let mut total: u16 = 0;
    while page_path(total).exists() {
        total += 1;
    }
    if total == 0 {
        return Err(MarkdownError::NoPages);
    }

    let mut pages = Vec::new();
    for page_index in 0..total {
        let png = fs::read(page_path(page_index)).map_err(MarkdownError::Read)?;
        pages.push(engine.recognize(&png)?);
        on_page(page_index, total);
    }

    let markdown = render_markdown(&pages);
    fs::create_dir_all(project_dir.join(OUTPUT_DIR)).map_err(MarkdownError::Write)?;
    let output = sanitized_markdown_path(project_dir);
    fs::write(&output, markdown).map_err(MarkdownError::Write)?;
    Ok(output)
}

/// Renders recognized pages as Markdown, reconstructing coarse structure:
/// a heading per page, paragraphs split on vertical gaps, taller-than-usual
/// lines as headings, and bullet characters as list items. Tables and
/// formulas are kept as plain text lines.
pub fn render_markdown(pages: &[PageOcr]) -> String {
    let mut output = String::new();
    for (page_index, page) in pages.iter().enumerate() {
        if page_index > 0 {
            output.push('\n');
        }
        output.push_str(&format!("## ページ {}\n", page_index + 1));

        let lines = measured_lines(page);
        let median = median_height(&lines);
        let mut previous_bottom: Option<f32> = None;
        for line in &lines {
            let paragraph_break = previous_bottom
                .map(|bottom| line.top - bottom > median * 0.8)
                .unwrap_or(true);
            if paragraph_break {
                output.push('\n');
            }
            output.push_str(&formatted(line, median));
            output.push('\n');
            previous_bottom = Some(line.bottom);
        }
    }
    output
}

struct MeasuredLine {
    text: String,
    top: f32,
    bottom: f32,
    height: f32,
}

fn measured_lines(page: &PageOcr) -> Vec<MeasuredLine> {
    page.lines
        .iter()
        .filter(|line| !line.text.trim().is_empty())
        .map(|line| {
            let rect = line
                .words
                .iter()
                .map(|word| word.rect)
                .reduce(|unioned, rect| unioned.union(&rect))
                .unwrap_or(Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 0.0,
                    height: 0.0,
                });
            MeasuredLine {
                text: line.text.trim().to_string(),
                top: rect.y,
                bottom: rect.y + rect.height,
                height: rect.height,
            }
        })
        .collect()
}

fn median_height(lines: &[MeasuredLine]) -> f32 {
    let mut heights: Vec<f32> = lines
        .iter()
        .map(|line| line.height)
        .filter(|height| *height > 0.0)
        .collect();
    if heights.is_empty() {
        return 1.0;
    }
    heights.sort_by(|a, b| a.partial_cmp(b).expect("heights are finite"));
    heights[heights.len() / 2]
}

fn formatted(line: &MeasuredLine, median: f32) -> String {
    for bullet in ["・", "•", "‣"] {
        if let Some(rest) = line.text.strip_prefix(bullet) {
            return format!("- {}", rest.trim_start());
        }
    }
    if line.height > median * 1.4 {
        return format!("### {}", line.text);
    }
    line.text.clone()
}
