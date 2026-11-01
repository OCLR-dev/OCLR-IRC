# OCLR-website shared referee modules

This distribution includes derived code from OCLR-website PR #409, commit
`1abbab1ddd981025249af727d748e70e23b9096b`:
<https://github.com/OCLR-dev/OCLR-website/pull/409>.
The event projection/model was additionally refreshed from OCLR-website commit
`bbf0300555fb80a78a6a16e4ceee9c6a5a329bea` for repeated Mod Ban rules.
The scoring-rules excerpt, command builder and event projection retain this license:

MIT License

Copyright (c) 2026 Emik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Installed dependencies, including Zod, Electron, React and HeroUI, retain their
respective license notices in the installed packages.

## Localization

The application uses i18next 26.5.12 and react-i18next 17.1.9 (MIT), with their installed license notices retained in the distribution. The authored Simplified Chinese catalog was initially converted using OpenCC JS 1.4.2 (MIT AND Apache-2.0) during development and adapted for UI terminology. The converter is not bundled or applied to user content.

## Installer tooling

Windows installers are built from the existing packaged application with electron-builder 26.18.0 (MIT), Copyright (c) 2015 Loopline Systems. The build dependency is pinned in package-lock.json; its installed MIT license is retained. Source: <https://github.com/electron-userland/electron-builder>.

The unmodified NSIS installer engine and compression components retain their respective licenses (zlib/libpng, bzip2, and CPL 1.0 with the NSIS LZMA linking exception). Copyright (C) 1999–2026 NSIS Contributors. License terms and source downloads: <https://nsis.sourceforge.io/License> and <https://nsis.sourceforge.io/Download>. The OCLR application remains separately MIT licensed; these components are not authored by OCLR. macOS disk images are created with the operating system's native tooling.
