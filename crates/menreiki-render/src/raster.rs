/// A rendered page: PNG-encoded pixels plus their dimensions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageImage {
    pub width: u32,
    pub height: u32,
    pub png: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum RasterError {
    #[error("document could not be opened: {0}")]
    UnsupportedDocument(String),
    #[error("page {0} could not be rendered: {1}")]
    Page(u16, String),
}

/// Renders a document's pages independently, so callers can skip pages that
/// already exist (resume) and stop between pages (cancel).
pub trait DocumentRasterizer {
    /// Number of pages in the document, without rasterizing any of them —
    /// lets callers show "page 3 of 12" progress from the first page on.
    fn page_count(&self, document: &[u8]) -> Result<u16, RasterError>;

    /// Rasterizes one 0-based page at `dpi`.
    fn rasterize_page(
        &self,
        document: &[u8],
        page_index: u16,
        dpi: u32,
    ) -> Result<PageImage, RasterError>;
}
