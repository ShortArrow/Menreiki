# Third-party notices

Menreikiの配布物には、以下のサードパーティソフトウェアが含まれます。

## PDFium

PDFレンダリングに使用しています。配布物にはPDFiumのバイナリ（pdfium.dll）が
同梱または埋め込まれています（ビルド: https://github.com/bblanchon/pdfium-binaries ）。

PDFiumはBSD 3-Clause LicenseとApache License 2.0のデュアルライセンスで
提供されています。Apache License 2.0の全文はリポジトリの
[LICENSE-APACHE](LICENSE-APACHE) と同一です。BSD 3-Clause Licenseの条文:

```text
Copyright 2014 The PDFium Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

PDFiumバイナリには、FreeType、libjpeg-turbo、OpenJPEG、zlib、
Little CMS、ICUなどのコンポーネントが静的リンクされています。いずれも
帰属表示を条件とする許諾的ライセンスで提供されており、各ライセンスの
詳細はPDFiumソースツリーの `third_party/` 配下に含まれています。

## Rust / npm 依存クレート・パッケージ

ビルドに使用したRustクレートおよびnpmパッケージのライセンスは、それぞれの
パッケージレジストリ（crates.io / npmjs.com）で公開されているものに従います。
いずれも許諾的ライセンス（MIT / Apache-2.0 / BSD系）のものだけを使用しています。

## Lucide

デスクトップアプリのUIアイコンに使用しています（アイコンのSVGパスデータを apps/desktop/src/icons.tsx に同梱）。

Lucide は ISC License で提供されています。

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```
