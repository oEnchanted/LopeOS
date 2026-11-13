import type { Bounds } from '../../../../packages/contracts/src';
import { desktopArea } from './appearance';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const visibleWidth = 120;
const visibleHeight = 128; // Together with the desktop's bottom inset, keep 140px on screen.

/** Keep enough of a floating window visible to retrieve it, without reserving Dock space. */
export function constrainBounds(bounds: Bounds): Bounds {
  const area = desktopArea();
  const width = clamp(bounds.width, 240, area.width);
  const height = clamp(bounds.height, 180, area.height);
  return {
    x: clamp(bounds.x, area.x + visibleWidth - width, area.x + area.width - visibleWidth),
    y: clamp(bounds.y, area.y, area.y + area.height - visibleHeight),
    width, height,
  };
}

/** Resize only the requested edges, leaving their opposite edges anchored. */
export function resizeBounds(bounds: Bounds, edge: string, dx: number, dy: number, min: { width: number; height: number }): Bounds {
  const area = desktopArea();
  const minWidth = Math.min(min.width, area.width), minHeight = Math.min(min.height, area.height);
  let { x, y, width, height } = bounds;
  const right = x + width, bottom = y + height;
  // If a window already extends off screen, resizing another edge must not pull it back in.
  if (edge.includes('w')) {
    const maxWidth = Math.max(width, Math.min(area.width, right - area.x));
    const reachableWidth = right - (area.x + area.width - visibleWidth);
    width = clamp(width - dx, Math.min(Math.max(minWidth, reachableWidth), maxWidth), maxWidth);
    x = right - width;
  } else if (edge.includes('e')) {
    const maxWidth = Math.max(width, Math.min(area.width, area.x + area.width - x));
    const reachableWidth = area.x + visibleWidth - x;
    width = clamp(width + dx, Math.min(Math.max(minWidth, reachableWidth), maxWidth), maxWidth);
  }
  if (edge.includes('n')) {
    const maxHeight = Math.max(height, Math.min(area.height, bottom - area.y));
    const reachableHeight = bottom - (area.y + area.height - visibleHeight);
    height = clamp(height - dy, Math.min(Math.max(minHeight, reachableHeight), maxHeight), maxHeight);
    y = bottom - height;
  } else if (edge.includes('s')) {
    const maxHeight = Math.max(height, Math.min(area.height, area.y + area.height - y));
    height = clamp(height + dy, Math.min(minHeight, maxHeight), maxHeight);
  }
  return { x, y, width, height };
}
