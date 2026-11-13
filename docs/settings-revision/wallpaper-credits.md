# Wallpaper provenance

The project owner explicitly confirmed on November 12, 2026: “I have permission to bundle it.” This records the owner’s authorization to include PerfectHue artwork in LopeOS. It does not replace the creator’s license or claim a broader public redistribution license.

| LopeOS file | Original artwork | Original download | Creator |
|---|---|---|---|
| `public/wallpapers/perfecthue-aurora-light.png` | [Aurora Glass & Bubbles Light](https://perfecthue.com/wallpapers/aurora-glass-and-bubbles-light) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/jun152026-4.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-aurora-dark.png` | [Aurora Glass & Bubbles Dark](https://perfecthue.com/wallpapers/aurora-glass-and-bubbles-dark) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/jun152026-3.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-orange-wave-light.png` | [Orange Wave - Light](https://perfecthue.com/wallpapers/orange-wave-light) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/apr272026.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-orange-wave-dark.png` | [Orange Wave - Dark](https://perfecthue.com/wallpapers/orange-wave-dark) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/apr272026-3.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-sky-orbs-light.png` | [Sky Orbs - Day](https://perfecthue.com/wallpapers/sky-orbs-day) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/apr282026-4.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-sky-orbs-dark.png` | [Sky Orbs - Night](https://perfecthue.com/wallpapers/sky-orbs-night) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/apr282026-2.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-purple-aqua-waves-light.png` | [Purple Aqua Waves](https://perfecthue.com/wallpapers/purple-aqua-waves) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/may282026.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/perfecthue-purple-aqua-waves-dark.png` | [Purple Aqua Waves - Night](https://perfecthue.com/wallpapers/purple-aqua-waves-night) | [Desktop PNG, 3840×2160](https://perfecthue.com/stream/content/may282026-4.png) | Jason Benjamin / Perfect Hue |
| `public/wallpapers/tidal.svg` | Tidal / After hours | Original SVG bundled with LopeOS | LopeOS |

On November 13, 2026, the owner requested three additional light/dark pairs: Orange Wave, Sky Orbs, and Purple Aqua Waves. Sky Orbs Day/Night and Purple Aqua Waves/Night are labelled Light/Dark in the gallery for consistency.

PerfectHue PNGs are downloaded unchanged from the official work pages. Gallery previews under `public/wallpapers/previews/` are the creator’s unchanged 640×360 JPEG thumbnails from `https://perfecthue.com/stream/thumbs/`, using the corresponding original PNG filename with a `.jpg` extension. These previews keep the gallery lightweight while the desktop displays the original 4K PNG. The application serves these files locally; choosing a wallpaper does not call PerfectHue’s API or transmit a user identifier to the creator. Opening the attribution link visits the creator’s website normally.

The active approved PerfectHue image displays the exact lowercase **perfecthue** link to [the wallpaper collection](https://perfecthue.com/wallpapers/), below application windows and clear of the Dock. Settings links to the specific artwork. Original and uploaded images do not acquire a PerfectHue credit.

The typed preference defaults to `perfecthue-light`. `lope.migration.perfecthue.v1` performs a one-time replacement of the temporary `aurora`/`night` fallback; personal uploads and later deliberate choices are preserved. Tidal and After hours remain available in the gallery.
