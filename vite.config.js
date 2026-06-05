import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react()
  ],
  server: {
    proxy: {
      "/anthropic": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/anthropic/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const apiKey =
              process.env.ANTHROPIC_API_KEY ||
              process.env.VITE_ANTHROPIC_API_KEY ||
              (req.headers["x-anthropic-key"] ? req.headers["x-anthropic-key"] : "");

            console.log("[proxy] API key sources:", {
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "not set",
              VITE_ANTHROPIC_API_KEY: process.env.VITE_ANTHROPIC_API_KEY ? "set" : "not set",
              headerKey: req.headers["x-anthropic-key"] ? "set" : "not set",
              finalKey: apiKey ? `${apiKey.slice(0, 10)}...` : "NONE"
            });

            if (apiKey) {
              proxyReq.setHeader("x-api-key", apiKey);
            }
            proxyReq.setHeader("anthropic-version", "2023-06-01");
            // Remove headers that might confuse Anthropic
            proxyReq.removeHeader("x-anthropic-key");
            proxyReq.removeHeader("origin");
          });
          proxy.on("proxyRes", (proxyRes) => {
            console.log("[proxy] Response status:", proxyRes.statusCode);
            if (proxyRes.statusCode !== 200) {
              let body = "";
              proxyRes.on("data", (chunk) => body += chunk);
              proxyRes.on("end", () => console.log("[proxy] Error body:", body));
            }
          });
        },
      },
    },
  },
})
