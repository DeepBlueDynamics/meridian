const { contextBridge } = require("electron");

// The renderer only learns the proxied root URL — never the key.
contextBridge.exposeInMainWorld("meridian", {
  isElectron: true,
  tiles: {
    rootUrl: "app://3dtiles/v1/3dtiles/root.json",
  },
});
