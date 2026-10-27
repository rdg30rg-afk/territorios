import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const leer = (ruta) => readFile(join(repoRoot, ruta), 'utf8')

/** El valor de la política de contenido, tal como queda en el encabezado. */
function politica(htaccess, nombreDeEncabezado) {
  const linea = htaccess
    .split('\n')
    .find((l) => !l.trim().startsWith('#') && l.includes(`Header always set ${nombreDeEncabezado} "`))
  if (!linea) return null
  return linea.slice(linea.indexOf('"') + 1, linea.lastIndexOf('"'))
}

function directivas(valor) {
  const mapa = new Map()
  for (const parte of valor.split(';')) {
    const [nombre, ...fuentes] = parte.trim().split(/\s+/)
    if (nombre) mapa.set(nombre, fuentes)
  }
  return mapa
}

test('.htaccess: los assets con hash salen un año e inmutables, solo si el archivo existe', async () => {
  const htaccess = await leer('public/.htaccess')
  assert.match(htaccess, /Header set Cache-Control "public, max-age=31536000, immutable" env=ASSET_CON_HASH/)
  // La marca se pone solo para archivos reales de /assets/: si faltan, el
  // fallback del SPA contesta index.html con 200 y no puede quedar "inmutable".
  assert.match(htaccess, /RewriteCond %\{REQUEST_FILENAME\} -f\s*\n\s*RewriteRule \^assets\/ - \[E=ASSET_CON_HASH:1\]/)
  // Y esa regla va antes del fallback del SPA.
  assert.ok(htaccess.indexOf('E=ASSET_CON_HASH:1') < htaccess.indexOf('RewriteRule ^ index.html [L]'))
})

test('.htaccess: el manifest sale con su tipo', async () => {
  const htaccess = await leer('public/.htaccess')
  assert.match(htaccess, /AddType application\/manifest\+json \.webmanifest/)
})

test('.htaccess: lo que apunta a la versión vigente nunca se guarda', async () => {
  const htaccess = await leer('public/.htaccess')
  const bloque = /<FilesMatch "\^\(([^)]+)\)\$">\s*Header set Cache-Control "no-cache, no-store, must-revalidate"/.exec(htaccess)
  assert.ok(bloque, 'tiene que haber un FilesMatch con no-cache')
  const archivos = bloque[1].split('|').map((nombre) => nombre.replace(/\\/g, ''))
  for (const esperado of ['index.html', 'editor-manzanas.html', 'editor-manzanas-embedded.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest', 'version.json']) {
    assert.ok(archivos.includes(esperado), `${esperado} tiene que ser no-cache`)
  }
})

test('.htaccess: conserva lo que ya estaba bien', async () => {
  const htaccess = await leer('public/.htaccess')
  assert.match(htaccess, /Options -Indexes -MultiViews/)
  assert.match(htaccess, /DirectoryIndex index\.html/)
  assert.match(htaccess, /RewriteRule \^ index\.html \[L\]/)
  assert.match(htaccess, /X-Content-Type-Options "nosniff"/)
  assert.match(htaccess, /Referrer-Policy "strict-origin-when-cross-origin"/)
})

test('.htaccess: todos los bloques <IfModule> y <FilesMatch> están cerrados', async () => {
  const htaccess = (await leer('public/.htaccess')).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  for (const etiqueta of ['IfModule', 'FilesMatch']) {
    const abre = (htaccess.match(new RegExp(`<${etiqueta}[ >]`, 'g')) ?? []).length
    const cierra = (htaccess.match(new RegExp(`</${etiqueta}>`, 'g')) ?? []).length
    assert.equal(abre, cierra, `${etiqueta}: ${abre} abren y ${cierra} cierran`)
  }
})

test('.htaccess: la CSP va en modo solo reporte: no se puede garantizar que no rompa el editor', async () => {
  const htaccess = await leer('public/.htaccess')
  assert.ok(politica(htaccess, 'Content-Security-Policy-Report-Only'), 'tiene que haber una CSP en modo solo reporte')
  // El encabezado que bloquea NO está activo (solo puede aparecer en comentarios).
  assert.equal(politica(htaccess, 'Content-Security-Policy'), null)
  // Y el porqué queda escrito junto a la política.
  assert.match(htaccess, /MapasPage inyecta un <script> en línea/)
  assert.match(htaccess, /Cómo pasarla a "aplicar"/)
})

test('.htaccess: la CSP permite Supabase (https y wss), MapTiler, OSM, unpkg, esm.sh, Google Fonts, blob: y data:', async () => {
  const htaccess = await leer('public/.htaccess')
  const csp = directivas(politica(htaccess, 'Content-Security-Policy-Report-Only'))

  assert.deepEqual(csp.get('default-src'), ["'self'"])
  const conectar = csp.get('connect-src')
  for (const fuente of ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://api.maptiler.com', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org']) {
    assert.ok(conectar.includes(fuente), `connect-src sin ${fuente}`)
  }
  const imagenes = csp.get('img-src')
  for (const fuente of ["'self'", 'data:', 'blob:', 'https://api.maptiler.com', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://unpkg.com']) {
    assert.ok(imagenes.includes(fuente), `img-src sin ${fuente}`)
  }
  const scripts = csp.get('script-src')
  for (const fuente of ["'self'", 'https://unpkg.com', 'https://esm.sh']) assert.ok(scripts.includes(fuente), `script-src sin ${fuente}`)
  // El editor y MapasPage usan scripts en línea: sin esto, al pasar a "aplicar" se rompería.
  assert.ok(scripts.includes("'unsafe-inline'"))
  const estilos = csp.get('style-src')
  for (const fuente of ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com']) assert.ok(estilos.includes(fuente), `style-src sin ${fuente}`)
  assert.ok(csp.get('font-src').includes('https://fonts.gstatic.com'))
  assert.ok(csp.get('font-src').includes('data:'))
  // MapLibre arma su worker con un blob:.
  assert.ok(csp.get('worker-src').includes('blob:'))
  assert.deepEqual(csp.get('object-src'), ["'none'"])
  assert.deepEqual(csp.get('base-uri'), ["'self'"])
})

test('.htaccess: todo origen externo que cargan index.html y el editor está permitido en la CSP', async () => {
  const htaccess = await leer('public/.htaccess')
  const valor = politica(htaccess, 'Content-Security-Policy-Report-Only')
  const todasLasFuentes = [...directivas(valor).values()].flat()
  const permite = (host) =>
    todasLasFuentes.some((fuente) => {
      const limpio = fuente.replace(/^(https?|wss?):\/\//, '')
      return limpio === host || (limpio.startsWith('*.') && host.endsWith(limpio.slice(1)))
    })

  const externos = new Set()
  for (const archivo of ['index.html', 'editor-manzanas.html']) {
    const html = await leer(archivo)
    // Solo lo que el navegador CARGA: src, href de stylesheet/preconnect e imports de módulos.
    for (const coincidencia of html.matchAll(/(?:\bsrc=|\bhref=|from\s+)["'](https:\/\/[^"'/]+)/g)) {
      if (/<a\s/.test(html.slice(Math.max(0, coincidencia.index - 4), coincidencia.index + 2))) continue
      externos.add(coincidencia[1].replace('https://', ''))
    }
  }
  assert.ok(externos.size >= 4, `se esperaban varios orígenes externos, hay: ${[...externos].join(', ')}`)
  for (const host of externos) assert.ok(permite(host), `la CSP no permite ${host}, que cargan index.html o el editor`)
})
