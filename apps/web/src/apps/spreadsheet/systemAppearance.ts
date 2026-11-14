import { useEffect, useState } from 'react';
import { usePreferences as useSystemPreferences } from '../../../../../packages/sdk/src/preferences';

/** Use the same preference store and system fallback as the LopeOS desktop. */
export function useSystemAppearance() {
  const settings = useSystemPreferences();
  const [deviceDark, setDeviceDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setDeviceDark(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return { theme: settings.theme === 'system' ? deviceDark ? 'dark' : 'light' : settings.theme, reduceMotion: settings.reduceMotion, increaseContrast: settings.increaseContrast, textScale: settings.textSize / 100 };
}
