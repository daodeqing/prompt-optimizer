# Third-party notices

## CPA Codex Candy Eval and LM Fingerpoint Detector

Test prompts, pelican variants and the numeric attribution implementation are adapted from https://github.com/haowang02/cpa-plugin-codex-candy-eval at commit 86d832c58f85f33e0cff91368fae1cb1012899f8 (MIT). The complete upstream license is retained at vendor/lm-detector/CPA-LICENSE.

The bundled shared_detector.bin, enrollment-suite.json and models.json come from the same CPA commit, which pins https://github.com/Ikaleio/lm-detector at a4ef212df06817e8071acd05f00219f4c9eb2f9a (MIT). The original license and data provenance are retained at vendor/lm-detector/LICENSE and vendor/lm-detector/README.md. The JavaScript attribution port is in node/fingerprint.cjs. Reference-bank probabilities compare included candidates only. Cindy task system context and user-level challenge instructions differ from upstream collection conditions.

The binary's Git blob SHA-1 was verified as 0e19e0220716d71607c84b1a2149dd9ca7e13902 against the upstream tree. The frozen detector and calibration are validated together at runtime. No account credentials or upstream Codex context files are bundled.

## Mozilla PDF.js / pdfjs-dist 4.10.38

Copyright Mozilla Foundation and contributors. Licensed under Apache License 2.0.

Source: https://github.com/mozilla/pdf.js
Distribution: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.10.38.tgz
Registry integrity (SHA-512): /Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ==

The upstream license is retained at vendor/pdfjs/LICENSE. Upstream runtime modules, CMaps and standard font resources are included unmodified. This plugin's adapter uses local resource readers and text-only extraction; it does not require the optional canvas rendering package. Test-only PDF generators are not distributed.

Bundled CMaps retain their upstream license at vendor/pdfjs/cmaps/LICENSE. Font-specific notices are retained at vendor/pdfjs/standard_fonts/LICENSE_FOXIT and vendor/pdfjs/standard_fonts/LICENSE_LIBERATION; these apply to the corresponding bundled font resources.
