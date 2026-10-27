import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadEnv } from 'vite'

import {
  assertAppEditorEntries,
  assertNoJunkFiles,
  assertProductionBundle,
  assertProductionEnvFilesDoNotLeak,
  assertRuntimeSecretsAbsent,
  assertServiceWorkerConsistent,
  assertRuntimeDataPresent,
  BUILD_MODE,
  buildDevSeguro,
  DEV_SUPABASE_REF,
  DEV_SUPABASE_URL,
  decodeJwtPayload,
  ENV_PROFILE,
  prunePublishableOutput,
  PRODUCTION_SUPABASE_REF,
  validateEnvironment,
} from '../scripts/build-dev-seguro.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function jwtFor(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.firma-no-real`
}

function validEnvironment(overrides = {}) {
  return {
    VITE_APP_ENV: 'development',
    VITE_SUPABASE_URL: DEV_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: jwtFor({ ref: DEV_SUPABASE_REF, role: 'anon' }),
    VITE_PRODUCTION_SUPABASE_REF: PRODUCTION_SUPABASE_REF,
    ...overrides,
  }
}

// loadEnv mezcla las variables del proceso con los archivos .env. Para que un
// VITE_* exportado en el shell de quien corre la suite no cambie el resultado,
// se las saca mientras dura la prueba y se restauran al terminar.
async function sinVariablesVite(callback) {
  const guardadas = Object.entries(process.env).filter(([clave]) => clave.startsWith('VITE_'))
  for (const [clave] of guardadas) delete process.env[clave]
  try {
    return await callback()
  } finally {
    for (const [clave, valor] of guardadas) process.env[clave] = valor
  }
}

async function withRuntimeFixture(text, callback) {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-runtime-fixture-'))
  try {
    await writeFile(join(outputDir, 'bundle.js'), text)
    return await callback(outputDir)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}

test('fija el tema hermano y no deja selector ni temas alternativos en runtime', async () => {
  const [index, main, vite] = await Promise.all([
    readFile(join(repoRoot, 'index.html'), 'utf8'),
    readFile(join(repoRoot, 'src/main.tsx'), 'utf8'),
    readFile(join(repoRoot, 'vite.config.ts'), 'utf8'),
  ])

  assert.match(index, /<html lang="es-AR" data-theme="hermano">/)
  assert.match(index, /Urbanist/)
  assert.match(index, /theme-color" content="#cbea5b"/)
  assert.doesNotMatch(index, /territorios:theme|localStorage|URLSearchParams|theme-switch|[?&]theme=/i)
  assert.match(main, /theme-hermano\.css/)
  assert.doesNotMatch(main, /theme-(?:mapsi|ato)\.css/)
  assert.doesNotMatch(vite, /bancoAto\s*:/)
  assert.match(vite, /theme_color:\s*'#cbea5b'/)
  assert.match(vite, /background_color:\s*'#f6f4ee'/)
})

test('valida URL DEV y JWT público anon del proyecto correcto', () => {
  const result = validateEnvironment(validEnvironment())
  assert.equal(result.supabaseUrl, DEV_SUPABASE_URL)
  assert.equal(result.supabaseRef, DEV_SUPABASE_REF)
  assert.equal(result.jwtRole, 'anon')
  assert.equal('serviceRoleEntries' in result, false)
})

test('rechaza la URL de producción aunque el JWT sea válido', () => {
  assert.throws(
    () => validateEnvironment(validEnvironment({ VITE_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` })),
    /producción/i,
  )
})

test('rechaza un JWT de otro ref o con rol service_role', () => {
  assert.throws(
    () => validateEnvironment(validEnvironment({ VITE_SUPABASE_ANON_KEY: jwtFor({ ref: 'otro-ref', role: 'anon' }) })),
    /JWT público no pertenece/i,
  )
  assert.throws(
    () => validateEnvironment(validEnvironment({ VITE_SUPABASE_ANON_KEY: jwtFor({ ref: DEV_SUPABASE_REF, role: 'service_role' }) })),
    /rol JWT anon/i,
  )
})

test('rechaza una variable VITE de service role', () => {
  assert.throws(
    () => validateEnvironment(validEnvironment({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'valor-no-real-largo' })),
    /VITE_.*service role/i,
  )
})

test('rechaza un JWT service_role embebido aunque no exista variable service role', async () => {
  await withRuntimeFixture(jwtFor({ ref: DEV_SUPABASE_REF, role: 'service_role' }), (outputDir) =>
    assert.rejects(
      () => assertRuntimeSecretsAbsent(outputDir),
      /JWT Supabase con ref o rol no permitido/i,
    ),
  )
})

test('rechaza un JWT anon de otro ref en el runtime', async () => {
  await withRuntimeFixture(jwtFor({ ref: 'otro-ref', role: 'anon' }), (outputDir) =>
    assert.rejects(
      () => assertRuntimeSecretsAbsent(outputDir),
      /JWT Supabase con ref o rol no permitido/i,
    ),
  )
})

test('permite un JWT anon del ref DEV en el runtime', async () => {
  await withRuntimeFixture(jwtFor({ ref: DEV_SUPABASE_REF, role: 'anon' }), async (outputDir) => {
    const result = await assertRuntimeSecretsAbsent(outputDir)
    assert.equal(result.checkedFiles, 1)
  })
})

test('rechaza tokens sb_secret_ en el runtime', async () => {
  await withRuntimeFixture('const key = "sb_secret_no-real"', (outputDir) =>
    assert.rejects(
      () => assertRuntimeSecretsAbsent(outputDir),
      /token sb_secret_/i,
    ),
  )
})

test('comprueba que app y editor resuelvan URL DEV y assets locales', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-test-'))
  try {
    await mkdir(join(outputDir, 'assets'))
    await writeFile(
      join(outputDir, 'index.html'),
      '<script type="module" src="/assets/main.js"></script><link rel="manifest" href="/manifest.webmanifest">',
    )
    await writeFile(join(outputDir, 'editor-manzanas.html'), `<script type="module">const url = '${DEV_SUPABASE_URL}'</script>`)
    await writeFile(join(outputDir, 'editor-manzanas-embedded.html'), `<script type="module">const url = '${DEV_SUPABASE_URL}'</script>`)
    await writeFile(join(outputDir, 'assets', 'main.js'), `const supabaseUrl = '${DEV_SUPABASE_URL}'`)
    await writeFile(join(outputDir, 'manifest.webmanifest'), '{}')

    const result = await assertAppEditorEntries(outputDir)
    assert.deepEqual(result, { app: '/', editor: '/editor-manzanas.html', supabaseUrl: DEV_SUPABASE_URL })
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('conserva datos runtime permitidos, retira respaldos y poda Ato no referenciado', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-prune-test-'))
  try {
    await mkdir(join(outputDir, 'datos'))
    await mkdir(join(outputDir, 'ato', 'fonts'), { recursive: true })
    await writeFile(join(outputDir, 'datos', 'privado.json'), '{}')
    await writeFile(join(outputDir, 'datos', 'manzanas-congregacion.geojson'), '{"features":[]}')
    await writeFile(join(outputDir, 'datos', 'manzanas-territorios.json'), '{}')
    await writeFile(join(outputDir, 'datos', 'sectores.json'), '{}')
    await writeFile(join(outputDir, 'datos', 'sin-viviendas.json'), '{}')
    await writeFile(join(outputDir, 'banco-ato.html'), '<!doctype html>')
    await writeFile(join(outputDir, 'ato', 'fonts', 'keep.woff'), 'font')
    await writeFile(join(outputDir, 'ato', 'unused.txt'), 'unused')
    await writeFile(join(outputDir, 'index.html'), `<style>@font-face{src:url('/ato/fonts/keep.woff')}</style>`)

    const result = await prunePublishableOutput(outputDir)
    assert.ok(result.removed.includes('datos/privado.json'))
    assert.ok(result.removed.includes('banco-ato.html'))
    assert.ok(result.removed.includes('ato/unused.txt'))
    await assert.rejects(() => readFile(join(outputDir, 'datos', 'privado.json')))
    assert.deepEqual((await assertRuntimeDataPresent(outputDir)).files, [
      'manzanas-congregacion.geojson',
      'manzanas-territorios.json',
      'sectores.json',
      'sin-viviendas.json',
    ])
    await assert.rejects(() => readFile(join(outputDir, 'banco-ato.html')))
    assert.equal(await readFile(join(outputDir, 'ato', 'fonts', 'keep.woff'), 'utf8'), 'font')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('rechaza secretos service role presentes en el runtime generado', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-secret-test-'))
  try {
    await writeFile(join(outputDir, 'app.js'), 'const token = "service-role-valor-no-real"')
    await assert.rejects(
      () => assertRuntimeSecretsAbsent(outputDir, { SUPABASE_SERVICE_ROLE_KEY: 'service-role-valor-no-real' }),
      /service role/i,
    )
    await rm(join(outputDir, 'app.js'))
    await writeFile(join(outputDir, 'prod.js'), `const url = '${`https://${PRODUCTION_SUPABASE_REF}.supabase.co`}'`)
    await assert.rejects(
      () => assertRuntimeSecretsAbsent(outputDir),
      /URL de producción/i,
    )
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

// Un sw.js mínimo que cumple el contrato: precache de app y editor, handler
// SKIP_WAITING (modo prompt), teselas en 'teselas-mapa' con CacheFirst.
const SW_VALIDO =
  'self.addEventListener("message",e=>{e.data&&"SKIP_WAITING"===e.data.type&&self.skipWaiting()});' +
  'precacheAndRoute([{url:"index.html"},{url:"editor-manzanas.html"},{url:"assets/main.js"}]);' +
  'new NavigationRoute(handler,{denylist:[/^\\/editor-manzanas\\.html$/]});' +
  'registerRoute(match,new CacheFirst({cacheName:"teselas-mapa"}),"GET")'

async function withServiceWorkerFixture({ sw = SW_VALIDO, registro = 'bundle' } = {}, callback) {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-sw-test-'))
  try {
    await mkdir(join(outputDir, 'assets'))
    for (const file of ['index.html', 'editor-manzanas.html', 'manifest.webmanifest', 'workbox-test.js']) {
      await writeFile(join(outputDir, file), '')
    }
    // Contrato actual: el registro vive dentro del bundle (virtual:pwa-register).
    // Contrato anterior: un registerSW.js suelto. Los dos valen.
    await writeFile(
      join(outputDir, 'assets', 'main.js'),
      registro === 'bundle'
        ? 'if("serviceWorker"in navigator){new Workbox(`/sw.js`,{scope:`/`,type:`classic`})}'
        : '',
    )
    if (registro === 'registerSW') {
      await writeFile(join(outputDir, 'registerSW.js'), "navigator.serviceWorker.register('/sw.js')")
    }
    await writeFile(join(outputDir, 'sw.js'), sw)
    return await callback(outputDir)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}

test('verifica que cada URL precacheada por Workbox exista en el paquete', () =>
  withServiceWorkerFixture({}, async (outputDir) => {
    const result = await assertServiceWorkerConsistent(outputDir)
    assert.equal(result.serviceWorker, 'sw.js')
    assert.equal(result.precacheCount, 3)
    assert.equal(result.registeredBy, 'assets/main.js')
  }))

test('acepta también el registro desde un registerSW.js suelto', () =>
  withServiceWorkerFixture({ registro: 'registerSW' }, async (outputDir) => {
    const result = await assertServiceWorkerConsistent(outputDir)
    assert.equal(result.registeredBy, 'registerSW.js')
  }))

test('rechaza un sw.js que se activa solo (sin handler SKIP_WAITING)', () =>
  withServiceWorkerFixture(
    { sw: SW_VALIDO.replace('SKIP_WAITING', 'OTRO_MENSAJE') },
    (outputDir) => assert.rejects(() => assertServiceWorkerConsistent(outputDir), /SKIP_WAITING.*se actualizaría solo/i),
  ))

test('rechaza un sw.js sin la ruta de teselas o con otro nombre de caché', async () => {
  await withServiceWorkerFixture({ sw: SW_VALIDO.replace('teselas-mapa', 'otro-cache') }, (outputDir) =>
    assert.rejects(() => assertServiceWorkerConsistent(outputDir), /teselas-mapa/i),
  )
  await withServiceWorkerFixture({ sw: SW_VALIDO.replace('CacheFirst', 'NetworkFirst') }, (outputDir) =>
    assert.rejects(() => assertServiceWorkerConsistent(outputDir), /teselas-mapa.*CacheFirst/i),
  )
})

test('rechaza un sw.js que cachea Supabase', () =>
  withServiceWorkerFixture(
    { sw: `${SW_VALIDO};registerRoute(({url})=>url.hostname==="${DEV_SUPABASE_REF}.supabase.co",new CacheFirst({cacheName:"api"}))` },
    (outputDir) => assert.rejects(() => assertServiceWorkerConsistent(outputDir), /Supabase.*nunca se cachean/i),
  ))

test('rechaza un paquete donde nada registra el service worker', () =>
  withServiceWorkerFixture({ registro: 'ninguno' }, (outputDir) =>
    assert.rejects(() => assertServiceWorkerConsistent(outputDir), /Ningún JS de la app registra sw\.js/i),
  ))

test('rechaza un sw.js que precachea un archivo que no está en el paquete', () =>
  withServiceWorkerFixture(
    { sw: SW_VALIDO.replace('assets/main.js', 'assets/fantasma.js') },
    (outputDir) => assert.rejects(() => assertServiceWorkerConsistent(outputDir), /archivo ausente.*fantasma/i),
  ))

test('decodifica el payload base64url del JWT sin exponer su firma', () => {
  const payload = decodeJwtPayload(jwtFor({ ref: DEV_SUPABASE_REF, role: 'anon' }))
  assert.deepEqual(payload, { ref: DEV_SUPABASE_REF, role: 'anon' })
})

// ---------------------------------------------------------------- P2: modo
test('el build sale en modo production y las variables se leen del perfil development', () => {
  // Son dos cosas distintas: antes `development` hacía las dos a la vez.
  assert.equal(BUILD_MODE, 'production')
  assert.equal(ENV_PROFILE, 'development')
})

test('el build seguro compila con `npm run build --mode production`, no con build:development', async () => {
  const [script, pkg] = await Promise.all([
    readFile(join(repoRoot, 'scripts/build-dev-seguro.mjs'), 'utf8'),
    readFile(join(repoRoot, 'package.json'), 'utf8'),
  ])
  assert.doesNotMatch(script, /build:development/)
  assert.match(script, /\['run', 'build', '--', '--mode', BUILD_MODE, '--outDir', outputDir\]/)
  assert.match(script, /childEnv\.NODE_ENV = BUILD_MODE/)
  // `build` es `tsc -b && vite build`: sin --mode explícito sería production
  // igual, pero se pasa a propósito para que no dependa del default.
  assert.match(JSON.parse(pkg).scripts.build, /vite build/)
})

test('rechaza un paquete con el runtime de desarrollo de React (jsxDEV)', async () => {
  await withRuntimeFixture('import{jsxDEV as e}from"react/jsx-dev-runtime";e("div",{})', (outputDir) =>
    assert.rejects(() => assertProductionBundle(outputDir), /runtime de desarrollo de React \(jsxDEV\) en bundle\.js/),
  )
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-prod-test-'))
  try {
    await mkdir(join(outputDir, 'assets'))
    await writeFile(join(outputDir, 'assets', 'chunk.mjs'), 'x.jsxDEV(1)')
    await assert.rejects(() => assertProductionBundle(outputDir), /jsxDEV.*assets\/chunk\.mjs/)
    await rm(join(outputDir, 'assets', 'chunk.mjs'))
    await writeFile(join(outputDir, 'index.html'), '<script>jsxDEV()</script>')
    await assert.rejects(() => assertProductionBundle(outputDir), /jsxDEV.*index\.html/)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('acepta un paquete de producción (jsx/jsxs) y no mira archivos que no son JS', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-prod-ok-test-'))
  try {
    await writeFile(join(outputDir, 'main.js'), 'import{jsx as e,jsxs as t}from"./jsx-runtime.js";e("div",{})')
    // Un .txt puede nombrar jsxDEV sin que importe.
    await writeFile(join(outputDir, 'notas.txt'), 'jsxDEV')
    const result = await assertProductionBundle(outputDir)
    assert.equal(result.checkedFiles, 1)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('rechaza una variable VITE_* que existe solo en .env.production', () => sinVariablesVite(async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'build-dev-env-test-'))
  try {
    await writeFile(join(rootDir, '.env.development.local'), `VITE_SUPABASE_URL=${DEV_SUPABASE_URL}\n`)
    await writeFile(join(rootDir, '.env.production'), 'VITE_SUPABASE_URL=https://x.supabase.co\nVITE_OTRA=1\n')
    const env = loadEnv(ENV_PROFILE, rootDir, '')
    // VITE_SUPABASE_URL está en el perfil development: el proceso la va a
    // pasar y gana. VITE_OTRA solo vive en production: se cuela sin guard.
    assert.throws(() => assertProductionEnvFilesDoNotLeak(rootDir, env), /VITE_OTRA.*\.env\.production/)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}))

test('acepta un directorio sin .env.production o con las mismas claves que el perfil development', () => sinVariablesVite(async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'build-dev-env-ok-test-'))
  try {
    await writeFile(join(rootDir, '.env'), `VITE_SUPABASE_URL=${DEV_SUPABASE_URL}\n`)
    await writeFile(join(rootDir, '.env.development.local'), 'VITE_APP_ENV=development\n')
    const env = loadEnv(ENV_PROFILE, rootDir, '')
    assert.doesNotThrow(() => assertProductionEnvFilesDoNotLeak(rootDir, env))
    // Mismo nombre de clave en production: el proceso la pisa, no es un riesgo.
    await writeFile(join(rootDir, '.env.production'), 'VITE_APP_ENV=production\n')
    assert.doesNotThrow(() => assertProductionEnvFilesDoNotLeak(rootDir, env))
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}))

test('buildDevSeguro frena antes de compilar si hay una variable solo de production', () => sinVariablesVite(async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'build-dev-guard-test-'))
  try {
    await writeFile(
      join(rootDir, '.env'),
      [
        'VITE_APP_ENV=development',
        `VITE_SUPABASE_URL=${DEV_SUPABASE_URL}`,
        `VITE_SUPABASE_ANON_KEY=${jwtFor({ ref: DEV_SUPABASE_REF, role: 'anon' })}`,
        `VITE_PRODUCTION_SUPABASE_REF=${PRODUCTION_SUPABASE_REF}`,
      ].join('\n'),
    )
    await writeFile(join(rootDir, '.env.production'), 'VITE_SUPABASE_SERVICE_ROLE_KEY=valor-no-real-largo\n')
    // Si llegara a compilar fallaría por otra razón (no hay proyecto Vite acá):
    // el mensaje tiene que ser el del guard.
    await assert.rejects(() => buildDevSeguro({ rootDir }), /VITE_SUPABASE_SERVICE_ROLE_KEY.*\.env\.production/)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}))

test('buildDevSeguro sigue exigiendo el proyecto DEV aunque el modo sea production', () => sinVariablesVite(async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'build-dev-guard-url-test-'))
  try {
    await writeFile(
      join(rootDir, '.env'),
      [
        'VITE_APP_ENV=development',
        `VITE_SUPABASE_URL=https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
        `VITE_SUPABASE_ANON_KEY=${jwtFor({ ref: PRODUCTION_SUPABASE_REF, role: 'anon' })}`,
      ].join('\n'),
    )
    await assert.rejects(() => buildDevSeguro({ rootDir }), /producción/i)
    await writeFile(
      join(rootDir, '.env'),
      [
        'VITE_APP_ENV=production',
        `VITE_SUPABASE_URL=${DEV_SUPABASE_URL}`,
        `VITE_SUPABASE_ANON_KEY=${jwtFor({ ref: DEV_SUPABASE_REF, role: 'anon' })}`,
      ].join('\n'),
    )
    await assert.rejects(() => buildDevSeguro({ rootDir }), /VITE_APP_ENV debe ser exactamente development/)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}))

// ------------------------------------------------------------ .DS_Store
test('saca .DS_Store y similares del paquete, en cualquier carpeta', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-junk-test-'))
  try {
    await mkdir(join(outputDir, 'assets'))
    await mkdir(join(outputDir, 'iconos-territorios'))
    await writeFile(join(outputDir, '.DS_Store'), 'x')
    await writeFile(join(outputDir, 'assets', '.DS_Store'), 'x')
    await writeFile(join(outputDir, 'iconos-territorios', '._sprite.svg'), 'x')
    await writeFile(join(outputDir, 'iconos-territorios', 'Thumbs.db'), 'x')
    await writeFile(join(outputDir, 'iconos-territorios', 'sprite.svg'), '<svg/>')
    await writeFile(join(outputDir, 'index.html'), '<html/>')
    await writeFile(join(outputDir, '.htaccess'), 'Options -Indexes')

    await assert.rejects(() => assertNoJunkFiles(outputDir), /archivos basura.*\.DS_Store/)
    const result = await prunePublishableOutput(outputDir)
    assert.deepEqual(
      result.removed.filter((path) => /DS_Store|Thumbs|\._/.test(path)).sort(),
      ['.DS_Store', 'assets/.DS_Store', 'iconos-territorios/Thumbs.db', 'iconos-territorios/._sprite.svg'].sort(),
    )
    assert.equal((await assertNoJunkFiles(outputDir)).checkedFiles, 3)
    // .htaccess es un archivo con punto, pero no es basura: se publica.
    assert.equal(await readFile(join(outputDir, '.htaccess'), 'utf8'), 'Options -Indexes')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

// ------------------------------------------------- PWA: aviso y teselas
test('vite.config.ts: actualización avisada (prompt) y sin skipWaiting automático', async () => {
  // Sin comentarios: la explicación en prosa puede nombrar estas opciones.
  const vite = (await readFile(join(repoRoot, 'vite.config.ts'), 'utf8')).replace(/\/\/.*$/gm, '')
  assert.match(vite, /registerType:\s*'prompt'/)
  assert.doesNotMatch(vite, /registerType:\s*'autoUpdate'/)
  assert.doesNotMatch(vite, /skipWaiting:\s*true/)
  assert.match(vite, /skipWaiting:\s*false/)
  // El registro lo hace AvisoActualizacion (virtual:pwa-register/react).
  assert.match(vite, /injectRegister:\s*false/)
})

test('vite.config.ts: teselas del mapa en teselas-mapa, CacheFirst, 3000 entradas, 30 días', async () => {
  const vite = await readFile(join(repoRoot, 'vite.config.ts'), 'utf8')
  const bloque = vite.slice(vite.indexOf('runtimeCaching'), vite.indexOf('devOptions'))
  assert.match(bloque, /handler:\s*'CacheFirst'/)
  assert.match(bloque, /cacheName:\s*'teselas-mapa'/)
  assert.match(bloque, /maxEntries:\s*3000/)
  assert.match(bloque, /maxAgeSeconds:\s*60 \* 60 \* 24 \* 30/)
  assert.match(bloque, /statuses:\s*\[0,\s*200\]/)
  assert.match(bloque, /api\.maptiler\.com/)
  assert.match(bloque, /tile\.openstreetmap\.org/)
  // Nunca Supabase: ni como host ni en un comentario que lo habilite.
  assert.doesNotMatch(bloque.replace(/\/\/.*$/gm, ''), /supabase/i)
  assert.match(vite, /globIgnores:\s*\['\*\*\/datos\/\*\*'/)
})

test('la ruta de teselas acepta la URL que arma Leaflet (subdominios {s} y @2x) y nada que no sea MapTiler u OSM', async () => {
  // Se extrae la función tal como queda en el config y se la ejecuta: es la
  // misma que Workbox serializa dentro de sw.js. La precarga de teselas pide
  // la URL exacta de fondoMapa.ts, así que tiene que caer en esta ruta.
  const vite = await readFile(join(repoRoot, 'vite.config.ts'), 'utf8')
  const inicio = vite.indexOf('urlPattern:') + 'urlPattern:'.length
  const fin = vite.indexOf('handler:', inicio)
  const fuente = vite.slice(inicio, fin).trim().replace(/,$/, '').replace(': { url: URL }', '')
  const coincide = new Function(`return (${fuente})`)()
  const prueba = (direccion) => coincide({ url: new URL(direccion) })

  // MapTiler: cualquier path, con o sin @2x ({r} de Leaflet), con la clave en la query.
  assert.equal(prueba('https://api.maptiler.com/maps/dataviz-light/256/15/10234/20123.png?key=abc'), true)
  assert.equal(prueba('https://api.maptiler.com/maps/dataviz-light/256/15/10234/20123@2x.png?key=abc'), true)
  assert.equal(prueba('https://api.maptiler.com/maps/streets-v2/256/3/2/1.webp'), true)
  assert.equal(prueba('https://api.maptiler.com/tiles/v3/12/1203/1540.pbf?key=abc'), true)
  // OpenStreetMap: el host pelado y cualquiera de los subdominios {s} (a, b, c).
  assert.equal(prueba('https://tile.openstreetmap.org/15/10234/20123.png'), true)
  for (const subdominio of ['a', 'b', 'c']) {
    assert.equal(prueba(`https://${subdominio}.tile.openstreetmap.org/15/10234/20123.png`), true, subdominio)
  }
  // Otros hosts, aunque se parezcan, y Supabase, nunca.
  assert.equal(prueba('https://tile.openstreetmap.org.malo.com/15/10234/20123.png'), false)
  assert.equal(prueba('https://eviltile.openstreetmap.org/15/10234/20123.png'), false)
  assert.equal(prueba('https://api.maptiler.com.malo.com/maps/x/256/1/2/3.png'), false)
  assert.equal(prueba('https://maptiler.com/maps/x/256/1/2/3.png'), false)
  assert.equal(prueba('https://www.openstreetmap.org/15/10234/20123.png'), false)
  assert.equal(prueba('https://evil.com/15/10234/20123.png'), false)
  assert.equal(prueba(`${DEV_SUPABASE_URL}/rest/v1/territorios`), false)
  assert.equal(prueba(`${DEV_SUPABASE_URL}/storage/v1/object/1/2/3.png`), false)
})
