import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/mtg-transcriber/",
  plugins: [
    VitePWA({
      base: "/mtg-transcriber/",
      scope: "/mtg-transcriber/",
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-maskable.png"],
      manifest: {
        name: "MTG文字起こし",
        short_name: "MTG文字起こし",
        description: "ブラウザ内で完結する音声文字起こしアプリ",
        start_url: "/mtg-transcriber/",
        scope: "/mtg-transcriber/",
        display: "standalone",
        background_color: "#f8fafc",
        theme_color: "#0f766e",
        lang: "ja",
        icons: [
          {
            src: "/mtg-transcriber/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/mtg-transcriber/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/mtg-transcriber/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/mtg-transcriber/index.html",
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(huggingface\.co|cdn-lfs\.huggingface\.co|[a-z0-9-]+\.xethub\.hf\.co)\//,
            handler: "CacheFirst",
            options: {
              cacheName: "hf-model-cache",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 180
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ]
});
