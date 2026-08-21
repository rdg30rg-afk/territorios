import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons.svg', 'pwa/icon-180.png'],
      manifest: {
        name: 'Territorios San Juan',
        short_name: 'Territorios',
        description:
          'Gestor territorial con mapas, conductores, grupos y salidas.',
        theme_color: '#4e342e',
        background_color: '#f7f5f2',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'es-AR',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa/icon-180.png',
            sizes: '180x180',
            type: 'image/png',
          },
        ],
        shortcuts: [
          {
            name: 'Mapas y Territorios',
            short_name: 'Mapas',
            url: '/mapas',
            description: 'Abrir el modulo de territorios',
          },
          {
            name: 'Salidas',
            short_name: 'Salidas',
            url: '/salidas',
            description: 'Abrir el modulo de salidas',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
