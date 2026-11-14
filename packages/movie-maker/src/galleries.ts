/** Named presets for the Movie Maker-style ribbon. All entries have real render decisions. */
export const transitionPresets = [
  { id: 'none', label: 'None', group: 'None' },
  { id: 'dissolve', label: 'Crossfade', group: 'Dissolves' }, { id: 'fade', label: 'Fade through black', group: 'Dissolves' }, { id: 'fade-white', label: 'Fade through white', group: 'Dissolves' },
  { id: 'wipe-left', label: 'Wipe left', group: 'Wipes' }, { id: 'wipe-right', label: 'Wipe right', group: 'Wipes' }, { id: 'wipe-up', label: 'Wipe up', group: 'Wipes' }, { id: 'wipe-down', label: 'Wipe down', group: 'Wipes' },
  { id: 'wipe-diagonal-left', label: 'Diagonal wipe left', group: 'Diagonals' }, { id: 'wipe-diagonal-right', label: 'Diagonal wipe right', group: 'Diagonals' },
  { id: 'slide-left', label: 'Slide left', group: 'Slides' }, { id: 'slide-right', label: 'Slide right', group: 'Slides' }, { id: 'slide-up', label: 'Slide up', group: 'Slides' }, { id: 'slide-down', label: 'Slide down', group: 'Slides' },
  { id: 'iris', label: 'Circle reveal', group: 'Shapes' }, { id: 'diamond', label: 'Diamond reveal', group: 'Shapes' }, { id: 'barn-door', label: 'Open doors', group: 'Reveals' },
  { id: 'blinds-horizontal', label: 'Horizontal blinds', group: 'Patterns' }, { id: 'blinds-vertical', label: 'Vertical blinds', group: 'Patterns' },
  { id: 'checkerboard', label: 'Checkerboard', group: 'Patterns' }, { id: 'pixelate', label: 'Pixel dissolve', group: 'Patterns' },
] as const;
export type TransitionKind = typeof transitionPresets[number]['id'];
export const effectPresets = [
  { id: 'none', label: 'No effect', group: 'None' }, { id: 'grayscale', label: 'Black and white', group: 'Black and white' },
  { id: 'blackwhite-orange', label: 'Black and white · orange', group: 'Black and white' }, { id: 'blackwhite-red', label: 'Black and white · red', group: 'Black and white' }, { id: 'blackwhite-yellow', label: 'Black and white · yellow', group: 'Black and white' },
  { id: 'sepia', label: 'Sepia tone', group: 'Color' }, { id: 'cyan', label: 'Cyan tone', group: 'Color' }, { id: 'warm', label: 'Warm', group: 'Color' }, { id: 'cool', label: 'Cool', group: 'Color' }, { id: 'contrast', label: 'Contrast', group: 'Color' }, { id: 'vintage', label: 'Vintage', group: 'Color' }, { id: 'hue-cycle', label: 'Hue cycle', group: 'Color' },
  { id: 'blur', label: 'Blur', group: 'Artistic' }, { id: 'pixelate', label: 'Pixelate', group: 'Artistic' }, { id: 'negative', label: 'Negative', group: 'Artistic' }, { id: 'posterize', label: 'Posterize', group: 'Artistic' }, { id: 'threshold', label: 'Threshold', group: 'Artistic' }, { id: 'edge', label: 'Edge detection', group: 'Artistic' },
  { id: 'mirror-horizontal', label: 'Mirror horizontal', group: 'Mirror' }, { id: 'mirror-vertical', label: 'Mirror vertical', group: 'Mirror' },
  { id: 'fade-in-black', label: 'Fade in from black', group: 'Fades' }, { id: 'fade-out-black', label: 'Fade out to black', group: 'Fades' }, { id: 'fade-in-white', label: 'Fade in from white', group: 'Fades' }, { id: 'fade-out-white', label: 'Fade out to white', group: 'Fades' },
] as const;
export type Effect = typeof effectPresets[number]['id'];
export const panZoomPresets = [
  { id: 'none', label: 'None', group: 'None' },
  { id: 'left', label: 'Pan left', group: 'Pan' }, { id: 'right', label: 'Pan right', group: 'Pan' }, { id: 'up', label: 'Pan up', group: 'Pan' }, { id: 'down', label: 'Pan down', group: 'Pan' },
  { id: 'up-left', label: 'Pan up left', group: 'Pan' }, { id: 'up-right', label: 'Pan up right', group: 'Pan' }, { id: 'down-left', label: 'Pan down left', group: 'Pan' }, { id: 'down-right', label: 'Pan down right', group: 'Pan' },
  { id: 'in', label: 'Zoom in center', group: 'Zoom in' }, { id: 'in-top', label: 'Zoom in top', group: 'Zoom in' }, { id: 'in-bottom', label: 'Zoom in bottom', group: 'Zoom in' }, { id: 'in-left', label: 'Zoom in left', group: 'Zoom in' }, { id: 'in-right', label: 'Zoom in right', group: 'Zoom in' },
  { id: 'in-top-left', label: 'Zoom in top left', group: 'Zoom in' }, { id: 'in-top-right', label: 'Zoom in top right', group: 'Zoom in' }, { id: 'in-bottom-left', label: 'Zoom in bottom left', group: 'Zoom in' }, { id: 'in-bottom-right', label: 'Zoom in bottom right', group: 'Zoom in' },
  { id: 'out', label: 'Zoom out center', group: 'Zoom out' }, { id: 'out-top', label: 'Zoom out top', group: 'Zoom out' }, { id: 'out-bottom', label: 'Zoom out bottom', group: 'Zoom out' }, { id: 'out-left', label: 'Zoom out left', group: 'Zoom out' }, { id: 'out-right', label: 'Zoom out right', group: 'Zoom out' },
  { id: 'out-top-left', label: 'Zoom out top left', group: 'Zoom out' }, { id: 'out-top-right', label: 'Zoom out top right', group: 'Zoom out' }, { id: 'out-bottom-left', label: 'Zoom out bottom left', group: 'Zoom out' }, { id: 'out-bottom-right', label: 'Zoom out bottom right', group: 'Zoom out' },
] as const;
export type PanZoom = typeof panZoomPresets[number]['id'];
export const textAnimationPresets = [
  { id: 'none', label: 'None', group: 'Simple' }, { id: 'fade', label: 'Fade', group: 'Simple' }, { id: 'rise', label: 'Rise', group: 'Simple' }, { id: 'scroll', label: 'Scroll', group: 'Credits' },
  { id: 'zoom', label: 'Zoom', group: 'Cinematic' }, { id: 'stretch', label: 'Stretch', group: 'Cinematic' }, { id: 'slide-left', label: 'Slide from left', group: 'Contemporary' }, { id: 'slide-right', label: 'Slide from right', group: 'Contemporary' }, { id: 'fly', label: 'Fly in', group: 'Contemporary' }, { id: 'spin', label: 'Spin in', group: 'Contemporary' },
] as const;
export type TextAnimation = typeof textAnimationPresets[number]['id'];
export const themePresets = [
  { id: 'simple', label: 'Default', group: 'AutoMovie themes' }, { id: 'contemporary', label: 'Contemporary', group: 'AutoMovie themes' }, { id: 'cinematic', label: 'Cinematic', group: 'AutoMovie themes' }, { id: 'fade', label: 'Fade', group: 'AutoMovie themes' }, { id: 'pan-zoom', label: 'Pan and zoom', group: 'AutoMovie themes' }, { id: 'black-white', label: 'Black and white', group: 'AutoMovie themes' }, { id: 'sepia', label: 'Sepia', group: 'AutoMovie themes' }, { id: 'travel', label: 'Journey', group: 'LopeOS themes' },
] as const;
export type AutoMovieTheme = typeof themePresets[number]['id'];
