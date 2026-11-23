<p align="center"><img src="www/icons/app-192.png" width="96" alt="RCB Weather logo" /></p>

<h1 align="center">RCB Weather</h1>

<p align="center">
  Live weather, air quality and alerts — in the browser, on Windows, Mac and iPhone.<br />
  <a href="https://rananjaya.github.io/RCB_Weather/"><b>Open the web app</b></a> ·
  <a href="https://github.com/Rananjaya/RCB_Weather/releases/latest">Download for Windows and Mac</a>
</p>

---

## Features

- **Three weather providers:** MET Norway (default, no key), Open-Meteo (no key) and
  OpenWeatherMap (your own API key).
- **Your location or any place:** use your current location, or search any city or village.
- **Everything at a glance:** temperature, feels like, wind speed and direction, gusts,
  humidity, dew point, pressure, chance of rain, precipitation, cloud cover, UV index, sunrise
  and sunset; the next 24 hours and the next days; °C or °F.
- **Air quality:** a colour gauge with the US AQI, its level and advice, plus PM2.5, PM10,
  ozone, NO₂, SO₂, CO and the European AQI.
- **Alerts:** a notification when the air turns bad (US AQI over 100) or heavy rain or a
  thunderstorm is expected in the next 6 hours — on phones and in browsers even when the app is
  closed (push), and in the Windows and Mac apps while they are running.
- **Live:** updates by itself every 5 minutes, when you come back to it and when the internet
  returns; a live clock shows how fresh the data is.
- **Full screen** on every platform, and works offline with the last weather.
- **Original icons:** the colourful day and night weather icons from RCB Wake.

## Get it

| Platform | How |
| --- | --- |
| **Browser** (any device) | Open https://rananjaya.github.io/RCB_Weather/. To install it as an app: **Install app** in Chrome or Edge, or **Share → Add to Home Screen** in Safari on iPhone. |
| **Windows** (64-bit) | Download `RCB-Weather-Windows-x64.zip` from [Releases](https://github.com/Rananjaya/RCB_Weather/releases/latest), extract it and run `RCB Weather.exe`. If Windows warns you, choose **More info → Run anyway**. |
| **Mac** (Apple silicon) | Download `RCB-Weather-macOS-arm64.zip` from [Releases](https://github.com/Rananjaya/RCB_Weather/releases/latest), unzip it and move **RCB Weather.app** to Applications. The first time, open **System Settings → Privacy & Security → Open Anyway**. |
| **iPhone / iPad** | Use the web app above (Add to Home Screen). A native build is in `ios/` (Capacitor). |

In the apps, **Esc** leaves full screen and **F11** goes back to it. The Windows and Mac apps load
the live site, so they stay up to date without a new download.

## Privacy

There are no accounts, ads, analytics or tracking.

- Weather requests go straight from your device to the provider you choose, with your location
  rounded to about 1 km.
- Place search uses Open-Meteo geocoding. With **My location**, the place name (for example
  "Padukka") is looked up from your rounded position with BigDataCloud's free reverse-geocoding
  service; the exact position is never sent.
- Your settings, including an OpenWeatherMap key, are stored only on your device. The key is sent
  only to OpenWeatherMap.
- **Alerts (only if you turn them on):** to send alerts when the app is closed, the RCB Weather
  alerts server (a Cloudflare Worker, `push-worker/`) stores your browser's push address, your
  place rounded to about 1 km, its name, your time zone and the weather provider you chose — and,
  only if that provider is OpenWeatherMap, your API key, encrypted. It checks that place's forecast
  with your provider every 15 minutes (air quality always from Open-Meteo). Push messages are empty; your device fetches the alert text from the server. The
  data is deleted when you turn Alerts off or the push address stops working, and is never shared
  or used for anything else.

## For developers

The web app is plain HTML, CSS and JavaScript in `www/`, with no build step. Location needs
`https://` or `localhost`:

```sh
cd www && python3 -m http.server 8080   # then open http://localhost:8080
```

A place can be set in the address: `?lat=6.93&lon=79.86&name=Colombo`.

| Folder | What |
| --- | --- |
| `www/` | The web app (also used by every app build) |
| `electron/` | Windows and Mac app (Electron) |
| `ios/` | iPhone and iPad app (Capacitor): `npm run ios`, then choose your team in Xcode |
| `push-worker/` | Alerts server (Cloudflare Worker + KV, cron every 15 min): `npx wrangler deploy`. Its private VAPID key is a Worker secret and is not in this repo. |
| `.github/workflows/pages.yml` | Publishes `www/` to GitHub Pages on every push to `main` |

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/Rananjaya/RCB_Weather/issues).
Pull requests are welcome too; by sending one you agree to the contribution terms in
[LICENSE](LICENSE). Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

**Copyright © Rananjaya. All rights reserved.**

RCB Weather is **source-available, not open source**. You may read the code and use the official
website and apps. You may **not** copy, modify, redistribute, host or sell it, or use its icons,
name or logo, **without written permission**. See [LICENSE](LICENSE) for the full terms, and ask
through a [GitHub issue](https://github.com/Rananjaya/RCB_Weather/issues).

Third-party software and data are under their own licences: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Weather data: [MET Norway](https://api.met.no/) (CC BY 4.0), [Open-Meteo](https://open-meteo.com/)
(CC BY 4.0), [OpenWeather](https://openweathermap.org/). Air quality: Copernicus Atmosphere
Monitoring Service via Open-Meteo. Place search: [GeoNames](https://www.geonames.org/) via
Open-Meteo.
