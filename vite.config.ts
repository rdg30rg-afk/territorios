import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Coincidir con la URL local usada por la app; evitar que localhost resuelva
  // solo a ::1 y el navegador en 127.0.0.1 termine mostrando caché obsoleta.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  // El editor de manzanas es una pagina aparte, no un componente de React.
  // Sin declararla aca, `vite build` solo empaqueta index.html: en el dev
  // server funcionaba porque sirve cualquier archivo del proyecto, y en
  // produccion la pagina directamente no existia.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor-manzanas.html'),
      },
    },
  },
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
          'Administración territorial para mapas, grupos y salidas.',
        theme_color: '#cbea5b',
        background_color: '#f6f4ee',
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
        // Sin esto, el service worker le contesta index.html a quien pide
        // el editor y la PWA instalada abre la app en su lugar.
        navigateFallbackDenylist: [/^\/editor-manzanas\.html$/],
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        // Los datos runtime se sirven online pero no se precachean: el build
        // seguro conserva una lista explícita de archivos públicos permitidos
        // y elimina respaldos locales. banco-ato es un prototipo, no se publica.
        globIgnores: ['**/datos/**', 'banco-ato.html'],
      },
      devOptions: {
        // Apagado. El service worker de desarrollo secuestraba el editor:
        // la pagina cargaba, el worker se activaba con autoUpdate, forzaba
        // una recarga y el navigateFallback contestaba index.html. La app
        // arrancaba, no encontraba la ruta y te sacaba a otro lado. El
        // denylist del bloque de arriba solo lo respeta el worker del
        // build, no el de desarrollo.
        enabled: false,
      },
    }),
  ],
})
