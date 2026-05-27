import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import pkg from "./package.json";

export default defineConfig({
  root: path.resolve(__dirname, "src/sidebar"),
  base: "/app/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      scope: "/app/",
      base: "/app/",
      // Service worker file output
      filename: "sw.js",
      // Inline the SW registration so no extra request is needed
      injectRegister: "inline",
      workbox: {
        // Precache JS, CSS, images, and WASM (fingerprinted → safe to cache forever)
        globPatterns: ["**/*.{js,css,wasm,webp,png,svg,ico}"],
        globIgnores: ["**/node_modules/**"],
        // Raise limit to 30 MB so the 23 MB ONNX runtime WASM is precached
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        runtimeCaching: [
          // HuggingFace model files (ONNX weights, tokenizer, config)
          {
            urlPattern: /^https:\/\/huggingface\.co\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "hf-model-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn-lfs.*\.huggingface\.co\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "hf-model-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Prevent SW from intercepting API worker calls
        navigateFallback: "/app/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/admin/],
      },
      manifest: {
        name: "Tensei | キャラクターが転生してきた件",
        short_name: "Tensei",
        description: "好きな小説のキャラクターと対話できるアプリ",
        theme_color: "#4f46e5",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/app/",
        scope: "/app/",
        icons: [
          {
            src: "/app/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/app/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ["tensei.alexlee.ccwu.cc"],
  },
  build: {
    outDir: path.resolve(__dirname, "dist-web"),
    emptyOutDir: true,
  },
});
