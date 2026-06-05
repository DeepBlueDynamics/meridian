import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useShipData } from "../hooks/useShipData.js";
import WidgetFrame from "./WidgetFrame.jsx";

// DEM tiles for terrain (expects a raster-dem tile template).
// We auto-select Copernicus COGs via titiler; no env override is required or used.

// Build a Copernicus COG URL for a 1x1 tile covering the given lat/lon.
function copernicusCogUrl(lat, lon) {
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  const latBase = Math.floor(lat);
  const lonBase = Math.floor(lon);
  const latTag = `${latBase >= 0 ? "N" : "S"}${Math.abs(latBase).toString().padStart(2, "0")}_00`;
  const lonTag = `${lonBase >= 0 ? "E" : "W"}${Math.abs(lonBase).toString().padStart(3, "0")}_00`;
  const name = `Copernicus_DSM_COG_30_${latTag}_${lonTag}_DEM`;
  return `https://copernicus-dem-90m.s3.amazonaws.com/${name}/${name}.tif`;
}

function buildMosaicJson(lat, lon, padding = 2) {
  const cogUrls = [];
  for (let dlat = -padding; dlat <= padding; dlat++) {
    for (let dlon = -padding; dlon <= padding; dlon++) {
      cogUrls.push(copernicusCogUrl(lat + dlat, lon + dlon));
    }
  }

  return {
    mosaicjson: "0.0.2",
    name: "copernicus-dynamic",
    minzoom: 9,
    maxzoom: 14,
    bounds: [
      Math.floor(lon) - padding,
      Math.floor(lat) - padding,
      Math.floor(lon) + padding + 1,
      Math.floor(lat) + padding + 1
    ],
    tiles: cogUrls.reduce((acc, u, i) => { acc[i] = [u]; return acc; }, {})
  };
}

// AWS Terrain Tiles or Copernicus MosaicJSON via TiTiler
function buildDemTileUrl(lat, lon) {
  const source = import.meta.env.VITE_DEM_SOURCE || "aws";
  const titilerEndpoint = import.meta.env.VITE_TITILER_ENDPOINT || "http://localhost:8081";

  if ((source === "copernicus" || import.meta.env.VITE_TITILER_ENDPOINT) && typeof lat === "number" && typeof lon === "number") {
    const mosaic = buildMosaicJson(lat, lon, 2);
    const base64 = btoa(JSON.stringify(mosaic));
    const dataUrl = `data:application/json;base64,${base64}`;
    return `${titilerEndpoint}/mosaicjson/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?url=${encodeURIComponent(dataUrl)}`;
  }

  return "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
}

// Fix default icon paths for Vite bundling.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).toString(),
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).toString(),
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).toString(),
});

// Simple toggle slider
const Chart = () => {
  const data = useShipData();
  const [zoom] = useState(12);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const containerRef = useRef(null);
  const depthLayerRef = useRef(null);
  const seamarkLayerRef = useRef(null);
  const [seamarkOn, setSeamarkOn] = useState(true);
  const imageryLayerRef = useRef(null);
  const [imageryOn, setImageryOn] = useState(false);
  const [imageryOpacity, setImageryOpacity] = useState(0.6);
  const bathyLayerRef = useRef(null);
  const [bathyOn, setBathyOn] = useState(false);
  const [bathyOpacity, setBathyOpacity] = useState(0.6);
  const [is3D, setIs3D] = useState(false);
  const [follow3D, setFollow3D] = useState(true);
  const [follow2D, setFollow2D] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const measureLineRef = useRef(null);
  const [measureInfo, setMeasureInfo] = useState(null);
  const measureClickRef = useRef({ count: 0, first: null });
  const measureMarkersRef = useRef({ start: null, end: null, label: null, clear: null });
  const [bathyError, setBathyError] = useState(null);
  const measureHandlersRef = useRef({ firstClick: null, move: null });
  const gridLayerRef = useRef(null);
  const [gridOn, setGridOn] = useState(true);
  const [gridStepLabel, setGridStepLabel] = useState(null);
  const map3DRef = useRef(null);
  const map3DContainerRef = useRef(null);
  const vessel3DReadyRef = useRef(false);
  const imagery3DReadyRef = useRef(false);
  const [map3DZoom, setMap3DZoom] = useState(null);
  const [map2DZoom, setMap2DZoom] = useState(null);
  const grid3DReadyRef = useRef(false);
  const grid3DListenerRef = useRef(null);
  const syncLockRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState(null);
  const [searchPending, setSearchPending] = useState(false);
  const [demDebug, setDemDebug] = useState(null);
  const [atMinZoom, setAtMinZoom] = useState(false);
  const [orbitMode, setOrbitMode] = useState(false);
  const orbitAnimRef = useRef(null);



  // Smooth toggle between 2D and 3D with location sync
  const handleToggle3D = () => {
    if (is3D) {
      // Switching from 3D to 2D: stop orbit, flatten first, sync location, then switch
      setOrbitMode(false);
      if (map3DRef.current) {
        const center = map3DRef.current.getCenter();
        const zoom = map3DRef.current.getZoom();

        // Flatten the 3D view first
        map3DRef.current.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 300,
        });

        // After flatten animation, sync 2D map and switch
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.setView([center.lat, center.lng], zoom, { animate: false });
          }
          setIs3D(false);
        }, 320);
      } else {
        setIs3D(false);
      }
    } else {
      // Switching from 2D to 3D: sync location first, then switch
      if (mapRef.current) {
        const center = mapRef.current.getCenter();
        const zoom = mapRef.current.getZoom();
        const minZoom3D = 6;

        if (zoom < minZoom3D) {
          // Zoom is too low for 3D - animate 2D map to min zoom first, then switch
          const latOffset = 0.15; // Shift north to compensate for 3D perspective
          mapRef.current.setView([center.lat + latOffset, center.lng], minZoom3D, {
            animate: true,
            duration: 0.5
          });
          // Wait for animation to complete, then switch to 3D
          setTimeout(() => {
            const newCenter = mapRef.current.getCenter();
            syncLockRef.current = {
              center: [newCenter.lng, newCenter.lat],
              zoom: minZoom3D
            };
            setIs3D(true);
            // Sync existing 3D map position
            if (map3DRef.current) {
              map3DRef.current.jumpTo({
                center: [newCenter.lng, newCenter.lat],
                zoom: minZoom3D
              });
              setTimeout(() => map3DRef.current.resize(), 100);
            }
          }, 550);
        } else {
          // Zoom is fine, switch immediately
          syncLockRef.current = {
            center: [center.lng, center.lat],
            zoom: zoom
          };
          setIs3D(true);
          // Sync existing 3D map position
          if (map3DRef.current) {
            map3DRef.current.jumpTo({
              center: [center.lng, center.lat],
              zoom: zoom
            });
            setTimeout(() => map3DRef.current.resize(), 100);
          }
        }
      } else {
        setIs3D(true);
      }
    }
  };

  // Leaflet 2D map
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      worldCopyJump: true,
      zoomControl: true,
      zoomSnap: 0.25,
    });
    map.setView([data.lat, data.lon], zoom);
    setMap2DZoom(zoom);

    const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OSM",
      maxZoom: 19,
      crossOrigin: true,
      subdomains: ["a", "b", "c"],
      updateWhenIdle: true,
      reuseTiles: true,
      keepBuffer: 4,
    });
    const seamarks = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
      attribution: "© OpenSeaMap",
      maxZoom: 18,
      crossOrigin: true,
      updateWhenIdle: true,
      reuseTiles: true,
      keepBuffer: 4,
    });
    base.addTo(map);
    const seamark = seamarks.addTo(map);
    // Push seamarks to top.
    seamark.setZIndex(1000);

    const imagery = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 18,
        opacity: 0.6,
        reuseTiles: true,
        keepBuffer: 4,
        updateWhenIdle: true,
        crossOrigin: true,
      }
    );
    const bathy = L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        maxNativeZoom: 10, // force upscaling sooner to avoid missing tiles when zoomed in
        opacity: 0.6,
        attribution: "Esri Ocean Base",
        crossOrigin: true,
        updateWhenIdle: true,
        reuseTiles: true,
        keepBuffer: 4,
        errorTileUrl: "",
      }
    );
    bathy.on("tileerror", () =>
      setBathyError("Bathy is coarse at this zoom; zoom out slightly for detail.")
    );
    bathy.on("load", () => setBathyError(null));
    L.control
      .scale({
        position: "bottomleft",
        imperial: false,
        metric: true,
      })
      .addTo(map);

    const vesselIcon = L.divIcon({
      className: "",
      html: vesselIconHtml(data.heading || 0),
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    const marker = L.marker([data.lat, data.lon], { title: "Own Ship", icon: vesselIcon }).addTo(map);
    const depthLayer = L.layerGroup().addTo(map);
    const gridLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    markerRef.current = marker;
    depthLayerRef.current = depthLayer;
    gridLayerRef.current = gridLayer;
    seamarkLayerRef.current = seamark;
    imageryLayerRef.current = imagery;
    bathyLayerRef.current = bathy;

    map.on("zoomend", () => {
      setMap2DZoom(map.getZoom());
    });

    // Continuously sync 2D position for 3D map to pick up
    map.on("moveend", () => {
      const center = map.getCenter();
      syncLockRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
    });

    // Initialize sync position
    syncLockRef.current = { center: [data.lon, data.lat], zoom };

    // Turn off follow2D on user interaction
    map.on("dragstart", () => setFollow2D(false));
    map.on("zoomstart", () => setFollow2D(false));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const { lat, lon, heading = 0 } = data;
    const marker = markerRef.current;
    marker.setLatLng([lat, lon]);
    marker.setIcon(
      L.divIcon({
        className: "",
        html: vesselIconHtml(heading),
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      })
    );

  }, [data, is3D]);

  // Center 2D map on vessel when follow2D is active
  useEffect(() => {
    if (mapRef.current && follow2D && !is3D) {
      mapRef.current.panTo([data.lat, data.lon]);
    }
  }, [data.lat, data.lon, follow2D, is3D]);


  // Render local depth halo near vessel (currently disabled to avoid double circles).
  useEffect(() => {
    if (!depthLayerRef.current || !mapRef.current) return;
    depthLayerRef.current.clearLayers();
  }, [data.lat, data.lon]);

  // Grid-based depth soundings (2D) - fixed lat/lon grid, hidden until hover
  const depthMarkersRef = useRef([]);
  const depthCacheRef = useRef({}); // Cache depths by grid key

  useEffect(() => {
    if (!mapRef.current || is3D) {
      // Clear 2D depth markers
      depthMarkersRef.current.forEach(m => m.remove());
      depthMarkersRef.current = [];
      return;
    }
    const map = mapRef.current;

    const updateDepthGrid = () => {
      // Clear old markers
      depthMarkersRef.current.forEach(m => m.remove());
      depthMarkersRef.current = [];

      const bounds = map.getBounds();
      const zoom = map.getZoom();

      // Calculate grid step based on zoom level (smaller step = more soundings at higher zoom)
      // Roughly: zoom 10 = 0.05°, zoom 12 = 0.02°, zoom 14 = 0.01°, zoom 16 = 0.005°
      const step = Math.max(0.002, 0.1 / Math.pow(2, (zoom - 10) / 2));

      const south = Math.floor(bounds.getSouth() / step) * step;
      const north = Math.ceil(bounds.getNorth() / step) * step;
      const west = Math.floor(bounds.getWest() / step) * step;
      const east = Math.ceil(bounds.getEast() / step) * step;

      // Generate grid points
      for (let lat = south; lat <= north; lat += step) {
        for (let lon = west; lon <= east; lon += step) {
          const gridKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;

          // Get or generate depth for this grid point (cached)
          if (!depthCacheRef.current[gridKey]) {
            // Generate pseudo-random but consistent depth based on coordinates
            // This simulates bathymetry - deeper further from coast, variation by location
            const latFactor = Math.sin(lat * 17.3) * Math.cos(lon * 23.7);
            const lonFactor = Math.cos(lat * 31.1) * Math.sin(lon * 19.9);
            const baseDepth = 15 + Math.abs(latFactor * 25) + Math.abs(lonFactor * 20);
            const variation = (Math.sin(lat * 100) * Math.cos(lon * 100)) * 5;
            depthCacheRef.current[gridKey] = Math.max(0.5, baseDepth + variation);
          }

          const depth = depthCacheRef.current[gridKey];

          const marker = L.marker([lat, lon], {
            icon: L.divIcon({
              className: "",
              html: `<div class="depth-sounding">${depth.toFixed(0)}</div>`,
              iconSize: [24, 12],
              iconAnchor: [12, 6],
            }),
            interactive: false,
          });
          marker.addTo(map);
          depthMarkersRef.current.push(marker);
        }
      }
    };

    // Track mouse position to reveal nearby soundings
    const revealNearby = (e) => {
      const cursorLat = e.latlng.lat;
      const cursorLon = e.latlng.lng;
      const revealRadius = 0.015; // degrees - roughly 1-2 km

      depthMarkersRef.current.forEach((marker) => {
        const pos = marker.getLatLng();
        const dist = Math.sqrt(
          Math.pow(pos.lat - cursorLat, 2) + Math.pow(pos.lng - cursorLon, 2)
        );
        const el = marker.getElement()?.querySelector('.depth-sounding');
        if (el) {
          if (dist < revealRadius) {
            el.classList.add('visible');
          } else {
            el.classList.remove('visible');
          }
        }
      });
    };

    const hideAll = () => {
      depthMarkersRef.current.forEach((marker) => {
        const el = marker.getElement()?.querySelector('.depth-sounding');
        if (el) el.classList.remove('visible');
      });
    };

    updateDepthGrid();
    map.on("moveend zoomend", updateDepthGrid);
    map.on("mousemove", revealNearby);
    map.on("mouseout", hideAll);

    return () => {
      map.off("moveend zoomend", updateDepthGrid);
      map.off("mousemove", revealNearby);
      map.off("mouseout", hideAll);
      depthMarkersRef.current.forEach(m => m.remove());
      depthMarkersRef.current = [];
    };
  }, [is3D]);


  // Grid overlay around the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gridLayerRef.current) return;

    const redraw = () => {
      const grid = gridLayerRef.current;
      grid.clearLayers();
      if (!gridOn) return;
      const bounds = map.getBounds();
      const span = Math.max(bounds.getEast() - bounds.getWest(), bounds.getNorth() - bounds.getSouth());
      const step = Math.max(0.01, span / 8); // aim for ~8 cells across view
      setGridStepLabel(`${(step * 60).toFixed(2)} nm grid`);

      const south = Math.floor(bounds.getSouth() / step) * step;
      const north = Math.ceil(bounds.getNorth() / step) * step;
      const west = Math.floor(bounds.getWest() / step) * step;
      const east = Math.ceil(bounds.getEast() / step) * step;

      for (let lat = south; lat <= north; lat += step) {
        L.polyline(
          [
            [lat, west],
            [lat, east],
          ],
          { color: "#1f2937", weight: 1, opacity: 0.5, dashArray: "4,4" }
        ).addTo(grid);
      }
      for (let lon = west; lon <= east; lon += step) {
        L.polyline(
          [
            [south, lon],
            [north, lon],
          ],
          { color: "#1f2937", weight: 1, opacity: 0.5, dashArray: "4,4" }
        ).addTo(grid);
      }
    };

    redraw();
    map.on("moveend zoomend", redraw);
    return () => {
      map.off("moveend zoomend", redraw);
    };
  }, [gridOn, is3D]);

  // Grid redraw helper for 3D (MapLibre).
  const updateGrid3D = useCallback((map) => {
    if (!map || !grid3DReadyRef.current) return;
    // Don't recalculate grid during orbit - let it rotate naturally
    if (orbitMode) return;
    if (!gridOn) {
      if (map.getSource("grid3d")) {
        map.getSource("grid3d").setData({ type: "FeatureCollection", features: [] });
      }
      setGridStepLabel(null);
      return;
    }
    const b = map.getBounds();
    const spanLat = b.getNorth() - b.getSouth();
    const spanLon = b.getEast() - b.getWest();
    const span = Math.max(spanLat, spanLon);
    const step = Math.max(0.01, span / 8);
    setGridStepLabel(`${(step * 60).toFixed(2)} nm grid`);

    const south = Math.floor(b.getSouth() / step) * step;
    const north = Math.ceil(b.getNorth() / step) * step;
    const west = Math.floor(b.getWest() / step) * step;
    const east = Math.ceil(b.getEast() / step) * step;
    const features = [];
    for (let lat = south; lat <= north; lat += step) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [west, lat],
            [east, lat],
          ],
        },
        properties: {},
      });
    }
    for (let lon = west; lon <= east; lon += step) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [lon, south],
            [lon, north],
          ],
        },
        properties: {},
      });
    }
    if (map.getSource("grid3d")) {
      map.getSource("grid3d").setData({ type: "FeatureCollection", features });
    }
  }, [gridOn, orbitMode]);

  // MapLibre 3D map (bathy-only for now) with tilt/pan/rotate controls.
  useEffect(() => {
    if (!is3D) {
      const timer = setTimeout(() => {
        setAtMinZoom(false); // Reset flash state when leaving 3D
      }, 0);
      return () => clearTimeout(timer);
    }
    if (map3DRef.current || !map3DContainerRef.current) return;

    // Clear 2D-only overlays
    setGridStepLabel(null);
    // Don't auto-follow vessel - use synced position from 2D map
    setFollow3D(false);

    setDemDebug("DEM: probing...");

    const map = new maplibregl.Map({
      container: map3DContainerRef.current,
      attributionControl: false,
      style: {
        version: 8,
        name: "meridian-3d",
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          seamarks: {
            type: "raster",
            tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 18,
          },
          bathy: {
            type: "raster",
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 12,
          },
          imagery: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 17,
          },
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], // single host to avoid {s} DNS issues
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0f172a" },
          },
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: { "raster-opacity": 1.0, "raster-fade-duration": 0, "raster-resampling": "linear" },
            layout: { visibility: "visible" },
          },
          {
            id: "bathy",
            type: "raster",
            source: "bathy",
            paint: { "raster-opacity": bathyOpacity, "raster-fade-duration": 0, "raster-resampling": "linear" },
            layout: { visibility: bathyOn ? "visible" : "none" },
          },
          {
            id: "imagery",
            type: "raster",
            source: "imagery",
            paint: { "raster-opacity": imageryOpacity, "raster-fade-duration": 0, "raster-resampling": "linear" },
            layout: { visibility: imageryOn ? "visible" : "none" },
          },
          {
            id: "seamarks",
            type: "raster",
            source: "seamarks",
            paint: { "raster-opacity": 1.0, "raster-fade-duration": 0, "raster-resampling": "linear" },
            layout: { visibility: seamarkOn ? "visible" : "none" },
          },
        ],
      },
      center: mapRef.current ? [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat] : (syncLockRef.current?.center || [data.lon, data.lat]),
      zoom: Math.max(6, mapRef.current ? mapRef.current.getZoom() : (syncLockRef.current?.zoom || 13)),
      pitch: 0,
      bearing: 0,
      interactive: true,
      antialias: true,
      maxZoom: 18,
      minZoom: 6,
      boxZoom: false,
      keyboard: true,
      dragPan: true,
      dragRotate: true,
      pitchWithRotate: true,
      transformRequest: (url) => {
        // Quietly short-circuit demo terrain tile fetches that would 404.
        if (url.includes("demotiles.maplibre.org/terrain-tiles")) {
          return {
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuMBgkXYKBkAAAAASUVORK5CYII=",
          };
        }
        if (url.includes("elevation-tiles-prod/terrarium")) {
          url = clampTileCoords(url, 12);
        }
        // Overzoom handling: clamp z and adjust x/y so lower-zoom tiles are reused instead of 404.
        if (url.includes("World_Ocean_Base/MapServer/tile/")) {
          url = clampTileCoords(url, 12);
        }
        if (url.includes("World_Imagery/MapServer/tile/")) {
          url = clampTileCoords(url, 17);
        }
        // OpenSeaMap seamarks only have data in certain areas/zooms
        if (url.includes("tiles.openseamap.org/seamark/")) {
          const match = url.match(/\/(\d+)\/\d+\/\d+\.png/);
          if (match) {
            const z = parseInt(match[1], 10);
            // Seamarks are sparse below zoom 9
            if (z < 9) {
              return {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
              };
            }
          }
        }
        return { url };
      },
    });

    map.dragPan.enable();
    map.dragRotate.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.touchZoomRotate.enable({ around: "center" });
    map.boxZoom && map.boxZoom.disable();
    map.keyboard && map.keyboard.enable();
    map.scrollZoom && map.scrollZoom.enable();
    map.doubleClickZoom && map.doubleClickZoom.enable();
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true, showZoom: true }),
      "top-left"
    );

    map.on("load", () => {
      setBathyError(null);
      setMap3DZoom(map.getZoom());
      imagery3DReadyRef.current = true;
      // Clear sync lock after 3D map has loaded with synced position
      syncLockRef.current = false;
      // Apply imagery visibility/opacity after load
      if (map.getLayer("imagery")) {
        map.setPaintProperty("imagery", "raster-opacity", imageryOpacity);
        map.setLayoutProperty("imagery", "visibility", imageryOn ? "visible" : "none");
      }
    });
    map.on("zoom", () => {
      const z = map.getZoom();
      setMap3DZoom(z);
      setAtMinZoom(z <= 6.1);  // Flash button when near min zoom
    });
    map.on("error", () => setBathyError("Bathy tiles unavailable in 3D."));
    map.on("dragstart", () => setFollow3D(false));
    map.on("rotatestart", () => setFollow3D(false));
    map.on("pitchstart", () => setFollow3D(false));
    // Sync 3D position back for 2D map to pick up
    map.on("moveend", () => {
      const center = map.getCenter();
      syncLockRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
    });
    map.on("load", () => {
      setBathyError(null);
      setMap3DZoom(map.getZoom());
      imagery3DReadyRef.current = true;
      // Apply imagery visibility/opacity after load
      if (map.getLayer("imagery")) {
        map.setPaintProperty("imagery", "raster-opacity", imageryOpacity);
        map.setLayoutProperty("imagery", "visibility", imageryOn ? "visible" : "none");
      }
      // Grid source/layer for 3D.
      if (!map.getSource("grid3d")) {
        map.addSource("grid3d", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      if (!map.getLayer("grid3d")) {
        map.addLayer({
          id: "grid3d",
          type: "line",
          source: "grid3d",
          layout: { visibility: gridOn ? "visible" : "none" },
          paint: {
            "line-color": "#1f2937",
            "line-width": 1,
            "line-opacity": 0.5,
            "line-dasharray": [2, 2],
          },
        });
      }
      grid3DReadyRef.current = true;
      const redrawGrid = () => updateGrid3D(map);
      if (grid3DListenerRef.current) {
        map.off("moveend", grid3DListenerRef.current);
      }
      map.on("moveend", redrawGrid);
      grid3DListenerRef.current = redrawGrid;
      redrawGrid();

      // Initialize vessel 3D tugboat model on load so it appears immediately
      const boat = buildVessel3DTriangle(data.lat, data.lon, data.heading || 0);
      if (!map.getSource("vessel3d")) {
        map.addSource("vessel3d", { type: "geojson", data: boat });
        map.addLayer({
          id: "vessel3d",
          type: "fill-extrusion",
          source: "vessel3d",
          paint: {
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-opacity": 0.95,
          },
        });
      }
      vessel3DReadyRef.current = true;

      // Resolve DEM with client-side mosaic or AWS global fallback.
      (async () => {
        try {
          const source = import.meta.env.VITE_DEM_SOURCE || "aws";
          const encoding = (source === "copernicus" || import.meta.env.VITE_TITILER_ENDPOINT) ? "mapbox" : "terrarium";
          const tileUrl = buildDemTileUrl(data.lat, data.lon);
          if (!tileUrl) {
            setDemDebug("DEM off (no COG)");
            return;
          }

          if (!map.getSource("dem")) {
            map.addSource("dem", { type: "raster-dem", tiles: [tileUrl], tileSize: 256, minzoom: 0, maxzoom: 15, encoding });
          }
          map.setTerrain({ source: "dem", exaggeration: 1.3333 });
          setDemDebug(`DEM on: ${source === "copernicus" || import.meta.env.VITE_TITILER_ENDPOINT ? "Copernicus mosaic" : "AWS global"}`);
        } catch {
          setDemDebug("DEM off (error)");
          map.setTerrain(null);
        }
      })();
    });
    map3DRef.current = map;
    vessel3DReadyRef.current = false;

    return () => {
      if (grid3DListenerRef.current && map3DRef.current) {
        map3DRef.current.off("moveend", grid3DListenerRef.current);
      }
      if (map3DRef.current) {
        map3DRef.current.remove();
        map3DRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3D]);

  // Always render vessel in 3D (regardless of follow state)
  useEffect(() => {
    if (!is3D || !map3DRef.current) return;
    const map = map3DRef.current;
    if (!map.isStyleLoaded()) return;

    // Update vessel 3D tugboat model
    const boat = buildVessel3DTriangle(data.lat, data.lon, data.heading || 0);
    if (!map.getSource("vessel3d")) {
      map.addSource("vessel3d", { type: "geojson", data: boat });
      map.addLayer({
        id: "vessel3d",
        type: "fill-extrusion",
        source: "vessel3d",
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-opacity": 0.95,
        },
      });
    } else {
      map.getSource("vessel3d").setData(boat);
    }
  }, [data.lat, data.lon, data.heading, is3D]);

  // Follow vessel with camera only when follow3D is true
  useEffect(() => {
    if (!is3D || !map3DRef.current || !follow3D) return;
    map3DRef.current.easeTo({
      center: [data.lon, data.lat],
      bearing: 0,
      pitch: 0,
      duration: 500,
      essential: false,
    });
  }, [data.lat, data.lon, follow3D, is3D]);


  // Grid-based depth soundings (3D) - fixed lat/lon grid, hidden until hover
  const depth3DReadyRef = useRef(false);
  useEffect(() => {
    if (!is3D || !map3DRef.current) return;
    const map = map3DRef.current;
    if (!map.isStyleLoaded()) return;

    const updateDepthGrid3D = () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();

      // Calculate grid step based on zoom (same logic as 2D)
      const step = Math.max(0.002, 0.1 / Math.pow(2, (zoom - 10) / 2));

      const south = Math.floor(bounds.getSouth() / step) * step;
      const north = Math.ceil(bounds.getNorth() / step) * step;
      const west = Math.floor(bounds.getWest() / step) * step;
      const east = Math.ceil(bounds.getEast() / step) * step;

      const features = [];
      let idx = 0;

      for (let lat = south; lat <= north; lat += step) {
        for (let lon = west; lon <= east; lon += step) {
          const gridKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;

          // Get or generate depth (use same cache as 2D)
          if (!depthCacheRef.current[gridKey]) {
            const latFactor = Math.sin(lat * 17.3) * Math.cos(lon * 23.7);
            const lonFactor = Math.cos(lat * 31.1) * Math.sin(lon * 19.9);
            const baseDepth = 15 + Math.abs(latFactor * 25) + Math.abs(lonFactor * 20);
            const variation = (Math.sin(lat * 100) * Math.cos(lon * 100)) * 5;
            depthCacheRef.current[gridKey] = Math.max(0.5, baseDepth + variation);
          }

          const depth = depthCacheRef.current[gridKey];

          features.push({
            type: "Feature",
            id: idx++,
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: { depth: depth, label: depth.toFixed(0) },
          });
        }
      }

      const geojson = { type: "FeatureCollection", features };

      if (!map.getSource("depth-grid-3d")) {
        map.addSource("depth-grid-3d", { type: "geojson", data: geojson });

        // Text labels - black with white halo, hidden by default
        map.addLayer({
          id: "depth-grid-3d-labels",
          type: "symbol",
          source: "depth-grid-3d",
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Regular"],
            "text-size": 10,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: {
            "text-color": "#000",
            "text-halo-color": "#fff",
            "text-halo-width": 1.5,
            "text-opacity": [
              "case",
              ["boolean", ["feature-state", "visible"], false],
              1,
              0
            ],
          },
        });

        depth3DReadyRef.current = true;
      } else {
        map.getSource("depth-grid-3d").setData(geojson);
      }
    };

    // Track mouse to reveal nearby soundings
    let visibleIds = new Set();

    const revealNearby3D = (e) => {
      if (!map.getSource("depth-grid-3d")) return;

      const cursorLng = e.lngLat.lng;
      const cursorLat = e.lngLat.lat;
      const revealRadius = 0.015;

      // Query all features in view
      const features = map.querySourceFeatures("depth-grid-3d");

      // Clear previously visible
      visibleIds.forEach((id) => {
        map.setFeatureState({ source: "depth-grid-3d", id }, { visible: false });
      });
      visibleIds.clear();

      // Show nearby
      features.forEach((f) => {
        if (f.geometry.type !== "Point") return;
        const [lon, lat] = f.geometry.coordinates;
        const dist = Math.sqrt(
          Math.pow(lat - cursorLat, 2) + Math.pow(lon - cursorLng, 2)
        );
        if (dist < revealRadius && f.id !== undefined) {
          map.setFeatureState({ source: "depth-grid-3d", id: f.id }, { visible: true });
          visibleIds.add(f.id);
        }
      });
    };

    const hideAll3D = () => {
      visibleIds.forEach((id) => {
        if (map.getSource("depth-grid-3d")) {
          map.setFeatureState({ source: "depth-grid-3d", id }, { visible: false });
        }
      });
      visibleIds.clear();
    };

    updateDepthGrid3D();
    map.on("moveend", updateDepthGrid3D);
    map.on("mousemove", revealNearby3D);
    map.on("mouseout", hideAll3D);

    return () => {
      map.off("moveend", updateDepthGrid3D);
      map.off("mousemove", revealNearby3D);
      map.off("mouseout", hideAll3D);
    };
  }, [is3D]);

  // Update bathy visibility/opacity in 3D.
  useEffect(() => {
    if (!is3D || !map3DRef.current) return;
    if (map3DRef.current.getLayer("bathy")) {
      map3DRef.current.setPaintProperty("bathy", "raster-opacity", bathyOpacity);
      map3DRef.current.setLayoutProperty("bathy", "visibility", bathyOn ? "visible" : "none");
    }
  }, [bathyOpacity, bathyOn, is3D]);

  // Update imagery visibility/opacity in 3D.
  useEffect(() => {
    if (!is3D || !map3DRef.current) return;
    if (map3DRef.current.getLayer("imagery")) {
      map3DRef.current.setPaintProperty("imagery", "raster-opacity", imageryOpacity);
      map3DRef.current.setLayoutProperty("imagery", "visibility", imageryOn ? "visible" : "none");
    }
  }, [imageryOpacity, imageryOn, is3D]);

  // Grid toggle in 3D.
  useEffect(() => {
    if (!is3D || !map3DRef.current || !grid3DReadyRef.current) return;
    const map = map3DRef.current;
    if (map.getLayer("grid3d")) {
      map.setLayoutProperty("grid3d", "visibility", gridOn ? "visible" : "none");
    }
    if (gridOn) {
      updateGrid3D(map);
    }
  }, [gridOn, is3D, updateGrid3D]);

  // Orbit mode - auto-rotate around center
  useEffect(() => {
    if (!is3D || !map3DRef.current || !orbitMode) {
      if (orbitAnimRef.current) {
        cancelAnimationFrame(orbitAnimRef.current);
        orbitAnimRef.current = null;
      }
      return;
    }

    const map = map3DRef.current;
    let lastTime = performance.now();
    const rotateSpeed = 10; // degrees per second

    // Set initial pitch for better orbit view
    map.easeTo({ pitch: 60, duration: 500 });

    const animate = (now) => {
      if (!orbitMode || !map3DRef.current) return;

      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const currentBearing = map.getBearing();
      map.setBearing(currentBearing + rotateSpeed * delta);

      orbitAnimRef.current = requestAnimationFrame(animate);
    };

    orbitAnimRef.current = requestAnimationFrame(animate);

    // Stop orbit on user interaction
    const stopOrbit = () => setOrbitMode(false);
    map.on("click", stopOrbit);
    map.on("dragstart", stopOrbit);
    map.on("zoomstart", stopOrbit);

    return () => {
      if (orbitAnimRef.current) {
        cancelAnimationFrame(orbitAnimRef.current);
        orbitAnimRef.current = null;
      }
      if (map3DRef.current) {
        map3DRef.current.off("click", stopOrbit);
        map3DRef.current.off("dragstart", stopOrbit);
        map3DRef.current.off("zoomstart", stopOrbit);
      }
    };
  }, [orbitMode, is3D]);

  // Handle seamark toggle (2D).
  useEffect(() => {
    if (seamarkLayerRef.current && mapRef.current) {
      if (seamarkOn) {
        if (!mapRef.current.hasLayer(seamarkLayerRef.current)) {
          seamarkLayerRef.current.addTo(mapRef.current);
        }
      } else {
        if (mapRef.current.hasLayer(seamarkLayerRef.current)) {
          mapRef.current.removeLayer(seamarkLayerRef.current);
        }
      }
    }
  }, [seamarkOn]);

  // Handle seamark toggle (3D).
  useEffect(() => {
    if (!is3D || !map3DRef.current) return;
    if (map3DRef.current.getLayer("seamarks")) {
      map3DRef.current.setLayoutProperty("seamarks", "visibility", seamarkOn ? "visible" : "none");
    }
  }, [seamarkOn, is3D]);

  // Imagery overlay toggle/opacity.
  useEffect(() => {
    if (!imageryLayerRef.current || !mapRef.current) return;
    imageryLayerRef.current.setOpacity(imageryOpacity);
    if (imageryOn) {
      if (!mapRef.current.hasLayer(imageryLayerRef.current)) {
        imageryLayerRef.current.addTo(mapRef.current);
      }
    } else {
      mapRef.current.removeLayer(imageryLayerRef.current);
    }
  }, [imageryOn, imageryOpacity]);

  // Bathymetry overlay toggle/opacity.
  useEffect(() => {
    if (!bathyLayerRef.current || !mapRef.current) return;
    bathyLayerRef.current.setOpacity(bathyOpacity);
    if (bathyOn) {
      if (!mapRef.current.hasLayer(bathyLayerRef.current)) {
        bathyLayerRef.current.addTo(mapRef.current);
      }
    } else {
      mapRef.current.removeLayer(bathyLayerRef.current);
    }
  }, [bathyOn, bathyOpacity]);

  const clearMeasureMarkers = useCallback(() => {
    const { start, end, label, clear } = measureMarkersRef.current;
    if (start) start.remove();
    if (end) end.remove();
    if (label) label.remove();
    if (clear) clear.remove();
    measureMarkersRef.current = { start: null, end: null, label: null, clear: null };
  }, []);

  const clearMeasureAll = useCallback(() => {
    setMeasureInfo(null);
    if (measureLineRef.current) {
      measureLineRef.current.remove();
      measureLineRef.current = null;
    }
    clearMeasureMarkers();
  }, [clearMeasureMarkers]);

  const placeMeasureMarkers = useCallback((start, end, text) => {
    clearMeasureMarkers();
    const map = mapRef.current;
    if (!map) return;
    const startMarker = L.circleMarker(start, { radius: 5, color: "#00d4ff", weight: 2, fillOpacity: 0.7 }).addTo(map);
    const endMarker = L.circleMarker(end, { radius: 5, color: "#00d4ff", weight: 2, fillOpacity: 0.7 }).addTo(map);

    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    const p1 = map.latLngToLayerPoint(start);
    const p2 = map.latLngToLayerPoint(end);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    // Leaflet screen coords have Y increasing downward; invert Y so the label runs along the segment.
    const angleDeg = (Math.atan2(-dy, dx) * 180) / Math.PI;
    const renderAngle = angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;

    const label = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="color:#e5e7eb; font-family:'JetBrains Mono', monospace; font-size:11px; transform: rotate(${renderAngle}deg) translateY(-4px); transform-origin: center center; white-space: nowrap; pointer-events:none;">${text}</div>`,
        iconAnchor: [0, 0],
      }),
    }).addTo(map);

    const clearBtn = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="color:#ef4444; font-size:12px; cursor:pointer; transform: translate(10px,-10px);">✕</div>`,
        iconAnchor: [0, 0],
      }),
    }).addTo(map);
    clearBtn.on("click", () => {
      setMeasureInfo(null);
      if (measureLineRef.current) {
        measureLineRef.current.remove();
        measureLineRef.current = null;
      }
      clearMeasureMarkers();
    });
    measureMarkersRef.current = { start: startMarker, end: endMarker, label, clear: clearBtn };
  }, [clearMeasureMarkers]);

  // Measure handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!measureMode) {
      if (measureHandlersRef.current.firstClick) {
        map.off("click", measureHandlersRef.current.firstClick);
      }
      if (measureHandlersRef.current.move) {
        map.off("mousemove", measureHandlersRef.current.move);
      }
      return;
    }
    const startMeasure = (startEvt) => {
      const start = startEvt.latlng;
      clearMeasureMarkers();
      measureLineRef.current = L.polyline([start, start], { color: "#00d4ff", weight: 2, dashArray: "4,2" }).addTo(map);
      const moveHandler = (moveEvt) => {
        if (!measureLineRef.current) return;
        measureLineRef.current.setLatLngs([start, moveEvt.latlng]);
      };
      const endHandler = (endEvt) => {
        map.off("mousemove", moveHandler);
        map.off("click", endHandler);
        const end = endEvt.latlng;
        if (!measureLineRef.current) {
          measureLineRef.current = L.polyline([start, end], { color: "#00d4ff", weight: 2, dashArray: "4,2" }).addTo(map);
        } else {
          measureLineRef.current.setLatLngs([start, end]);
        }
        const distNm = distanceNm(start.lat, start.lng, end.lat, end.lng);
        const distKm = distNm * 1.852;
        const distMi = distNm * 1.151;
        const slope = lineSlopeDeg(start, end);
        setMeasureInfo({ start, end, nm: distNm, km: distKm, mi: distMi, slope });
        placeMeasureMarkers(start, end, `${distNm.toFixed(2)} nm / ${distKm.toFixed(2)} km / ${distMi.toFixed(2)} mi`);
        setMeasureMode(false);
      };
      measureHandlersRef.current = { firstClick: endHandler, move: moveHandler };
      map.on("mousemove", moveHandler);
      map.once("click", endHandler);
    };

    measureHandlersRef.current = { firstClick: startMeasure, move: null };
    map.once("click", startMeasure);
  }, [measureMode, placeMeasureMarkers, clearMeasureMarkers]);

  // ESC cancels measuring (before or after second click).
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        clearMeasureAll();
        setMeasureMode(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearMeasureAll]);

  // Search handler: try lat,lon parse; fallback to Anthropic geocode if configured.
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchError(null);

    // Helper to switch to 2D first, then focus
    const focusWithTransition = (lat, lon, zoom) => {
      if (is3D && map3DRef.current) {
        // Flatten 3D view first
        setOrbitMode(false);
        map3DRef.current.easeTo({ pitch: 0, bearing: 0, duration: 300 });
        setTimeout(() => {
          setIs3D(false);
          setTimeout(() => focusMap(lat, lon, zoom), 100);
        }, 320);
      } else {
        focusMap(lat, lon, zoom);
      }
    };

    // 1) Try direct lat,lon.
    const parsed = parseLatLon(searchQuery);
    if (parsed) {
      console.info("[search] parsed lat/lon", parsed);
      focusWithTransition(parsed.lat, parsed.lon, null);
      return;
    }
    // 2) Try Anthropic geocode if key is present.
    setSearchPending(true);
    try {
      // Get current map position to provide context
      const currentLat = mapRef.current?.getCenter()?.lat || map3DRef.current?.getCenter()?.lat || data.lat;
      const currentLon = mapRef.current?.getCenter()?.lng || map3DRef.current?.getCenter()?.lng || data.lon;
      const currentZoom = mapRef.current?.getZoom() || map3DRef.current?.getZoom() || 12;

      console.info("[search] geocoding via Anthropic", searchQuery);
      const result = await geocodeWithAnthropic(searchQuery, currentLat, currentLon, currentZoom);
      if (result) {
        console.info("[search] geocode success", result);
        focusWithTransition(result.lat, result.lon, result.zoom);
      } else {
        console.warn("[search] geocode returned no result");
        setSearchError("Could not resolve location. Try lat,lon like 14.92,-148.21");
      }
    } catch (err) {
      console.error("[search] geocode error", err);
      setSearchError(err.message || "Geocode failed.");
    } finally {
      setSearchPending(false);
    }
  };

  const focusMap = (lat, lon, targetZoom = null) => {
    const zoom = targetZoom || mapRef.current?.getZoom() || map3DRef.current?.getZoom() || 13;

    // Update syncLockRef so position persists when switching modes
    syncLockRef.current = { center: [lon, lat], zoom: Math.max(zoom, 6) };

    if (mapRef.current) {
      mapRef.current.flyTo([lat, lon], zoom, { animate: true, duration: 1.5 });
    }
    if (map3DRef.current) {
      map3DRef.current.flyTo({
        center: [lon, lat],
        zoom: Math.max(zoom, 6),
        bearing: 0,
        pitch: 45,
        duration: 1500,
      });
    }
  };

  return (
    <WidgetFrame title="Chart (OpenSeaMap)" color="#22c55e">
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          50% { box-shadow: 0 0 12px 4px rgba(34, 197, 94, 0.7); }
        }
        /* Hide MapLibre default attribution and watermarks */
        .maplibregl-ctrl-attrib,
        .maplibregl-ctrl-logo,
        .maplibregl-missing-css,
        .maplibregl-canary {
          display: none !important;
        }
        /* Grid-based depth soundings - black text with white glow */
        .depth-sounding {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          font-weight: 500;
          color: #000;
          text-shadow:
            -1px -1px 0 #fff,
            1px -1px 0 #fff,
            -1px 1px 0 #fff,
            1px 1px 0 #fff,
            0 0 4px rgba(255,255,255,0.8);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .depth-sounding.visible {
          opacity: 1;
        }
      `}</style>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            data-no-drag
            type="text"
            placeholder="Search place, lat/lon, or chart..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #1f2937",
              background: "#0f172a",
              color: "#e5e7eb",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
            }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "#9ca3af" }}>
            <Toggle label="Seamarks" checked={seamarkOn} onChange={setSeamarkOn} />
            <Toggle label="Grid" checked={gridOn} onChange={setGridOn} />
            <Toggle label="Imagery" checked={imageryOn} onChange={setImageryOn} />
            {imageryOn && (
              <input
                data-no-drag
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={imageryOpacity}
                onChange={(e) => setImageryOpacity(parseFloat(e.target.value))}
              />
            )}
            <Toggle label="Bathy" checked={bathyOn} onChange={setBathyOn} />
            {bathyOn && (
              <input
                data-no-drag
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={bathyOpacity}
                onChange={(e) => setBathyOpacity(parseFloat(e.target.value))}
              />
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            data-no-drag
            onClick={handleSearch}
            disabled={searchPending}
            style={{
              background: searchPending ? "#111827" : "#0f172a",
              color: searchPending ? "#4b5563" : "#22c55e",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: "6px 12px",
              fontFamily: "JetBrains Mono, monospace",
              cursor: searchPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            🔍 Search
          </button>
          <button
            data-no-drag
            onClick={() => {
              setMeasureMode(true);
              if (measureLineRef.current) {
                measureLineRef.current.remove();
                measureLineRef.current = null;
              }
              setMeasureInfo(null);
              measureClickRef.current = { count: 0, first: null };
              clearMeasureMarkers();
            }}
            style={{
              background: measureMode ? "#22c55e" : "#0f172a",
              color: measureMode ? "#0b0b0f" : "#22c55e",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: "6px 12px",
              fontFamily: "JetBrains Mono, monospace",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            📏 Measure
          </button>
          <button
            data-no-drag
            onClick={handleToggle3D}
            style={{
              background: is3D ? "#22c55e" : "#0f172a",
              color: is3D ? "#0b0b0f" : "#22c55e",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: "6px 12px",
              fontFamily: "JetBrains Mono, monospace",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              animation: (is3D && atMinZoom) ? "pulse 1s ease-in-out infinite" : "none",
            }}
          >
            🎛 {is3D ? "2D" : "3D"}
          </button>
          {is3D && (
            <button
              data-no-drag
              onClick={() => setOrbitMode(!orbitMode)}
              style={{
                background: orbitMode ? "#22c55e" : "#0f172a",
                color: orbitMode ? "#0b0b0f" : "#22c55e",
                border: "1px solid #1f2937",
                borderRadius: 12,
                padding: "6px 12px",
                fontFamily: "JetBrains Mono, monospace",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              🔄 Orbit
            </button>
          )}
          <button
            data-no-drag
            onClick={() => {
              setFollow2D(true);
              setFollow3D(true);
              if (mapRef.current) {
                const currentZoom = mapRef.current.getZoom();
                mapRef.current.setView([data.lat, data.lon], currentZoom);
              } else if (map3DRef.current) {
                map3DRef.current.easeTo({
                  center: [data.lon, data.lat],
                  bearing: 0,
                  pitch: 0,
                  duration: 400,
                  essential: false,
                });
              }
            }}
            style={{
              background: "#0f172a",
              color: "#22c55e",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: "6px 12px",
              fontFamily: "JetBrains Mono, monospace",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ⦿ Vessel
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          display: is3D ? "none" : "block",
          height: "calc(100vh - 170px)",
          width: "100%",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid #1f2937",
        }}
      />
      <div
        ref={map3DContainerRef}
        style={{
          display: is3D ? "block" : "none",
          height: "calc(100vh - 170px)",
          width: "100%",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid #1f2937",
        }}
      />
      {measureInfo && !is3D && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#e5e7eb", background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, padding: "6px 10px" }}>
          Measure: {measureInfo.nm.toFixed(2)} nm / {measureInfo.km.toFixed(2)} km / {measureInfo.mi.toFixed(2)} mi • slope {measureInfo.slope.toFixed(1)}°
          <span
            style={{ marginLeft: 10, cursor: "pointer", color: "#ef4444" }}
            onClick={() => {
              clearMeasureAll();
            }}
          >
            ✕
          </span>
        </div>
      )}
      {bathyError && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#fbbf24" }}>
          {bathyError}
        </div>
      )}
      {searchError && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>
          {searchError}
        </div>
      )}
      {(gridStepLabel || demDebug) && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "#0f172a",
            border: "1px solid #1f2937",
            borderRadius: 8,
            padding: "6px 12px",
            color: "#e5e7eb",
            fontSize: 12,
            fontFamily: "JetBrains Mono, monospace",
            boxShadow: "0 0 12px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxWidth: "360px",
            wordBreak: "break-all",
          }}
        >
          {gridStepLabel && <span style={{ color: "#9ca3af" }}>{gridStepLabel}</span>}
          {!is3D && map2DZoom !== null && <span style={{ color: "#9ca3af" }}>Zoom {map2DZoom.toFixed(2)}</span>}
          {is3D && map3DZoom !== null && <span style={{ color: "#9ca3af" }}>Zoom {map3DZoom.toFixed(2)}</span>}
          {is3D && demDebug && <span style={{ color: "#f59e0b" }}>{demDebug}</span>}
        </div>
      )}
    </WidgetFrame>
  );
};

const Toggle = ({ label, checked, onChange }) => (
  <div data-no-drag style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div
      data-no-drag
      onClick={() => onChange(!checked)}
      style={{
        width: 46,
        height: 24,
        background: checked ? "#22c55e" : "#1f2937",
        borderRadius: 999,
        position: "relative",
        cursor: "pointer",
        border: "1px solid #111827",
        transition: "background 0.2s",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 24 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#0b0f17",
          transition: "left 0.2s",
          boxShadow: "0 0 6px rgba(0,0,0,0.4)",
        }}
      />
    </div>
    <span style={{ color: "#e5e7eb", fontSize: 12 }}>{label}</span>
  </div>
);

// Simple great-circle forward calculation.
function destinationPoint(lat, lon, bearingDeg, distanceNm) {
  const R = 3440.065; // nm
  const brng = (bearingDeg * Math.PI) / 180;
  const dByR = distanceNm / R;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dByR) + Math.cos(lat1) * Math.sin(dByR) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(dByR) * Math.cos(lat1),
      Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lat2 * 180) / Math.PI, ((lon2 * 180) / Math.PI + 540) % 360 - 180];
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}



function lineSlopeDeg(start, end) {
  const dy = end.lat - start.lat;
  const dx = end.lng - start.lng;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}



// Clamp tile coords for MapServer tiling; rescales x/y when z is clamped so lower-zoom tiles are reused.
function clampTileCoords(url, maxZ) {
  const match = url.match(/tile\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return url;
  const z = parseInt(match[1], 10);
  const y = parseInt(match[2], 10);
  const x = parseInt(match[3], 10);
  if (z <= maxZ) return url;
  const delta = z - maxZ;
  const factor = Math.pow(2, delta);
  const newX = Math.floor(x / factor);
  const newY = Math.floor(y / factor);
  return url.replace(/tile\/\d+\/\d+\/\d+/, `tile/${maxZ}/${newY}/${newX}`);
}



function vesselIconHtml(heading) {
  const clamped = ((heading % 360) + 360) % 360;
  // Triangle inscribed in circle radius r. Apex at -90° (heading).
  // Base chord scaled by baseScale (fraction of equilateral chord length).
  const cx = 16, cy = 16, r = 14;
  const baseScale = 0.67;
  const apexAngle = -90;
  const chordEquilateral = Math.sqrt(3) * r;
  const chord = chordEquilateral * baseScale;
  const baseSpanHalf = (Math.asin(Math.max(-1, Math.min(1, chord / (2 * r)))) * 180) / Math.PI;
  const baseLeftAngle = 90 + baseSpanHalf;
  const baseRightAngle = 90 - baseSpanHalf;
  const toPoint = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${cx + r * Math.cos(rad)},${cy + r * Math.sin(rad)}`;
  };
  const apex = toPoint(apexAngle);
  const baseLeft = toPoint(baseLeftAngle);
  const baseRight = toPoint(baseRightAngle);
  return `
    <svg width="32" height="32" viewBox="0 0 32 32" style="transform: translate(-50%, -50%);">
      <g transform="rotate(${clamped} ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(34,197,94,0.06)" stroke="#22c55e" stroke-width="2" />
        <polygon points="${apex} ${baseLeft} ${baseRight}" fill="#22c55e" filter="drop-shadow(0 0 4px rgba(34,197,94,0.6))" />
      </g>
    </svg>
  `;
}

function parseLatLon(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, "");
  const parts = cleaned.split(",");
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Build a 3D tugboat model for MapLibre with hull, cabin, and smokestack.
function buildVessel3DTriangle(lat, lon, heading) {
  const features = [];

  // Hull - boat-shaped polygon (pointed bow, flat stern)
  const hullLength = 30; // meters
  const hullWidth = 10;
  const bow = destinationPointMeters(lat, lon, heading, hullLength / 2);
  const stern = destinationPointMeters(lat, lon, heading, -hullLength / 2);
  const midLeft = destinationPointMeters(lat, lon, heading - 90, hullWidth / 2);
  const midRight = destinationPointMeters(lat, lon, heading + 90, hullWidth / 2);
  const sternLeft = destinationPointMeters(stern[0], stern[1], heading - 90, hullWidth / 2.5);
  const sternRight = destinationPointMeters(stern[0], stern[1], heading + 90, hullWidth / 2.5);
  const bowMidLeft = destinationPointMeters(bow[0], bow[1], heading - 90, hullWidth / 6);
  const bowMidRight = destinationPointMeters(bow[0], bow[1], heading + 90, hullWidth / 6);

  features.push({
    type: "Feature",
    properties: { height: 4, base: 0, color: "#1e3a5f" }, // Dark blue hull
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bow[1], bow[0]],
        [bowMidRight[1], bowMidRight[0]],
        [midRight[1], midRight[0]],
        [sternRight[1], sternRight[0]],
        [sternLeft[1], sternLeft[0]],
        [midLeft[1], midLeft[0]],
        [bowMidLeft[1], bowMidLeft[0]],
        [bow[1], bow[0]],
      ]],
    },
  });

  // Deck - slightly smaller, sits on hull
  const deckInset = 1.5;
  const deckBow = destinationPointMeters(lat, lon, heading, hullLength / 2 - deckInset);
  const deckStern = destinationPointMeters(lat, lon, heading, -hullLength / 2 + deckInset);
  const deckLeft = destinationPointMeters(lat, lon, heading - 90, hullWidth / 2 - deckInset);
  const deckRight = destinationPointMeters(lat, lon, heading + 90, hullWidth / 2 - deckInset);

  features.push({
    type: "Feature",
    properties: { height: 5, base: 4, color: "#4a5568" }, // Gray deck
    geometry: {
      type: "Polygon",
      coordinates: [[
        [deckBow[1], deckBow[0]],
        [deckRight[1], deckRight[0]],
        [deckStern[1], deckStern[0]],
        [deckLeft[1], deckLeft[0]],
        [deckBow[1], deckBow[0]],
      ]],
    },
  });

  // Wheelhouse/cabin - rectangular, toward stern
  const cabinCenter = destinationPointMeters(lat, lon, heading, -hullLength / 6);
  const cabinLength = 8;
  const cabinWidth = 6;
  const cabinFront = destinationPointMeters(cabinCenter[0], cabinCenter[1], heading, cabinLength / 2);
  const cabinBack = destinationPointMeters(cabinCenter[0], cabinCenter[1], heading, -cabinLength / 2);
  const cabinFL = destinationPointMeters(cabinFront[0], cabinFront[1], heading - 90, cabinWidth / 2);
  const cabinFR = destinationPointMeters(cabinFront[0], cabinFront[1], heading + 90, cabinWidth / 2);
  const cabinBL = destinationPointMeters(cabinBack[0], cabinBack[1], heading - 90, cabinWidth / 2);
  const cabinBR = destinationPointMeters(cabinBack[0], cabinBack[1], heading + 90, cabinWidth / 2);

  features.push({
    type: "Feature",
    properties: { height: 14, base: 5, color: "#f0f0f0" }, // White cabin
    geometry: {
      type: "Polygon",
      coordinates: [[
        [cabinFL[1], cabinFL[0]],
        [cabinFR[1], cabinFR[0]],
        [cabinBR[1], cabinBR[0]],
        [cabinBL[1], cabinBL[0]],
        [cabinFL[1], cabinFL[0]],
      ]],
    },
  });

  // Smokestack - small rectangle behind cabin
  const stackCenter = destinationPointMeters(cabinCenter[0], cabinCenter[1], heading, -cabinLength / 2 - 2);
  const stackSize = 2;
  const stackFL = destinationPointMeters(stackCenter[0], stackCenter[1], heading + 45, stackSize);
  const stackFR = destinationPointMeters(stackCenter[0], stackCenter[1], heading + 135, stackSize);
  const stackBR = destinationPointMeters(stackCenter[0], stackCenter[1], heading + 225, stackSize);
  const stackBL = destinationPointMeters(stackCenter[0], stackCenter[1], heading + 315, stackSize);

  features.push({
    type: "Feature",
    properties: { height: 20, base: 5, color: "#ef4444" }, // Red smokestack
    geometry: {
      type: "Polygon",
      coordinates: [[
        [stackFL[1], stackFL[0]],
        [stackFR[1], stackFR[0]],
        [stackBR[1], stackBR[0]],
        [stackBL[1], stackBL[0]],
        [stackFL[1], stackFL[0]],
      ]],
    },
  });

  // Bow marker - small triangle at front (green navigation light)
  const markerTip = destinationPointMeters(lat, lon, heading, hullLength / 2 + 1);
  const markerLeft = destinationPointMeters(bow[0], bow[1], heading - 90, 1);
  const markerRight = destinationPointMeters(bow[0], bow[1], heading + 90, 1);

  features.push({
    type: "Feature",
    properties: { height: 8, base: 4, color: "#22c55e" }, // Green bow marker
    geometry: {
      type: "Polygon",
      coordinates: [[
        [markerTip[1], markerTip[0]],
        [markerRight[1], markerRight[0]],
        [markerLeft[1], markerLeft[0]],
        [markerTip[1], markerTip[0]],
      ]],
    },
  });

  return { type: "FeatureCollection", features };
}

// Destination point using meters for convenience (approx, uses NM conversion).
function destinationPointMeters(lat, lon, bearingDeg, distanceMeters) {
  const nm = distanceMeters / 1852;
  return destinationPoint(lat, lon, bearingDeg, nm);
}

// Anthropic geocode helper; supports proxy auth so the client doesn't need the key.
async function geocodeWithAnthropic(query, currentLat = null, currentLon = null, currentZoom = null) {
  const proxy =
    import.meta.env.VITE_ANTHROPIC_PROXY_URL ||
    (typeof window !== "undefined" ? "/anthropic/v1/messages" : null);
  const url = proxy || "https://api.anthropic.com/v1/messages";
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey && !proxy) {
    throw new Error("Geocode unavailable: missing API credentials.");
  }
  const headers = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers["x-anthropic-key"] = apiKey;
  }

  // Build context-aware prompt
  const positionContext = currentLat !== null
    ? `Current view: lat=${currentLat.toFixed(4)}, lon=${currentLon.toFixed(4)}, zoom=${currentZoom}. `
    : "";

  const systemPrompt = `You are a map assistant. ${positionContext}

Handle these commands:
- Place names: Return coordinates and appropriate zoom (1=world, 5=continent, 8=country, 10=city, 13=neighborhood, 16=street)
- "zoom in" / "closer": Return current coordinates with zoom increased by 2-3
- "zoom out" / "further": Return current coordinates with zoom decreased by 2-3
- "zoom way in/out": Larger zoom change (4-5 levels)
- Relative directions ("go north", "pan left"): Shift coordinates appropriately

Respond ONLY with JSON: {"lat":<number>,"lon":<number>,"zoom":<number>}
If unknown, respond {}.`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: "user", content: query }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const suffix = errText ? `: ${errText.slice(0, 200)}` : "";
    throw new Error(`Geocode request failed${suffix}`);
  }
  const data = await resp.json();
  const text = data?.content?.[0]?.text || "";
  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed.lat === "number" &&
      typeof parsed.lon === "number" &&
      Math.abs(parsed.lat) <= 90 &&
      Math.abs(parsed.lon) <= 180
    ) {
      // Validate and clamp zoom if present
      if (typeof parsed.zoom === "number") {
        parsed.zoom = Math.max(1, Math.min(18, parsed.zoom));
      }
      return parsed;
    }
  } catch {
    // fallthrough
  }
  return null;
}

export default Chart;
