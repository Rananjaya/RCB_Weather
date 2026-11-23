/* RCB Weather — a small, dependency-free weather dashboard.
 * Providers: MET Norway (default, no key), Open-Meteo (no key), OpenWeatherMap (user's own key).
 * Every provider is mapped onto one model so the UI and the RCB Wake icon set stay the same. */
'use strict';

const $ = id => document.getElementById(id);
// Push alerts server (push-worker/): sends alerts even when the app is closed.
const PUSH_API = 'https://rcb-weather-alerts.rananjayabandara.workers.dev';
const VAPID_PUBLIC = 'BAZG3q7Ru5jzaIrz1x1909hOXhlSw51ITSTixRoBv_CqNP_0lo27VzvHKQpZvuxZq04NCzErMwM9sOqil88560Y';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('rcbw.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rcbw.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  provider: store.get('provider', 'metno'),
  units: store.get('units', 'c'),
  owmKey: store.get('owmKey', ''),
  location: store.get('location', null), // { name, lat, lon }
};

// ---------------------------------------------------------------- conditions and icons

const LABEL = {
  CLEAR: 'Clear', MOSTLY_CLEAR: 'Mostly clear', PARTLY_CLOUDY: 'Partly cloudy', CLOUDY: 'Cloudy',
  FOG: 'Fog', DRIZZLE: 'Drizzle', RAIN: 'Rain', HEAVY_RAIN: 'Heavy rain', SHOWERS: 'Showers',
  SLEET: 'Sleet', SNOW: 'Snow', SNOW_SHOWERS: 'Snow showers', THUNDERSTORM: 'Thunderstorm',
};

function icon(cond, isDay) {
  const dn = isDay === false ? 'night' : 'day';
  const file = {
    CLEAR: `clear_${dn}`, MOSTLY_CLEAR: `mostly_clear_${dn}`, PARTLY_CLOUDY: `partly_${dn}`,
    CLOUDY: 'cloudy', FOG: 'fog', DRIZZLE: 'drizzle', RAIN: 'rain', HEAVY_RAIN: 'heavy_rain',
    SHOWERS: `showers_${dn}`, SLEET: 'sleet', SNOW: 'snow', SNOW_SHOWERS: `snow_showers_${dn}`,
    THUNDERSTORM: `thunder_${dn}`,
  }[cond] || 'cloudy';
  return `icons/${file}.svg`;
}

function wmoCondition(code) {
  if (code === 0) return 'CLEAR';
  if (code === 1) return 'MOSTLY_CLEAR';
  if (code === 2) return 'PARTLY_CLOUDY';
  if (code === 3) return 'CLOUDY';
  if (code === 45 || code === 48) return 'FOG';
  if ([56, 57, 66, 67].includes(code)) return 'SLEET';
  if (code >= 51 && code <= 55) return 'DRIZZLE';
  if (code === 65 || code === 82) return 'HEAVY_RAIN';
  if (code >= 61 && code <= 64) return 'RAIN';
  if (code === 80 || code === 81) return 'SHOWERS';
  if (code >= 71 && code <= 77) return 'SNOW';
  if (code === 85 || code === 86) return 'SNOW_SHOWERS';
  if (code >= 95) return 'THUNDERSTORM';
  return 'CLOUDY';
}

function metCondition(symbol = 'cloudy') {
  const s = symbol.split('_')[0];
  if (s.includes('thunder')) return 'THUNDERSTORM';
  if (s.includes('sleet')) return 'SLEET';
  if (s.includes('snowshowers')) return 'SNOW_SHOWERS';
  if (s.includes('snow')) return 'SNOW';
  if (s.startsWith('heavyrain')) return 'HEAVY_RAIN';
  if (s.includes('rainshowers')) return 'SHOWERS';
  if (s === 'lightrain') return 'DRIZZLE';
  if (s.includes('rain')) return 'RAIN';
  if (s === 'fog') return 'FOG';
  if (s === 'clearsky') return 'CLEAR';
  if (s === 'fair') return 'MOSTLY_CLEAR';
  if (s === 'partlycloudy') return 'PARTLY_CLOUDY';
  return 'CLOUDY';
}

function owmCondition(id) {
  if (id >= 200 && id < 300) return 'THUNDERSTORM';
  if (id >= 300 && id < 400) return 'DRIZZLE';
  if (id === 511 || (id >= 611 && id <= 616)) return 'SLEET';
  if (id >= 520 && id <= 531) return 'SHOWERS';
  if (id >= 502 && id <= 504) return 'HEAVY_RAIN';
  if (id >= 500 && id < 600) return 'RAIN';
  if (id >= 620 && id <= 622) return 'SNOW_SHOWERS';
  if (id >= 600 && id < 700) return 'SNOW';
  if (id >= 700 && id < 800) return 'FOG';
  if (id === 800) return 'CLEAR';
  if (id === 801) return 'MOSTLY_CLEAR';
  if (id === 802) return 'PARTLY_CLOUDY';
  return 'CLOUDY';
}

// ---------------------------------------------------------------- helpers

const round2 = n => Math.round(n * 100) / 100;
const temp = c => c == null ? '–' : `${Math.round(state.units === 'f' ? c * 9 / 5 + 32 : c)}°`;
const hourLabel = d => d.toLocaleTimeString([], { hour: 'numeric' });
const dayLabel = (d, i) => i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'long' });
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
/** A wall-clock time at the location, as a Date whose local fields show that time. */
const shifted = (unixSeconds, offsetSeconds) => {
  const d = new Date((unixSeconds + offsetSeconds) * 1000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
};
const mostCommon = arr => {
  const n = {}; arr.forEach(x => { n[x] = (n[x] || 0) + 1; });
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0];
};

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
/** Apparent ("feels like") temperature, Australian BoM formula; used where a provider has none. */
function apparent(t, rh, windKmh) {
  if (t == null || rh == null || windKmh == null) return null;
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
  return t + 0.33 * e - 0.7 * (windKmh / 3.6) - 4.0;
}
/** Dew point (Magnus formula). */
function dewPoint(t, rh) {
  if (t == null || rh == null || rh <= 0) return null;
  const a = 17.27, b = 237.7, g = (a * t) / (b + t) + Math.log(rh / 100);
  return (b * g) / (a - g);
}
/** Sunrise and sunset for a date and place (NOAA approximation); returned as Dates. */
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const day = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(2000, 0, 1)) / 864e5); // days since J2000
  const n = day - lon / 360;
  const M = (357.5291 + 0.98560028 * n) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + n + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return null; // polar day or night
  const H = Math.acos(cosH) / rad / 360;
  const toDate = jd => new Date((jd - 2440587.5) * 864e5);
  return { rise: toDate(transit - H), set: toDate(transit + H) };
}
const clock = d => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------- providers → one model
// Model: { current: {temp, cond, isDay, feels, humidity, wind, pressure, precip},
//          hourly: [{time, temp, cond, isDay, precip}], daily: [{date, min, max, cond, precip}] }

const providers = {
  metno: {
    name: 'MET Norway',
    attribution: 'Weather data from MET Norway (CC BY 4.0).',
    async load({ lat, lon }) {
      // Browsers cannot set User-Agent; MET Norway identifies browser apps by their Origin header.
      const data = await getJson(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${round2(lat)}&lon=${round2(lon)}`);
      const series = data.properties.timeseries.map(t => {
        const symbol = t.data.next_1_hours?.summary.symbol_code ?? t.data.next_6_hours?.summary.symbol_code;
        return {
          time: new Date(t.time),
          d: t.data.instant.details,
          chance: t.data.next_1_hours?.details.probability_of_precipitation,
          symbol,
          precip: t.data.next_1_hours?.details.precipitation_amount ?? t.data.next_6_hours?.details.precipitation_amount,
        };
      });
      const first = series[0];
      const hourly = series.slice(0, 24).filter(s => s.symbol).map(s => ({
        time: s.time, temp: s.d.air_temperature, cond: metCondition(s.symbol),
        isDay: !s.symbol.endsWith('_night'), precip: s.precip, chance: s.chance,
        wind: s.d.wind_speed * 3.6, windDir: s.d.wind_from_direction,
      }));
      const byDay = new Map();
      for (const s of series) {
        const k = dayKey(s.time);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(s);
      }
      const daily = [...byDay.values()].slice(0, 9).map(list => {
        const temps = list.map(s => s.d.air_temperature);
        const noon = list.find(s => s.time.getHours() >= 11 && s.time.getHours() <= 14 && s.symbol) || list.find(s => s.symbol);
        return {
          date: list[0].time, min: Math.min(...temps), max: Math.max(...temps),
          cond: metCondition(noon?.symbol), precip: list.reduce((a, s) => a + (s.precip && s.time.getMinutes() === 0 ? s.precip : 0), 0),
          windMax: Math.max(...list.map(s => s.d.wind_speed * 3.6)),
          uvMax: Math.max(...list.map(s => s.d.ultraviolet_index_clear_sky ?? 0)),
        };
      });
      return {
        current: {
          temp: first.d.air_temperature, cond: metCondition(first.symbol), isDay: !first.symbol?.endsWith('_night'),
          humidity: first.d.relative_humidity, wind: first.d.wind_speed * 3.6,
          windDir: first.d.wind_from_direction, gust: first.d.wind_speed_of_gust != null ? first.d.wind_speed_of_gust * 3.6 : null,
          pressure: first.d.air_pressure_at_sea_level, precip: first.precip, clouds: first.d.cloud_area_fraction,
          dew: first.d.dew_point_temperature, uv: first.d.ultraviolet_index_clear_sky, chance: first.chance,
          fog: first.d.fog_area_fraction,
        },
        hourly, daily,
      };
    },
  },

  openmeteo: {
    name: 'Open-Meteo',
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0).',
    async load({ lat, lon }) {
      const q = new URLSearchParams({
        latitude: round2(lat), longitude: round2(lon), timezone: 'auto', forecast_days: 8,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,cloud_cover',
        hourly: 'temperature_2m,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,uv_index,visibility,dew_point_2m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset',
      });
      const d = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
      const local = s => { const [date, time = '00:00'] = s.split('T'); const [y, m, dd] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
      const now = local(d.current.time);
      const start = Math.max(0, d.hourly.time.findIndex(t => local(t) >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())));
      return {
        current: {
          temp: d.current.temperature_2m, feels: d.current.apparent_temperature, cond: wmoCondition(d.current.weather_code),
          isDay: d.current.is_day === 1, humidity: d.current.relative_humidity_2m, wind: d.current.wind_speed_10m,
          windDir: d.current.wind_direction_10m, gust: d.current.wind_gusts_10m,
          pressure: d.current.pressure_msl, precip: d.current.precipitation, clouds: d.current.cloud_cover,
          uv: d.hourly.uv_index[start], visibility: d.hourly.visibility[start] / 1000, dew: d.hourly.dew_point_2m[start],
          chance: d.hourly.precipitation_probability[start],
          sunrise: local(d.daily.sunrise[0]), sunset: local(d.daily.sunset[0]),
        },
        hourly: d.hourly.time.slice(start, start + 24).map((t, i) => ({
          time: local(t), temp: d.hourly.temperature_2m[start + i], cond: wmoCondition(d.hourly.weather_code[start + i]),
          isDay: d.hourly.is_day[start + i] === 1, chance: d.hourly.precipitation_probability[start + i], precip: d.hourly.precipitation[start + i],
          wind: d.hourly.wind_speed_10m[start + i], windDir: d.hourly.wind_direction_10m[start + i],
        })),
        daily: d.daily.time.map((t, i) => ({
          date: local(t), min: d.daily.temperature_2m_min[i], max: d.daily.temperature_2m_max[i],
          cond: wmoCondition(d.daily.weather_code[i]), precip: d.daily.precipitation_sum[i],
          chance: d.daily.precipitation_probability_max[i], windMax: d.daily.wind_speed_10m_max[i],
          uvMax: d.daily.uv_index_max[i],
        })),
      };
    },
  },

  owm: {
    name: 'OpenWeatherMap',
    attribution: 'Weather data provided by OpenWeather.',
    async load({ lat, lon }) {
      if (!state.owmKey) throw new Error('Enter your OpenWeatherMap API key above.');
      const base = `lat=${round2(lat)}&lon=${round2(lon)}&units=metric&appid=${encodeURIComponent(state.owmKey)}`;
      const [now, fc] = await Promise.all([
        getJson(`https://api.openweathermap.org/data/2.5/weather?${base}`),
        getJson(`https://api.openweathermap.org/data/2.5/forecast?${base}`),
      ]);
      const tz = fc.city.timezone;
      const items = fc.list.map(x => ({
        time: shifted(x.dt, tz), temp: x.main.temp, cond: owmCondition(x.weather[0].id),
        isDay: !x.weather[0].icon.endsWith('n'), precip: (x.rain?.['3h'] ?? 0) + (x.snow?.['3h'] ?? 0),
        chance: Math.round((x.pop ?? 0) * 100),
        wind: x.wind.speed * 3.6, windDir: x.wind.deg,
      }));
      const byDay = new Map();
      for (const s of items) { const k = dayKey(s.time); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); }
      return {
        current: {
          temp: now.main.temp, feels: now.main.feels_like, cond: owmCondition(now.weather[0].id),
          isDay: !now.weather[0].icon.endsWith('n'), humidity: now.main.humidity, wind: now.wind.speed * 3.6,
          pressure: now.main.pressure, clouds: now.clouds?.all, precip: now.rain?.['1h'] ?? 0,
          windDir: now.wind.deg, gust: now.wind.gust != null ? now.wind.gust * 3.6 : null,
          visibility: now.visibility != null ? now.visibility / 1000 : null,
          dew: dewPoint(now.main.temp, now.main.humidity), chance: items[0]?.chance,
          sunrise: shifted(now.sys.sunrise, now.timezone), sunset: shifted(now.sys.sunset, now.timezone),
        },
        hourly: items.slice(0, 8), // 3-hourly on the free plan
        daily: [...byDay.values()].map(list => ({
          date: list[0].time, min: Math.min(...list.map(s => s.temp)), max: Math.max(...list.map(s => s.temp)),
          cond: mostCommon(list.filter(s => s.isDay).map(s => s.cond)) || list[0].cond,
          precip: list.reduce((a, s) => a + s.precip, 0),
          chance: Math.max(...list.map(s => s.chance ?? 0)), windMax: Math.max(...list.map(s => s.wind)),
        })),
      };
    },
  },
};

// ---------------------------------------------------------------- rendering

const uvLabel = uv => uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme';

function render(model) {
  const { current: c, hourly, daily } = model;
  $('now').hidden = $('hourlyCard').hidden = $('dailyCard').hidden = $('rainCard').hidden = false;
  $('place').textContent = state.location.name;
  $('nowIcon').src = icon(c.cond, c.isDay);
  $('nowIcon').alt = LABEL[c.cond];
  $('nowTemp').textContent = temp(c.temp);
  $('nowCond').textContent = LABEL[c.cond];
  // Fill gaps a provider leaves: feels like, dew point, sunrise/sunset are computed locally.
  const feels = c.feels ?? apparent(c.temp, c.humidity, c.wind);
  const dew = c.dew ?? dewPoint(c.temp, c.humidity);
  const sun = c.sunrise ? { rise: c.sunrise, set: c.sunset } : sunTimes(new Date(), state.location.lat, state.location.lon);
  $('sunrise').textContent = sun ? clock(sun.rise) : '–';
  $('sunset').textContent = sun ? clock(sun.set) : '–';
  // Scenery: dusk within an hour of sunrise/sunset, otherwise day or night.
  const t = Date.now(), near = d => d && Math.abs(t - d.getTime()) < 3600e3;
  $('hero').className = `hero ${sun && (near(sun.rise) || near(sun.set)) ? 'dusk' : c.isDay ? 'day' : 'night'}`;

  const arrow = deg => deg != null ? `<span class="arrow" style="transform:rotate(${deg + 180}deg)" title="${Math.round(deg)}°">↑</span>` : '';
  const tiles = [
    ['thermo', 'Feels like', feels != null ? temp(feels) : null],
    ['wind', 'Wind', c.wind != null ? `${Math.round(c.wind)} km/h<small>${c.windDir != null ? `${arrow(c.windDir)} ${compass(c.windDir)}` : ''}${c.gust != null ? ` · gusts ${Math.round(c.gust)}` : ''}</small>` : null],
    ['drop', 'Humidity', c.humidity != null ? `${Math.round(c.humidity)}%` : null],
    ['gauge', 'Pressure', c.pressure != null ? `${Math.round(c.pressure)} hPa` : null],
    ['rain', 'Precipitation', c.precip != null ? `${c.precip.toFixed(1)} mm${c.chance != null ? `<small>${Math.round(c.chance)}% chance</small>` : ''}` : null],
    ['cloud', 'Cloud cover', c.clouds != null ? `${Math.round(c.clouds)}%` : null],
    ['sun', 'UV index', c.uv != null ? `${c.uv.toFixed(1)}<small>${uvLabel(c.uv)}</small>` : null],
    ['leaf', 'Dew point', dew != null ? temp(dew) : null],
    ['eye', 'Visibility', c.visibility != null ? `${c.visibility >= 10 ? Math.round(c.visibility) : c.visibility.toFixed(1)} km` : null],
  ].filter(([, , v]) => v);
  $('nowDetails').innerHTML = tiles.map(([ic, k, v]) => `<div><i data-i="${ic}"></i><span><dt>${k}</dt><dd>${v}</dd></span></div>`).join('');

  $('hourly').innerHTML = hourly.map((h, i) => {
    const wet = (h.chance ?? 0) >= 30 || (h.precip ?? 0) > 0.2;
    const rainTxt = h.chance != null ? `${Math.round(h.chance)}%` : `${(h.precip ?? 0).toFixed(1)} mm`;
    return `<div class="hour${i === 0 ? ' cur' : ''}">
      <div class="h">${i === 0 ? 'Now' : clock(h.time)}</div>
      <img src="${icon(h.cond, h.isDay)}" alt="${LABEL[h.cond]}" title="${LABEL[h.cond]}" />
      <div class="t">${temp(h.temp)}</div>
      <div class="p rain${wet ? ' wet' : ''}">💧 ${rainTxt}</div>
      <div class="p wind" hidden>${h.wind != null ? `${arrow(h.windDir)} ${Math.round(h.wind)} km/h` : '–'}</div>
    </div>`;
  }).join('');
  setHourlyMode(hourlyMode);

  const days = daily.slice(0, 8);
  $('daysTitle').textContent = `Next ${days.length} days`;
  $('daily').innerHTML = days.map((d, i) => `
    <div class="dcard${i === 0 ? ' today' : ''}" title="${[d.chance != null ? `Rain chance ${Math.round(d.chance)}%` : '', d.precip ? `${d.precip.toFixed(1)} mm` : '', d.windMax != null ? `Wind up to ${Math.round(d.windMax)} km/h` : '', d.uvMax ? `UV ${Math.round(d.uvMax)}` : ''].filter(Boolean).join(' · ')}">
      <b>${i === 0 ? 'Today' : d.date.toLocaleDateString([], { weekday: 'short' })}</b>
      <small>${d.date.toLocaleDateString([], { weekday: i === 0 ? 'short' : undefined, day: 'numeric', month: 'short' })}</small>
      <img src="${icon(d.cond, true)}" alt="" />
      <div class="temps">${temp(d.max)}<span>${temp(d.min)}</span></div>
      <div class="c">${LABEL[d.cond]}</div>
    </div>`).join('');

  renderRain(hourly);
  $('attribution').textContent = providers[state.provider].attribution.replace(/\.$/, '');
  fillIcons();
}

// Rainfall bars for the next 24 hours (3-hour steps for OpenWeatherMap).
function renderRain(hourly) {
  const pts = hourly.filter(h => h.precip != null);
  const total = pts.reduce((a, h) => a + h.precip, 0);
  $('rainTotal').textContent = `Total: ${total.toFixed(1)} mm`;
  if (!pts.length) { $('rainChart').innerHTML = '<p class="rain-empty">No rainfall amounts from this provider.</p>'; return; }
  const top = Math.max(1, Math.ceil(Math.max(...pts.map(h => h.precip))));
  const rows = Math.min(top, 6), step = top / rows;
  const every = Math.ceil(pts.length / 6);
  $('rainChart').innerHTML = `
    <div class="rain-y">${Array.from({ length: rows + 1 }, (_, i) => `<span>${+(i * step).toFixed(1)}${i === rows ? ' mm' : ''}</span>`).join('')}</div>
    <div class="rain-plot" style="--rows:${rows}">${pts.map(h => `<div style="height:${(h.precip / top) * 100}%" title="${clock(h.time)}: ${h.precip.toFixed(1)} mm"></div>`).join('')}</div>
    <div class="rain-x">${pts.filter((_, i) => i % every === 0).map(h => `<span>${clock(h.time)}</span>`).join('')}</div>`;
}

// Alerts card: what the alerts watch right now (same rules as the notifications).
function renderAlertsCard(model, air) {
  const items = [];
  if (air && air.us_aqi != null) {
    const [, label, , note] = AQI_LEVELS.find(([max]) => air.us_aqi <= max);
    const cls = air.us_aqi <= 50 ? 'ok' : air.us_aqi <= 100 ? 'warn' : 'bad';
    items.push([cls, 'wind', `${label} air quality`, `US AQI ${Math.round(air.us_aqi)} • ${note}`]);
  }
  const soon = Date.now() + 6 * 3600e3;
  const hours = model.hourly.filter(h => h.time.getTime() <= soon);
  const rough = hours.filter(h => ROUGH.has(h.cond) || (h.precip ?? 0) >= 5);
  if (rough.length) {
    const what = rough.some(h => h.cond === 'THUNDERSTORM') ? 'Thunderstorm ahead' : 'Heavy rain ahead';
    const from = rough[0].time, to = new Date(rough[rough.length - 1].time.getTime() + 3600e3);
    items.push(['rain', 'rain', what, `Likely within 6 hours (≈ ${clock(from)} – ${clock(to)})`]);
  } else {
    const wet = hours.find(h => (h.chance ?? 0) >= 50 || (h.precip ?? 0) >= 0.5);
    items.push(wet ? ['rain', 'rain', 'Rain likely', `From about ${clock(wet.time)} • no heavy rain expected`]
                   : ['ok', 'sun', 'No heavy rain expected', 'Next 6 hours look calm']);
  }
  const on = store.get('alerts', 'off') === 'on';
  $('alertList').innerHTML = items.map(([cls, ic, t, sub]) => `<div class="alert-item ${cls}"><i data-i="${ic}"></i><div><b>${t}</b><small>${sub}</small></div></div>`).join('')
    + `<p class="alert-hint">${on ? 'Notifications are on for bad air and heavy rain.' : 'Turn on Alerts to get a notification.'}</p>`;
  $('alertsCard').hidden = false;
  fillIcons();
}

// ---------------------------------------------------------------- air quality (all providers)
// Open-Meteo Air Quality API (Copernicus CAMS data, CC BY 4.0), free and without a key.

const AQI_LEVELS = [ // US EPA AQI
  [50, 'Good', '#4ade80', 'Air quality is good.'],
  [100, 'Moderate', '#facc15', 'Acceptable; unusually sensitive people should limit long outdoor effort.'],
  [150, 'Unhealthy for sensitive groups', '#fb923c', 'Sensitive groups should reduce long outdoor effort.'],
  [200, 'Unhealthy', '#f87171', 'Everyone should reduce long or heavy outdoor effort.'],
  [300, 'Very unhealthy', '#c084fc', 'Avoid long outdoor effort.'],
  [Infinity, 'Hazardous', '#be123c', 'Stay indoors and keep activity low.'],
];

async function loadAir({ lat, lon }) {
  const q = new URLSearchParams({
    latitude: round2(lat), longitude: round2(lon), timezone: 'auto',
    current: 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
  });
  return (await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`)).current;
}

function renderAir(a) {
  if (!a || a.us_aqi == null) { $('airCard').hidden = true; return; }
  const [, label, color, note] = AQI_LEVELS.find(([max]) => a.us_aqi <= max);
  $('airCard').hidden = false;
  $('aqiValue').textContent = Math.round(a.us_aqi);
  $('aqiLabel').textContent = label;
  $('aqiBadge').style.setProperty('--aqi', color);
  // Marker position on the gauge: six equal bands, linear inside each band (last band 300–500).
  const i = AQI_LEVELS.findIndex(([max]) => a.us_aqi <= max);
  const lo = i ? AQI_LEVELS[i - 1][0] : 0, hi = i === AQI_LEVELS.length - 1 ? 500 : AQI_LEVELS[i][0];
  $('aqiBadge').style.setProperty('--p', Math.min(1, (i + Math.min(1, (a.us_aqi - lo) / (hi - lo))) / AQI_LEVELS.length));
  // Dot colour per pollutant: green / orange / red against common guideline levels (µg/m³).
  const chip = (k, v, ok, bad) => v == null ? '' : `<div style="--c:${v <= ok ? '#4ade80' : v <= bad ? '#fb923c' : '#f87171'}"><dt>${k}</dt><dd>${v.toFixed(1)} µg/m³</dd></div>`;
  $('airDetails').innerHTML = chip('PM2.5', a.pm2_5, 15, 35) + chip('PM10', a.pm10, 45, 100) + chip('O₃', a.ozone, 100, 160)
    + chip('NO₂', a.nitrogen_dioxide, 25, 100) + chip('SO₂', a.sulphur_dioxide, 40, 125) + chip('CO', a.carbon_monoxide, 4000, 10000);
  $('airNote').textContent = note;
  fillIcons();
}

// ---------------------------------------------------------------- alerts (notifications)
// Sent by the app itself while it is open or running in the background (no server, no push service).
// Bad air: US AQI above 100, again only if it gets worse the same day. Heavy rain: heavy rain,
// thunderstorm or ≥ 5 mm expected in the next 6 hours, at most once every 3 hours per place.

const ROUGH = new Set(['HEAVY_RAIN', 'THUNDERSTORM']);

const IS_DESKTOP_APP = /Electron/.test(navigator.userAgent);
async function notify(title, body, tag) {
  const opts = { body, tag, icon: 'icons/app-192.png', badge: 'icons/app-192.png' };
  // The desktop apps show notifications through the system directly (service-worker notifications
  // are not shown there).
  if (IS_DESKTOP_APP) { try { new Notification(title, opts).onclick = () => window.focus(); } catch { /* unavailable */ } return; }
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) return await reg.showNotification(title, opts);
  } catch { /* fall back below */ }
  try { new Notification(title, opts); } catch { /* notifications unavailable */ }
}

function checkAlerts(model, air) {
  if (store.get('alerts', 'off') !== 'on' || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (store.get('push', false)) return; // the alerts server sends them (also when the app is closed)
  const loc = state.location, where = loc.name, id = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
  const sent = store.get('alerted', {});

  if (air && air.us_aqi > 100) {
    const level = AQI_LEVELS.findIndex(([max]) => air.us_aqi <= max);
    const key = `aqi|${id}|${new Date().toDateString()}`;
    if ((sent[key] ?? -1) < level) {
      const [, label, , advice] = AQI_LEVELS[level];
      notify(`Air quality: ${label}`, `${where}: US AQI ${Math.round(air.us_aqi)}. ${advice}`, 'rcbw-air');
      sent[key] = level;
    }
  }

  const soon = Date.now() + 6 * 3600e3;
  const rain = model.hourly.find(h => h.time.getTime() <= soon && (ROUGH.has(h.cond) || (h.precip ?? 0) >= 5));
  const rainKey = `rain|${id}`;
  if (rain && Date.now() - (sent[rainKey] ?? 0) > 3 * 3600e3) {
    const at = rain.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const what = rain.cond === 'THUNDERSTORM' ? 'Thunderstorm' : 'Heavy rain';
    const amount = rain.precip != null ? ` (${rain.precip.toFixed(1)} mm in that hour)` : '';
    notify(`${what} ahead`, `${where}: ${what.toLowerCase()} expected around ${at}${amount}.`, 'rcbw-rain');
    sent[rainKey] = Date.now();
  }

  // Keep only today's air entries and the rain timestamps.
  const today = new Date().toDateString();
  for (const k of Object.keys(sent)) if (k.startsWith('aqi|') && !k.endsWith(today)) delete sent[k];
  store.set('alerted', sent);
}

// Real push (app closed too): subscribe this device with the alerts server. Where push is not
// available (e.g. the desktop apps), the app checks by itself while it is running instead.
const b64ToBytes = b => Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b.length % 4) % 4)), c => c.charCodeAt(0));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

async function pushSync(force = false, welcome = false) {
  const loc = state.location;
  if (!loc || IS_DESKTOP_APP || !('serviceWorker' in navigator) || !('PushManager' in window)) { store.set('push', false); return false; }
  const owmKey = state.provider === 'owm' ? state.owmKey : '';
  const sig = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${loc.name},${state.provider},${owmKey.slice(-6)}`;
  const lastSync = store.get('pushSync', {});
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 10000);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) }), 15000);
    if (force || lastSync.sig !== sig || lastSync.endpoint !== sub.endpoint || Date.now() - (lastSync.at || 0) > 864e5) {
      const r = await fetch(`${PUSH_API}/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ welcome, provider: state.provider, owmKey: owmKey || undefined, subscription: sub.toJSON(), lat: loc.lat, lon: loc.lon, name: loc.name, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      store.set('pushSync', { sig, endpoint: sub.endpoint, at: Date.now() });
    }
    store.set('push', true);
    return true;
  } catch {
    store.set('push', false);
    return false;
  }
}

async function pushOff() {
  store.set('push', false); store.set('pushSync', {});
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`${PUSH_API}/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* nothing to undo */ }
}

$('alerts').value = store.get('alerts', 'off');
$('alerts').onchange = async e => {
  let on = e.target.value === 'on';
  if (on) {
    if (!('Notification' in window)) { $('status').textContent = 'Notifications are not available here.'; on = false; }
    else if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
      $('status').textContent = 'Notifications are blocked. Allow them in your browser or system settings.'; on = false;
    }
  }
  e.target.value = on ? 'on' : 'off';
  store.set('alerts', e.target.value);
  if (!on) { pushOff(); return; }
  // With push, the server sends the confirmation as a real push; otherwise the app shows it.
  if (!await pushSync(true, true)) notify('RCB Weather alerts are on', 'You will be told about bad air and heavy rain ahead while RCB Weather is open.', 'rcbw-test');
  refresh(true);
};
// Keep the server's copy of this device's place up to date.
if (store.get('alerts', 'off') === 'on') setTimeout(() => pushSync(), 3000);


let last = null;
async function refresh(silent = false) {
  if (!state.location) { $('status').textContent = 'Search a place or use your location.'; return; }
  const p = providers[state.provider];
  if (!silent) $('status').textContent = `Loading ${p.name} for ${state.location.name}…`;
  try {
    const [model, air] = await Promise.all([p.load(state.location), loadAir(state.location).catch(() => null)]);
    last = model;
    render(last);
    renderAir(air);
    renderAlertsCard(model, air);
    checkAlerts(model, air);
    updatedAt = Date.now();
    $('status').textContent = p.name;
    tick();
  } catch (e) {
    $('status').textContent = `Could not load weather from ${p.name}: ${e.message}`;
  }
}

function setLocation(loc) {
  state.location = loc;
  store.set('location', loc);
  refresh();
  if (store.get('alerts', 'off') === 'on') pushSync();
}

// ---------------------------------------------------------------- location: current + search

// Place name for a position (reverse geocoding, BigDataCloud's free client service; coordinates
// rounded to about 1 km). Returns null when it cannot be found, and the app shows "My location".
async function placeName(lat, lon) {
  try {
    const d = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${round2(lat)}&longitude=${round2(lon)}&localityLanguage=${(navigator.language || 'en').split('-')[0]}`);
    const town = d.locality || d.city || d.localityInfo?.administrative?.slice(-1)[0]?.name;
    return town ? (d.city && d.city !== town ? `${town}, ${d.city}` : town) : (d.principalSubdivision || null);
  } catch { return null; }
}

function locate() {
  if (!navigator.geolocation) { $('status').textContent = 'Location is not available in this browser.'; return; }
  $('status').textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    async p => {
      const lat = p.coords.latitude, lon = p.coords.longitude, prev = state.location;
      // Same place as last time (within ~1 km): keep its name; otherwise look the name up.
      const same = prev?.mine && prev.name !== 'My location' && round2(prev.lat) === round2(lat) && round2(prev.lon) === round2(lon);
      const name = same ? prev.name : await placeName(lat, lon);
      setLocation({ name: name || 'My location', lat, lon, mine: true });
    },
    e => { $('status').textContent = `Could not get your location (${e.message}). Search for a place instead.`; },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
}

let searchTimer, searchAbort;
async function search(text) {
  const list = $('results');
  if (text.trim().length < 2) { list.hidden = true; return; }
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const d = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=10&format=json&name=${encodeURIComponent(text.trim())}`, { signal: searchAbort.signal }).then(r => r.json());
    const results = d.results || [];
    list.innerHTML = results.length
      ? results.map((r, i) => `<li role="option" data-i="${i}">${r.name}<small>${[r.admin2, r.admin1, r.country].filter(Boolean).join(', ')}</small></li>`).join('')
      : '<li aria-disabled="true">No places found</li>';
    list.hidden = false;
    list.onclick = e => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      const r = results[Number(li.dataset.i)];
      setLocation({ name: [r.name, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude });
      list.hidden = true;
      $('q').value = '';
    };
  } catch (e) {
    if (e.name !== 'AbortError') { list.innerHTML = '<li aria-disabled="true">Search failed</li>'; list.hidden = false; }
  }
}

// ---------------------------------------------------------------- wiring

function syncControls() {
  $('provider').value = state.provider;
  $('units').value = state.units;
  $('owmKey').value = state.owmKey;
  $('keyWrap').hidden = state.provider !== 'owm';
}

$('provider').onchange = e => { state.provider = e.target.value; store.set('provider', state.provider); syncControls(); refresh(); if (store.get('alerts', 'off') === 'on') pushSync(); };
$('units').onchange = e => { state.units = e.target.value; store.set('units', state.units); if (last) render(last); };
$('owmKey').onchange = e => { state.owmKey = e.target.value.trim(); store.set('owmKey', state.owmKey); refresh(); if (store.get('alerts', 'off') === 'on') pushSync(); };
$('locate').onclick = locate;
$('search').onsubmit = e => { e.preventDefault(); search($('q').value); };
$('q').oninput = e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(e.target.value), 350); };
document.addEventListener('click', e => { if (!$('search').contains(e.target)) $('results').hidden = true; });

// Live updates: weather every 5 minutes, when the tab comes back and when the internet returns;
// updates are silent (the page keeps showing data while new data loads). Clock every second.
const REFRESH_MS = 5 * 60 * 1000;
let updatedAt = null;
setInterval(() => { if (!document.hidden || store.get('alerts', 'off') === 'on') refresh(true); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!updatedAt || Date.now() - updatedAt > 60 * 1000)) refresh(true);
});
window.addEventListener('online', () => refresh(true));
setInterval(tick, 1000);
function tick() {
  const n = new Date();
  $('clock').textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('today').textContent = n.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (updatedAt) {
    const m = Math.floor((Date.now() - updatedAt) / 60000);
    $('updated').textContent = m < 1 ? 'Updated just now' : `Updated ${m} min ago`;
  }
}

// A location can also be given in the address: ?lat=6.93&lon=79.86&name=Colombo
const params = new URLSearchParams(location.search);
syncControls();
tick();
if (params.has('lat') && params.has('lon')) {
  setLocation({ name: params.get('name') || 'Chosen place', lat: Number(params.get('lat')), lon: Number(params.get('lon')) });
} else if (state.location?.mine) locate(); // keep "My location" current
else if (state.location) refresh();
else locate();                              // first visit: try current location

// ---------------------------------------------------------------- interface icons (line icons, drawn for RCB Weather)
const UI = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sunrise: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 3v4M9 6l3-3 3 3M4.5 10.5l1.5 1M19.5 10.5l-1.5 1"/>',
  sunset: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 3v4M9 4l3 3 3-3M4.5 10.5l1.5 1M19.5 10.5l-1.5 1"/>',
  thermo: '<path d="M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0z"/><path d="M12 9v8"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><circle cx="12" cy="17" r="1"/>',
  rain: '<path d="M7 14a5 5 0 1 1 9.6-2H17a3.5 3.5 0 0 1 0 7H8"/><path d="M8 20l-1 2M12 20l-1 2M16 20l-1 2"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 11 3.5 3.5 0 0 1 18 18z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19l7-7"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lungs: '<path d="M12 4v8M12 12c-1 0-2-1-3-1-3 0-5 4-5 7 0 2 2 2 4 1s3-3 4-5M12 12c1 0 2-1 3-1 3 0 5 4 5 7 0 2-2 2-4 1s-3-3-4-5"/>',
  windows: '<path d="M3 5l8-1v7H3zM13 4l8-1v8h-8zM3 13h8v7l-8-1zM13 13h8v8l-8-1z" fill="currentColor" stroke="none"/>',
  apple: '<path d="M16 3c0 2-1.5 3.5-3 3.5 0-2 1.5-3.5 3-3.5zM12 7.5c1 0 2-1 3.5-1 2 0 3.5 1.5 3.5 1.5-2 1.2-2 4.5.5 5.5-.8 2.5-2.5 5.5-4 5.5-1.2 0-1.8-.8-3.5-.8s-2.3.8-3.5.8C7 19 4 15 4 11.5 4 8.5 6 6.5 8.3 6.5c1.5 0 2.7 1 3.7 1z" fill="currentColor" stroke="none"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
};
function fillIcons() {
  document.querySelectorAll('i[data-i]:not([data-done])').forEach(el => {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UI[el.dataset.i] || ''}</svg>`;
    el.dataset.done = '1';
  });
}
fillIcons();

// Search and settings buttons, section tabs, hourly/details switch.
$('searchBtn').onclick = () => {
  const f = $('search'); f.hidden = !f.hidden; $('searchBtn').classList.toggle('on', !f.hidden);
  if (!f.hidden) $('q').focus();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('search').hidden) $('searchBtn').click(); });
$('search').addEventListener('submit', e => e.preventDefault());
document.addEventListener('click', e => { if (e.target.closest('#results li')) { $('search').hidden = true; $('searchBtn').classList.remove('on'); } });
const controls = document.querySelector('.controls');
controls.hidden = store.get('controlsHidden', false);
$('settingsBtn').classList.toggle('on', !controls.hidden);
$('settingsBtn').onclick = () => { controls.hidden = !controls.hidden; store.set('controlsHidden', controls.hidden); $('settingsBtn').classList.toggle('on', !controls.hidden); };
document.querySelectorAll('.tabs a').forEach(a => a.addEventListener('click', () => {
  document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('active', x === a));
}));
$('alertsGo').onclick = e => { e.preventDefault(); controls.hidden = false; $('settingsBtn').classList.add('on'); $('hero').scrollIntoView(); $('alerts').focus(); };
let hourlyMode = 'hourly';
function setHourlyMode(m) {
  hourlyMode = m;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  document.querySelectorAll('.hour .rain').forEach(el => { el.hidden = m !== 'hourly'; });
  document.querySelectorAll('.hour .wind').forEach(el => { el.hidden = m === 'hourly'; });
}
document.querySelector('.seg').onclick = e => { const b = e.target.closest('button'); if (b) setHourlyMode(b.dataset.mode); };
$('hourly').addEventListener('scroll', () => {
  const h = $('hourly'), w = h.clientWidth / h.scrollWidth;
  $('hourlyBar').style.width = `${w * 100}%`;
  $('hourlyBar').style.marginLeft = `${(h.scrollLeft / h.scrollWidth) * 100}%`;
});
