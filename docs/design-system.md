# LopeOS visual system

The desktop uses the authorized PerfectHue Aurora Glass & Bubbles wallpaper, an angular Lope mark, neutral reading surfaces, and distinct original application icons. Lucide symbols are reserved for interface controls. The system font stack follows the device. A light workspace is the default; dark, system appearance, reduced transparency, increased contrast, and reduced motion are supported.

## Materials

Control Center's glass is the standard material everywhere LopeOS uses glass. The single source is [`packages/ui/src/glass.css`](../packages/ui/src/glass.css), loaded automatically by the shared UI stylesheet. Use this material for the Dock, menu bar, menus, popovers, notifications, window frames, navigation chrome, dialogs, Spotlight, setup/sign-in panels, Weather cards, and appearance previews. Components own their size, padding, and corner geometry; they must not introduce independent glass colors, reflections, blur, or shadow recipes.

The material combines a translucent neutral tint, a directional reflection, a bright rim, a soft raised shadow, and 34px backdrop blur with 1.65 saturation. Light and dark tones come from the same shared palette. The glass clarity preference adjusts tint opacity; menu-bar strength adjusts the continuous bar's opacity. Balanced effects use 20px blur and 1.4 saturation. Low effects, reduced transparency, increased contrast, and unsupported backdrop filtering use opaque, legible fills. Strong contrast also strengthens edges and text. These fallbacks apply inside explicitly themed previews and apps as well as the desktop.

| Use | Shared API |
| --- | --- |
| Floating glass surface | `.glass`, or `--glass-background`, `--glass-border`, `--glass-shadow`, `--glass-filter` |
| Tile/navigation inside glass | `.glass-inset`, or `--glass-inset-background`, `--glass-inset-border`, `--glass-inset-shadow` |
| Foreground | `--glass-text`, `--glass-muted` |
| Icon/control surface | `--glass-icon-background`, `--glass-icon-ink`, `--glass-track`, `--glass-fill` |
| Interaction | `--glass-hover`, `--glass-active` |
| Explicit material tone | `data-glass-tone="light"` or `data-glass-tone="dark"`; otherwise inherit OS appearance |

Use one backdrop filter at the outer glass surface. Nested tiles and navigation use the inset material without another blur. Text and icons remain sharp: never blur or distort the content itself. Decorative layers are independent and use `pointer-events: none`. No continuous decorative animation is part of the material.

```tsx
<section className="glass my-popover">
  <h2>Quick actions</h2>
  <button className="glass-inset">Open workspace</button>
</section>
```

[`shell/glass-surfaces.css`](../apps/web/src/shell/glass-surfaces.css) adapts existing shell surfaces and maps the legacy `--window-material` / `--floating-material` tokens to outer glass, and `--chrome-material` / `--sidebar-material` to inset glass. Control Center consumes these same tokens. App-specific CSS must use the shared API so later material changes propagate automatically.

Opaque reading surfaces (`--surface`, `--content-material`, and `--row-material`), document pages, editing canvases, web content, and terminal output retain their content treatment. Modal scrims are scene dimming/blur, not glass panels. A palette-specific app such as Weather or Terminal can opt into a dark material tone while still honoring accessibility preferences.

## Geometry and motion

The desktop menu bar is 30px high (33px on compact screens); title bars are 39px; default Dock icons are 52px with 12px bottom clearance. System utility windows have 16px corners; creative applications retain their frame geometry and use the shared outer glass material. Dragging updates transforms on animation frames and commits geometry to React on release. The Dock uses bounded CSS scale and vertical movement; magnification can be disabled. Running applications have a dot, and the active application's indicator widens to a small pill. Motion preferences remove transitions and magnification.

Floating windows can extend behind the Dock and partly beyond the viewport, with enough of their title bar kept visible to retrieve them. Drag previews, committed positions, keyboard movement, and restored layouts use the same bounds. Resizing keeps the opposite edge anchored. Maximized and edge-tiled windows reserve Dock space; changing Dock settings does not reposition floating windows. The window manager switches to one visible focused window below 700px. Minimized app components stay mounted to preserve their state. Layout, theme, and Dock settings persist locally.

The green window control enters full screen within LopeOS, filling the desktop and hiding the Dock and menu bar. The green control or Escape restores the previous window geometry and maximized state. Move to the top edge to reveal the menu bar, whose separate browser full-screen button controls browser full screen independently. Window full screen is transient; closing, minimizing, or switching away from the window returns to the desktop. Title-bar double-click, top-edge snapping, and Window → Maximize retain their Dock-aware behavior.

Dock clicks focus or restore the most recent window of an open app. Its context menu lists windows and offers pinning, New Window for supported apps, and Quit with the app’s unsaved-change guard. Pinned apps retain their order and can be reordered by dragging. Downloads opens a newest-first workspace file stack; Trash accepts dragged Files selections and opens a recoverable view with Put Back and confirmed permanent deletion. Both utilities use the Files access preference. Dock menus and stacks use the shared glass, remain within the viewport, and support keyboard dismissal with focus restored to their trigger.

## Shared controls

`packages/ui/src/index.tsx` provides Button, Input, Select, Toolbar, Sidebar, Tabs, ListRow, Popover, Dialog, Tooltip, and EmptyState. Shell frames, global menus, notifications, and file dialogs reuse the same tokens. Dialogs trap focus, restore the previous focus, and dismiss on Escape. Menus support arrow keys, Home/End, Escape, and return to their trigger.

Use application-scoped CSS. Avoid resetting global elements or adding another font stack. Keep body content opaque and readable, use chrome for navigation, and reserve the stronger material for floating controls. Shared application controls inherit theme tokens. Writer, Lightroom, and Image Editor keep their opaque internal UI; their outer shell frames use the standard glass. Purposefully opaque content dialogs retain their solid treatment. Browser chrome, Files, Text Editor, Calculator, Weather, and Terminal use scoped styles; website content and terminal rendering keep their own colors.

Settings uses a searchable frosted sidebar, visible category headings, consistently spaced grouped rows, browser-scoped persistence status, actual wallpaper previews, and right-aligned controls. Its consolidated `settings.css` owns the Settings visual system, including narrow-window navigation, larger text, contrast and transparency preferences. Reusable Settings components live in `packages/ui/src/settings.tsx`. The clarity slider changes chrome translucency; content surfaces remain stable. Custom SVG app icons use one light model with separate folder, document, compass, gear, and application silhouettes. Icon variants and folder colors are rendered through scoped SVG styles.

Application artwork in [`shell/Icons.tsx`](../apps/web/src/shell/Icons.tsx) uses a 64px grid, restrained color gradients, and simple, recognizable shapes. Keep details legible at 23px preview and 39–52px Dock sizes: use meaningful symbols instead of miniature labels, stacked illustrations, or decorative hardware. Shadows and rims stay subtle. Dark, clear, and tinted finishes preserve the symbols; clear icons use shared glass colors and become opaque with reduced transparency, increased contrast, or low effects. See the [application icon sheet](screenshots/system-icons-refined.png).

## Sources and licensing

The interaction structure follows [W3C's menu pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/); material separation is informed by [Apple's materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) and [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/). LopeOS code, marks, application icons, and Tidal wallpaper are original work. The project owner confirmed PerfectHue bundling permission; original assets and attribution are recorded in [wallpaper credits](settings-revision/wallpaper-credits.md).

The current refinement captures show the [light desktop](screenshots/desktop-refined-light.png), [dark Control Center](screenshots/desktop-refined-dark.png), and Settings in [light](screenshots/settings-refined-light.png) and [dark](screenshots/settings-refined-dark.png) appearance. Earlier before/after screenshots and measured conditions remain in [the Settings revision report](settings-revision/verification.md). Headless animation-frame timings are an automation measurement, not a guarantee about a physical display's refresh rate or every user's GPU.
