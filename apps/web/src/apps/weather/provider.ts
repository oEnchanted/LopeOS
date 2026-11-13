export interface WeatherLocation { name: string; latitude: number; longitude: number; country?: string; timezone?: string }
export type WeatherUnits = 'celsius' | 'fahrenheit';
export interface HourlyWeather { time: string; temperature: number; code: number; isDay: boolean; precipitation?: number }
export interface WeatherData {
  location: WeatherLocation; units: WeatherUnits; fetchedAt: number; time: string;
  temperature: number; feelsLike: number; humidity: number; wind: number; code: number; isDay: boolean;
  windDirection?: number; windGusts?: number; visibility?: number; uvIndex?: number;
  sunrise?: string; sunset?: string; hourly?: HourlyWeather[];
  forecast: { date: string; low: number; high: number; code: number; precipitation: number }[];
}
export interface WeatherProvider {
  forecast(location: WeatherLocation, units: WeatherUnits): Promise<WeatherData>;
  search(query: string, signal?: AbortSignal): Promise<WeatherLocation[]>;
}
export const WEATHER_ATTRIBUTION = { label: 'Weather data by Open-Meteo', url: 'https://open-meteo.com/', license: 'https://creativecommons.org/licenses/by/4.0/', geocoding: 'https://www.geonames.org/' };
export const DEFAULT_LOCATION: WeatherLocation = { name: 'Denver', latitude: 39.7392, longitude: -104.9903, country: 'United States', timezone: 'America/Denver' };
export function validLocation(location: WeatherLocation): boolean {
  return Boolean(location && typeof location.name === 'string' && location.name.trim() && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180);
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('The weather provider returned incomplete data.');
  return value;
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function localTime(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) ? value : undefined;
}
export function parseForecast(raw: any, location: WeatherLocation, units: WeatherUnits, now = Date.now()): WeatherData {
  const current = raw?.current; const daily = raw?.daily;
  if (!current || typeof current.time !== 'string' || !daily || !Array.isArray(daily.time) || !daily.time.length) throw new Error('The weather provider returned incomplete data.');
  // Provider timestamps share the location's local time. Compare those strings
  // directly so the browser's timezone cannot shift the forecast into yesterday.
  const currentHour = current.time.slice(0, 13) + ':00';
  const hourly: HourlyWeather[] = [];
  if (Array.isArray(raw.hourly?.time)) {
    raw.hourly.time.forEach((value: unknown, index: number) => {
      const time = localTime(value);
      const temperature = optionalNumber(raw.hourly.temperature_2m?.[index]);
      const code = optionalNumber(raw.hourly.weather_code?.[index]);
      const isDay = raw.hourly.is_day?.[index];
      if (!time || time < currentHour || temperature === undefined || code === undefined || (isDay !== 0 && isDay !== 1)) return;
      hourly.push({ time, temperature, code, isDay: isDay === 1, precipitation: optionalNumber(raw.hourly.precipitation_probability?.[index]) });
    });
  }
  return {
    location, units, fetchedAt: now, time: current.time,
    temperature: number(current.temperature_2m), feelsLike: number(current.apparent_temperature),
    humidity: number(current.relative_humidity_2m), wind: number(current.wind_speed_10m),
    code: number(current.weather_code), isDay: current.is_day === 1,
    windDirection: optionalNumber(current.wind_direction_10m), windGusts: optionalNumber(current.wind_gusts_10m),
    // Visibility is always returned in meters, independent of temperature units.
    visibility: optionalNumber(current.visibility), uvIndex: optionalNumber(current.uv_index),
    sunrise: localTime(daily.sunrise?.[0]), sunset: localTime(daily.sunset?.[0]),
    hourly: hourly.length ? hourly.slice(0, 24) : undefined,
    forecast: daily.time.slice(0, 10).map((date: string, index: number) => {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The weather provider returned an invalid date.');
      return { date, low: number(daily.temperature_2m_min?.[index]), high: number(daily.temperature_2m_max?.[index]), code: number(daily.weather_code?.[index]), precipitation: number(daily.precipitation_probability_max?.[index]) };
    }),
  };
}

/** Public endpoints are for noncommercial deployments. Commercial adapters must proxy a licensed plan; never put an API key in the browser. */
export function createOpenMeteoProvider(options: { forecastEndpoint?: string; geocodingEndpoint?: string; fetcher?: typeof fetch } = {}): WeatherProvider {
  const fetcher = options.fetcher || globalThis.fetch.bind(globalThis);
  async function request(url: URL, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'omit' });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Weather requests are temporarily limited. Please try again in a few minutes.');
      throw new Error('The weather provider is unavailable. Try again later.');
    }
    const data = await response.json();
    if (data?.error) throw new Error('The weather provider could not process this location.');
    return data;
  }
  return {
    async forecast(location, units) {
      if (!validLocation(location)) throw new Error('Select a valid weather location.');
      const url = new URL(options.forecastEndpoint || 'https://api.open-meteo.com/v1/forecast', globalThis.location?.origin || 'http://localhost');
      url.search = new URLSearchParams({
        latitude: String(location.latitude), longitude: String(location.longitude),
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index',
        hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
        forecast_days: '10', forecast_hours: '24', timezone: 'auto', temperature_unit: units,
        wind_speed_unit: units === 'fahrenheit' ? 'mph' : 'kmh',
      }).toString();
      return parseForecast(await request(url), location, units);
    },
    async search(query, signal) {
      if (query.trim().length < 2) return [];
      const url = new URL(options.geocodingEndpoint || 'https://geocoding-api.open-meteo.com/v1/search', globalThis.location?.origin || 'http://localhost');
      url.search = new URLSearchParams({ name: query.trim().slice(0, 120), count: '6', language: 'en', format: 'json' }).toString();
      const raw = await request(url, signal);
      return (raw.results || []).map((place: any) => ({ name: [place.name, place.admin1].filter(Boolean).join(', '), latitude: place.latitude, longitude: place.longitude, country: place.country, timezone: place.timezone })).filter(validLocation);
    },
  };
}

export function weatherDescription(code: number): string {
  const codes: Record<number, string> = { 0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms with hail', 97: 'Heavy thunderstorms', 99: 'Thunderstorms with hail' };
  return codes[code] || 'Conditions unavailable';
}
export function weatherSymbol(code: number, isDay = true): string {
  if (code < 2) return isDay ? '☀' : '☾';
  if (code < 4) return '☁';
  if (code >= 95) return 'ϟ';
  if ((code >= 71 && code <= 77) || code >= 85) return '❄';
  if (code >= 51) return '☂';
  return '≋';
}
