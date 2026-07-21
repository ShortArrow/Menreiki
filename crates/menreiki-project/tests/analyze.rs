use std::cell::RefCell;
use std::fs;

use menreiki_project::{analyze, import, page_image_path, AnalyzeError};
use menreiki_render::{DocumentRasterizer, PageImage, RasterError};

struct FakeRasterizer {
    pages: Vec<Vec<u8>>,
    rendered: RefCell<Vec<u16>>,
}

impl FakeRasterizer {
    fn new(pages: Vec<Vec<u8>>) -> Self {
        Self {
            pages,
            rendered: RefCell::new(Vec::new()),
        }
    }
}

impl DocumentRasterizer for FakeRasterizer {
    fn page_count(&self, _document: &[u8]) -> Result<u16, RasterError> {
        Ok(self.pages.len() as u16)
    }

    fn rasterize_page(
        &self,
        _document: &[u8],
        page_index: u16,
        _dpi: u32,
    ) -> Result<PageImage, RasterError> {
        self.rendered.borrow_mut().push(page_index);
        Ok(PageImage {
            width: 1,
            height: 1,
            png: self.pages[usize::from(page_index)].clone(),
        })
    }
}

fn fresh_project(tmp: &tempfile::TempDir) -> std::path::PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    project_dir
}

#[test]
fn analyze_writes_one_png_per_page() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    let rasterizer = FakeRasterizer::new(vec![b"png-1".to_vec(), b"png-2".to_vec()]);

    let mut reported: Vec<(u16, u16)> = Vec::new();
    let page_count = analyze(&project_dir, &rasterizer, 300, false, None, &mut |index, total| {
        reported.push((index, total));
        true
    })
    .unwrap();

    assert_eq!(page_count, 2);
    assert_eq!(reported, vec![(0, 2), (1, 2)]);
    assert_eq!(fs::read(page_image_path(&project_dir, 0)).unwrap(), b"png-1");
    assert_eq!(fs::read(page_image_path(&project_dir, 1)).unwrap(), b"png-2");
}

#[test]
fn analyze_requires_an_existing_project() {
    let tmp = tempfile::tempdir().unwrap();
    let rasterizer = FakeRasterizer::new(vec![]);

    let result = analyze(tmp.path(), &rasterizer, 300, false, None, &mut |_, _| true);

    assert!(result.is_err());
}

#[test]
fn cancelling_keeps_finished_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    let rasterizer = FakeRasterizer::new(vec![b"png-1".to_vec(), b"png-2".to_vec()]);

    let cancel_after_first_page = &mut |_: u16, _: u16| false;
    let result = analyze(&project_dir, &rasterizer, 300, false, None, cancel_after_first_page);

    assert!(matches!(result, Err(AnalyzeError::Cancelled)));
    assert!(page_image_path(&project_dir, 0).exists());
    assert!(!page_image_path(&project_dir, 1).exists());
}

#[test]
fn resume_skips_pages_that_already_exist() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    fs::create_dir_all(page_image_path(&project_dir, 0).parent().unwrap()).unwrap();
    fs::write(page_image_path(&project_dir, 0), b"from-previous-run").unwrap();
    let rasterizer = FakeRasterizer::new(vec![b"png-1".to_vec(), b"png-2".to_vec()]);

    let page_count = analyze(&project_dir, &rasterizer, 300, true, None, &mut |_, _| true).unwrap();

    assert_eq!(page_count, 2);
    assert_eq!(*rasterizer.rendered.borrow(), vec![1]);
    assert_eq!(
        fs::read(page_image_path(&project_dir, 0)).unwrap(),
        b"from-previous-run"
    );
    assert_eq!(fs::read(page_image_path(&project_dir, 1)).unwrap(), b"png-2");
}

#[test]
fn a_page_selection_re_renders_only_those_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    fs::create_dir_all(page_image_path(&project_dir, 0).parent().unwrap()).unwrap();
    fs::write(page_image_path(&project_dir, 0), b"old-0").unwrap();
    fs::write(page_image_path(&project_dir, 1), b"old-1").unwrap();
    let rasterizer = FakeRasterizer::new(vec![b"png-1".to_vec(), b"png-2".to_vec()]);

    // Re-render page 1 (0-based) only, forced despite the existing image.
    let page_count =
        analyze(&project_dir, &rasterizer, 300, true, Some(&[1]), &mut |_, _| true).unwrap();

    assert_eq!(page_count, 2);
    assert_eq!(*rasterizer.rendered.borrow(), vec![1]);
    assert_eq!(fs::read(page_image_path(&project_dir, 0)).unwrap(), b"old-0");
    assert_eq!(fs::read(page_image_path(&project_dir, 1)).unwrap(), b"png-2");
}
