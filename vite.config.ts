import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Must stay inline / RegExp — Workbox serializes patterns into sw.js. */
const SUPABASE_HOST_PATTERN =
  /^https:\/\/([^/?#]+\.)?supabase\.co(\/|$)/i

const SUPABASE_API_PATH_PATTERN =
  /\/(rest|rpc|auth|functions|storage)\/v1\//

const supabaseMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: [
        'favicon.svg',
        'icons/apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-192-maskable.png',
        'icons/icon-512-maskable.png',
      ],
      manifest: {
        id: '/',
        name: 'À la Nantaise',
        short_name: 'ALN Pronos',
        description:
          'À la Nantaise — pronostics amicaux sur les matchs du FC Nantes.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f4f0',
        theme_color: '#ffdd00',
        categories: ['sports', 'entertainment'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Shell + static hashed assets only. Never cache Supabase traffic.
        // Push handlers only — no fetch logic in push-events.js.
        importScripts: ['/push-events.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2,webmanifest}'],
        runtimeCaching: [
          ...supabaseMethods.map((method) => ({
            urlPattern: SUPABASE_HOST_PATTERN,
            handler: 'NetworkOnly' as const,
            method,
          })),
          // Defensive path match if a future proxy rewrites Supabase under same origin.
          {
            urlPattern: SUPABASE_API_PATH_PATTERN,
            handler: 'NetworkOnly' as const,
            method: 'GET' as const,
          },
          {
            urlPattern: SUPABASE_API_PATH_PATTERN,
            handler: 'NetworkOnly' as const,
            method: 'POST' as const,
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    // Bundle principal ~500 kB (supabase-js + fonts déjà hors chunk JS).
    chunkSizeWarningLimit: 600,
  },
})
