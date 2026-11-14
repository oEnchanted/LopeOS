**NOT READY for publication.** Repaired candidate source: `7136412011e06dcb2cbee96ccff8419fe0ff3ba2` (LopeOS 0.1.0 / Luma). Target: Adobe Lightroom desktop 10.0, Advanced, Dark, Compact, English, macOS. The exact Adobe build, display scale and complete workspace captures remain unverified.

[Download the tested production artifact](release-candidate.tar.gz) · [Build hashes](build-manifest.json) · [Repairs patch](repairs.patch) · [Before/after comparisons](evidence/comparisons/) · [Full issue register](issues.csv) · [Workflow results](workflow-results.json).

The audit ran in an isolated local branch containing the existing uncommitted workspace, with later concurrent changes copied into that build. Lightroom/shared repairs are copied back only after baseline-hash checks. No user work was discarded, no originals were overwritten, and nothing was published. The subsequent live-workspace typecheck fails on concurrent `movie-maker/index.tsx:123` and `spreadsheet/index.tsx:73` syntax errors. Those files were not part of this isolated candidate and were left untouched; see [integration validation](integration.json). Base repository commit: `ec4599f`; workspace snapshot: `a3c817f`. The artifact tree SHA256 is `c49f2d655da41552b3e9043bbbae92a7358d245aa55d113fb6b3bd49b0ae3ec2`. The original attachment's separate Photoshop audit sign-off was not available; the actual cross-app workflow was verified here on this artifact.

**Repairs and verification.** 44 repaired-defect records cover atomic saves/restores, durable/deep albums, smart rules, hidden export selections, delayed edits targeting the wrong photo, numeric negative/decimal entry and Escape, pointer pan, mask geometry, keyboard crop/curve actions, correct focused-app menu order, filter dismissal, and real PNG16/TIFF decoding defects. Source-identified preconditions are explicitly distinguished from observed before failures in the findings. New documentation-supported UI changes include import Select All, Photo Grid badge separation, and export bounds. Root fixes: [app findings](app-findings.json); [controls](controls-findings.json); [data](data-findings.json).

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed; existing chunk-size/dynamic-import warnings retained |
| Photo engine and decoder tests | 39 passed |
| Repository `npm test` | 147 passed; 3 environment-dependent checks skipped |
| Production UI workflow/captures | 35 passed; 0 failed; native browser zoom: 1 unverified |
| Production control integration | 6 passed; 0 page errors |
| Component control regression | 13 passed |
| Targeted app regressions | 9 passed |
| Storage rollback/hierarchy | 7 passed |
| Actual RAW→local AI→TIFF16 production | 5 workflow assertions passed; 0 page errors |
| Real Luma→LopeDrive→Prism→Luma | 6 stages passed; independent Pillow output read passed |
| Browser codec matrix | Chromium 158.0.8127.18 and WebKit 27.2 passed; Firefox launch failed |

Runs use Node 26.12.1, Playwright 1.65.0, React 19.3.1, Vite 8.3.8, TypeScript 7.0.2, LibRaw WASM 1.6.0 and Pillow 11.3.0 on macOS 27.2 arm64. These bundled browser versions do not certify every current stable browser. [Reproduction commands](reproduce.md) retain test dependencies, infrastructure failures and final logs.

**Confirmed matches, approximations and unknowns.** Documented desktop shortcuts and the tested real import/edit/export behaviors match the assertions recorded in [the production UI run](evidence/ui-production-final/results.json). Pixel output is an independent implementation, with no Adobe processing equivalence claim. Menu ownership/order, save-target correctness, source checksums and output encodings were observed. App geometry is measured at exact 1440×900, 1920×1080 and 680×460 client areas, DPR 1. The actual 680×460 minimum outer window has a 678×419 client. [Measured rectangles, typography and colors](evidence/ui-production-final/measured-anchors.json) are implementation measurements only. No reference CSS values have been invented. Native 125%/200% browser zoom did not engage through headless shortcuts and remains unverified.

Original Adobe documentation screenshots remain immutable and hashed. Their unknown scale/platform and cropped/illustrated content prevent legitimate pixel-normalized Adobe overlays. The supplied [50% overlays, difference images and side-by-side comparisons](evidence/implementation-comparisons.json) compare LopeOS before/after defect evidence only, at original size with no resampling or hidden regions. They are not Adobe identity evidence. No high whole-image similarity score substitutes for an anchor comparison.

**Release blockers.** 60 audit issues remain open, plus the concurrent live-workspace syntax errors above (some contract capability entries overlap by design). Required HDR/panorama merge, segmentation/depth/generative tools, lens blur, video/tethering, several formats/color transforms, Default/Classic-style workspace presets, crop ratio lock/full-session cancellation, complete mask/component controls and selective settings copy remain absent or incomplete. TIFF alpha and non-square straightening fidelity remain limited/unverified. Real high-ISO camera RAW, wide-gamut and remaining conditional decoder fixtures are missing; the synthetic DNG does not certify entire camera families. Exhaustive native control states, accessibility preference combinations, browser zoom and exact Advanced geometry are not closed.

Fresh production runs have zero JavaScript page exceptions in the covered photo workflows, but retain workspace API 401/403 console/network errors for health/identity/trash/visitor initialization. Photo decoding, model assets, downloads and LopeDrive handoff succeeded; the complete authenticated runtime/clean-console gate is still open. Logged requests show no unexpected photo uploads. Failed infrastructure and test-selector attempts remain in evidence and are not presented as passes.

[Inventory](ui-inventory.csv): 546 rows — 44 passed repaired-defect subsets, 47 failed, 455 unverified, 0 not applicable. The broader reference-state denominator was retained. Mandatory LR-01/03/07/09 have functional passes with stated limits; LR-02/05/08 fail full scope; LR-04/06 remain unverified. No new deliberate difference was approved or waived. This is a tested, improved candidate, not a completed identity release.
