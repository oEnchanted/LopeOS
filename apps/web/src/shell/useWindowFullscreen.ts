import { useCallback, useEffect, useState } from 'react';

/** Keep full screen transient so a window retains its bounds and maximized state. */
export function useWindowFullscreen(activeWindowId: string | undefined) {
  const [windowId, setWindowId] = useState<string | null>(null);
  const exit = useCallback(() => setWindowId(null), []);
  const toggle = useCallback((id: string) => setWindowId(current => current === id ? null : id), []);

  useEffect(() => {
    if (windowId && windowId !== activeWindowId) exit();
  }, [activeWindowId, windowId, exit]);

  return { fullscreenWindowId: windowId === activeWindowId ? windowId : null, toggleFullscreen: toggle, exitFullscreen: exit };
}
