# IO earthpulse

An interactive NASA Earth observation explorer for wildfire thermal anomalies. Explore global and regional FIRMS observations, dated satellite imagery, a 3D globe and timeline replay. Earth Trends and Radar Change are planned previews.

## Data

- NASA FIRMS area API provides MODIS and NOAA-20 VIIRS near-real-time and standard-processing records. Set `FIRMS_MAP_KEY` as a server-side secret; never commit it.
- NASA GIBS provides imagery. True-colour imagery is a daily composite, not live video.
- Records represent observed thermal anomalies, not confirmed fires or fire perimeters. Counts aggregate observations into approximately 2 km cells per UTC day. Data may be incomplete due to coverage and latency; NRT and standard products can differ.
- An optional restricted `GOOGLE_MAPS_BROWSER_KEY` enables embedded map, traffic and Street View. Without it, external links are available. SI analysis is not connected.

## Build

Requires Node.js 18 or later. Run `node scripts/build-worker.mjs` to create `dist/server/index.js`, a Cloudflare Worker-compatible server bundle. Deploy using your preferred Worker deployment system and configure secrets in its environment. The project contains an OpenAI Sites hosting manifest for the existing deployment.

For the deployed application, choose **FIRMS hotspot records**, a region and optional UTC dates, then click **Load FIRMS**. Regional date ranges allow up to 62 days; worldwide requests allow up to five. A historical request uses standard processing and recent requests use near-real-time, with an explicitly labelled archive fallback when the recent feed returns no records.

## Enhancements (Space Apps final round)

- **Fire history · harmonized calendar**: every month on record as a years × months heatmap. MODIS-only months are calibrated to the combined MODIS + VIIRS cell-day scale with a least-squares ratio fitted on months both instruments observed, so years before and after VIIRS compare fairly. Toggle to anomaly vs the median of the same month in other years, see the latest month against history, and a Mann-Kendall test with Sen's slope on yearly totals. Click any month to open it in the explorer. Download the calendar as CSV.
- **Fire Detective**: a three-case game generated from the data on screen (peak day, instrument comparison, season vs median, repeat detections), with score, streak and badges.
- **Earth Trends** (replaces the preview): NASA POWER monthly data since 1981 for a chosen place. Pick a variable (temperature, daily maximum, precipitation, humidity, wind, soil wetness) and season, or a guided question. Shows yearly values, Sen's slope trend, 95% confidence band, Mann-Kendall significance, and a correlation with loaded fire records.
- **NASA Worldview link** on every hotspot, opening the same place and date with thermal-anomaly and true-colour layers.

## Investigation tools

- **Place search** by name (OpenStreetMap Nominatim), next to the coordinate form.
- **Legend and freshness strip**: what the imagery layer shows and its units, what a marker means, sensor pixel sizes, and how recent the loaded records are.
- **Coverage warnings**: days outside the loaded data are hatched in the calendar and called out, separately from days with no records or only one instrument.
- **Synchronized timeline**: the selected day is highlighted in the activity chart (click a bar to jump to that day), the history calendar marks the current month, and the map shows the imagery date.
- **Before / after**: swipe between two dates of MODIS true-colour or false-colour imagery for the current region.
- **Saved views and share links**: save a place and date on this device, or copy a link that reopens the same view.
- **Guided missions**: three missions whose steps tick off as you use the app, with badges.
- **Fuel and weather**: NASA POWER daily rain, temperature, humidity and wind against daily hotspot cell-days, rain in the previous 30 days vs the long-term normal, dry-spell length before the peak, and MODIS NDVI (ORNL DAAC) for vegetation greenness.
- **Sharper imagery when zoomed**: GIBS imagery is re-requested at up to about 2.8× resolution after zooming in.
- **All cells drawn**: cells beyond the 2,500 selectable markers are drawn on a canvas layer instead of being dropped.

## Sharp zoom

The **Sharp zoom** button on the explorer opens a tiled map that zooms to street level, with the loaded hotspot cells on top.

- Imagery: Esri World Imagery (free, about 0.5 m) by default; Google satellite when a key is set in `dist/config.js`.
- Dated NASA layers from GIBS: Harmonized Landsat Sentinel-2 at 30 m, MODIS true colour and false colour 7-2-1.
- Overlays: MODIS aerosol optical depth (smoke), named wildfire events from NASA EONET, place names.
- Setting a Google key also enables the in-app Street detail view on GitHub Pages. Restrict the key to this site and to Map Tiles API, Maps JavaScript API and Street View before committing it.

Leaflet 1.9.4 is vendored in `dist/vendor/` (BSD-2-Clause).

## Tests

`node tests/smoke.mjs` runs 39 browser checks with Playwright against `dist/`, with NASA, ORNL and OpenStreetMap requests mocked so it works offline.

## GitHub Pages

`.github/workflows/pages.yml` publishes `dist/` to GitHub Pages on every push to `main`. The Pages version runs fully in the browser: replay records, CSV import, GIBS imagery, Earth Trends and the game all work. The **FIRMS hotspot records** mode needs the server function and its `FIRMS_MAP_KEY` secret, so use the Worker deployment for that mode, or download CSVs from the FIRMS archive and import them.

## SI disclosure

The application code was written with AI assistance: ChatGPT (OpenAI) for the original app, and Claude (Anthropic) for the enhancements listed above. The team chose the challenge, region, data sources and features. The demo dataset is simulated and labelled as such in the app.

Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m), NASA GIBS, NASA POWER, MODIS MOD13Q1 NDVI via ORNL DAAC, NASA EONET. Sharp imagery © Esri, Maxar, Earthstar Geographics (or © Google with a key). Place search © OpenStreetMap contributors. We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).
