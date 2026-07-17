/// One rendered page, PNG-encoded, with its pixel dimensions.
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
    #[error("rendered page could not be stored: {0}")]
    Sink(#[from] std::io::Error),
}

/// Receives rendered pages in order, keyed by 0-based page index.
pub type PageSink<'a> = dyn FnMut(u16, PageImage) -> std::io::Result<()> + 'a;

/// Renders every page of a document, streaming each page to the sink as soon
/// as it is ready (pages must arrive in index order). Streaming keeps memory
/// flat for large documents and lets review start before rendering finishes.
pub trait DocumentRasterizer {
    /// Number of pages in the document, without rasterizing any of them —
    /// lets callers show "page 3 of 12" progress from the first page on.
    fn page_count(&self, document: &[u8]) -> Result<u16, RasterError>;

    /// Rasterizes `document` at `dpi` and returns the page count.
    fn rasterize(
        &self,
        document: &[u8],
        dpi: u32,
        sink: &mut PageSink<'_>,
    ) -> Result<u16, RasterError>;
}
