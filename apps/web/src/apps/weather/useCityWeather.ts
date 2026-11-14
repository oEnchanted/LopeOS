import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { WeatherLocation, WeatherUnits } from './provider';
import { weatherStore } from './store';

/** Mount only visible city cards; the sidebar owns its one optional refresh timer. */
export function useCityWeather(location: WeatherLocation, units: WeatherUnits, enabled = true) {
  const getSnapshot = useCallback(() => weatherStore.getCitySnapshot(location, units), [location, units]);
  useEffect(() => {
    if (enabled) void weatherStore.refreshCity(location, units);
  }, [location.latitude, location.longitude, location.name, location.country, location.timezone, units, enabled]);
  return useSyncExternalStore(weatherStore.subscribeCities, getSnapshot);
}
