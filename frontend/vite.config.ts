import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import solid from "vite-plugin-solid";

// Single source of truth for this build: also read by __APP_NAME__ below
// and by the index.html %APP_NAME% placeholder, so the value only has to
// be resolved once. Backed by the same APP_NAME the Go backend reads
// (see cardpod.env), so both sides agree without duplicating the value.
const appName = process.env.APP_NAME;

// index.html isn't JS, so Vite's `define` (below) can't reach it;
// this replaces the %APP_NAME% placeholder at build/serve time
// instead, without widening envPrefix to expose non-VITE_ vars.
const injectAppNameHtml: Plugin = {
  name: "inject-app-name-html",
  transformIndexHtml(html) {
    return html.replace(/%APP_NAME%/g, appName ?? "");
  },
};

// Proxy settings shared by every websocket endpoint of the backend (collab
// editing and realtime card events). configure() rewrites the outgoing Origin
// header to match the proxy target: the backend's websocket upgraders reject
// any handshake whose Origin doesn't match the Host they receive.
// changeOrigin only rewrites Host, not Origin, so without this every real
// cross-origin connection (i.e. anything going through this dev proxy)
// fails the handshake.
const wsProxy: ProxyOptions = {
  target: "http://127.0.0.1:3000",
  changeOrigin: true,
  ws: true,
  configure: (proxy) => {
    proxy.on("proxyReqWs", (proxyReq) => {
      proxyReq.setHeader("origin", "http://127.0.0.1:3000");
    });
  },
};

export default defineConfig({
  plugins: [solid(), injectAppNameHtml],
  // Resolves the "@/*" alias declared in tsconfig.json's "paths".
  resolve: {
    tsconfigPaths: true,
    // Force a single instance of the CodeMirror core packages. With
    // node_modules hoisted to the repository root, bun can install several
    // copies, which breaks instanceof checks ("Unrecognized extension value").
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@lezer/common",
    ],
  },
  // solid-codemirror needs a single instance of these packages, or
  // "Unrecognized extension value" errors appear.
  optimizeDeps: {
    include: ["@codemirror/state", "@codemirror/view"],
  },
  // __APP_NAME__ is a build-time constant (not a runtime env var), so it
  // can be referenced anywhere in src/ without an import.
  define: {
    __APP_NAME__: JSON.stringify(appName),
  },
  server: {
    host: "0.0.0.0",
    port: 3001,
    allowedHosts: true,
    // node_modules lives at the repository root, outside frontend/, so Vite
    // must be allowed to serve files from there (fonts are fetched via /@fs/).
    fs: {
      allow: [".."],
    },
    proxy: {
      // Use 127.0.0.1 explicitly to avoid localhost resolving to ::1 (IPv6)
      // while PocketBase only listens on 127.0.0.1 (IPv4).
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/_": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/files": { target: "http://127.0.0.1:3000", changeOrigin: true },

      "/collab/": wsProxy,
      "/connection/": wsProxy,
    },
  },
  build: {
    outDir: "../internal/static/dist",
    emptyOutDir: true,
  },
});
