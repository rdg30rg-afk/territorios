import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Los íconos no llevan hash en el nombre, y el navegador y la CDN de Hostinger
// los guardan una semana: al cambiar la marca se seguía viendo la vieja. Su
// dirección lleva entonces `?v=` con un resumen de su contenido, que cambia
// solo cuando se regeneran (scripts/generar-iconos.mjs).
const ICONOS_DE_LA_MARCA = [
  'favicon.svg',
  'favicon.ico',
  'pwa/icon-180.png',
  'pwa/icon-192.png',
  'pwa/icon-512.png',
  'pwa/icon-maskable-512.png',
]
const versionDeLaMarca = ICONOS_DE_LA_MARCA.reduce(
  (resumen, ruta) => resumen.update(readFileSync(resolve(__dirname, 'public', ruta))),
  createHash('sha256'),
).digest('hex').slice(0, 10)

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
    {
      name: 'version-de-la-marca',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('%VERSION_MARCA%', versionDeLaMarca),
      },
    },
    VitePWA({
      // "prompt": el service worker nuevo se instala pero queda esperando.
      // Con "autoUpdate" (+ skipWaiting + clientsClaim) una publicación le
      // recargaba la pantalla a quien estaba marcando o editando. Ahora
      // AvisoActualizacion muestra "Hay una versión nueva" y recién cuando
      // la persona toca "Actualizar" (y no quedan marcas por enviar) se
      // activa el worker nuevo y se recarga.
      registerType: 'prompt',
      // Sin script inyectado: el registro lo hace AvisoActualizacion con
      // `virtual:pwa-register/react`, para poder avisar y esperar.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'icons.svg', 'pwa/icon-180.png'],
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
            src: `pwa/icon-192.png?v=${versionDeLaMarca}`,
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: `pwa/icon-512.png?v=${versionDeLaMarca}`,
            sizes: '512x512',
            type: 'image/png',
          },
          {
            // La marca más chica, dentro del círculo que recorta Android.
            src: `pwa/icon-maskable-512.png?v=${versionDeLaMarca}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: `pwa/icon-180.png?v=${versionDeLaMarca}`,
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
        // Se reclaman los clientes al activarse, pero activarse ya NO es
        // automático: sin `skipWaiting: true` el worker nuevo espera hasta
        // recibir el mensaje SKIP_WAITING que manda el botón "Actualizar".
        clientsClaim: true,
        skipWaiting: false,
        navigateFallback: '/index.html',
        // Sin esto, el service worker le contesta index.html a quien pide
        // el editor y la PWA instalada abre la app en su lugar.
        navigateFallbackDenylist: [/^\/editor-manzanas\.html$/],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        // Los datos runtime se sirven online pero no se precachean: el build
        // seguro conserva una lista explícita de archivos públicos permitidos
        // y elimina respaldos locales. banco-ato es un prototipo, no se publica.
        globIgnores: ['**/datos/**', 'banco-ato.html'],
        // Teselas del mapa para usar sin señal, de MapTiler y de OpenStreetMap.
        // Se compara por host, no por la forma del path: la precarga de teselas
        // pide exactamente la URL que arma Leaflet (con el subdominio {s} de
        // OSM, a/b/c.tile.openstreetmap.org, y el @2x de MapTiler), y esa URL
        // tiene que caer acá sin importar cómo se arme. Hoy la app no pide a
        // api.maptiler.com nada que no sea una tesela; si algún día pide
        // estilos, glifos o búsquedas, acotar el path para que no queden 30
        // días en un CacheFirst.
        // Supabase NO se cachea acá: la sesión y los datos tienen que ser
        // siempre los del servidor.
        //
        // El nombre del caché es un contrato: la precarga de teselas escribe
        // en 'teselas-mapa' y esta ruta las lee. No cambiarlo de un solo lado.
        //
        // La función se serializa dentro de sw.js: tiene que bastarse sola,
        // sin variables ni imports de afuera.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.hostname === 'api.maptiler.com' ||
              url.hostname === 'tile.openstreetmap.org' ||
              url.hostname.endsWith('.tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'teselas-mapa',
              expiration: {
                maxEntries: 3000,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                // Las respuestas opacas (status 0) pesan mucho para la
                // cuota del navegador: si se llena, se vacía este caché en
                // vez de dejar de guardar el resto de la app.
                purgeOnQuotaError: true,
              },
              // 0 = respuesta opaca: un <img> de otro origen sin
              // crossorigin la devuelve así, y es el caso normal de Leaflet.
              cacheableResponse: { statuses: [0, 200] },
              // La precarga pide con CORS y el <img> sin CORS: sin esto el
              // Vary de la respuesta hace que una no encuentre a la otra.
              matchOptions: { ignoreVary: true },
            },
          },
        ],
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
