import { useEffect, useState, type RefObject } from 'react';
import type { SettingsService } from '../../../../../packages/contracts/src';

/** Animate only while this Weather window is visible and motion is permitted. */
export function useWeatherMotion(rootRef: RefObject<HTMLElement | null>, settings: SettingsService): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    let disposed = false;
    let frame = 0;
    let intersecting = false;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const ancestors: HTMLElement[] = [];
    for (let node: HTMLElement | null = element; node; node = node.parentElement) ancestors.push(node);

    const visible = () => {
      if (!element.isConnected || !element.getClientRects().length) return false;
      // IntersectionObserver alone does not notice visibility:hidden on compact,
      // unfocused windows. Ancestor checks also cover minimized/fullscreen wrappers.
      return ancestors.every(node => {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
          && style.contentVisibility !== 'hidden' && Number(style.opacity) !== 0;
      });
    };
    const evaluate = () => {
      if (disposed) return;
      const allowed = !settings.get<boolean>('reduceMotion', false)
        && settings.get<string>('effectsQuality', 'high') !== 'low'
        && !media.matches && !document.hidden;
      if (!allowed) { setActive(false); return; }
      const bounds = element.getBoundingClientRect();
      const inViewport = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0
        && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
      setActive(intersecting && inViewport && visible());
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; evaluate(); }); };
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio > 0);
      evaluate();
    });
    if (intersection) intersection.observe(element);
    else intersecting = true; // The viewport bounds check remains available without IO.

    const mutations = new MutationObserver(schedule);
    for (const node of ancestors) mutations.observe(node, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'data-compact', 'data-window-fullscreen'],
    });
    const windowFrame = element.closest('.os-window') || element;
    const unsubscribe = settings.subscribe(evaluate);
    media.addEventListener('change', evaluate);
    document.addEventListener('visibilitychange', evaluate);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    // A window's entry fade may initially have zero opacity without later DOM mutations.
    windowFrame.addEventListener('animationend', schedule);
    windowFrame.addEventListener('transitionend', schedule);
    evaluate();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      intersection?.disconnect();
      mutations.disconnect();
      unsubscribe();
      media.removeEventListener('change', evaluate);
      document.removeEventListener('visibilitychange', evaluate);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      windowFrame.removeEventListener('animationend', schedule);
      windowFrame.removeEventListener('transitionend', schedule);
    };
  }, [rootRef, settings]);
  return active;
}
