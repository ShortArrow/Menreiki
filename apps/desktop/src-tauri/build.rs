fn main() {
    // generate_context! embeds the window icon at compile time, but cargo
    // does not otherwise know the icon files feed the build. Without this,
    // regenerating icons leaves a stale titlebar/taskbar icon until a clean
    // rebuild.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    tauri_build::build()
}
