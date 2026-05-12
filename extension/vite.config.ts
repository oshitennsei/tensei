import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import path from "path";
import pkg from "./package.json";
import type { Plugin } from "vite";

function redirectRootToSidebar(): Plugin {
  return {
    name: "redirect-root-to-sidebar",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/") {
          res.writeHead(302, { Location: "/src/sidebar/index.html" });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  build: {
    sourcemap: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    webExtension({
      manifest: "manifest.json",
    }),
    redirectRootToSidebar(),
  ],
  server: {
    port: 5173,
    allowedHosts: ["tensei.alexlee.ccwu.cc"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});