# RCB Weather

A live weather dashboard in plain HTML, CSS and JavaScript — no build step, no dependencies.

- **Providers:** MET Norway (default, no key), Open-Meteo (no key), OpenWeatherMap (your own key).
- **Location:** your current location (browser permission) or search any city or village.
- **Shows:** temperature, feels like, wind speed and direction, gusts, humidity, dew point,
  pressure, chance of rain, precipitation, cloud cover, UV index, visibility, sunrise and sunset;
  next 24 hours (with rain chance and wind) and next days (with rain, wind and UV); °C / °F.
- **Air quality:** US AQI with level and advice, PM2.5, PM10, ozone, NO₂, SO₂, CO (Open-Meteo /
  Copernicus CAMS, no key; shown for every provider).
- **Live:** refreshes every 5 minutes and when you return to the tab; live clock.
- **Icons:** the original RCB Wake weather icons (`icons/`).

## Run

Geolocation needs `https://` or `localhost`, so serve the folder:

```sh
cd www && python3 -m http.server 8080
# open http://localhost:8080
```

A place can also be set in the address: `?lat=6.93&lon=79.86&name=Colombo`.

## Data and privacy

Requests go straight from the browser to the chosen provider with rounded coordinates (about
1 km). Place search uses Open-Meteo geocoding (GeoNames data). Settings are kept in the browser's
local storage only. Weather data: MET Norway (CC BY 4.0), Open-Meteo (CC BY 4.0), OpenWeather.

## Apps

| Platform | How |
| --- | --- |
| Windows (desktop) | `dist/RCB-Weather-Windows-x64.zip` → unzip → run `RCB Weather.exe`. Opens full screen (F11 / Esc to leave). Rebuild: `npm install`, then copy `www/` into `dist/RCB Weather-win32-x64/resources/app/www`. |
| iPhone / iPad | `npm run ios` opens the Xcode project; choose your Apple ID team under Signing & Capabilities and run on your device. Full screen, status bar hidden. |
| macOS | `dist/RCB-Weather-macOS-arm64.zip` → unzip → open `RCB Weather.app` (Apple silicon). First launch: right-click → Open. |
| Any device (browser / PWA) | https://rananjaya.github.io/RCB_Weather/ (GitHub Pages, deployed by `.github/workflows/pages.yml`) → "Install app" (Edge/Chrome) or Safari → Share → Add to Home Screen. Works offline with the last weather. |
