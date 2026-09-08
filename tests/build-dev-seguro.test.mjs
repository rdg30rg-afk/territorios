import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  assertAppEditorEntries,
  assertRuntimeSecretsAbsent,
  assertServiceWorkerConsistent,
  assertRuntimeDataPresent,
  DEV_SUPABASE_REF,
  DEV_SUPABASE_URL,
  decodeJwtPayload,
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

test('verifica que cada URL precacheada por Workbox exista en el paquete', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'build-dev-sw-test-'))
  try {
    await mkdir(join(outputDir, 'assets'))
    for (const file of ['index.html', 'editor-manzanas.html', 'manifest.webmanifest', 'registerSW.js', 'workbox-test.js', 'assets/main.js']) {
      await writeFile(join(outputDir, file), '')
    }
    await writeFile(join(outputDir, 'registerSW.js'), "navigator.serviceWorker.register('/sw.js')")
    await writeFile(
      join(outputDir, 'sw.js'),
      'precacheAndRoute([{url:"index.html"},{url:"editor-manzanas.html"},{url:"assets/main.js"}]); new NavigationRoute(handler,{denylist:[/^\\/editor-manzanas\\.html$/]})',
    )

    const result = await assertServiceWorkerConsistent(outputDir)
    assert.equal(result.serviceWorker, 'sw.js')
    assert.equal(result.precacheCount, 3)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('decodifica el payload base64url del JWT sin exponer su firma', () => {
  const payload = decodeJwtPayload(jwtFor({ ref: DEV_SUPABASE_REF, role: 'anon' }))
  assert.deepEqual(payload, { ref: DEV_SUPABASE_REF, role: 'anon' })
})
