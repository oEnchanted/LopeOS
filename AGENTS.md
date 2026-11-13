# LopeOS UI conventions

Control Center's glass is the OS-wide design standard. Read `docs/design-system.md` when changing UI materials.

- Use `packages/ui/src/glass.css` as the single source for glass colors, blur, reflections, edges, shadows, and accessibility fallbacks. It is loaded by the shared UI stylesheet.
- Use `.glass` for floating surfaces and `.glass-inset` for tiles or navigation inside glass, or consume their `--glass-*` tokens. Do not introduce separate glass recipes in applications or shell components.
- Keep geometry and interaction styling component-specific. Use `data-glass-tone="light"` or `"dark"` only when a surface deliberately needs its own tone.
- Keep document pages, editing canvases, web content, terminal output, and other reading surfaces opaque. Modal dimming scrims are separate from the glass material.
- Preserve reduced-transparency, increased-contrast, low-effects, and reduced-motion preferences. Nested glass does not need another backdrop blur.
