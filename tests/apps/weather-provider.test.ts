import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenMeteoProvider, DEFAULT_LOCATION, parseForecast } from '../../apps/web/src/apps/weather/provider.ts';

function forecast() {
  const days = Array.from({ length: 11 }, (_, index) => `2026-11-${String(13 + index).padStart(2, '0')}`);
  return {
    current: { time: '2026-11-13T00:15', temperature_2m: 12, apparent_temperature: 10, relative_humidity_2m: 45, wind_speed_10m: 8, weather_code: 2, is_day: 0 },
    daily: { time: days, temperature_2m_min: days.map(() => 4), temperature_2m_max: days.map(() => 17), weather_code: days.map(() => 2), precipitation_probability_max: days.map(() => 10) },
  };
}

test('weather keeps the current local hour and next 23 hours without using the browser timezone', () => {
  const hours = ['2026-11-12T23:00', ...Array.from({ length: 24 }, (_, hour) => `2026-11-13T${String(hour).padStart(2, '0')}:00`), '2026-11-14T00:00'];
  const raw = { ...forecast(), hourly: {
    time: hours,
    temperature_2m: hours.map((_, index) => index),
    weather_code: hours.map(() => 2),
    is_day: hours.map((_, index) => index >= 8 && index < 18 ? 1 : 0),
    precipitation_probability: hours.map(() => 0),
  } };
  const data = parseForecast(raw, DEFAULT_LOCATION, 'celsius', 123);
  assert.equal(data.forecast.length, 10);
  assert.equal(data.hourly?.length, 24);
  assert.deepEqual(data.hourly?.[0], { time: '2026-11-13T00:00', temperature: 1, code: 2, isDay: false, precipitation: 0 });
  assert.equal(data.hourly?.at(-1)?.time, '2026-11-13T23:00');
  assert.equal(data.fetchedAt, 123);
});

test('optional weather details tolerate unavailable values and preserve valid zeroes', () => {
  const legacy = parseForecast(forecast(), DEFAULT_LOCATION, 'celsius');
  assert.equal(legacy.hourly, undefined);
  assert.equal(legacy.visibility, undefined);
  const raw = forecast();
  const data = parseForecast({
    ...raw,
    current: { ...raw.current, wind_direction_10m: 0, wind_gusts_10m: 0, visibility: null, uv_index: 0 },
    daily: { ...raw.daily, sunrise: ['2026-11-13T06:42'], sunset: [null] },
    hourly: { time: ['2026-11-13T00:00', 'invalid'], temperature_2m: [null, 10], weather_code: [2, 2], is_day: [0, 0] },
  }, DEFAULT_LOCATION, 'celsius');
  assert.equal(data.windDirection, 0);
  assert.equal(data.windGusts, 0);
  assert.equal(data.uvIndex, 0);
  assert.equal(data.visibility, undefined);
  assert.equal(data.sunrise, '2026-11-13T06:42');
  assert.equal(data.sunset, undefined);
  assert.equal(data.hourly, undefined);
  assert.throws(() => parseForecast({ ...raw, current: { ...raw.current, temperature_2m: null } }, DEFAULT_LOCATION, 'celsius'), /incomplete data/);
});

test('weather requests ten days, 24 hours, and consistent imperial units', async () => {
  let requestURL: URL | undefined;
  const provider = createOpenMeteoProvider({ fetcher: (async input => {
    requestURL = new URL(String(input));
    return new Response(JSON.stringify(forecast()), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch });
  await provider.forecast(DEFAULT_LOCATION, 'fahrenheit');
  assert.equal(requestURL?.searchParams.get('forecast_days'), '10');
  assert.equal(requestURL?.searchParams.get('forecast_hours'), '24');
  assert.equal(requestURL?.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(requestURL?.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(requestURL?.searchParams.get('timezone'), 'auto');
  assert.ok(requestURL?.searchParams.get('current')?.includes('visibility'));
  assert.ok(requestURL?.searchParams.get('hourly')?.includes('precipitation_probability'));
});
