// RCB Weather alerts: Web Push for bad air and heavy rain, even when the app is closed.
//
// Stored per device (Cloudflare KV, key "sub:<sha256(endpoint)>"): the browser's push
// subscription, the place (rounded to ~1 km), its name, time zone and what was already sent.
// Every 15 minutes the forecast and air quality are checked (Open-Meteo); when an alert is due, the
// message is saved under "msg:<id>" (kept 1 day) and an empty push is sent. The app's service
// worker then fetches the message from /messages and shows it. Pushes carry no data, so no
// payload encryption is needed; only the VAPID signature.

const AQI_LEVELS = [ // US EPA AQI, same as the app
  [50, 'Good', ''], [100, 'Moderate', ''],
  [150, 'Unhealthy for sensitive groups', 'Sensitive groups should reduce long outdoor effort.'],
  [200, 'Unhealthy', 'Everyone should reduce long or heavy outdoor effort.'],
  [300, 'Very unhealthy', 'Avoid long outdoor effort.'],
  [Infinity, 'Hazardous', 'Stay indoors and keep activity low.'],
];
const HEAVY = new Set([65, 82]);          // WMO: heavy rain, violent showers
const STORM = new Set([95, 96, 99]);      // WMO: thunderstorm
const RAIN_MM = 5;                        // mm in one hour counts as heavy
const RAIN_HOURS = 6;
const RAIN_GAP_MS = 3 * 3600e3;
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)$/;

export default {
  async fetch(req, env) {
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
        const id = await sha(s.endpoint);
        const old = await env.SUBS.get('sub:' + id, 'json');
        const moved = !old || old.lat !== round2(lat) || old.lon !== round2(lon);
        await env.SUBS.put('sub:' + id, JSON.stringify({
          sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          lat: round2(lat), lon: round2(lon), name: String(b.name || 'Your location').slice(0, 60),
          tz: validTz(b.tz), sent: moved ? {} : old.sent || {}, since: old?.since || Date.now(),
        }));
        let pushed = null;
        if (b.welcome) { // confirm the whole push path with a real push
          await env.SUBS.put('msg:' + id, JSON.stringify([{ title: 'RCB Weather alerts are on', body: `You will be told about bad air and heavy rain ahead for ${String(b.name || 'your place').slice(0, 60)}, even when the app is closed.`, tag: 'rcbw-test' }]), { expirationTtl: 86400 });
          pushed = (await sendPush(s.endpoint, env)).status;
        }
        return json({ ok: true, id, pushed });
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

  // One weather and one air-quality request per 50 distinct places.
  const places = [...new Map(subs.map(s => [`${s.lat},${s.lon}`, { lat: s.lat, lon: s.lon }])).values()];
  const data = new Map();
  for (let i = 0; i < places.length; i += 50) {
    const batch = places.slice(i, i + 50);
    const q = `latitude=${batch.map(p => p.lat).join(',')}&longitude=${batch.map(p => p.lon).join(',')}`;
    const [wx, aq] = await Promise.all([
      getJson(`https://api.open-meteo.com/v1/forecast?${q}&hourly=precipitation,weather_code&forecast_hours=${RAIN_HOURS + 1}&timeformat=unixtime&timezone=GMT`),
      getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi&timeformat=unixtime&timezone=GMT`),
    ]);
    const wl = Array.isArray(wx) ? wx : [wx], al = Array.isArray(aq) ? aq : [aq];
    batch.forEach((p, j) => data.set(`${p.lat},${p.lon}`, { wx: wl[j], aq: al[j] }));
  }

  let sent = 0;
  for (const s of subs) {
    const d = data.get(`${s.lat},${s.lon}`);
    if (!d) continue;
    const msgs = alertsFor(s, d, now);
    if (!msgs.length) continue;
    const id = s.key.slice(4);
    const queued = (await env.SUBS.get('msg:' + id, 'json')) || [];
    await env.SUBS.put('msg:' + id, JSON.stringify([...queued, ...msgs].slice(-5)), { expirationTtl: 86400 });
    const res = await sendPush(s.sub.endpoint, env);
    if (res.status === 404 || res.status === 410) { await env.SUBS.delete(s.key); await env.SUBS.delete('msg:' + id); continue; }
    const { key, ...rest } = s;
    await env.SUBS.put(key, JSON.stringify(rest));
    if (res.ok) sent++;
  }
  return { checked: subs.length, sent };
}

// Same rules as the app: air above US AQI 100 (again only if it gets worse the same local day);
// heavy rain, thunderstorm or ≥ 5 mm in an hour within 6 hours (at most once every 3 hours).
export function alertsFor(s, { wx, aq }, now) {
  const msgs = [];
  const sent = s.sent || (s.sent = {});
  const aqi = aq?.current?.us_aqi;
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: s.tz });
  if (aqi > 100) {
    const level = AQI_LEVELS.findIndex(([max]) => aqi <= max);
    if (sent.aqiDay !== day || (sent.aqiLevel ?? -1) < level) {
      const [, label, advice] = AQI_LEVELS[level];
      msgs.push({ title: `Air quality: ${label}`, body: `${s.name}: US AQI ${Math.round(aqi)}. ${advice}`, tag: 'rcbw-air' });
      sent.aqiDay = day; sent.aqiLevel = level;
    }
  }
  const h = wx?.hourly;
  if (h?.time && now - (sent.rainAt || 0) > RAIN_GAP_MS) {
    for (let i = 0; i < h.time.length; i++) {
      const t = h.time[i] * 1000, code = h.weather_code[i], mm = h.precipitation[i] ?? 0;
      if (t < now - 3600e3 || t > now + RAIN_HOURS * 3600e3) continue;
      if (HEAVY.has(code) || STORM.has(code) || mm >= RAIN_MM) {
        const what = STORM.has(code) ? 'Thunderstorm' : 'Heavy rain';
        const at = new Date(Math.max(t, now)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: s.tz });
        const amount = mm > 0 ? ` (${mm.toFixed(1)} mm in that hour)` : '';
        msgs.push({ title: `${what} ahead`, body: `${s.name}: ${what.toLowerCase()} expected around ${at}${amount}.`, tag: 'rcbw-rain' });
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

// ---------------------------------------------------------------- helpers

const round2 = n => Math.round(n * 100) / 100;
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'RCBWeatherAlerts/1.0 (+https://github.com/Rananjaya/RCB_Weather)' } });
  if (!r.ok) throw new Error(`${url.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const ok = env.ALLOWED_ORIGINS.split(',').includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : 'https://rananjaya.github.io', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' };
}
