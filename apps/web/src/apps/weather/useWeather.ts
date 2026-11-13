import { useEffect, useSyncExternalStore } from 'react';
import type { SettingsService } from '../../../../../packages/contracts/src';
import { DEFAULT_LOCATION, type WeatherLocation, type WeatherUnits } from './provider';
import { weatherStore } from './store';

export function useWeather(settings: SettingsService) {
  const location = useSyncExternalStore(settings.subscribe.bind(settings), () => settings.get<WeatherLocation>('weather.location', DEFAULT_LOCATION));
  const units = useSyncExternalStore(settings.subscribe.bind(settings), () => settings.get<WeatherUnits>('weather.units', 'celsius'));
  useEffect(() => { weatherStore.configure(location, units); }, [location, units]);
  const autoRefresh = useSyncExternalStore(settings.subscribe.bind(settings), () => settings.get('weatherAutoRefresh', true));
  useEffect(() => weatherStore.setAutoRefresh(autoRefresh), [autoRefresh]);
  useEffect(weatherStore.retain, []);
  return useSyncExternalStore(weatherStore.subscribe, weatherStore.getSnapshot);
}
