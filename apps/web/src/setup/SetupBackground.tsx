import { useEffect, useState } from 'react';
import type { DesktopBackground } from '../shell/background';
import { isPerfectHue } from '../apps/settings/wallpaper-policy';
import './setup-background.css';

export function SetupBackground({ background, reduceMotion }: { background: DesktopBackground; reduceMotion: boolean }) {
  const [displayed, setDisplayed] = useState(background);
  const [incoming, setIncoming] = useState<DesktopBackground | null>(null);
  const [systemReduceMotion, setSystemReduceMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const motionDisabled = reduceMotion || systemReduceMotion;

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduceMotion(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    // Complete an active fade before considering the latest selection. Replacing
    // a partially visible layer would otherwise cause a flash during fast clicks.
    if (incoming || displayed.id === background.id && displayed.backgroundImage === background.backgroundImage) return;
    let cancelled = false;
    async function prepare() {
      if (background.wallpaper) {
        const image = new Image();
        image.src = background.wallpaper.asset;
        try { await image.decode(); }
        catch { return; } // Keep the previous image visible if this asset fails.
      }
      if (cancelled) return;
      if (motionDisabled) setDisplayed(background);
      else setIncoming(background);
    }
    void prepare();
    return () => { cancelled = true; };
  }, [background.id, background.backgroundImage, background.wallpaper?.asset, displayed.id, displayed.backgroundImage, incoming, motionDisabled]);

  function finishTransition() {
    if (incoming) { setDisplayed(incoming); setIncoming(null); }
  }

  useEffect(() => {
    if (!incoming) return;
    if (motionDisabled) { setDisplayed(incoming); setIncoming(null); return; }
    // Also finish if the tab is backgrounded or animation events are suppressed.
    const timeout = window.setTimeout(() => { setDisplayed(incoming); setIncoming(null); }, 500);
    return () => window.clearTimeout(timeout);
  }, [incoming, motionDisabled]);

  return <>
    <div className={'setup-background wallpaper--' + displayed.id} style={{ backgroundImage: displayed.backgroundImage }} aria-hidden="true"/>
    {incoming && <div className={'setup-background setup-background--incoming wallpaper--' + incoming.id} style={{ backgroundImage: incoming.backgroundImage }} onAnimationEnd={finishTransition} aria-hidden="true"/>}
    {(displayed.wallpaper && isPerfectHue(displayed.wallpaper) || incoming?.wallpaper && isPerfectHue(incoming.wallpaper)) && <a className="setup-credit" href="https://perfecthue.com/wallpapers/" target="_blank" rel="noreferrer">Wallpaper by Perfect Hue</a>}
  </>;
}
