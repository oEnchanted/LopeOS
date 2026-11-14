import { useLayoutEffect, useRef, type RefObject } from 'react';

type RunningMotion = { node: HTMLElement; animation: Animation };
const rowsIn = (list: HTMLElement) => [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement && Boolean(node.dataset.cityKey));
const positionsIn = (list: HTMLElement) => new Map(rowsIn(list).map(node => [node.dataset.cityKey!, node.offsetTop]));

/** Move existing rows into their new positions without replacing or refocusing them. */
export function useCityReorderMotion(listRef: RefObject<HTMLElement | null>, keys: readonly string[], motion: boolean): void {
  const previous = useRef(new Map<string, number>());
  const running = useRef(new Map<string, RunningMotion>());
  const wasMoving = useRef(false);
  const signature = JSON.stringify(keys);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) { wasMoving.current = false; return; }
    const animateReorder = motion && wasMoving.current;
    wasMoving.current = motion;
    const rows = rowsIn(list);
    const visualTops = new Map<string, number>();
    // Capture the current translated position before cancelling an interrupted move.
    for (const [key, item] of running.current) if (item.node.isConnected) visualTops.set(key, item.node.getBoundingClientRect().top);
    for (const item of running.current.values()) item.animation.cancel();
    running.current.clear();
    const current = positionsIn(list);
    if (animateReorder) for (const node of rows) {
      const key = node.dataset.cityKey!;
      const oldTop = previous.current.get(key);
      if (oldTop === undefined || typeof node.animate !== 'function') continue;
      const interruptedOffset = visualTops.has(key) ? visualTops.get(key)! - node.getBoundingClientRect().top : 0;
      const distance = oldTop + interruptedOffset - current.get(key)!;
      if (Math.abs(distance) < 1) continue;
      const animation = node.animate([{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }], {
        duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)',
      });
      running.current.set(key, { node, animation });
      animation.onfinish = () => {
        if (running.current.get(key)?.animation === animation) running.current.delete(key);
      };
    }
    previous.current = current;
    // Closing presence may remove the list DOM while this hook stays mounted.
    // Do not keep a ResizeObserver attached to that detached list.
    if (!motion) return;

    // Keep the baseline current when edit controls, fonts or summary heights change.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { previous.current = positionsIn(list); });
    observer?.observe(list);
    for (const node of rows) observer?.observe(node);
    return () => observer?.disconnect();
  }, [signature, motion, listRef]);

  useLayoutEffect(() => () => {
    for (const item of running.current.values()) item.animation.cancel();
    running.current.clear();
  }, []);
}
