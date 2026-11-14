# NOT READY — Photoshop identity release audit

Audited **LopeOS Prism 0.1.0**, retaining **Photoshop CS6 Standard, Windows, English, dark reset Essentials**. The existing project contract takes precedence over the 28.0/macOS fallback. No publication or deployment occurred.

Candidate build: `eb7162f3f059f8f50dd992f8a7ca232bcd8de2aa9feabf123de3e9d6e4d53d07`. Base commit: `ec4599f2b2e4bab9e09e8018d9146445213c8711`, isolated branch `audit/photoshop-release-20261113`, plus preserved in-progress source and audit repairs. This is an uncommitted integrated source snapshot, identified by [build/source hashes](build-manifest.json). Host: darwin arm64; browser versions and capture conditions are recorded in [environment](environment.json) and [matrix](evidence/production-matrix.json).

## Verdict and scope

The identity gate fails. There is no authorized, build-labelled CS6 reference installation or matched capture set. Exact build, Windows scaling, fonts, preferences and reference geometry remain unknown. The existing newer Adobe screenshot is immutable and supplementary; no pixel-identity measurements, reference overlays or similarity score are claimed. [Exact reference request](reference-request.md).

The source/state inventory contains **1,246 rows: 0 identity PASS, 94 FAIL, 1,144 UNVERIFIED, 8 NOT APPLICABLE**. It covers 120 command IDs, 28 tools, 11 top-level menus, 237 JSX controls and 125 capability families. Rows overlap; 94 failures are **not** 94 unique defects. Retained CS6 families include 34 implemented, 40 partial and 44 missing; implemented does not mean Adobe parity verified. Modern shipped additions remain inventoried separately. [Inventory](ui-inventory.csv), [capability gaps](capability-gaps.json).

## Repairs and verification

**20 issue records were repaired and retested**, including out-of-bounds Bucket fills, masks clipping scaled sources, nested alignment, malformed native files, feathered copies, painting after mask deletion, document-local Reselect, signed numeric input, tool-group memory, interrupted gestures, real color controls, menu disabled states, keyboard focus, popup bounds and shortcut isolation. [Reproduction/cause/fix ledger](issues.csv). No shared UI primitive or Lightroom source was changed by this audit.

- 63/63 image-engine tests pass, including seven new regressions that fail on the captured baseline. Valid legacy native fixture reserializes byte-identically.
- Whole-project and scoped image-editor TypeScript checks pass; production bundle succeeds. Full app regression: 147 pass, 0 fail, 3 pre-existing skipped (150 total). The initial PTY fixture failure was traced to a missing executable bit in the installed dependency and resolved in an isolated dependency copy; original dependencies remain untouched.
- All seven production acceptance suites pass: browser, stability, CS6 operations, presets, Smart Filters, blends, and handoff.
- 24 targeted UI assertions and two menu-isolation checks pass on this exact candidate.
- Full New → Place PNG → Selection → Mask → Brush mask → Adjustment → multiline Unicode Type → native Save → Reopen preserves editable state and the original fixture hash.
- Production menu traversal covers document/no-document menus and direct submenus; tested client sizes are 1440×900, 1920×1080, and 740×500. Additional 1152×720 and 720×450 checks emulate effective available space, **not actual browser zoom**.
- Real production shell launch/New Layer/Undo passes. Its runtime identity/Trash calls were aborted because no backend is served; these are recorded, not hidden.
- Independent psd-tools 1.10.9 decoding confirms four exported layer records, masks, brightness/contrast and editable Unicode text. Merged transparency uses white-matte encoding; integer quantization reaches 1.2588 visible channel levels in this fixture, so no lossless pixel-identity claim is made. [Independent reader evidence](evidence/independent-psd-alpha.json).
- Two independent runs of the Lightroom handoff preserve original checksums, exposure and returned derivative linkage on this build, using the versioned SDK filesystem fixture.

[Mandatory PS-01–PS-10 results](workflow-results.json) distinguish local passes from partial/unverified required scope. [Test logs and captures](evidence/) retain pre-fix failures and final results. Fault injection models quota exhaustion and unavailable AI service; it is not a successful real generation claim. No private originals were used.

## Remaining release blockers

- Matched authorized CS6 references and precise settings are missing. Modern menus/new-document styling and taskbar cannot be silently accepted as CS6 identity.
- Missing/partial scope remains, including Bézier editing, warp, required panels, advanced type/brush behavior, ICC/high-depth/CMYK/RAW/PSB, complete PSD semantics, native Smart Objects/filters and other enumerated families. Disabled controls are not waivers.
- Native/runtime filesystem acceptance, external Agent 1 signoff against this exact build, native platform shortcuts, real model generation, physical stylus/GPU loss and the unobserved state combinations remain unverified.
- Installed Chrome and bundled Chromium were exercised. The current Playwright WebKit/Firefox executables were absent; these attempts are UNVERIFIED. Actual browser zoom 125%/200% was not established.
- Repairs were copied back without conflicts. The primary workspace subsequently fails whole-project TypeScript in concurrently added spreadsheet/movie-maker/media files; that workspace is not the frozen tested build. See [primary workspace check](evidence/primary-workspace-typecheck.log). No spreadsheet/movie-maker/media source was modified.
- Three pre-existing runtime tests remain skipped by their existing conditions; full deployed Linux/container acceptance is separate from the local passing suite.

This is a repaired, tested candidate for continued work, **not an approved identical Photoshop release**. See [commands](reproduce.md) to reproduce the checks and [issues](issues.csv) for unresolved scope.
