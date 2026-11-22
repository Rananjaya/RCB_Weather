/* RCB Weather — a small, dependency-free weather dashboard.
 * Providers: MET Norway (default, no key), Open-Meteo (no key), OpenWeatherMap (user's own key).
 * Every provider is mapped onto one model so the UI and the RCB Wake icon set stay the same. */
'use strict';

const $ = id => document.getElementById(id);
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
        hourly: 'temperature_2m,weather_code,is_day,precipitation_probability,wind_speed_10m,wind_direction_10m,uv_index,visibility,dew_point_2m',
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
          isDay: d.hourly.is_day[start + i] === 1, chance: d.hourly.precipitation_probability[start + i],
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
  $('now').hidden = $('hourlyCard').hidden = $('dailyCard').hidden = false;
  $('place').textContent = state.location.name;
  $('nowIcon').src = icon(c.cond, c.isDay);
  $('nowIcon').alt = LABEL[c.cond];
  $('nowTemp').textContent = temp(c.temp);
  $('nowCond').textContent = LABEL[c.cond];
  // Fill gaps a provider leaves: feels like, dew point, sunrise/sunset are computed locally.
  const feels = c.feels ?? apparent(c.temp, c.humidity, c.wind);
  const dew = c.dew ?? dewPoint(c.temp, c.humidity);
  const sun = c.sunrise ? { rise: c.sunrise, set: c.sunset } : sunTimes(new Date(), state.location.lat, state.location.lon);
  const arrow = deg => deg != null ? `<span class="arrow" style="transform:rotate(${deg + 180}deg)" title="${Math.round(deg)}°">↑</span>` : '';
  const details = [
    ['Feels like', feels != null ? temp(feels) : null],
    ['Wind', c.wind != null ? `${arrow(c.windDir)} ${Math.round(c.wind)} km/h${c.windDir != null ? ` ${compass(c.windDir)}` : ''}` : null],
    ['Gusts', c.gust != null ? `${Math.round(c.gust)} km/h` : null],
    ['Humidity', c.humidity != null ? `${Math.round(c.humidity)}%` : null],
    ['Dew point', dew != null ? temp(dew) : null],
    ['Pressure', c.pressure != null ? `${Math.round(c.pressure)} hPa` : null],
    ['Chance of rain', c.chance != null ? `${Math.round(c.chance)}%` : null],
    ['Precipitation', c.precip != null ? `${c.precip.toFixed(1)} mm` : null],
    ['Cloud cover', c.clouds != null ? `${Math.round(c.clouds)}%` : null],
    ['UV index', c.uv != null ? `${c.uv.toFixed(1)} ${uvLabel(c.uv)}` : null],
    ['Visibility', c.visibility != null ? `${c.visibility >= 10 ? Math.round(c.visibility) : c.visibility.toFixed(1)} km` : null],
    ['Fog', c.fog != null && c.fog > 0 ? `${Math.round(c.fog)}%` : null],
    ['Sunrise', sun ? clock(sun.rise) : null],
    ['Sunset', sun ? clock(sun.set) : null],
  ].filter(([, v]) => v);
  $('nowDetails').innerHTML = details.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  $('hourly').innerHTML = hourly.map(h => `
    <div class="hour">
      <div class="h">${hourLabel(h.time)}</div>
      <img src="${icon(h.cond, h.isDay)}" alt="${LABEL[h.cond]}" title="${LABEL[h.cond]}" />
      <div class="t">${temp(h.temp)}</div>
      <div class="p">💧 ${h.chance != null ? `${Math.round(h.chance)}%` : h.precip ? `${h.precip.toFixed(1)}` : '0'}</div>
      <div class="p">${h.wind != null ? `${arrow(h.windDir)} ${Math.round(h.wind)}` : ''}</div>
    </div>`).join('');

  $('daily').innerHTML = daily.map((d, i) => `
    <div class="day">
      <div>${dayLabel(d.date, i)}</div>
      <img src="${icon(d.cond, true)}" alt="" />
      <div class="c">${LABEL[d.cond]}${d.chance != null ? ` · 💧 ${Math.round(d.chance)}%` : ''}${d.precip ? ` · ${d.precip.toFixed(1)} mm` : ''}${d.windMax != null ? ` · 💨 ${Math.round(d.windMax)} km/h` : ''}${d.uvMax ? ` · UV ${Math.round(d.uvMax)}` : ''}</div>
      <div class="lo">${temp(d.min)}</div>
      <div class="hi">${temp(d.max)}</div>
    </div>`).join('');
  $('attribution').textContent = providers[state.provider].attribution;
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
  const ug = v => v == null ? null : `${v.toFixed(1)} µg/m³`;
  $('airDetails').innerHTML = [
    ['PM2.5', ug(a.pm2_5)], ['PM10', ug(a.pm10)], ['Ozone (O₃)', ug(a.ozone)],
    ['Nitrogen dioxide (NO₂)', ug(a.nitrogen_dioxide)], ['Sulphur dioxide (SO₂)', ug(a.sulphur_dioxide)],
    ['Carbon monoxide (CO)', ug(a.carbon_monoxide)], ['European AQI', a.european_aqi != null ? Math.round(a.european_aqi) : null],
  ].filter(([, v]) => v != null).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('airNote').textContent = `${note} US AQI. Air quality data: Open-Meteo.com / Copernicus CAMS (CC BY 4.0).`;
}

// ---------------------------------------------------------------- alerts (notifications)
// Sent by the app itself while it is open or running in the background (no server, no push service).
// Bad air: US AQI above 100, again only if it gets worse the same day. Heavy rain: heavy rain,
// thunderstorm or ≥ 5 mm expected in the next 6 hours, at most once every 3 hours per place.

const ROUGH = new Set(['HEAVY_RAIN', 'THUNDERSTORM']);

async function notify(title, body, tag) {
  const opts = { body, tag, icon: 'icons/app-192.png', badge: 'icons/app-192.png' };
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) return await reg.showNotification(title, opts);
  } catch { /* fall back below */ }
  try { new Notification(title, opts); } catch { /* notifications unavailable */ }
}

function checkAlerts(model, air) {
  if (store.get('alerts', 'off') !== 'on' || !('Notification' in window) || Notification.permission !== 'granted') return;
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
  if (on) { notify('RCB Weather alerts are on', 'You will be told about bad air and heavy rain ahead.', 'rcbw-test'); refresh(true); }
};

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
    checkAlerts(model, air);
    updatedAt = Date.now();
    $('status').textContent = `${p.name} · ${state.location.name}`;
    tick();
  } catch (e) {
    $('status').textContent = `Could not load weather from ${p.name}: ${e.message}`;
  }
}

function setLocation(loc) {
  state.location = loc;
  store.set('location', loc);
  refresh();
}

// ---------------------------------------------------------------- location: current + search

function locate() {
  if (!navigator.geolocation) { $('status').textContent = 'Location is not available in this browser.'; return; }
  $('status').textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    p => setLocation({ name: 'My location', lat: p.coords.latitude, lon: p.coords.longitude, mine: true }),
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

$('provider').onchange = e => { state.provider = e.target.value; store.set('provider', state.provider); syncControls(); refresh(); };
$('units').onchange = e => { state.units = e.target.value; store.set('units', state.units); if (last) render(last); };
$('owmKey').onchange = e => { state.owmKey = e.target.value.trim(); store.set('owmKey', state.owmKey); refresh(); };
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
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
