// Basic formatting utilities for navigation displays.

// Format latitude with optional style: 'DD', 'DMM', or 'DMS'.
export const formatLat = (lat, format = "DMM") => {
  const abs = Math.abs(lat);
  const dir = lat >= 0 ? "N" : "S";
  if (format === "DD") return `${abs.toFixed(5)}°${dir}`;
  const deg = Math.floor(abs);
  const minutes = (abs - deg) * 60;
  if (format === "DMM") return `${deg}°${minutes.toFixed(3)}'${dir}`;
  const minInt = Math.floor(minutes);
  const sec = (minutes - minInt) * 60;
  return `${deg}°${minInt}'${sec.toFixed(1)}"${dir}`;
};

// Format longitude with optional style: 'DD', 'DMM', or 'DMS'.
export const formatLon = (lon, format = "DMM") => {
  const abs = Math.abs(lon);
  const dir = lon >= 0 ? "E" : "W";
  if (format === "DD") return `${abs.toFixed(5)}°${dir}`;
  const deg = Math.floor(abs);
  const minutes = (abs - deg) * 60;
  if (format === "DMM") return `${deg}°${minutes.toFixed(3)}'${dir}`;
  const minInt = Math.floor(minutes);
  const sec = (minutes - minInt) * 60;
  return `${deg}°${minInt}'${sec.toFixed(1)}"${dir}`;
};

export const formatHeading = (hdg) =>
  `${Math.round((hdg + 360) % 360).toString().padStart(3, "0")}°`;

export const formatSpeed = (speed) => `${speed.toFixed(1)} kn`;
