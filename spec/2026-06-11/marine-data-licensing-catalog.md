# Free Marine Data Sources: A Commercial Licensing & Access Catalog

## TL;DR
- **The cleanest legal foundation for a paid "single pane of glass" service is US Government public-domain data (all NOAA: GFS, HRRR, NAM, WaveWatch III, RTOFS, NDBC, CO-OPS tides, ENC charts, US National Ice Center) plus CC-BY-4.0 sources (ECMWF open data since 1 Oct 2025, DWD ICON, MET Norway, Copernicus Marine/Sentinel) — all of which explicitly permit commercial use, redistribution, proxying, and local caching with attribution.**
- **The dangerous sources to avoid proxying/caching are the per-user-licensed or non-commercial ones: Open-Meteo's hosted API (non-commercial only — must self-host for commercial), WorldTides (no multi-user caching, "not for navigational purposes"), UKHO Admiralty EasyTide/charts (paid only), most national ENCs locked behind paid IC-ENC/PRIMAR, OSM's public tile server (no commercial/offline use), and Google tiles.**
- **For nautical charts, only NOAA (US) and LINZ (New Zealand) offer truly free official ENCs; everyone else (UK, Norway, Brazil, Argentina, Chile) routes through the paid IC-ENC or PRIMAR distributors — so plan to license charts as a paid input or build coverage from NOAA ENC + OpenSeaMap (ODbL/CC-BY-SA).**

## Key Findings

1. **Public-domain US federal data is your backbone.** Everything NOAA/NWS/NCEP produces is a US Government work, open under the NOAA Open Data Dissemination (NODD) policy: "NOAA data disseminated through NODD are open to the public and can be used as desired." This covers global weather (GFS), wave (WaveWatch III), regional (HRRR, NAM), ocean (RTOFS), observations (NDBC buoys), tides/currents (CO-OPS), charts (ENC), and ice (USNIC). No attribution legally required; commercial use, redistribution, proxying and caching all permitted.

2. **ECMWF became fully open on 1 October 2025.** Per the ECMWF Product Distribution Rules: "As of 1 October 2025, the Real-time Catalogue Products and Advanced Web Services are... released under the Creative Commons Attribution 4.0 International Public Licence (CC BY 4.0), which permits copy and redistribution... in any medium or format for any purpose, including Commercial Use." A free subset (0.25°, GRIB2) is on the open-data portal and mirrored on AWS/Google/Azure.

3. **Open-Meteo is a trap for a paid service.** Per Open-Meteo's Terms: "The free API is for non-commercial use, rate-limited to 10,000 calls/day" (5,000/hour, 600/minute). Commercial use requires a paid plan (Standard "$29 per month and provides 1 million API calls per month," Professional 5M/mo, Enterprise 50M+/mo) or self-hosting the AGPLv3 server. The underlying data is CC-BY-4.0, but the convenient free endpoint cannot be used commercially.

4. **CMEMS (Copernicus Marine) permits commercial value-added products and redistribution** under its licence, but requires account registration and DOI-based attribution — important for currents, SST, chlorophyll, and global wave/physics models.

5. **Charts are the hardest licensing problem.** Free official ENCs exist only for the US and NZ; all other major nations distribute through the paid RENCs IC-ENC (UKHO-run) or PRIMAR (Norway-run). OpenSeaMap fills gaps as crowd-sourced data (ODbL data / CC-BY-SA tiles) usable commercially with share-alike obligations.

6. **Several "free" tide/water-level sources forbid the exact pattern you need.** WorldTides prohibits multi-user server caching and navigational use; UKHO EasyTide is view-only and "must not be used by vessels for navigation"; Australian BOM tides are © Commonwealth and need permission for commercial reuse. By contrast NOAA CO-OPS (US) and Germany's PEGELONLINE (DL-DE-Zero, public-domain-equivalent) are ideal.

## Details

### 1. WEATHER

**NOAA NOMADS (GFS, GFS-Wave/WaveWatch III, HRRR, NAM, NBM, RTOFS)** — *the core free weather backbone.*
- Data: GFS global (0.25°/0.5°/1°, atmospheric+surface), GFS-Wave/WaveWatch III (significant wave height, period, direction; GWES ensemble), HRRR (3 km CONUS+Alaska, hourly, convection-allowing), NAM (North American Mesoscale), RTOFS ocean.
- Coverage: global (GFS, WW3, RTOFS), CONUS/Alaska (HRRR), North America (NAM).
- Access: HTTPS bulk download; **GRIB filter** (`https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl`, `filter_hrrr_2d.pl`) for variable/level/region subsetting; OpenDAP/GrADS Data Server; partial-file download via `.idx` + get_inv.pl/get_grib.pl. Also mirrored free on AWS (`registry.opendata.aws/noaa-gfs-bdp-pds`, `noaa-hrrr-pds`, `noaa-rtofs`), Google, Azure.
- Format: GRIB2 (CCSDS compression on some); NetCDF/HYCOM a/b for RTOFS.
- Update: GFS 4×/day (00/06/12/18Z), out to 384 h; HRRR hourly; NAM; WW3 with GFS cycles.
- License: **US Government public domain (NODD)** — commercial use, redistribution, caching all permitted.
- Rate limits: NOMADS has blacklists for abusive automated use; the open-data portal limits concurrent connections — for production, prefer the AWS/cloud mirrors.
- Docs: `https://nomads.ncep.noaa.gov/`, `https://www.nco.ncep.noaa.gov/pmb/products/gfs/`, `https://www.nco.ncep.noaa.gov/pmb/products/hrrr/`, `https://polar.ncep.noaa.gov/waves/`.

**ECMWF Open Data (IFS, AIFS)** — *premium global model, newly fully open.*
- Data: IFS deterministic + ensemble, AIFS (AI model), wave fields; surface + pressure levels.
- Coverage: global.
- Access: open-data portal (`https://data.ecmwf.int/forecasts/`), `ecmwf-opendata` Python client, mirrors on AWS/Google/Azure.
- Format: GRIB2 (CCSDS), 0.25° free subset (9 km coming later in 2026 with 2-h latency).
- Update: 00/06/12/18Z; ~1 h delay vs operational on third-party mirrors.
- License: **CC-BY-4.0** since 1 Oct 2025; "permits copy and redistribution... for any purpose, including Commercial Use." Attribution example from ECMWF: "Adapted from 'ECMWF IFS 15-day Forecast Data' by ECMWF, licensed under CC BY 4.0, available at https://data.ecmwf.int/forecasts/".
- Limits: **access to the Open-Data Portal is "limited to 500 simultaneous connections"**; high-volume needs a paid delivery Service Agreement (data itself is free).
- Docs: `https://www.ecmwf.int/en/forecasts/datasets/open-data`.

**DWD ICON (Germany — ICON global, ICON-EU, ICON-D2; GWAM/EWAM/CWAM waves)** — *high-resolution, free.*
- Data: ICON global (13 km), ICON-EU nest (~7 km), ICON-D2 (2.2 km, Central Europe), plus DWD wave models.
- Access: DWD Open Data Server `https://opendata.dwd.de/weather/nwp/` (HTTPS directory tree); files are GRIB2 in `.bz2`, **deleted after ~24 h** (must cache locally). Pre-cut sailing-area GRIBs at OpenSkiron.
- Format: GRIB2 (triangular native grid or regular lat/lon); convert with cdo/eccodes.
- Update: ICON global 4×/day; ICON-EU to +120 h; ICON-D2 every 3 h.
- License: open under DWD's GeoNutzV — free use including commercial, with source attribution. Caching explicitly necessary (files expire).
- Docs: `https://www.dwd.de/EN/ourservices/nwp_forecast_data/nwp_forecast_data.html`.

**Météo-France (ARPEGE, AROME)** — global ARPEGE + high-resolution AROME (France/Western Europe). Available on the Météo-France open-data portal (meteo.data.gouv.fr) under Etalab/CC-BY-style licensing; GRIB2; accessible also via Open-Meteo's aggregation. (Confirm current API key requirements on the portal.)

**Open-Meteo (aggregator incl. Marine API)** — *convenient but non-commercial hosted.*
- Data: unified JSON API aggregating GFS/HRRR, ICON, AROME/ARPEGE, IFS, JMA, GEM, MET Norway; **Marine Weather API** (`/v1/marine`) gives wave height/direction/period from local+global models.
- Access: REST/JSON, no API key, CORS; `https://open-meteo.com/en/docs/marine-weather-api`.
- License: data CC-BY-4.0, but per Open-Meteo Terms "The free API is for non-commercial use, rate-limited to 10,000 calls/day." Commercial requires a paid plan (Standard $29/mo = 1M calls; Professional 5M; Enterprise 50M+) or self-hosting the AGPLv3 server (which then allows unrestricted commercial use, with source-disclosure obligations).
- Recommendation: for a paid product, **self-host Open-Meteo** or use a paid plan — do not proxy the free endpoint.

**MET Norway / Yr API (api.met.no)** — *global point forecasts, commercial OK.*
- Data: Locationforecast 2.0 (global), Oceanforecast 2.0 (NW Europe waves/currents), Nowcast, MetAlerts, ice service.
- Access: REST/JSON; **mandatory identifying User-Agent** (blank/generic = 403); honor `Expires`/`If-Modified-Since`; round coords to ≤4 decimals.
- License: **NLOD 2.0 + CC-BY-4.0 — commercial use allowed** with attribution ("Data from MET Norway"). Global model NetCDF on thredds.met.no is restricted to Nordic/Arctic for licensing reasons.
- Docs: `https://api.met.no/`.

**NOAA NDBC buoys** — *real-time marine observations.*
- Data: standard met (wind, pressure, air/sea temp), spectral waves, ADCP currents, ocean data. Per NOAA NDBC, the core moored network is "about 90 buoys and 60 Coastal Marine Automated Network (C-MAN) stations" (plus partner/IOOS/drifting/ship reports the site aggregates).
- Access: HTTPS flat files `https://www.ndbc.noaa.gov/data/realtime2/<STATION>.txt` (last 45 days); historical archives; XML active-station list; (FTP being deprecated). Community `ndbc-api` Python lib. Also via IOOS/ERDDAP, Synoptic.
- Format: whitespace-delimited text, plus `.spec`, `.ocean`, etc.
- License: US Government public domain. Request: limit retrieval rate (hourly data ready ~25 min past the hour).

**OpenWeatherMap free tier** — REST/JSON; free tier requires API key; commercial use allowed on appropriate paid tiers but data is proprietary (not redistributable in bulk). Use as a supplementary convenience, not a cacheable bulk source. (Verify current free-tier call limits.)

**Saildocs / SailMail** — free email-based GRIB delivery (GFS, COAMPS, RTOFS, WW3) for low-bandwidth offshore users; sources are NOAA/NCEP public-domain data. Useful as a model/UX reference; not a server-side bulk source. `http://www.saildocs.com/`. XyGrib/zyGrib (GPLv3 viewers) pull from the same NOAA/DWD free sources.

**METAR / aviation & GMDSS/NAVTEX text** — METARs via NWS/aviationweather.gov (public domain). NAVTEX/GMDSS Maritime Safety Information text via NGA MSI (see Navigation Aids below).

### 2. TIDES

**NOAA CO-OPS Tides & Currents API** — *the gold standard, free.*
- Data: real-time water levels (6-min, 1-min during events), tide predictions (harmonic + subordinate), tidal current predictions, met obs, datums, harmonic constituents, sea-level trends.
- Coverage: US coasts, Great Lakes, US-affiliated + some global partner stations (>200 NWLON stations).
- Access: REST `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`; Metadata API (`/mdapi/prod/`); Derived Products API. Formats: JSON, XML, CSV, KML, NetCDF.
- Limits: high/low predictions up to 10 years; 6-min predictions 1 year/request. Ask to include an app/organization name parameter.
- License: US Government public domain.
- Docs: `https://api.tidesandcurrents.noaa.gov/api/prod/`, URL builder at `https://tidesandcurrents.noaa.gov/api-helper/url-generator.html`.

**Canadian Hydrographic Service (CHS) — IWLS REST API** — *free under licence.*
- Data: water-level predictions, observations, forecasts; >800 stations across Canada; datums, currents, water temp where available.
- Access: REST/JSON `https://api-iwls.dfo-mpo.gc.ca` (Swagger UI `/swagger-ui/index.html`; paths like `/api/v1/stations/{id}/data?time-series-code=wlp`). SPINE St. Lawrence forecast API separate.
- License: **requires accepting the CHS Licence Agreement** (`https://www.tides.gc.ca/en/licence-agreement`); also listed on open.canada.ca. Verify the commercial-redistribution clause directly before deployment.
- Rate limits: per-IP, HTTP 429 on exceed.

**Germany — PEGELONLINE (WSV)** — *best-in-class free terms.*
- Data: federal-waterway gauges (inland + coastal), water level + parameters; last 30 days retained. Per ITZBund's 14 June 2024 release the network "currently comprises ca. 800 gauges with over 630,000 measurements per day" ("ca. 800 Pegel mit über 630.000 Messwerten pro Tag"); govdata lists ~660 currently active.
- Access: REST `https://www.pegelonline.wsv.de/webservices/rest-api/v2` (JSON/CSV/PNG), no auth; also WMS/WFS/SOS.
- License: **DL-DE-Zero-2.0 — public-domain-equivalent**: commercial use and redistribution permitted, no attribution required.
- Docs: `https://www.pegelonline.wsv.de/webservice/dokuRestapi`.

**SHOM (France) — data.shom.fr** — tide prediction services, REFMAR sea-level observations; open datasets under **CC-BY-SA 4.0**, but **integration into a paid service requires a separate royalty licence** ("s'il souhaite les intégrer dans un service payant, il devra passer par un autre type de licence avec redevance"). REFMAR downloads capped at 31 days/request. Flag for commercial use.

**Australia — BOM tides** — predictions free to view but **© Commonwealth of Australia; commercial reuse needs permission** plus mandated copyright + disclaimer. Not freely cacheable/redistributable by default.

**UK — UKHO Admiralty EasyTide** — free 7-day predictions for 600+ British Isles ports, **view-only, "must not be used by vessels for navigation," no scraping/redistribution.** Commercial use requires paid ADMIRALTY Tidal Prediction Service / UK Tidal APIs / TotalTide.

**WorldTides API** — global; free trial (100 credits/month), then ~$1.99/1,000 credits. **Critical: prohibits server-side caching for multiple users and states "you may not use this data... for navigational purposes."** Proprietary (Brainware LLC). Largely unsuitable for a cacheable nav backend.

**Global tide models (self-hostable, compute locally):**
- **FES2022 / FES2014 (AVISO/CNES)**: global tidal atlases (34+ constituents, 1/16°–1/30° grids), NetCDF; **heights usable for any purpose including commercial** (FES2022 heights, FES2014 heights). FES2014 *currents* are scientific-use only. Free download requires AVISO+ registration (FTP/SFTP/THREDDS). Prediction engine: PyFES (open source). Attribution required. `https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes.html`.
- **EOT20, GOT, TPXO, HAMTIDE** — alternatives; check each licence (TPXO requires a commercial licence).
- **XTide / harmonic constituents**: XTide software is GPL, but the US harmonic constituents it historically used were withdrawn from public distribution by NOAA; current free harmonic data should be sourced from the CO-OPS API. Verify constituent licensing before bundling.

### 3. CURRENTS

- **NOAA RTOFS (Global, 1/12° HYCOM-based)**: temp, salinity, currents, SSH, sea ice; NetCDF + GRIB2; daily, nowcast + 8-day forecast; via NOMADS + AWS (`registry.opendata.aws/noaa-rtofs`); US Government public domain. `https://polar.ncep.noaa.gov/global/`.
- **HYCOM Consortium**: global/regional ocean (temp, salinity, currents, SSH); "UNCLASSIFIED, DoD Distribution A, Approved for Public Release; Distribution Unlimited" — free/public, provided "as is." `https://www.hycom.org/`.
- **NCOM (Navy regional)** and **Global RTOFS** also available as GRIB2 via NOMADS and `ftp.ocean.weather.gov`.
- **NOAA OSCAR** (satellite-derived surface currents, NASA/PODAAC): free, requires Earthdata login; also email-deliverable via Sarana.
- **CMEMS global/regional ocean physics** (currents): free with registration, commercial value-added permitted with DOI attribution.
- **NOAA tidal current predictions**: via CO-OPS API (currents product, harmonic + subordinate stations).
- **IOOS HF-radar surface currents**: ~183 radars in US waters; near-real-time hourly/25-h-averaged surface currents; NetCDF on-demand via NDBC; WMS/OPeNDAP via IOOS; US Government public domain. `https://hfradar.ioos.us/`.

### 4. SEA CHARTS / NAUTICAL CHARTS

- **NOAA ENC (S-57)** — *free, official, the anchor for US coverage.* The legacy suite was "over 1200 irregularly shaped cells, compiled in over 100 scales"; under NOAA's rescheming program the new gridded scheme "will ultimately comprise over 7,000 cells in only 12 standard scales," covering US coastal waters + Great Lakes + EEZ. Bulk download by cell/region (`https://nauticalcharts.noaa.gov/charts/noaa-enc.html`, `https://www.charts.noaa.gov/ENCs/ENCs.shtml`); updated weekly (new update cells each weekday). **Traditional paper/RNC raster charts and the RNC Tile/Seamless services were fully sunset by January 2025.** Replacement display services (rendered ENC tiles, free): ENC Online/ECDIS Display Service (WMS) and **NOAA Chart Display Service (WMTS)** with paper-chart symbology, plus **MBTiles download** for offline. ENC Direct to GIS exports S-57 to GIS/CAD formats. NOAA ENCs downloaded from Coast Survey are free (IC-ENC value-added resellers charge a fee). Public domain.
- **USACE Inland ENC (IENC)** — free, for US rivers; same IHO format.
- **S-101**: next-gen ENC under IHO S-100 model, gradually being produced; plan for the S-57→S-101 transition.
- **Other nations**: Free official ENCs essentially only **US (NOAA)** and **New Zealand (LINZ)**. All others distribute via paid RENCs: **IC-ENC** (UKHO-operated; Brazil, Argentina, Chile, many others) or **PRIMAR** (Norway-operated). Brazil's raster (RNC/BSB) is free but **explicitly non-commercial** (DHN holds copyright; commercial use needs an EMGEPRON agreement). UK AVCS, Norway via PRIMAR distributors — all paid.
- **OpenSeaMap / OSM seamarks** — *free, crowd-sourced, commercially usable.* Seamarks, buoys, lights, harbors, depth (crowd-sourced), port handbook. Underlying OSM data under **ODbL**; rendered seamark tiles under **CC-BY-SA 2.0** — commercial use allowed with attribution + share-alike. Tiles at `https://map.openseamap.org/`; data via OSM. Not a substitute for official charts (state this in-product). Self-host tiles for a commercial service.

### 5. BATHYMETRY / DEPTH

- **GEBCO global grid (GEBCO_2026)** — *public domain, the global baseline.* 15-arc-second global terrain (ocean+land); NetCDF, GeoTIFF, Esri ASCII; plus TID source-type grid. "The GEBCO Grid is placed in the public domain and may be used free of charge... Commercially exploit the GEBCO Grid, by... including it in their own product or application." WMS available. Download via BODC/CEDA + OPeNDAP. `https://www.gebco.net/data-products/gridded-bathymetry-data`. **Not navigation-grade.**
- **EMODnet Bathymetry (Europe)** — DTM at 1/16 arc-min (~115 m) for all European seas + Caribbean; WMS/WMTS (EBWBL world base layer), download portal; free and open (EU). `https://emodnet.ec.europa.eu/en/bathymetry`.
- **NOAA NCEI** (multibeam, BAG, DEMs), **NOAA BlueTopo** (US modern bathymetric coverage), **ETOPO** (global relief), **IHO DCDB** (crowd-sourced bathymetry) — all free, US Government / open. **SRTM / Copernicus DEM** for land elevation (Copernicus DEM open; commercial OK).
- Caveat throughout: these are survey/scientific-grade, **not navigation-grade** — must not be presented as a substitute for charted depths.

### 6. AIS / VESSEL TRAFFIC

- **AISHub** — free AIS data-sharing exchange; you must feed your own receiver to get access to the pooled JSON/XML feed; global where contributors exist. `https://www.aishub.net/`.
- **Norwegian Coastal Administration / BarentsWatch** — free real-time AIS within the Norwegian EEZ + Svalbard/Jan Mayen (excludes fishing <15 m and leisure <45 m). Raw TCP/IP IEC 62320-1 stream, or REST API via BarentsWatch (OAuth client_credentials, scope `ais`). **NLOD licence** (open, commercial OK). `https://developer.barentswatch.no/docs/AIS/live-ais-api/`, `https://www.kystverket.no/en/...ais/access-to-ais-data/`.
- **aprs.fi / SDR receiver networks** — community AIS; check per-site terms.
- **MarineTraffic / VesselFinder** — proprietary, paid APIs; free web view only; **not redistributable**. Treat as paid optional integrations.

### 7. NAVIGATION AIDS & SAFETY

- **NGA Maritime Safety Information (MSI)** — *free, US Government.* US Notice to Mariners, Sailing Directions, List of Lights, World Port Index, Radio Navigational Aids (Pub 117), NAVAREA IV/XII warnings, broadcast warnings. Web app + **REST API** (`https://msi.nga.mil/`, downloads via `https://msi.nga.mil/api/publications/download?...`); formats incl. PDF, and warnings exportable as TXT/GeoJSON/KML. Public domain (US Government work).
- **USCG Local Notice to Mariners** — free PDF/web; public domain.
- **NOAA / NWS** coastal & offshore text forecasts, marine warnings — public domain.

### 8. OTHER MARINE DATA

- **Sea surface temperature, ocean color/chlorophyll**: CMEMS (registration, commercial value-added OK), NASA (PODAAC/OceanColor, Earthdata login, open), NOAA Coral Reef Watch / NESDIS (public domain).
- **Ice charts**:
  - **US National Ice Center** — public domain; Shapefile, KMZ, GeoTIFF (IMS 1/4 km), GRIB, NetCDF, SIGRID-3; Arctic/Antarctic/Great Lakes. `https://usicecenter.gov/`.
  - **MET Norway / Norwegian Ice Service (cryo.met.no)** — Svalbard/Barents daily charts; Shapefile + zipped SIGRID-3; **NLOD 2.0 / CC-BY-4.0, commercial OK** with attribution.
  - **Canadian Ice Service (ECCC)** — daily/regional charts; Shapefile (SIGRID-3); **Open Government Licence – Canada, commercial OK** with attribution. `https://open.canada.ca/data/dataset/c80b950d-0a0a-44ed-87cc-53f69354750b`.
- **Tsunami / storm surge warnings**: NOAA Tsunami Warning Centers, CO-OPS, NWS — public domain.
- **Marine protected areas**: Protected Planet (WDPA) — free with attribution, some commercial restrictions (verify); Marine Regions (marineregions.org) maritime boundaries (CC-BY).
- **Port/marina databases**: NGA World Port Index (public domain); OpenStreetMap/OpenSeaMap harbor data (ODbL).
- **River gauges (inland boating)**: USGS Water Services REST API (`waterservices.usgs.gov`) — public domain; real-time streamflow/gauge height; JSON/WaterML.
- **Great Lakes**: NOAA GLERL / CoastWatch (GLCFS/GLOFS) — public domain.

### 9. BASE MAPS / TILES

- **OpenStreetMap data** — ODbL, free incl. commercial (attribution + share-alike on derived data). **But the public tile server (tile.openstreetmap.org) is NOT for heavy/commercial/offline use** — "OpenStreetMap data is free... Our tile servers are not"; offline/prefetch prohibited; access can be withdrawn from commercial users without notice. **Do not proxy or cache the OSMF tiles for a paid product.**
- **Protomaps** — open-source basemap from OSM as a single PMTiles file you self-host; **download the planet free; commercial use of the hosted CDN API requires GitHub sponsorship**, but self-hosting PMTiles is the intended commercial path (very cheap, fully cacheable). `https://protomaps.com/`.
- **OpenFreeMap** — free self-hostable/hosted OSM vector tiles (no key, permissive); good cacheable alternative.
- **Self-hosted OSM raster/vector tiles** (OpenMapTiles, tileserver-gl) — full control, cacheable, commercial OK (respect OpenMapTiles attribution).
- **ESRI** free tiers (basemaps) — subject to ArcGIS terms/keys; limited free use.
- **USGS topo / The National Map** — public domain (US).
- **Satellite imagery**: **Sentinel-2 / Sentinel-1/3** (Copernicus) — free, full, open, **commercial use permitted**, attribution "Contains modified Copernicus Sentinel data [year]"; via Copernicus Data Space Ecosystem, AWS, Google EE, MS Planetary Computer; GeoTIFF/SAFE/NetCDF. **Landsat** (USGS/NASA) — public domain. ESA-processed Sentinel stills are CC-BY-SA 3.0 IGO.

## Recommendations

**Stage 1 — Build the MVP entirely on public-domain + CC-BY sources (zero licensing risk):**
- Weather: NOAA GFS/HRRR/NAM/WW3 + ECMWF open data, cached on your backend from AWS mirrors. Add DWD ICON (cache aggressively — files expire in 24 h).
- Tides/currents: NOAA CO-OPS (US), CHS IWLS (Canada, accept licence), PEGELONLINE (Germany); compute global tides locally with FES2022 heights (commercial-OK) + PyFES.
- Charts: NOAA ENC + USACE IENC + OpenSeaMap (self-hosted tiles).
- Bathymetry: GEBCO (public domain) + EMODnet (Europe).
- AIS: AISHub (contribute a feed) + BarentsWatch (Nordic).
- Safety: NGA MSI API + USCG LNM.
- Base maps: self-hosted Protomaps/OpenFreeMap PMTiles; Sentinel-2 for satellite layer.
- Observations: NDBC buoys; USGS for inland.

**Stage 2 — Add MET Norway, CMEMS, USNIC/CIS/MET ice, Marine Regions, Coral Reef Watch.** All commercial-OK with attribution; register accounts where needed (CMEMS, Earthdata, AVISO+).

**Stage 3 — License paid inputs only where free coverage is inadequate:** non-US ENCs via IC-ENC/PRIMAR; UKHO Tidal APIs for UK/global ports if FES2022 + CO-OPS + CHS are insufficient; commercial AIS (MarineTraffic) for global vessel coverage.

**Engineering rules that should be hard-coded:**
- Maintain a per-source attribution registry and render required credits in-app (ECMWF, MET Norway, CMEMS DOIs, Copernicus Sentinel, OpenSeaMap/OSM, DWD, AVISO/CNES).
- For share-alike data (OSM/OpenSeaMap ODbL, SHOM CC-BY-SA), keep derived datasets segregated so the share-alike obligation doesn't contaminate proprietary data.
- Never proxy: OSMF tiles, Open-Meteo hosted free API, WorldTides, UKHO EasyTide, Google tiles.
- Cache DWD/ECMWF/NOAA aggressively (they expect it); honor cache headers for MET Norway and PEGELONLINE.

**Thresholds that change the plan:**
- If you need >a few M weather calls/day, self-host Open-Meteo (AGPLv3) rather than buy plans.
- If global vessel tracking becomes a core feature, budget for paid AIS (free sources are coverage-limited).
- If you serve EU paid customers heavily off SHOM data, obtain the SHOM royalty licence.

## Caveats
- **Navigation-grade vs not:** GEBCO/EMODnet/crowd-sourced bathymetry and OpenSeaMap are NOT navigation-grade; you must display official-chart disclaimers and not present them as ECDIS-equivalent. NOAA ENC viewers are explicitly "not certified for navigation"/do not meet carriage requirements.
- **Licence verification:** CHS IWLS commercial-redistribution clause, OpenWeatherMap and Météo-France current free-tier limits, and Protected Planet/WDPA commercial terms should each be re-read in full before launch — these were not fully extractable here.
- **Expiring data:** DWD deletes GRIB after ~24 h; WorldTides/UKHO/BOM forbid the caching pattern you need; MET Norway requires identifying User-Agent and cache-header compliance or you'll be throttled/blocked.
- **The RNC sunset is complete (Jan 2025):** design only around ENC/S-57 (and forthcoming S-101), not raster nautical charts.
- **Share-alike contamination risk:** ODbL (OSM/OpenSeaMap) and CC-BY-SA (SHOM) can impose obligations on derived datasets — isolate them architecturally.
- Some figures (Open-Meteo plan pricing, WorldTides credit costs, OWM limits, PEGELONLINE/NDBC station counts) change over time; treat the specific numbers as of mid-2026 and reconfirm at integration time.