# Image Editor workspace refinement

Verified in Chromium at 1440 × 900 and 780 × 550 CSS pixels, scale 1, using the layered Alpine study fixture. The [reference inventory](reference-inventory.md) records the Photoshop reference conditions. These captures demonstrate the implemented layout; they do not establish pixel equivalence to an authorized Photoshop installation.

The opaque editing workspace retains the compact desktop hierarchy: application menus, tool options, document tabs and rulers, left toolbar, panel rail, docked Color/Properties/Layers groups, and a document status strip. The refinement makes layer names and panel tabs more legible, exposes seven layer rows in the large fixture, reduces excess panel spacing, and fixes the clipped Rotation label. Adjustment controls use a compact icon grid with native tooltips and accessible names. Smart Filter controls and saved alpha channels have dedicated spacing and input sizing.

Floating menus, tool flyouts, contextual controls, floating panels, and dialog chrome now consume the canonical `--glass-*` material from `packages/ui/src/glass.css`. The editor explicitly requests a dark material tone. Canvas, panel content, and dialog reading surfaces remain opaque. No independent glass palette, blur, reflection, or shadow was added.

Short app windows initially use a two-column toolbar and reduce the upper panel heights. The toolbar toggle overrides this automatically chosen layout and preserves the user's choice after refresh. The single-column tool list scrolls while the foreground/background, Quick Mask, and Fit controls remain reachable. Tool flyouts render outside the scrolling list, work with long press or right-click, and support keyboard opening, arrow navigation, and Escape. At 780 × 550, Quick Mask ends at y = 457 and the layer footer ends at y = 548, both inside the window. The canvas retains its document view when the window size changes; the Fit command is available when a different view is desired.

Docked panel groups now have draggable horizontal dividers. The dock width divider and floating panel resize grip also support arrow keys (Shift increases the step). Dock width, group heights, and floating panel dimensions and position persist through refresh and named workspace saves. Pointer movement updates the layout directly; settings are written on release. Verification resized Color from 182 to 232 px, set the dock to 294 px, and moved/resized floating Properties to x = 210, y = 140, 364 × 360 px. All values were restored after refresh. A 480 × 400 containment check kept the floating panel and resize grip inside the smaller window.

High contrast, reduced transparency, and low effects were checked together. The menu resolves to an opaque `rgb(41, 42, 46)` surface, white edge/text, and `backdrop-filter: none`. Motion preference selectors also disable the busy spinner animation. Browser verification produced no page errors. Raw measurements are in [ui-verification.json](ui-verification.json).

The Local AI portrait and generative tabs were reviewed at 1440 × 900 and 780 × 550 without downloading a model. The reading/form body is opaque, and its children retain their natural height inside a scrolling region; this fixes a compressed Generate button in short windows. Header, navigation, and footer stay visible. Both tabs have no horizontal overflow, and Tab/Shift+Tab wrap within the dialog. Expanded generation settings and canvas expansion controls remain reachable. At the compact size, the New Document form also scrolls without horizontal overflow; naming and saving a preset worked, and the Create/Close footer remained visible. These checks exercise layout and focus, not AI inference quality.

Captures:

- [Workspace](screenshots/ui-refined-workspace.png)
- [Menu](screenshots/ui-refined-menu.png)
- [New Document dialog](screenshots/ui-refined-dialog.png)
- [Compact workspace](screenshots/ui-refined-compact.png)
- [Floating panel](screenshots/ui-refined-floating-panels.png)
- [Accessibility fallbacks](screenshots/ui-refined-accessible.png)
- [Local AI](screenshots/local-ai.png)
- [Compact Local AI generation controls](screenshots/local-ai-compact.png)
- [Compact New Document preset form](screenshots/new-document-compact.png)

Remaining visual differences include the independently drawn icons, browser font metrics, the modern preset-based New Document dialog, and the optional contextual task bar. The latter two are not a strict CS6 interface reproduction. The layout does not yet offer every Photoshop document arrangement or docking target.
