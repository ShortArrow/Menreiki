# Restricted capability justification (paste into Partner Center)

`AppxManifest.template.xml` declares `runFullTrust`, which the Store treats as
a restricted capability: the submission cannot proceed until the **Restricted
capabilities** field on the Submission Options page explains why the app needs
it.

That field holds **500 characters** and silently drops everything past the
limit — a longer answer looks saved but reaches the reviewer cut off mid-word.
The text below is 488 characters as a single paragraph (line breaks count too,
so a bulleted list does not fit). Measure any edit before pasting.

> Packaged Win32 desktop app built with Tauri (native Rust executable, WebView2 UI). Full trust lets it run that executable, load its bundled pdfium.dll to render PDF pages, run local OCR through Windows.Media.Ocr, read and write the project folders the user picks in the file dialog, and register its own .mnrk file type for the current user on request. Offline de-identification tool: no network calls, no data collection, no account, no service or driver, no elevation, nothing at logon.

The five uses map to the app as built: the packaged executable itself,
`pdfium.dll` loaded from the package directory for PDF rasterization,
`Windows.Media.Ocr` for local text recognition, the project folder chosen
through the file dialog (source document, page images, analysis results,
exports), and the `.mnrk` association written under
`HKEY_CURRENT_USER\Software\Classes` only when the user presses the button that
asks for it.
