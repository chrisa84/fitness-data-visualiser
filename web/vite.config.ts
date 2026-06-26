import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ship a new service worker automatically when the bundle changes; the
      // plugin injects the registration script (injectRegister: 'auto').
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32x32.png', 'icons/apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Fitness Data Visualiser',
        short_name: 'Fitness',
        description: 'Charts and analysis of your Garmin data.',
        id: '/',
        start_url: '/',
        display: 'standalone',
        background_color: '#14171c',
        theme_color: '#14171c',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell (hashed JS/CSS/HTML). Data is NOT precached —
        // it's fetched live and cached at runtime below.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // API responses: always try the network first so charts are fresh, but
        // fall back to the last successful response when offline. The login
        // redirect from oauth2-proxy is never a 200, so it won't get cached.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
