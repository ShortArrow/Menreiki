use std::fs;

use menreiki_project::{analyze, import, page_image_path};
use menreiki_render::{DocumentRasterizer, PageImage, PageSink, RasterError};

struct FakeRasterizer {
    pages: Vec<Vec<u8>>,
}

impl DocumentRasterizer for FakeRasterizer {
    fn rasterize(
        &self,
        _document: &[u8],
        _dpi: u32,
        sink: &mut PageSink<'_>,
    ) -> Result<u16, RasterError> {
        for (index, png) in self.pages.iter().enumerate() {
            sink(
                index as u16,
                PageImage {
                    width: 1,
                    height: 1,
                    png: png.clone(),
                },
            )?;
        }
        Ok(self.pages.len() as u16)
    }
}

#[test]
fn analyze_writes_one_png_per_page() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    let rasterizer = FakeRasterizer {
        pages: vec![b"png-1".to_vec(), b"png-2".to_vec()],
    };

    let page_count = analyze(&project_dir, &rasterizer, 300).unwrap();

    assert_eq!(page_count, 2);
    assert_eq!(fs::read(page_image_path(&project_dir, 0)).unwrap(), b"png-1");
    assert_eq!(fs::read(page_image_path(&project_dir, 1)).unwrap(), b"png-2");
}

#[test]
fn analyze_requires_an_existing_project() {
    let tmp = tempfile::tempdir().unwrap();
    let rasterizer = FakeRasterizer { pages: vec![] };

    let result = analyze(tmp.path(), &rasterizer, 300);

    assert!(result.is_err());
}
