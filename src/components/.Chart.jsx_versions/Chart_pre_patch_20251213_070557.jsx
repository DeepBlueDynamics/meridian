import { useEffect, useRef, useState } from "react";
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

// Build a titiler raster-dem template around the vessel location if no env override is provided.
function buildDemTileUrl(lat, lon) {
  const cog = copernicusCogUrl(lat, lon);
  if (!cog) return null;
  const params = `url=${encodeURIComponent(cog)}&rescale=0,9000&nodata=-9999`;
  return `http://localhost:8081/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${params}`;
}

async function headOk(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(t);
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: 0 };
  }
}

async function findDemUrl(lat, lon) {
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dy, dx] of offsets) {
    const candidate = buildDemTileUrl(lat + dy, lon + dx);
    if (!candidate) continue;
    // Check one tileurl sample (replace placeholders with center tile to validate)
    const { z, x, y } = tileFromLatLon(lat + dy, lon + dx, 12);
    const sample = candidate
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const res = await headOk(sample, 2000);
    if (res.ok) {
      console.info("[dem] OK", sample, res.status);
      return { url: candidate, reason: `cog @ (${Math.floor(lat + dy)},${Math.floor(lon + dx)})` };
    }
    console.warn("[dem] probe failed", sample, res.status);
  }
  return null;
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
  const [measureMode, setMeasureMode] = useState(false);
  const measureLineRef = useRef(null);
  const [measureInfo, setMeasureInfo] = useState(null);
  const measureClickRef = useRef({ count: 0, first: null });
  const measureModeRef = useRef(false);
  const measureMarkersRef = useRef({ start: null, end: null, label: null, clear: null });
  const mapDragStateRef = useRef({ dragging: true, dblClick: true, box: true });
  const [bathyError, setBathyError] = useState(null);
  const measureHandlersRef = useRef({ firstClick: null, move: null });
  const [soundings, setSoundings] = useState([]);
  const gridLayerRef = useRef(null);
  const [gridOn, setGridOn] = useState(true);
  const [hoverDepth, setHoverDepth] = useState(null);
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

  const clearMeasureAll = () => {
    setMeasureInfo(null);
    if (measureLineRef.current) {
      measureLineRef.current.remove();
      measureLineRef.current = null;
    }
    clearMeasureMarkers();
  };

  // Leaflet 2D map
  useEffect(() => {
    if (is3D) return;
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
        opacity: imageryOpacity,
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
        opacity: bathyOpacity,
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

  }, [data.lat, data.lon, data.heading, data.cog, data.sog, zoom]);

  useEffect(() => {
    if (!mapRef.current) return;
    const { lat, lon, heading = 0, cog = 0, sog = 0 } = data;
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

  }, [data.lat, data.lon, data.heading, data.cog, data.sog, is3D]);

  // Synthetic soundings field (for hover depth) seeded around vessel.
  useEffect(() => {
    const synthetic = [];
    const offsets = [-0.02, -0.01, 0, 0.01, 0.02];
    offsets.forEach((dy) => {
      offsets.forEach((dx) => {
        const lat = data.lat + dy;
        const lon = data.lon + dx;
        const distFactor = Math.sqrt(dx * dx + dy * dy);
        const depth = Math.max(1, data.depth + (Math.random() - 0.5) * 1.5 + distFactor * 20);
        synthetic.push({ id: `syn-${lat}-${lon}`, lat, lon, depth });
      });
    });
    setSoundings(synthetic);
  }, [data.lat, data.lon, data.depth]);

  // Render local depth halo near vessel (currently disabled to avoid double circles).
  useEffect(() => {
    if (!depthLayerRef.current || !mapRef.current) return;
    depthLayerRef.current.clearLayers();
  }, [data.lat, data.lon]);

  // Track cursor depth from nearest synthetic sounding.
  useEffect(() => {
    if (!mapRef.current || is3D) return;
    const map = mapRef.current;
    const moveHandler = (e) => {
      let nearest = null;
      let best = Number.POSITIVE_INFINITY;
      soundings.forEach((s) => {
        const d = distanceNm(e.latlng.lat, e.latlng.lng, s.lat, s.lon);
        if (d < best) {
          best = d;
          nearest = s;
        }
      });
      if (nearest) {
        setHoverDepth({ depth: nearest.depth, latlng: e.latlng });
      } else {
        setHoverDepth(null);
      }
    };
    map.on("mousemove", moveHandler);
    return () => map.off("mousemove", moveHandler);
  }, [soundings, is3D]);

  // Grid overlay around the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gridLayerRef.current) return;

    const redraw = () => {
      const grid = gridLayerRef.current;
      grid.clearLayers();
      if (!gridOn) return;
      const bounds = map.getBounds();
      const zoom = map.getZoom();
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
  const updateGrid3D = (map) => {
    if (!map || !grid3DReadyRef.current) return;
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
  };

  // MapLibre 3D map (bathy-only for now) with tilt/pan/rotate controls.
  useEffect(() => {
    if (!is3D) {
      if (map3DRef.current) {
        map3DRef.current.remove();
        map3DRef.current = null;
      }
      return;
    }
    if (map3DRef.current || !map3DContainerRef.current) return;

    // Clear 2D-only overlays
    setHoverDepth(null);
    setGridStepLabel(null);
    setFollow3D(true);

    setDemDebug("DEM: probing...");

    const map = new maplibregl.Map({
      container: map3DContainerRef.current,
      style: {
        version: 8,
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
            layout: { visibility: "visible" },
          },
        ],
      },
      center: mapRef.current ? [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat] : [data.lon, data.lat],
      zoom: mapRef.current ? mapRef.current.getZoom() : 13,
      pitch: 0,
      bearing: 0,
      interactive: true,
      antialias: true,
      maxZoom: 18,
      minZoom: 3,
      boxZoom: false,
      keyboard: true,
      dragPan: true,
      dragRotate: true,
      pitchWithRotate: true,
      transformRequest: (url, type) => {
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
      // Apply imagery visibility/opacity after load
      if (map.getLayer("imagery")) {
        map.setPaintProperty("imagery", "raster-opacity", imageryOpacity);
        map.setLayoutProperty("imagery", "visibility", imageryOn ? "visible" : "none");
      }
    });
    map.on("zoom", () => setMap3DZoom(map.getZoom()));
    map.on("error", () => setBathyError("Bathy tiles unavailable in 3D."));
    map.on("dragstart", () => setFollow3D(false));
    map.on("rotatestart", () => setFollow3D(false));
    map.on("pitchstart", () => setFollow3D(false));
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

      // Resolve DEM with fail-fast and neighbor scan.
      (async () => {
        const candidate = await findDemUrl(data.lat, data.lon);
        if (!candidate || !candidate.url) {
          setDemDebug("DEM off (no reachable tile)");
          map.setTerrain(null);
          return;
        }
        try {
          if (!map.getSource("dem")) {
            map.addSource("dem", { type: "raster-dem", tiles: [candidate.url], tileSize: 256, maxzoom: 14 });
          }
          map.setTerrain({ source: "dem", exaggeration: 1.0 });
          setDemDebug(`DEM on: ${candidate.reason}`);
        } catch (e) {
          console.warn("DEM apply failed", e);
          setDemDebug("DEM off (apply failed)");
          map.setTerrain(null);
        }
      })();
    });
    // On first show, jump to current 2D view for alignment.
    if (mapRef.current) {
      const c = mapRef.current.getCenter();
      map.jumpTo({ center: [c.lng, c.lat], zoom: mapRef.current.getZoom(), bearing: 0, pitch: 0 });
    }
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
  }, [is3D, bathyOpacity]);

  // Sync 3D camera to vessel when active.
  useEffect(() => {
    if (!is3D || !map3DRef.current || !follow3D) return;
    const map = map3DRef.current;

    // Update vessel 3D model
    const boat = buildVessel3DTriangle(data.lat, data.lon, data.heading || 0);
    if (!vessel3DReadyRef.current && map.isStyleLoaded()) {
      if (!map.getSource("vessel3d")) {
        map.addSource("vessel3d", { type: "geojson", data: boat });
        map.addLayer({
          id: "vessel3d",
          type: "fill-extrusion",
          source: "vessel3d",
          paint: {
            "fill-extrusion-color": "#22c55e",
            "fill-extrusion-height": 8,
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.9,
          },
        });
      }
      vessel3DReadyRef.current = true;
    } else if (map.getSource("vessel3d")) {
      map.getSource("vessel3d").setData(boat);
    }

    map.easeTo({
      center: [data.lon, data.lat],
      bearing: 0,
      pitch: 0,
      duration: 500,
      essential: false,
    });
  }, [data.lat, data.lon, data.heading, is3D]);

  // Update bathy opacity in 3D when slider changes.
  useEffect(() => {
    if (!is3D || !map3DRef.current) return;
    if (map3DRef.current.getLayer("bathy")) {
      map3DRef.current.setPaintProperty("bathy", "raster-opacity", bathyOpacity);
    }
  }, [bathyOpacity, is3D]);

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
  }, [gridOn, is3D]);

  // Handle seamark toggle.
  useEffect(() => {
    if (seamarkLayerRef.current) {
      if (seamarkOn) {
        if (!mapRef.current.hasLayer(seamarkLayerRef.current)) {
          seamarkLayerRef.current.addTo(mapRef.current);
        }
      } else {
        mapRef.current.removeLayer(seamarkLayerRef.current);
      }
    }
  }, [seamarkOn]);

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

  // Track measure mode for click handler and cursor.
  useEffect(() => {
    measureModeRef.current = measureMode;
    const map = mapRef.current;
    if (!map) return;

    // Cleanup previous handlers
    if (measureHandlersRef.current.firstClick) map.off("click", measureHandlersRef.current.firstClick);
    if (measureHandlersRef.current.move) map.off("mousemove", measureHandlersRef.current.move);

    if (!measureMode) {
      // Restore controls/cursor
      if (map.dragging && mapDragStateRef.current.dragging) map.dragging.enable();
      if (map.doubleClickZoom && mapDragStateRef.current.dblClick) map.doubleClickZoom.enable();
      if (map.boxZoom && mapDragStateRef.current.box) map.boxZoom.enable();
      map._container.style.cursor = "";
      return;
    }

    // Enable measure mode: disable map gestures, set cursor, set up handlers
    mapDragStateRef.current = {
      dragging: map.dragging?.enabled?.() ?? true,
      dblClick: map.doubleClickZoom?.enabled?.() ?? true,
      box: map.boxZoom?.enabled?.() ?? true,
    };
    if (map.dragging) map.dragging.disable();
    if (map.doubleClickZoom) map.doubleClickZoom.disable();
    if (map.boxZoom) map.boxZoom.disable();
    map._container.style.cursor = "crosshair";

    const startMeasure = (e) => {
      const start = e.latlng;
      if (measureLineRef.current) {
        measureLineRef.current.remove();
        measureLineRef.current = null;
      }
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
  }, [measureMode]);

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
  }, []);

  const clearMeasureMarkers = () => {
    const { start, end, label, clear } = measureMarkersRef.current;
    if (start) start.remove();
    if (end) end.remove();
    if (label) label.remove();
    if (clear) clear.remove();
    measureMarkersRef.current = { start: null, end: null, label: null, clear: null };
  };

  const placeMeasureMarkers = (start, end, text) => {
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
  };

  // Search handler: try lat,lon parse; fallback to Anthropic geocode if configured.
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchError(null);
    // 1) Try direct lat,lon.
    const parsed = parseLatLon(searchQuery);
    if (parsed) {
      console.info("[search] parsed lat/lon", parsed);
      focusMap(parsed.lat, parsed.lon);
      return;
    }
    // 2) Try Anthropic geocode if key is present.
    setSearchPending(true);
    try {
      console.info("[search] geocoding via Anthropic", searchQuery);
      const result = await geocodeWithAnthropic(searchQuery);
      if (result) {
        console.info("[search] geocode success", result);
        focusMap(result.lat, result.lon);
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

  const focusMap = (lat, lon) => {
    if (mapRef.current) {
      mapRef.current.setView([lat, lon], mapRef.current.getZoom(), { animate: true });
    }
    if (map3DRef.current) {
      map3DRef.current.jumpTo({
        center: [lon, lat],
        zoom: map3DRef.current.getZoom() || 13,
        bearing: 0,
        pitch: 0,
      });
    }
  };

  return (
    <WidgetFrame title="Chart (OpenSeaMap)" color="#22c55e">
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
              measureModeRef.current = true;
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
            onClick={() => setIs3D((v) => !v)}
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
            }}
          >
            🎛 3D
          </button>
          <button
            data-no-drag
            onClick={() => {
              if (mapRef.current) {
                const currentZoom = mapRef.current.getZoom();
                mapRef.current.setView([data.lat, data.lon], currentZoom);
              } else if (map3DRef.current) {
                setFollow3D(true);
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
          height: "calc(100vh - 220px)",
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
          height: "calc(100vh - 220px)",
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
      {searchError && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>
          {searchError}
        </div>
      )}
      {(hoverDepth || gridStepLabel || demDebug) && (
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
          {hoverDepth && <>Depth under cursor: {hoverDepth.depth?.toFixed?.(1) ?? "--"} m</>}
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
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div
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

function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function lineSlopeDeg(start, end) {
  const dy = end.lat - start.lat;
  const dx = end.lng - start.lng;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function clampBathyZ(url, maxZ) {
  return url.replace(/(tile\/)(\d+)(\/)/, (m, p1, z, p3) => `${p1}${Math.min(parseInt(z, 10), maxZ)}${p3}`);
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

function tileFromLatLon(lat, lon, z) {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
  return { z, x, y };
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

// Build a small 3D wedge (triangle) extruded for MapLibre.
function buildVessel3DTriangle(lat, lon, heading) {
  // Distances in meters
  const forward = 25;
  const back = -10;
  const lateral = 6;
  const apex = destinationPointMeters(lat, lon, heading, forward);
  const backCenter = destinationPointMeters(lat, lon, heading, back);
  const baseLeft = destinationPointMeters(backCenter[0], backCenter[1], heading - 90, lateral);
  const baseRight = destinationPointMeters(backCenter[0], backCenter[1], heading + 90, lateral);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [apex[1], apex[0]],
              [baseLeft[1], baseLeft[0]],
              [baseRight[1], baseRight[0]],
              [apex[1], apex[0]],
            ],
          ],
        },
      },
    ],
  };
}

// Destination point using meters for convenience (approx, uses NM conversion).
function destinationPointMeters(lat, lon, bearingDeg, distanceMeters) {
  const nm = distanceMeters / 1852;
  return destinationPoint(lat, lon, bearingDeg, nm);
}

// Anthropic geocode helper; requires VITE_ANTHROPIC_API_KEY at build/run time.
async function geocodeWithAnthropic(query) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Geocode unavailable: set VITE_ANTHROPIC_API_KEY to enable.");
  }
  const proxy =
    import.meta.env.VITE_ANTHROPIC_PROXY_URL ||
    (typeof window !== "undefined" ? "/anthropic/v1/messages" : null);
  const url = proxy || "https://api.anthropic.com/v1/messages";
  const headers = { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      system:
        "You extract latitude and longitude in decimal degrees. Respond ONLY with JSON: {\"lat\":<number>,\"lon\":<number>}. If unknown, respond {}.",
      messages: [{ role: "user", content: query }],
    }),
  });
  if (!resp.ok) {
    throw new Error("Geocode request failed.");
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
      return parsed;
    }
  } catch (e) {
    // fallthrough
  }
  return null;
}

export default Chart;
