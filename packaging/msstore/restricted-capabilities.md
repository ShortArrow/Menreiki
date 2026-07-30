# Restricted capability justification (paste into Partner Center)

`AppxManifest.template.xml` declares `runFullTrust`, which the Store treats as
a restricted capability: the submission cannot proceed until the **Restricted
capabilities** field on the Submission Options page explains why the app needs
it. Paste the text below into that field.

> This is a packaged Win32 desktop application built with Tauri: a native Rust
> executable that renders its user interface in WebView2. runFullTrust is
> required to:
>
> 1. Run that native executable (menreiki-desktop.exe) and load its bundled PDF
>    rendering library (pdfium.dll) from the package directory as an ordinary
>    Win32 DLL.
> 2. Rasterize document pages into images and read text from them with local OCR
>    through the Windows.Media.Ocr API.
> 3. Read and write the project folder the user picks in the file dialog: the
>    source document they chose to de-identify, the rendered page images, the
>    analysis results, and the exported PDF, Markdown, and image files.
> 4. Store the application's settings and the built-in sample project under the
>    user's application data folder, so the app can be tried with no external
>    document.
> 5. Register the application's own .mnrk project file type under
>    HKEY_CURRENT_USER\Software\Classes. This happens only when the user clicks
>    the button that asks for the association, only for the current user, and
>    only for that one file type.
>
> The app is a local-first document de-identification tool. It makes no network
> connections, collects no data, and requires no account: all processing happens
> on the device, and nothing the user imports ever leaves it.
>
> The capability is used only for that document processing. The app installs no
> service and no driver, requires no elevation, registers nothing to run at
> logon, and launches no other application.
