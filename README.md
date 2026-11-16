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
