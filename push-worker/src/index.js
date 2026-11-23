// RCB Weather alerts: Web Push for bad air and heavy rain, even when the app is closed.
//
// Stored per device (Cloudflare KV, key "sub:<sha256(endpoint)>"): the browser's push
// subscription, the place (rounded to ~1 km), its name, time zone, weather provider, the user's
// OpenWeatherMap key if that provider is chosen (encrypted with AES-GCM), and what was already sent.
//
// Every 15 minutes each device's rain forecast is checked with the provider chosen in its app:
//   MET Norway  — one request per place, cached until MET's Expires time (as MET's terms ask),
//   Open-Meteo  — up to 50 places per request,
//   OpenWeatherMap — with that user's own key.
// Air quality always comes from Open-Meteo (the only source). If a provider fails, Open-Meteo is
// used instead. When an alert is due, the message is saved under "msg:<id>" (kept 1 day) and an
// empty push is sent; the app's service worker fetches the message from /messages and shows it.
// Pushes carry no data, so only the VAPID signature is needed.

const AQI_LEVELS = [ // US EPA AQI, same as the app
  [50, 'Good', ''], [100, 'Moderate', ''],
  [150, 'Unhealthy for sensitive groups', 'Sensitive groups should reduce long outdoor effort.'],
  [200, 'Unhealthy', 'Everyone should reduce long or heavy outdoor effort.'],
  [300, 'Very unhealthy', 'Avoid long outdoor effort.'],
  [Infinity, 'Hazardous', 'Stay indoors and keep activity low.'],
];
const PROVIDERS = { metno: 'MET Norway', openmeteo: 'Open-Meteo', owm: 'OpenWeatherMap' };
const RAIN_MM = 5;                        // mm in one hour counts as heavy
const RAIN_HOURS = 6;
const RAIN_GAP_MS = 3 * 3600e3;
const UA = 'RCBWeatherAlerts/1.1 (+https://github.com/Rananjaya/RCB_Weather)';
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)$/;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json' } });
    try {
      if (url.pathname === '/subscribe' && req.method === 'POST') {
        const b = await req.json();
        const s = b.subscription;
        if (!s?.endpoint || !PUSH_HOSTS.test(new URL(s.endpoint).hostname) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'bad subscription' }, 400);
        const lat = Number(b.lat), lon = Number(b.lon);
        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({ error: 'bad location' }, 400);
        let provider = PROVIDERS[b.provider] ? b.provider : 'openmeteo';
        let owmKey = null;
        if (provider === 'owm') {
          if (/^[0-9a-f]{32}$/i.test(b.owmKey || '')) owmKey = await encrypt(b.owmKey, env);
          else provider = 'openmeteo'; // no usable key: fall back
        }
        const id = await sha(s.endpoint);
        const old = await env.SUBS.get('sub:' + id, 'json');
        const moved = !old || old.lat !== round2(lat) || old.lon !== round2(lon);
        const name = String(b.name || 'Your location').slice(0, 60);
        await env.SUBS.put('sub:' + id, JSON.stringify({
          sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          lat: round2(lat), lon: round2(lon), name, tz: validTz(b.tz), provider, owmKey,
          sent: moved ? {} : old.sent || {}, since: old?.since || Date.now(),
        }));
        let pushed = null;
        if (b.welcome) { // confirm the whole push path with a real push
          await env.SUBS.put('msg:' + id, JSON.stringify([{ title: 'RCB Weather alerts are on', body: `You will be told about bad air and heavy rain ahead for ${name} (${PROVIDERS[provider]}), even when the app is closed.`, tag: 'rcbw-test' }]), { expirationTtl: 86400 });
          pushed = (await sendPush(s.endpoint, env)).status;
        }
        return json({ ok: true, id, provider, pushed });
      }
      if (url.pathname === '/test' && req.method === 'POST') {
        // "Send test alert" in the app: a real push to this device after ~10 s (time to close the app).
        const b = await req.json();
        if (!b.endpoint) return json({ error: 'no endpoint' }, 400);
        const id = await sha(b.endpoint);
        const sub = await env.SUBS.get('sub:' + id, 'json');
        if (!sub) return json({ error: 'not subscribed' }, 404);
        if (Date.now() - (sub.lastTest || 0) < 30e3) return json({ error: 'wait a moment before the next test' }, 429);
        sub.lastTest = Date.now();
        await env.SUBS.put('sub:' + id, JSON.stringify(sub));
        await env.SUBS.put('msg:' + id, JSON.stringify([{ title: 'RCB Weather test alert', body: `Push alerts work on this device. Alerts for ${sub.name} use ${PROVIDERS[sub.provider] || 'Open-Meteo'}.`, tag: 'rcbw-test' }]), { expirationTtl: 3600 });
        const delay = Math.min(Math.max(Number(b.delay) || 0, 0), 20) * 1000;
        ctx.waitUntil(new Promise(r => setTimeout(r, delay)).then(() => sendPush(sub.sub.endpoint, env))
          .then(r => console.log(`test push ${id.slice(0, 8)}: ${r.status}`)).catch(e => console.log(`test push ${id.slice(0, 8)} failed: ${e}`)));
        return json({ ok: true, provider: PROVIDERS[sub.provider] || 'Open-Meteo', name: sub.name, delay: delay / 1000 });
      }
      if (url.pathname === '/unsubscribe' && req.method === 'POST') {
        const b = await req.json();
        if (b.endpoint) { const id = await sha(b.endpoint); await env.SUBS.delete('sub:' + id); await env.SUBS.delete('msg:' + id); }
        return json({ ok: true });
      }
      if (url.pathname === '/messages' && req.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (!/^[0-9a-f]{64}$/.test(id)) return json([], 400);
        const msgs = (await env.SUBS.get('msg:' + id, 'json')) || [];
        if (msgs.length) await env.SUBS.delete('msg:' + id);
        return json(msgs);
      }
      if (url.pathname === '/') return json({ service: 'RCB Weather alerts', ok: true });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkAll(env));
  },
};

export async function checkAll(env, now = Date.now()) {
  const subs = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) { const v = await env.SUBS.get(k.name, 'json'); if (v) subs.push({ key: k.name, ...v }); }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (!subs.length) return { checked: 0, sent: 0 };

  // Open-Meteo for every place (air quality, Open-Meteo users, and fallback), 50 places a request.
  const placeKey = s => `${s.lat},${s.lon}`;
  const places = [...new Map(subs.map(s => [placeKey(s), { lat: s.lat, lon: s.lon }])).values()];
  const om = new Map();
  for (let i = 0; i < places.length; i += 50) {
    const batch = places.slice(i, i + 50);
    const q = `latitude=${batch.map(p => p.lat).join(',')}&longitude=${batch.map(p => p.lon).join(',')}`;
    const [wx, aq] = await Promise.all([
      getJson(`https://api.open-meteo.com/v1/forecast?${q}&hourly=precipitation,weather_code&forecast_hours=${RAIN_HOURS + 1}&timeformat=unixtime&timezone=GMT`).catch(() => null),
      getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi&timeformat=unixtime&timezone=GMT`).catch(() => null),
    ]);
    const wl = wx ? (Array.isArray(wx) ? wx : [wx]) : [], al = aq ? (Array.isArray(aq) ? aq : [aq]) : [];
    batch.forEach((p, j) => om.set(`${p.lat},${p.lon}`, { hours: wl[j] ? openMeteoHours(wl[j]) : null, aqi: al[j]?.current?.us_aqi }));
  }

  // MET Norway once per place (cached), OpenWeatherMap once per user.
  const met = new Map();
  for (const s of subs.filter(s => s.provider === 'metno')) {
    if (!met.has(placeKey(s))) met.set(placeKey(s), await metNorwayHours(s, env, now).catch(() => null));
  }

  let sent = 0;
  for (const s of subs) {
    const base = om.get(placeKey(s)) || {};
    let hours = null, source = s.provider || 'openmeteo';
    if (source === 'metno') hours = met.get(placeKey(s));
    else if (source === 'owm' && s.owmKey) hours = await owmHours(s, env).catch(() => null);
    else hours = base.hours;
    if (!hours) { hours = base.hours; source = 'openmeteo'; } // provider failed: fall back
    const msgs = alertsFor(s, { hours, aqi: base.aqi, source }, now);
    if (!msgs.length) continue;
    const id = s.key.slice(4);
    const queued = (await env.SUBS.get('msg:' + id, 'json')) || [];
    await env.SUBS.put('msg:' + id, JSON.stringify([...queued, ...msgs].slice(-5)), { expirationTtl: 86400 });
    const res = await sendPush(s.sub.endpoint, env);
    if (res.status === 404 || res.status === 410) { console.log(`removed expired device ${id.slice(0, 8)}`); await env.SUBS.delete(s.key); await env.SUBS.delete('msg:' + id); continue; }
    const { key, ...rest } = s;
    await env.SUBS.put(key, JSON.stringify(rest));
    if (res.ok) sent++;
    console.log(`alert ${id.slice(0, 8)} (${source}): ${msgs.map(m => m.title).join(', ')} → push ${res.status}`);
  }
  console.log(`checked ${subs.length} devices, sent ${sent} alerts`);
  return { checked: subs.length, sent };
}

// ---------------------------------------------------------------- providers → [{ t, mm, heavy, storm }]

export function openMeteoHours(d) {
  const h = d?.hourly;
  if (!h?.time) return null;
  return h.time.map((t, i) => {
    const code = h.weather_code[i];
    return { t: t * 1000, mm: h.precipitation[i] ?? 0, heavy: code === 65 || code === 82, storm: code >= 95 };
  });
}

export function metHoursFrom(d) {
  const ts = d?.properties?.timeseries;
  if (!ts) return null;
  return ts.filter(x => x.data.next_1_hours).slice(0, RAIN_HOURS + 2).map(x => {
    const sym = x.data.next_1_hours.summary?.symbol_code || '';
    return { t: Date.parse(x.time), mm: x.data.next_1_hours.details?.precipitation_amount ?? 0, heavy: /heavy(rain|sleet)/.test(sym), storm: /thunder/.test(sym) };
  });
}

// MET's terms: identify the app, and do not ask again before the Expires time (If-Modified-Since).
async function metNorwayHours(s, env, now) {
  const ck = `met:${s.lat},${s.lon}`;
  const cached = await env.SUBS.get(ck, 'json');
  if (cached && now < cached.expires) return metHoursFrom(cached.data);
  const headers = { 'User-Agent': UA };
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${s.lat}&lon=${s.lon}`, { headers });
  const expires = Date.parse(r.headers.get('Expires') || '') || now + 30 * 60e3;
  if (r.status === 304 && cached) {
    await env.SUBS.put(ck, JSON.stringify({ ...cached, expires }), { expirationTtl: 86400 });
    return metHoursFrom(cached.data);
  }
  if (!r.ok) throw new Error(`MET Norway: HTTP ${r.status}`);
  const data = await r.json();
  // Keep only what the alerts need, so the cache stays small.
  data.properties.timeseries = data.properties.timeseries.slice(0, RAIN_HOURS + 3).map(x => ({ time: x.time, data: { next_1_hours: x.data.next_1_hours } }));
  await env.SUBS.put(ck, JSON.stringify({ data, expires, lastModified: r.headers.get('Last-Modified') }), { expirationTtl: 86400 });
  return metHoursFrom(data);
}

// OpenWeatherMap 5-day forecast (3-hour steps), with the user's own key.
export function owmHoursFrom(d) {
  if (!d?.list) return null;
  return d.list.slice(0, 3).map(x => {
    const id = x.weather?.[0]?.id ?? 0;
    return { t: x.dt * 1000, mm: (x.rain?.['3h'] ?? 0) / 3, heavy: [502, 503, 504, 522, 531].includes(id), storm: id >= 200 && id < 300, span: 3 };
  });
}
async function owmHours(s, env) {
  const key = await decrypt(s.owmKey, env);
  return owmHoursFrom(await getJson(`https://api.openweathermap.org/data/2.5/forecast?lat=${s.lat}&lon=${s.lon}&units=metric&cnt=3&appid=${encodeURIComponent(key)}`));
}

// ---------------------------------------------------------------- alert rules

// Same rules as the app: air above US AQI 100 (again only if it gets worse the same local day);
// heavy rain, thunderstorm or ≥ 5 mm in an hour within 6 hours (at most once every 3 hours).
export function alertsFor(s, { hours, aqi, source = 'openmeteo' }, now) {
  const msgs = [];
  const sent = s.sent || (s.sent = {});
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: s.tz });
  if (aqi > 100) {
    const level = AQI_LEVELS.findIndex(([max]) => aqi <= max);
    if (sent.aqiDay !== day || (sent.aqiLevel ?? -1) < level) {
      const [, label, advice] = AQI_LEVELS[level];
      msgs.push({ title: `Air quality: ${label}`, body: `${s.name}: US AQI ${Math.round(aqi)}. ${advice}`, tag: 'rcbw-air' });
      sent.aqiDay = day; sent.aqiLevel = level;
    }
  }
  if (hours && now - (sent.rainAt || 0) > RAIN_GAP_MS) {
    for (const h of hours) {
      const end = h.t + (h.span || 1) * 3600e3;
      if (end <= now || h.t > now + RAIN_HOURS * 3600e3) continue;
      if (h.heavy || h.storm || h.mm >= RAIN_MM) {
        const what = h.storm ? 'Thunderstorm' : 'Heavy rain';
        const at = new Date(Math.max(h.t, now)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: s.tz });
        const amount = h.mm > 0 ? ` (${h.mm.toFixed(1)} mm an hour)` : '';
        msgs.push({ title: `${what} ahead`, body: `${s.name}: ${what.toLowerCase()} expected around ${at}${amount}. Forecast: ${PROVIDERS[source]}.`, tag: 'rcbw-rain' });
        sent.rainAt = now;
        break;
      }
    }
  }
  return msgs;
}

// ---------------------------------------------------------------- Web Push (VAPID, RFC 8292)

let signingKey;
async function vapidJwt(aud, env) {
  signingKey ||= await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

export async function sendPush(endpoint, env) {
  const aud = new URL(endpoint).origin;
  return fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${await vapidJwt(aud, env)}, k=${env.VAPID_PUBLIC}`, TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
  });
}

// ---------------------------------------------------------------- OpenWeatherMap key encryption

let aesKey;
async function aes(env) {
  aesKey ||= await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.KEY_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return aesKey;
}
export async function encrypt(text, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(env), new TextEncoder().encode(text)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
export async function decrypt(blob, env) {
  const [iv, ct] = blob.split('.').map(fromB64url);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aes(env), ct));
}

// ---------------------------------------------------------------- helpers

const round2 = n => Math.round(n * 100) / 100;
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
async function sha(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const ok = env.ALLOWED_ORIGINS.split(',').includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : 'https://rananjaya.github.io', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' };
}
