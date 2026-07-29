use std::path::{Path, PathBuf};

fn main() {
    // generate_context! embeds the window icon at compile time, but cargo
    // does not otherwise know the icon files feed the build. Without this,
    // regenerating icons leaves a stale titlebar/taskbar icon until a clean
    // rebuild.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    embed_sample_project();
    tauri_build::build()
}

/// Bakes the analyzed sample project (assets/sample.menreiki) into the binary
/// as `(relative_path, bytes)` pairs, so the "open sample" flow works with no
/// external files or OCR language pack — the same include_bytes! approach the
/// crate already uses for pdfium. Regenerate the tree with
/// scripts/build-sample-project.ps1.
fn embed_sample_project() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let sample_dir = manifest_dir.join("assets").join("sample.menreiki");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("sample_manifest.rs");

    let mut files = Vec::new();
    collect_files(&sample_dir, &sample_dir, &mut files);
    files.sort();

    let mut code = String::from("pub static SAMPLE_FILES: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &files {
        println!("cargo:rerun-if-changed={}", abs.display());
        code.push_str(&format!(
            "    ({:?}, include_bytes!(r\"{}\")),\n",
            rel,
            abs.display()
        ));
    }
    code.push_str("];\n");
    std::fs::write(&out, code).expect("write sample manifest");
    println!("cargo:rerun-if-changed={}", sample_dir.display());
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, out);
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, path));
        }
    }
}
