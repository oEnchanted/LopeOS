import { useEffect } from 'react';
import type { SharedServices } from '../../../../../packages/contracts/src';
import { weatherSymbol } from './provider';
import { useWeather } from './useWeather';

/** Mount once in Shell; the app and widget share one provider, cache, and location. */
export function WeatherStatusBridge({ services }: { services: SharedServices }) {
  const state = useWeather(services.settings);
  useEffect(() => services.statusItems.register({
    id: 'lope.weather',
    label: state.data ? `${weatherSymbol(state.data.code, state.data.isDay)} ${Math.round(state.data.temperature)}°${state.units === 'celsius' ? 'C' : 'F'}${state.status === 'offline' || state.status === 'error' ? ' · cached' : ''}` : state.status === 'loading' ? 'Weather…' : 'Weather unavailable',
    onClick: () => services.launch('lope.weather'),
  }), [state, services]);
  return null;
}
