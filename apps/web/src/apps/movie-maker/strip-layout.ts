import { timeline, framesToSeconds, type MovieProject, type MovieClip } from '../../../../../packages/movie-maker/src/model';
export interface StoryFragment { clip: MovieClip; index: number; start: number; end: number; localStart: number; localEnd: number; width: number; first: boolean; last: boolean }
/** A continuous sequence wraps at the edge of the workspace; long clips continue on the next row. */
export function storyboardRows(project: MovieProject, availableWidth: number, pixelsPerSecond: number): StoryFragment[][] {
  const width = Math.max(100, availableWidth); const rows: StoryFragment[][] = [[]]; let remaining = width;
  for (const { clip, index, start } of timeline(project)) {
    const totalWidth = Math.max(36, framesToSeconds(clip.duration, project.fps) * pixelsPerSecond); let used = 0;
    while (used < totalWidth - .01) {
      if (remaining < 24) { rows.push([]); remaining = width; }
      let take = Math.min(remaining, totalWidth - used);
      if (totalWidth - used - take > 0 && totalWidth - used - take < 24 && take > 48) take -= 24;
      const localStart = clip.duration * used / totalWidth, localEnd = clip.duration * (used + take) / totalWidth;
      rows.at(-1)!.push({ clip, index, start: start + localStart, end: start + localEnd, localStart, localEnd, width: take, first: used === 0, last: used + take >= totalWidth - .01 });
      used += take; remaining -= take;
    }
  }
  return rows.filter(row => row.length);
}
