import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  PREFIJO_RESPALDO,
  PublicacionBloqueada,
  RESPALDOS_A_CONSERVAR,
  SERVIDOR,
  TEXTO_DE_AYUDA,
  analizarListadoDeRespaldos,
  argumentosRsync,
  argumentosSsh,
  assetsDeUnaVersion,
  clasificarArchivos,
  comandos,
  comprobarRutas,
  construirManifiesto,
  crearVersionJson,
  elegirRespaldosAPodar,
  evaluarEstadoGit,
  fechaCompacta,
  nombreDeRespaldo,
  nombreDeRespaldoLibre,
  opcionesSsh,
  ordenarRespaldos,
  parsearArgumentos,
  planDePodaDeAssets,
  publicar,
  referenciasAAssets,
  revisarEncabezados,
  separarVolcado,
  sha256,
  shQuote,
  verificarPorHttps,
} from '../scripts/publicar-hostinger.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
// 27 de octubre de 2026, hora local: la fecha del respaldo es la que ve quien publica.
const FECHA = new Date(2026, 9, 27, 23, 30, 0)

// ------------------------------------------------------------------ argumentos

test('sin opciones es una simulación; --ejecutar es lo único que publica de verdad', () => {
  assert.equal(parsearArgumentos([]).dryRun, true)
  assert.equal(parsearArgumentos(['--dry-run']).dryRun, true)
  const real = parsearArgumentos(['--ejecutar'])
  assert.equal(real.dryRun, false)
  assert.equal(real.ejecutar, true)
  assert.equal(real.host, SERVIDOR.host)
  assert.equal(real.usuario, SERVIDOR.usuario)
  assert.equal(real.puerto, 65002)
})

test('rechaza combinaciones y valores peligrosos', () => {
  assert.throws(() => parsearArgumentos(['--dry-run', '--ejecutar']), /a la vez/)
  assert.throws(() => parsearArgumentos(['--borrar-todo']), /Opción desconocida/)
  assert.throws(() => parsearArgumentos(['--ejecutar', '--salida', '/tmp/x']), /--salida solo se puede usar en simulación/)
  assert.throws(() => parsearArgumentos(['--salida']), /Falta el valor/)
  // Un host o usuario que empieza con "-" sería una opción de ssh.
  assert.throws(() => parsearArgumentos(['--host', '-oProxyCommand=algo']), /host SSH no es válido/)
  assert.throws(() => parsearArgumentos(['--host', 'a b']), /host SSH no es válido/)
  assert.throws(() => parsearArgumentos(['--usuario', 'x;rm']), /usuario SSH no es válido/)
  assert.throws(() => parsearArgumentos(['--puerto', '0']), /puerto/)
  assert.throws(() => parsearArgumentos(['--puerto', 'abc']), /puerto/)
  assert.equal(parsearArgumentos(['--sin-podar']).sinPodar, true)
  assert.equal(parsearArgumentos(['--puerto', '22']).puerto, 22)
  assert.equal(parsearArgumentos(['-h']).ayuda, true)
  assert.match(TEXTO_DE_AYUDA, /--ejecutar/)
})

test('el script de npm es una simulación: nunca lleva --ejecutar', async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['publicar:hostinger'], 'node scripts/publicar-hostinger.mjs')
  assert.doesNotMatch(pkg.scripts['publicar:hostinger'], /--ejecutar/)
})

// ------------------------------------------------------------------------- git

test('se niega con el árbol sucio, con archivos sin versionar o sin tag', () => {
  assert.deepEqual(
    (({ ok, tag, problemas }) => ({ ok, tag, n: problemas.length }))(evaluarEstadoGit({ estado: '', etiquetas: 'v1.2.3\n' })),
    { ok: true, tag: 'v1.2.3', n: 0 },
  )

  const sucio = evaluarEstadoGit({ estado: ' M src/main.tsx\n', etiquetas: 'v1.2.3\n' })
  assert.equal(sucio.ok, false)
  assert.match(sucio.problemas[0], /árbol de git está sucio \(1 cambio: M src\/main\.tsx\)/)

  // Un archivo sin versionar (como la migración que estaba publicada y sin commit) también ensucia.
  const sinVersionar = evaluarEstadoGit({ estado: '?? supabase/migrations/x.sql\n', etiquetas: 'v1\n' })
  assert.equal(sinVersionar.ok, false)

  const sinTag = evaluarEstadoGit({ estado: '', etiquetas: '\n' })
  assert.equal(sinTag.ok, false)
  assert.equal(sinTag.tag, null)
  assert.match(sinTag.problemas[0], /HEAD no tiene ningún tag/)

  const ambas = evaluarEstadoGit({ estado: ' M a\n M b\n', etiquetas: '' })
  assert.equal(ambas.problemas.length, 2)
})

test('con varios tags en HEAD usa el primero (el más nuevo)', () => {
  const resultado = evaluarEstadoGit({ estado: '', etiquetas: 'v2.0.0\nv2.0.0-rc1\n' })
  assert.equal(resultado.tag, 'v2.0.0')
  assert.deepEqual(resultado.tags, ['v2.0.0', 'v2.0.0-rc1'])
})

// ----------------------------------------------------------------------- nombres

test('el respaldo se llama congregacion-dev-<fecha>-<tag>-pre, con fecha local', () => {
  assert.equal(fechaCompacta(FECHA), '20261027')
  assert.equal(nombreDeRespaldo({ fecha: FECHA, tag: 'v1.2.3' }), 'congregacion-dev-20261027-v1.2.3-pre')
  assert.equal(nombreDeRespaldo({ fecha: new Date(2026, 0, 5), tag: 'v1' }), 'congregacion-dev-20260105-v1-pre')
  assert.equal(nombreDeRespaldo({ fecha: FECHA, tag: 'release/1.0 final' }), 'congregacion-dev-20261027-release-1.0-final-pre')
  assert.ok(nombreDeRespaldo({ fecha: FECHA, tag: 'v1' }).startsWith(PREFIJO_RESPALDO))
  assert.throws(() => nombreDeRespaldo({ fecha: FECHA, tag: '///' }), PublicacionBloqueada)
})

test('si el respaldo ya existe se numera y nunca se pisa', () => {
  const base = 'congregacion-dev-20261027-v1-pre'
  assert.equal(nombreDeRespaldoLibre(base, []), base)
  assert.equal(nombreDeRespaldoLibre(base, [base]), 'congregacion-dev-20261027-v1-2-pre')
  assert.equal(nombreDeRespaldoLibre(base, [base, 'congregacion-dev-20261027-v1-2-pre']), 'congregacion-dev-20261027-v1-3-pre')
})

test('version.json lleva commit, tag y fecha', () => {
  const json = JSON.parse(crearVersionJson({ commit: COMMIT, tag: 'v1.2.3', fecha: FECHA }))
  assert.deepEqual(Object.keys(json), ['commit', 'tag', 'fecha'])
  assert.equal(json.commit, COMMIT)
  assert.equal(json.tag, 'v1.2.3')
  assert.equal(json.fecha, FECHA.toISOString())
  assert.ok(crearVersionJson({ commit: COMMIT, tag: 'v1', fecha: FECHA }).endsWith('}\n'))
})

// ---------------------------------------------------------------- orden de subida

test('assets primero, después editores e index, después .htaccess y al final sw.js; nunca la basura', () => {
  const grupos = clasificarArchivos([
    'sw.js',
    'index.html',
    'assets/main-Bgr4I66f.js',
    'assets/main-Bgr4I66f.css',
    '.DS_Store',
    'assets/.DS_Store',
    'editor-manzanas.html',
    'editor-manzanas-embedded.html',
    'workbox-835c8c05.js',
    'manifest.webmanifest',
    'version.json',
    '.htaccess',
    'pwa/icon-192.png',
    'datos/sectores.json',
    'iconos-territorios/._sprite.svg',
    'favicon.svg',
  ])
  assert.deepEqual(grupos.serviceWorker, ['sw.js'])
  assert.deepEqual(grupos.servidor, ['.htaccess'])
  assert.deepEqual(grupos.paginas, ['editor-manzanas-embedded.html', 'editor-manzanas.html', 'index.html', 'manifest.webmanifest', 'version.json'])
  // Workbox va con los assets: sw.js lo importa y tiene que estar antes.
  assert.deepEqual(grupos.assets, [
    'assets/main-Bgr4I66f.css',
    'assets/main-Bgr4I66f.js',
    'datos/sectores.json',
    'favicon.svg',
    'pwa/icon-192.png',
    'workbox-835c8c05.js',
  ])
  assert.deepEqual(grupos.omitidos.sort(), ['.DS_Store', 'assets/.DS_Store', 'iconos-territorios/._sprite.svg'])
})

// ----------------------------------------------------------------- ssh y rsync

test('ssh va por BatchMode y el puerto indicado, y rsync nunca borra ni copia permisos', () => {
  assert.deepEqual(opcionesSsh(SERVIDOR).slice(0, 2), ['-p', '65002'])
  assert.ok(opcionesSsh(SERVIDOR).includes('BatchMode=yes'))
  const ssh = argumentosSsh(SERVIDOR, 'ls')
  assert.equal(ssh.at(-2), 'u800479702@cuyo.news')
  assert.equal(ssh.at(-1), 'ls')

  const rsync = argumentosRsync({ servidor: SERVIDOR, origen: '/tmp/paquete/', archivoDeLista: '/tmp/lista.txt', destino: SERVIDOR.carpeta })
  assert.ok(rsync.includes('--no-perms'))
  assert.ok(rsync.includes('--files-from=/tmp/lista.txt'))
  assert.equal(rsync.some((argumento) => /delete/.test(argumento)), false)
  assert.equal(rsync.at(-2), '/tmp/paquete/')
  assert.equal(rsync.at(-1), `u800479702@cuyo.news:${SERVIDOR.carpeta}/`)
  assert.match(rsync[rsync.indexOf('-e') + 1], /^ssh -p 65002 -o BatchMode=yes/)
})

test('shQuote entrecomilla incluso con apóstrofes y espacios', () => {
  assert.equal(shQuote('/a b/c'), `'/a b/c'`)
  assert.equal(shQuote(`it's`), `'it'\\''s'`)
})

test('los comandos remotos validan nombres y nunca arman un borrado fuera de lo permitido', () => {
  const r = SERVIDOR.respaldos
  assert.match(
    comandos.respaldar({ origen: SERVIDOR.carpeta, respaldos: r, nombre: 'congregacion-dev-20261027-v1-pre' }),
    /cp -a '.*congregacion' '.*backups\/congregacion-dev-20261027-v1-pre'/,
  )
  for (const nombre of ['../x', 'congregacion-dev-../x', 'otro-respaldo', 'congregacion-dev-a b', 'congregacion-dev-$(id)', '']) {
    assert.throws(() => comandos.borrarRespaldo({ respaldos: r, nombre }), PublicacionBloqueada, nombre)
    assert.throws(() => comandos.respaldar({ origen: SERVIDOR.carpeta, respaldos: r, nombre }), PublicacionBloqueada, nombre)
    assert.throws(() => comandos.quitarRespaldo({ respaldos: r, nombre }), PublicacionBloqueada, nombre)
  }
  assert.match(comandos.borrarRespaldo({ respaldos: r, nombre: 'congregacion-dev-20260920-x-pre' }), /^rm -rf -- '.*backups\/congregacion-dev-20260920-x-pre'$/)

  for (const nombre of ['a.js; rm -rf /', '$(id).js', 'a b.js', '', '..', '.']) {
    assert.throws(() => comandos.borrarAssets({ carpeta: SERVIDOR.carpeta, nombres: [nombre] }), PublicacionBloqueada, nombre)
  }
  assert.throws(() => comandos.borrarAssets({ carpeta: SERVIDOR.carpeta, nombres: [] }), PublicacionBloqueada)
  assert.match(
    comandos.borrarAssets({ carpeta: SERVIDOR.carpeta, nombres: ['main-A1.js', 'chunk-B2.css'] }),
    /^cd '.*congregacion\/assets' && rm -f -- 'main-A1\.js' 'chunk-B2\.css'$/,
  )
  assert.throws(() => comandos.volcarArchivos({ directorio: '/x', nombres: ['a;b'], marcador: '@@' }), PublicacionBloqueada)
})

test('ningún comando remoto usa --delete ni toca algo fuera de la carpeta del sitio y de ~/backups', () => {
  const nombre = 'congregacion-dev-20261027-v1-pre'
  const todos = [
    comandos.existeCarpeta(SERVIDOR.carpeta),
    comandos.respaldoLibre({ respaldos: SERVIDOR.respaldos, nombre }),
    comandos.respaldar({ origen: SERVIDOR.carpeta, respaldos: SERVIDOR.respaldos, nombre }),
    comandos.comprobarRespaldo({ origen: SERVIDOR.carpeta, respaldos: SERVIDOR.respaldos, nombre }),
    comandos.listarAssets(SERVIDOR.carpeta),
    comandos.listarRespaldos(SERVIDOR.respaldos),
    comandos.volcarTextoDeAssets({ carpeta: SERVIDOR.carpeta, marcador: '@@m@@' }),
    comandos.volcarArchivos({ directorio: `${SERVIDOR.respaldos}/${nombre}`, nombres: ['index.html'], marcador: '@@m@@' }),
    comandos.borrarAssets({ carpeta: SERVIDOR.carpeta, nombres: ['a.js'] }),
    comandos.borrarRespaldo({ respaldos: SERVIDOR.respaldos, nombre }),
    comandos.borrarDsStore(SERVIDOR.carpeta),
    comandos.restaurar({ carpeta: SERVIDOR.carpeta, respaldos: SERVIDOR.respaldos, nombre }),
  ]
  for (const comando of todos) assert.doesNotMatch(comando, /--delete|rm -rf \/|rm -rf \*/)
  // Los únicos rm -rf apuntan a ~/backups/congregacion-dev-*.
  for (const comando of todos.filter((c) => /rm -rf/.test(c))) {
    assert.match(comando, /rm -rf -- '\/home\/u800479702\/backups\/congregacion-dev-[^']+'/)
  }
})

test('separa el volcado de archivos remotos con su marcador, conservando el texto exacto', () => {
  const marcador = '@@territorios-abc@@'
  const salida = `${marcador}index.html\n<html>\n</html>\n\n${marcador}sw.js\nconsole.log(1)\n${marcador}vacio.js\n\n`
  const archivos = separarVolcado(salida, marcador)
  assert.equal(archivos.get('index.html'), '<html>\n</html>\n')
  assert.equal(archivos.get('sw.js'), 'console.log(1)')
  assert.equal(archivos.get('vacio.js'), '')
  assert.equal(archivos.size, 3)
  assert.equal(separarVolcado('', marcador).size, 0)
})

test('lee el listado de respaldos y descarta lo que no es congregacion-dev-*', () => {
  const listado = [
    '1790000000\tcongregacion-dev-20261001-numeros-colores-pre',
    '1789000000\tcongregacion-dev-20260925-resultado-estado-pre',
    '1788000000\tcongregacion-20260904-1515',
    '1787000000\tcongregacion-dev-$(id)',
    'basura sin tabulador',
    '',
  ].join('\n')
  assert.deepEqual(analizarListadoDeRespaldos(listado), [
    { nombre: 'congregacion-dev-20261001-numeros-colores-pre', mtime: 1790000000 },
    { nombre: 'congregacion-dev-20260925-resultado-estado-pre', mtime: 1789000000 },
  ])
})

// ------------------------------------------------------------------ poda: respaldos

// Los 14 respaldos de la congregación que había en el servidor (más viejos primero).
const respaldosDelServidor = [
  'congregacion-dev-20260906-k8evXS',
  'congregacion-dev-20260922-programa-v2-pre',
  'congregacion-dev-20260922-v2-default-pre',
  'congregacion-dev-20260923-agenda-24h-pre',
  'congregacion-dev-20260923-borrador-compartido-pre',
  'congregacion-dev-20260923-nueva-salida-pre',
  'congregacion-dev-20260923-orden-programa-pre',
  'congregacion-dev-20260923-programa-paridad-pre',
  'congregacion-dev-20260925-resultado-estado-pre',
  'congregacion-dev-20261001-numeros-colores-pre',
].map((nombre, indice) => ({ nombre, mtime: 1000 + indice }))

test('ordena los respaldos del más nuevo al más viejo, por fecha del nombre y después por mtime', () => {
  const mezclados = [
    { nombre: 'congregacion-dev-20260923-b-pre', mtime: 5 },
    { nombre: 'congregacion-dev-20261001-z-pre', mtime: 1 },
    { nombre: 'congregacion-dev-20260923-a-pre', mtime: 9 },
  ]
  assert.deepEqual(ordenarRespaldos(mezclados).map((r) => r.nombre), [
    'congregacion-dev-20261001-z-pre',
    'congregacion-dev-20260923-a-pre',
    'congregacion-dev-20260923-b-pre',
  ])
})

test('conserva el respaldo nuevo y el anterior, borra el resto y no toca lo que no es congregacion-dev-*', () => {
  const nuevo = 'congregacion-dev-20261027-v1.0.0-pre'
  const lista = [
    ...respaldosDelServidor,
    { nombre: nuevo, mtime: 9999 },
    { nombre: 'congregacion-20260904-1515', mtime: 1 },
    { nombre: 'cuyo-news-semanal', mtime: 2 },
  ]
  const plan = elegirRespaldosAPodar(lista, { conservar: RESPALDOS_A_CONSERVAR, protegido: nuevo })
  assert.deepEqual(plan.conservar, [nuevo, 'congregacion-dev-20261001-numeros-colores-pre'])
  assert.equal(plan.borrar.length, 9)
  assert.ok(plan.borrar.includes('congregacion-dev-20260906-k8evXS'))
  assert.ok(!plan.borrar.includes(nuevo))
  // Lo que no se llama congregacion-dev-* no entra jamás en ninguna lista.
  for (const ajeno of ['congregacion-20260904-1515', 'cuyo-news-semanal']) {
    assert.ok(!plan.borrar.includes(ajeno))
    assert.ok(!plan.conservar.includes(ajeno))
  }
})

test('con pocos respaldos no borra nada, y sin el respaldo nuevo en el listado se niega a podar', () => {
  const nuevo = 'congregacion-dev-20261027-v1-pre'
  assert.deepEqual(
    elegirRespaldosAPodar([{ nombre: nuevo, mtime: 1 }, respaldosDelServidor[0]], { protegido: nuevo }).borrar,
    [],
  )
  assert.throws(
    () => elegirRespaldosAPodar(respaldosDelServidor, { protegido: nuevo }),
    /no aparece en el listado del servidor: no se poda nada/,
  )
})

// ------------------------------------------------------------------ poda: assets

test('encuentra los assets que menciona un texto, y solo los que existen', () => {
  const existentes = new Set(['main-A1.js', 'chunk-B2.js', 'index.es-C3.js', 'font-D4.woff2', 'Foo@2x-E5.png'])
  const texto = [
    '<script src="/assets/main-A1.js"></script>',
    'import("./chunk-B2.js")',
    '["assets/index.es-C3.js","assets/no-existe-ZZ.js"]',
    'url(./font-D4.woff2) url("Foo@2x-E5.png")',
    'main-A1.jsx',
  ].join('\n')
  assert.deepEqual([...referenciasAAssets(texto, existentes)].sort(), ['Foo@2x-E5.png', 'chunk-B2.js', 'font-D4.woff2', 'index.es-C3.js', 'main-A1.js'])
})

test('sigue las referencias a través de imports de JS y url() de CSS', () => {
  const existentes = new Set(['main-A.js', 'main-A.css', 'lazy-B.js', 'vendor-C.js', 'font-D.woff2', 'huerfano-E.js'])
  const textos = new Map([
    ['main-A.js', 'import "./vendor-C.js"; const x = () => import("./lazy-B.js")'],
    ['main-A.css', '@font-face{src:url(./font-D.woff2)}'],
    ['lazy-B.js', ''],
    ['vendor-C.js', ''],
  ])
  const necesarios = assetsDeUnaVersion({
    archivosDeVersion: new Map([['index.html', '<script src="/assets/main-A.js"></script><link href="/assets/main-A.css">']]),
    existentes,
    leerAsset: (nombre) => textos.get(nombre) ?? null,
  })
  assert.deepEqual([...necesarios].sort(), ['font-D.woff2', 'lazy-B.js', 'main-A.css', 'main-A.js', 'vendor-C.js'])
})

/** Una versión de la app con su main, un chunk perezoso, el editor y un vendor compartido. */
function versionFalsa(n, { compartido = 'vendor-COMPARTIDO.js' } = {}) {
  return {
    archivos: new Map([
      ['index.html', `<script type="module" src="/assets/main-v${n}.js"></script><link rel="stylesheet" href="/assets/main-v${n}.css">`],
      ['editor-manzanas.html', `<script type="module" src="/assets/editor-v${n}.js"></script>`],
      ['editor-manzanas-embedded.html', `<script type="module" src="/assets/editor-v${n}.js"></script>`],
      ['sw.js', `precacheAndRoute([{url:"assets/main-v${n}.js"},{url:"assets/chunk-v${n}.js"},{url:"assets/lazy-v${n}.js"}])`],
    ]),
    textos: new Map([
      [`main-v${n}.js`, `import "./chunk-v${n}.js";import "./${compartido}"`],
      [`chunk-v${n}.js`, `export const l = () => import("./lazy-v${n}.js")`],
      [`lazy-v${n}.js`, ''],
      [`editor-v${n}.js`, `import "./${compartido}"`],
      [`main-v${n}.css`, `@font-face{src:url(./font-v${n}.woff2)}`],
      [`font-v${n}.woff2`, ''],
    ]),
  }
}

test('con 34 versiones acumuladas deja solo las 3 últimas y conserva lo compartido', () => {
  const versiones = Array.from({ length: 34 }, (_, indice) => versionFalsa(indice + 1))
  const existentes = new Set(['vendor-COMPARTIDO.js'])
  const textos = new Map([['vendor-COMPARTIDO.js', '']])
  for (const version of versiones) for (const [nombre, texto] of version.textos) { existentes.add(nombre); textos.set(nombre, texto) }

  const [v34, v33, v32] = [versiones[33], versiones[32], versiones[31]]
  const plan = planDePodaDeAssets({
    existentes: [...existentes],
    versiones: [
      { nombre: 'nueva', archivos: v34.archivos },
      { nombre: 'respaldo-1', archivos: v33.archivos },
      { nombre: 'respaldo-2', archivos: v32.archivos },
    ],
    leerAsset: (nombre) => textos.get(nombre) ?? null,
  })

  const mains = plan.conservar.filter((nombre) => /^main-v\d+\.js$/.test(nombre))
  assert.deepEqual(mains, ['main-v32.js', 'main-v33.js', 'main-v34.js'])
  assert.ok(plan.conservar.includes('vendor-COMPARTIDO.js'))
  assert.ok(!plan.borrar.includes('vendor-COMPARTIDO.js'))
  // 34 versiones x 6 archivos + 1 compartido = 205; quedan 3 x 6 + 1 = 19.
  assert.equal(existentes.size, 205)
  assert.equal(plan.conservar.length, 19)
  assert.equal(plan.borrar.length, 186)
  assert.ok(plan.borrar.includes('main-v1.js') && plan.borrar.includes('font-v31.woff2'))
  assert.ok(!plan.borrar.includes('lazy-v33.js'), 'un chunk perezoso de una versión que se queda no se borra')
  assert.deepEqual(plan.porVersion.map((v) => v.nombre), ['nueva', 'respaldo-1', 'respaldo-2'])
})

test('un asset que usan dos versiones se conserva mientras una de ellas siga', () => {
  const a = versionFalsa(1, { compartido: 'vendor-VIEJO.js' })
  const b = versionFalsa(2, { compartido: 'vendor-NUEVO.js' })
  const c = versionFalsa(3, { compartido: 'vendor-NUEVO.js' })
  const existentes = ['vendor-VIEJO.js', 'vendor-NUEVO.js', ...[a, b, c].flatMap((v) => [...v.textos.keys()])]
  const textos = new Map([...a.textos, ...b.textos, ...c.textos, ['vendor-VIEJO.js', ''], ['vendor-NUEVO.js', '']])
  const plan = planDePodaDeAssets({
    existentes,
    versiones: [{ nombre: 'nueva', archivos: c.archivos }, { nombre: 'r1', archivos: b.archivos }],
    leerAsset: (nombre) => textos.get(nombre) ?? null,
  })
  assert.ok(plan.borrar.includes('vendor-VIEJO.js'))
  assert.ok(!plan.borrar.includes('vendor-NUEVO.js'))
  assert.ok(plan.borrar.includes('main-v1.js'))
})

test('se niega a podar si la versión nueva no tiene assets, referencia uno que falta o vaciaría la carpeta', () => {
  const v = versionFalsa(5)
  const existentes = [...v.textos.keys(), 'vendor-COMPARTIDO.js']
  const leer = (nombre) => v.textos.get(nombre) ?? null

  // Lectura equivocada: el servidor no devolvió assets.
  assert.throws(
    () => planDePodaDeAssets({ existentes: [], versiones: [{ nombre: 'nueva', archivos: v.archivos }], leerAsset: leer }),
    /no referencia ningún asset del servidor: no se poda nada/,
  )
  // La nueva referencia un asset que no está arriba.
  assert.throws(
    () => planDePodaDeAssets({ existentes: existentes.filter((n) => n !== 'main-v5.css'), versiones: [{ nombre: 'nueva', archivos: v.archivos }], leerAsset: leer }),
    /referencia assets\/main-v5\.css y no está en el servidor/,
  )
  // Sin versión nueva.
  assert.throws(() => planDePodaDeAssets({ existentes, versiones: [], leerAsset: leer }), PublicacionBloqueada)
})

test('nunca propone borrar nombres con caracteres raros', () => {
  const v = versionFalsa(5)
  const raro = 'a b;rm -rf.js'
  const plan = planDePodaDeAssets({
    existentes: [...v.textos.keys(), 'vendor-COMPARTIDO.js', raro],
    versiones: [{ nombre: 'nueva', archivos: v.archivos }],
    leerAsset: (nombre) => v.textos.get(nombre) ?? null,
  })
  assert.ok(!plan.borrar.includes(raro))
})

// --------------------------------------------------------------- verificación HTTPS

const respuesta = (cuerpo, { status = 200, headers = {} } = {}) => new Response(cuerpo, { status, headers })

test('verifica el SHA-256 de cada archivo por HTTPS, sin leer copias viejas', async () => {
  const archivos = { 'index.html': '<html>nuevo</html>', 'assets/main-A1.js': 'console.log(1)', 'assets/Foo@2x.png': 'png' }
  const manifiesto = Object.entries(archivos).map(([ruta, texto]) => ({ ruta, sha256: sha256(Buffer.from(texto)), bytes: texto.length }))
  manifiesto.push({ ruta: '.htaccess', sha256: sha256(Buffer.from('x')), bytes: 1 })
  const pedidos = []
  const resultado = await verificarPorHttps({
    baseUrl: 'https://sitio.test/',
    manifiesto,
    nonce: 'n0nce',
    fetchFn: async (url, opciones) => {
      pedidos.push({ url, opciones })
      const ruta = decodeURIComponent(new URL(url).pathname.slice(1))
      return respuesta(archivos[ruta])
    },
  })
  assert.deepEqual({ verificados: resultado.verificados, total: resultado.total, fallas: resultado.fallas }, { verificados: 3, total: 3, fallas: [] })
  // .htaccess lo esconde el servidor: no se pide.
  assert.equal(pedidos.some((p) => p.url.includes('htaccess')), false)
  for (const pedido of pedidos) {
    assert.match(pedido.url, /\?verif=n0nce$/)
    assert.equal(pedido.opciones.headers['cache-control'], 'no-cache')
  }
  assert.ok(pedidos.some((p) => p.url === 'https://sitio.test/assets/Foo%402x.png?verif=n0nce'))
})

test('detecta un SHA distinto, un 404 y un error de red', async () => {
  const manifiesto = [
    { ruta: 'index.html', sha256: sha256(Buffer.from('bueno')), bytes: 5 },
    { ruta: 'sw.js', sha256: sha256(Buffer.from('sw')), bytes: 2 },
    { ruta: 'assets/falta.js', sha256: sha256(Buffer.from('x')), bytes: 1 },
    { ruta: 'assets/red.js', sha256: sha256(Buffer.from('y')), bytes: 1 },
  ]
  const resultado = await verificarPorHttps({
    baseUrl: 'https://sitio.test',
    manifiesto,
    fetchFn: async (url) => {
      const ruta = new URL(url).pathname.slice(1)
      if (ruta === 'index.html') return respuesta('viejo')
      if (ruta === 'sw.js') return respuesta('sw')
      if (ruta === 'assets/falta.js') return respuesta('no', { status: 404 })
      throw new Error('ECONNRESET')
    },
  })
  assert.equal(resultado.verificados, 1)
  assert.deepEqual(resultado.fallas.map((f) => f.ruta), ['assets/falta.js', 'assets/red.js', 'index.html'])
  assert.match(resultado.fallas[0].motivo, /HTTP 404/)
  assert.match(resultado.fallas[1].motivo, /ECONNRESET/)
  assert.match(resultado.fallas[2].motivo, /SHA-256 distinto/)
})

test('comprueba que las rutas del SPA contesten 200', async () => {
  const fallas = await comprobarRutas({
    baseUrl: 'https://sitio.test',
    fetchFn: async (url) => respuesta('x', { status: new URL(url).pathname === '/mapas' ? 500 : 200 }),
  })
  assert.deepEqual(fallas, [{ ruta: '/mapas', motivo: 'HTTP 500' }])
})

test('avisa (sin fallar) si el servidor ignora el manifest, el caché inmutable o la CSP', async () => {
  const mal = await revisarEncabezados({
    baseUrl: 'https://sitio.test',
    ejemploDeAsset: 'assets/main-A1.js',
    fetchFn: async () => respuesta('x', { headers: { 'content-type': 'text/plain', 'cache-control': 'max-age=604800' } }),
  })
  assert.equal(mal.length, 3)
  assert.match(mal[0], /manifest.*text\/plain/)
  assert.match(mal[1], /immutable/)
  assert.match(mal[2], /Report-Only/)

  const bien = await revisarEncabezados({
    baseUrl: 'https://sitio.test',
    ejemploDeAsset: 'assets/main-A1.js',
    fetchFn: async (url) =>
      respuesta('x', {
        headers: {
          'content-type': url.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html',
          'cache-control': 'public, max-age=31536000, immutable',
          'content-security-policy-report-only': "default-src 'self'",
        },
      }),
  })
  assert.deepEqual(bien, [])
})

// ------------------------------------------------------ simulación: no toca nada

function depsQueNoDebenUsarseParaNada(extra = {}) {
  const lanza = (nombre) => async () => {
    throw new Error(`En simulación no se debía llamar a ${nombre}`)
  }
  const salida = []
  return {
    salida,
    deps: {
      git: async (args) => {
        if (args[0] === 'status') return extra.estado ?? ''
        if (args[0] === 'rev-parse') return `${COMMIT}\n`
        return extra.etiquetas ?? 'v1.2.3\n'
      },
      construir: lanza('construir'),
      ssh: lanza('ssh'),
      rsync: lanza('rsync'),
      fetchFn: lanza('fetch'),
      ahora: () => FECHA,
      log: (linea) => salida.push(linea),
    },
  }
}

test('la simulación imprime el plan completo y no construye, no usa ssh, ni rsync, ni red', async () => {
  const { deps, salida } = depsQueNoDebenUsarseParaNada()
  const resultado = await publicar({ opciones: parsearArgumentos([]), deps })
  const texto = salida.join('\n')
  assert.equal(resultado.dryRun, true)
  assert.equal(resultado.bloqueado, false)
  assert.match(texto, /SIMULACIÓN \(no se toca nada\)/)
  assert.match(texto, /u800479702@cuyo\.news \(puerto 65002\)/)
  assert.match(texto, /Respaldo : \/home\/u800479702\/backups\/congregacion-dev-20261027-v1\.2\.3-pre/)
  assert.match(texto, /Commit   : 0123456789ab   Tag: v1\.2\.3/)
  assert.match(texto, /1\. Comprobar git.*Hoy: OK/)
  // El orden de la subida y la verificación están a la vista.
  assert.ok(texto.indexOf('a) assets') < texto.indexOf('b) editores') && texto.indexOf('b) editores') < texto.indexOf('c) .htaccess') && texto.indexOf('c) .htaccess') < texto.indexOf('d) sw.js'))
  assert.match(texto, /Verificar el SHA-256 de lo subido pidiéndolo por HTTPS/)
  assert.match(texto, /últimas 3 versiones de assets/)
  assert.match(texto, /últimos 2 respaldos congregacion-dev-\*/)
  assert.match(texto, /Nada de lo anterior se ejecutó\. Para publicar de verdad: node scripts\/publicar-hostinger\.mjs --ejecutar/)
})

test('la simulación avisa que una publicación real se negaría si el árbol está sucio o no hay tag', async () => {
  const { deps, salida } = depsQueNoDebenUsarseParaNada({ estado: ' M src/main.tsx\n', etiquetas: '' })
  const resultado = await publicar({ opciones: parsearArgumentos(['--dry-run']), deps })
  assert.equal(resultado.bloqueado, true)
  const texto = salida.join('\n')
  assert.match(texto, /Hoy: BLOQUEADO/)
  assert.match(texto, /Una publicación real se negaría por esto/)
  assert.match(texto, /árbol de git está sucio/)
  assert.match(texto, /HEAD no tiene ningún tag/)
})

test('la simulación con --salida cuenta los archivos de cada tanda y lista la basura que no sube', async () => {
  const paquete = await mkdtemp(join(tmpdir(), 'publicar-salida-test-'))
  try {
    await mkdir(join(paquete, 'assets'))
    for (const [ruta, contenido] of Object.entries({
      'index.html': 'i', 'editor-manzanas.html': 'e', 'sw.js': 's', '.htaccess': 'h',
      'assets/a.js': '1', 'assets/b.js': '2', 'workbox-1.js': 'w', '.DS_Store': 'x',
    })) await writeFile(join(paquete, ruta), contenido)
    const { deps, salida } = depsQueNoDebenUsarseParaNada()
    await publicar({ opciones: parsearArgumentos(['--salida', paquete]), deps })
    const texto = salida.join('\n')
    assert.match(texto, /a\) assets.*\(3 archivos\)/)
    assert.match(texto, /b\) editores.*\(2 archivos\)/)
    assert.match(texto, /c\) \.htaccess.*\(1 archivo\)/)
    assert.match(texto, /d\) sw\.js.*\(1 archivo\)/)
    assert.match(texto, /No se suben \(basura del sistema\): \.DS_Store/)
    const manifiesto = await construirManifiesto(paquete)
    assert.equal(manifiesto.some((a) => a.ruta === '.DS_Store'), false)
  } finally {
    await rm(paquete, { recursive: true, force: true })
  }
})

test('una publicación real con el árbol sucio se niega antes de compilar y sin tocar el servidor', async () => {
  const llamadas = []
  const { deps } = depsQueNoDebenUsarseParaNada({ estado: '?? algo.txt\n' })
  const espia = (nombre) => async () => { llamadas.push(nombre); throw new Error('no debía llamarse') }
  await assert.rejects(
    () => publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: { ...deps, construir: espia('construir'), ssh: espia('ssh'), rsync: espia('rsync'), fetchFn: espia('fetch') } }),
    (error) => error instanceof PublicacionBloqueada && /árbol de git está sucio/.test(error.message),
  )
  assert.deepEqual(llamadas, [])
})

test('una publicación real sin tag en HEAD se niega antes de compilar', async () => {
  const llamadas = []
  const { deps } = depsQueNoDebenUsarseParaNada({ etiquetas: '' })
  const espia = (nombre) => async () => { llamadas.push(nombre); throw new Error('no debía llamarse') }
  await assert.rejects(
    () => publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: { ...deps, construir: espia('construir'), ssh: espia('ssh'), rsync: espia('rsync') } }),
    /HEAD no tiene ningún tag/,
  )
  assert.deepEqual(llamadas, [])
})

// ------------------------------------------------------- servidor falso en memoria

const archivoVersion = (n) => ({
  'index.html': `<script type="module" src="/assets/main-v${n}.js"></script><link rel="stylesheet" href="/assets/main-v${n}.css">`,
  'editor-manzanas.html': `<script type="module" src="/assets/editor-v${n}.js"></script>`,
  'editor-manzanas-embedded.html': `<script type="module" src="/assets/editor-v${n}.js"></script>`,
  'sw.js': `precacheAndRoute([{url:"assets/main-v${n}.js"},{url:"assets/chunk-v${n}.js"},{url:"assets/lazy-v${n}.js"}])`,
})

/**
 * Un servidor en memoria con cinco versiones viejas (la 5 es la que está en
 * vivo), cuatro respaldos congregacion-dev-*, uno con otro nombre, y un
 * paquete local con la versión 6. ssh, rsync y fetch actúan sobre este estado.
 */
async function crearMundo({ configurar } = {}) {
  const local = await mkdtemp(join(tmpdir(), 'publicar-flujo-test-'))
  const v6 = versionFalsa(6)
  await mkdir(join(local, 'assets'))
  const archivosLocales = {
    ...archivoVersion(6),
    'manifest.webmanifest': '{}',
    '.htaccess': 'Options -Indexes',
    'workbox-abc12345.js': 'workbox',
    '.DS_Store': 'basura',
    'assets/.DS_Store': 'basura',
  }
  for (const [nombre, texto] of v6.textos) archivosLocales[`assets/${nombre}`] = texto
  archivosLocales['assets/vendor-COMPARTIDO.js'] = ''
  for (const [ruta, texto] of Object.entries(archivosLocales)) await writeFile(join(local, ruta), texto)

  const remoto = {
    vivo: new Map(Object.entries(archivoVersion(5))),
    assets: new Map([['vendor-COMPARTIDO.js', '']]),
    respaldos: new Map(),
    borradosDeAssets: [],
    borradosDeRespaldos: [],
    dsStoreBorrado: false,
    htaccessCaido: false,
  }
  for (let n = 1; n <= 5; n += 1) for (const [nombre, texto] of versionFalsa(n).textos) remoto.assets.set(nombre, texto)
  // Cada respaldo guarda el estado ANTERIOR a una publicación: el 4 guarda la versión 1.
  const fechasDeRespaldos = ['20260920', '20260925', '20261001', '20261010']
  fechasDeRespaldos.forEach((fecha, indice) => {
    remoto.respaldos.set(`congregacion-dev-${fecha}-prueba${indice + 1}-pre`, {
      mtime: 1000 + indice,
      archivos: new Map(Object.entries(archivoVersion(indice + 1))),
    })
  })
  remoto.respaldos.set('congregacion-20260904-1515', { mtime: 1, archivos: new Map(Object.entries(archivoVersion(1))) })

  const registro = []
  const subidas = []
  const log = []
  let nonceFalloEnVerificacion = null

  const ssh = async (comando) => {
    registro.push(comando)
    const marcador = /'(@@territorios-[0-9a-f]+@@)'/.exec(comando)?.[1]
    if (comando.startsWith('test -d ')) return ''
    if (comando.includes('for d in congregacion-dev-*')) {
      return [...remoto.respaldos].map(([nombre, r]) => `${r.mtime}\t${nombre}`).join('\n')
    }
    if (comando.startsWith('test ! -e ')) {
      const nombre = /backups\/([^']+)'/.exec(comando)[1]
      if (remoto.respaldos.has(nombre)) throw new Error('existe')
      return ''
    }
    if (comando.includes('cp -a ')) {
      if (configurar?.respaldoFalla) throw new Error('cp: Disk quota exceeded')
      const nombre = /backups\/([^']+)' && touch/.exec(comando)[1]
      remoto.respaldos.set(nombre, { mtime: 99999, archivos: new Map(remoto.vivo) })
      return ''
    }
    if (comando.startsWith('test "$(find')) return ''
    if (comando.startsWith('ls -1A ')) return [...remoto.assets.keys()].join('\n')
    if (comando.includes('for f in *.js *.mjs *.css')) {
      return [...remoto.assets].filter(([n]) => /\.(js|mjs|css)$/.test(n)).map(([n, t]) => `${marcador}${n}\n${t}\n`).join('')
    }
    if (comando.includes('for f in ') && marcador) {
      const directorio = /^cd '([^']+)'/.exec(comando)[1]
      const nombre = directorio.split('/').pop()
      const archivos = remoto.respaldos.get(nombre)?.archivos ?? new Map()
      return [...archivos].map(([n, t]) => `${marcador}${n}\n${t}\n`).join('')
    }
    if (comando.includes('rm -f -- ')) {
      const nombres = [...comando.slice(comando.indexOf('rm -f -- ') + 9).matchAll(/'([^']+)'/g)].map((m) => m[1])
      for (const nombre of nombres) { remoto.assets.delete(nombre); remoto.borradosDeAssets.push(nombre) }
      return ''
    }
    if (comando.startsWith('rm -rf -- ') && comando.includes('/backups/')) {
      const nombre = /backups\/([^']+)'/.exec(comando)[1]
      remoto.respaldos.delete(nombre)
      remoto.borradosDeRespaldos.push(nombre)
      return ''
    }
    if (comando.startsWith('find ') && comando.includes('.DS_Store')) { remoto.dsStoreBorrado = true; return '' }
    throw new Error(`ssh falso: comando no previsto: ${comando}`)
  }

  const rsync = async ({ origen, lista, archivos }) => {
    // La lista tiene que ser exactamente lo que se pidió subir.
    assert.equal((await readFile(lista, 'utf8')).trim().split('\n').join('|'), archivos.join('|'))
    subidas.push(archivos)
    registro.push(`rsync ${archivos.length} archivos: ${archivos[0]}…`)
    for (const ruta of archivos) {
      const contenido = await readFile(join(origen, ruta))
      if (ruta.startsWith('assets/')) remoto.assets.set(ruta.slice('assets/'.length), contenido.toString('utf8'))
      remoto.vivo.set(ruta, contenido.toString('utf8'))
    }
    if (configurar?.rsyncFallaEn && archivos.includes(configurar.rsyncFallaEn)) throw new Error('rsync terminó con código 23')
    if (archivos.includes('.htaccess') && configurar?.htaccessRompeElSitio) remoto.htaccessCaido = true
  }

  const fetchFn = async (url, opciones) => {
    registro.push(`fetch ${new URL(url).pathname}`)
    const { pathname } = new URL(url)
    if (remoto.htaccessCaido) return respuesta('error', { status: 500 })
    if (['/', '/mapas', '/login', '/index.html'].includes(pathname)) {
      const cuerpo = remoto.vivo.get('index.html')
      return respuesta(pathname === '/index.html' && configurar?.indexAdulterado ? `${cuerpo}<!-- otro -->` : cuerpo, {
        headers: { 'content-security-policy-report-only': "default-src 'self'" },
      })
    }
    const ruta = decodeURIComponent(pathname.slice(1))
    if (remoto.vivo.has(ruta)) {
      return respuesta(remoto.vivo.get(ruta), {
        headers: {
          'content-type': ruta.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/plain',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    }
    void nonceFalloEnVerificacion
    void opciones
    return respuesta('no existe', { status: 404 })
  }

  const deps = {
    git: async (args) => (args[0] === 'status' ? '' : args[0] === 'rev-parse' ? `${COMMIT}\n` : 'v6.0.0\nv6.0.0-rc1\n'),
    construir: async () => ({ outputDir: local }),
    ssh,
    rsync,
    fetchFn,
    ahora: () => FECHA,
    log: (linea) => log.push(linea),
  }
  return { local, remoto, registro, subidas, log, deps, limpiar: () => rm(local, { recursive: true, force: true }) }
}

test('flujo completo: respaldo, assets, editores, .htaccess, sw.js, verificación y poda, en ese orden', async () => {
  const mundo = await crearMundo()
  try {
    const resultado = await publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: mundo.deps })
    const { registro, remoto } = mundo
    const posicion = (patron) => registro.findIndex((linea) => patron.test(linea))
    const ultima = (patron) => registro.findLastIndex((linea) => patron.test(linea))

    // El respaldo, antes que cualquier subida.
    const iRespaldo = posicion(/cp -a /)
    assert.ok(iRespaldo >= 0)
    assert.match(registro[iRespaldo], /backups\/congregacion-dev-20261027-v6\.0\.0-pre/)
    assert.equal(resultado.nombreDeRespaldo, 'congregacion-dev-20261027-v6.0.0-pre')
    assert.ok(iRespaldo < posicion(/^rsync/))

    // Cuatro tandas, en el orden pedido; sw.js sola y al final.
    assert.equal(mundo.subidas.length, 4)
    const [assets, paginas, servidor, sw] = mundo.subidas
    assert.ok(assets.includes('assets/main-v6.js') && assets.includes('workbox-abc12345.js'))
    assert.deepEqual(paginas, ['editor-manzanas-embedded.html', 'editor-manzanas.html', 'index.html', 'manifest.webmanifest', 'version.json'])
    assert.deepEqual(servidor, ['.htaccess'])
    assert.deepEqual(sw, ['sw.js'])
    // La basura no se sube jamás.
    assert.equal(mundo.subidas.flat().some((ruta) => ruta.endsWith('.DS_Store')), false)

    // Se verifica por HTTPS DESPUÉS de subir sw.js, y se poda DESPUÉS de verificar.
    const iUltimaSubida = ultima(/^rsync/)
    const iPrimeraVerificacion = registro.findIndex((linea, indice) => indice > iUltimaSubida && /^fetch/.test(linea))
    const iUltimaVerificacion = ultima(/^fetch/)
    // Comandos que borran: rm -f de assets, rm -rf de respaldos y el find -delete de .DS_Store.
    const esBorrado = (linea) => /rm -f -- |^rm -rf -- |-delete$/.test(linea)
    const iPrimerBorrado = registro.findIndex(esBorrado)
    assert.ok(iPrimerBorrado > 0, 'la poda tiene que haber borrado algo')
    assert.ok(iUltimaSubida < iPrimeraVerificacion)
    assert.ok(iUltimaVerificacion < iPrimerBorrado, 'no se borra nada hasta que la verificación terminó')
    // Durante la subida no se borra nada: no hay comandos de borrado antes de la poda.
    assert.equal(registro.slice(0, iUltimaVerificacion).some(esBorrado), false)

    // version.json: commit, tag y fecha; el SHA que se verificó es el de lo escrito.
    const version = JSON.parse(remoto.vivo.get('version.json'))
    assert.deepEqual(version, { commit: COMMIT, tag: 'v6.0.0', fecha: FECHA.toISOString() })
    assert.equal(resultado.verificacion.fallas.length, 0)
    assert.equal(resultado.verificacion.verificados, resultado.verificacion.total)

    // Poda de assets: quedan solo las versiones 4, 5 y 6 (más lo compartido).
    const mains = [...remoto.assets.keys()].filter((n) => /^main-v\d+\.js$/.test(n)).sort()
    assert.deepEqual(mains, ['main-v4.js', 'main-v5.js', 'main-v6.js'])
    assert.ok(remoto.assets.has('vendor-COMPARTIDO.js'))
    assert.ok(remoto.assets.has('lazy-v5.js'))
    assert.ok(!remoto.assets.has('main-v1.js') && !remoto.assets.has('font-v3.woff2'))

    // Poda de respaldos: quedan el nuevo y el último; lo de otro nombre ni se toca.
    assert.deepEqual([...remoto.respaldos.keys()].sort(), [
      'congregacion-20260904-1515',
      'congregacion-dev-20261010-prueba4-pre',
      'congregacion-dev-20261027-v6.0.0-pre',
    ])
    assert.deepEqual(remoto.borradosDeRespaldos.sort(), [
      'congregacion-dev-20260920-prueba1-pre',
      'congregacion-dev-20260925-prueba2-pre',
      'congregacion-dev-20261001-prueba3-pre',
    ])
    assert.equal(remoto.dsStoreBorrado, true)
    assert.match(mundo.log.join('\n'), /Publicación terminada: v6\.0\.0/)
  } finally {
    await mundo.limpiar()
  }
})

test('con --sin-podar publica y verifica pero no borra nada', async () => {
  const mundo = await crearMundo()
  try {
    await publicar({ opciones: parsearArgumentos(['--ejecutar', '--sin-podar']), deps: mundo.deps })
    assert.equal(mundo.subidas.length, 4)
    assert.equal(mundo.remoto.borradosDeAssets.length, 0)
    assert.equal(mundo.remoto.borradosDeRespaldos.length, 0)
    assert.equal(mundo.remoto.dsStoreBorrado, false)
    assert.equal(mundo.registro.some((linea) => /rm -f|rm -rf/.test(linea)), false)
    assert.match(mundo.log.join('\n'), /poda omitida/)
  } finally {
    await mundo.limpiar()
  }
})

test('si la verificación por HTTPS falla, no se poda nada y se muestra cómo volver atrás', async () => {
  const mundo = await crearMundo({ configurar: { indexAdulterado: true } })
  try {
    await assert.rejects(
      () => publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: mundo.deps }),
      (error) =>
        error instanceof PublicacionBloqueada &&
        /La verificación falló/.test(error.message) &&
        /No se podó nada/.test(error.message) &&
        /index\.html: SHA-256 distinto/.test(error.message) &&
        /Para volver a como estaba: ssh -p 65002 u800479702@cuyo\.news .*rsync -rt --no-perms .*backups\/congregacion-dev-20261027-v6\.0\.0-pre\//.test(error.message),
    )
    assert.equal(mundo.remoto.borradosDeAssets.length, 0)
    assert.equal(mundo.remoto.borradosDeRespaldos.length, 0)
    assert.equal(mundo.remoto.assets.has('main-v1.js'), true)
  } finally {
    await mundo.limpiar()
  }
})

test('si el respaldo falla (cuota llena) limpia lo que creó y no sube ni un archivo', async () => {
  const mundo = await crearMundo({ configurar: { respaldoFalla: true } })
  try {
    await assert.rejects(
      () => publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: mundo.deps }),
      (error) => error instanceof PublicacionBloqueada && /No se pudo hacer el respaldo.*Disk quota exceeded/.test(error.message) && /No se subió nada/.test(error.message),
    )
    assert.equal(mundo.subidas.length, 0)
    // Intentó sacar el respaldo parcial, con un nombre congregacion-dev-*.
    assert.ok(mundo.registro.some((l) => /^rm -rf -- '.*backups\/congregacion-dev-20261027-v6\.0\.0-pre'$/.test(l)))
    // Lo único que borró es ese respaldo parcial; ningún respaldo ni asset que ya existía.
    assert.deepEqual(mundo.remoto.borradosDeRespaldos, ['congregacion-dev-20261027-v6.0.0-pre'])
    assert.equal(mundo.remoto.borradosDeAssets.length, 0)
    assert.equal(mundo.remoto.respaldos.size, 5)
  } finally {
    await mundo.limpiar()
  }
})

test('si un .htaccess rompe el sitio, se frena antes de subir sw.js', async () => {
  const mundo = await crearMundo({ configurar: { htaccessRompeElSitio: true } })
  try {
    await assert.rejects(
      () => publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: mundo.deps }),
      (error) => /Después de subir \.htaccess el sitio no contesta bien/.test(error.message) && /No se subió sw\.js/.test(error.message) && /Para volver a como estaba/.test(error.message),
    )
    assert.equal(mundo.subidas.length, 3)
    assert.equal(mundo.subidas.flat().includes('sw.js'), false)
    assert.equal(mundo.remoto.borradosDeAssets.length, 0)
  } finally {
    await mundo.limpiar()
  }
})

test('si falla la subida de assets, se detiene ahí y dice cómo volver atrás', async () => {
  const mundo = await crearMundo({ configurar: { rsyncFallaEn: 'assets/main-v6.js' } })
  try {
    await assert.rejects(
      () => publicar({ opciones: parsearArgumentos(['--ejecutar']), deps: mundo.deps }),
      (error) => /Falló la subida de a\) assets/.test(error.message) && /Para volver a como estaba/.test(error.message),
    )
    assert.equal(mundo.subidas.length, 1)
    assert.equal(mundo.subidas.flat().includes('index.html'), false)
  } finally {
    await mundo.limpiar()
  }
})

test('si el respaldo del día ya existe, usa otro nombre en vez de pisarlo', async () => {
  const mundo = await crearMundo()
  try {
    mundo.remoto.respaldos.set('congregacion-dev-20261027-v6.0.0-pre', { mtime: 50000, archivos: new Map(Object.entries(archivoVersion(5))) })
    const resultado = await publicar({ opciones: parsearArgumentos(['--ejecutar', '--sin-podar']), deps: mundo.deps })
    assert.equal(resultado.nombreDeRespaldo, 'congregacion-dev-20261027-v6.0.0-2-pre')
    assert.ok(mundo.remoto.respaldos.has('congregacion-dev-20261027-v6.0.0-pre'))
    assert.ok(mundo.remoto.respaldos.has('congregacion-dev-20261027-v6.0.0-2-pre'))
  } finally {
    await mundo.limpiar()
  }
})

// ------------------------------------------------------------------- el script

test('el script no usa --delete, no contiene credenciales y la publicación real siempre pasa por el build seguro', async () => {
  const fuente = await readFile(join(repoRoot, 'scripts/publicar-hostinger.mjs'), 'utf8')
  // Sin --delete en ningún comando (el texto "--delete" solo puede aparecer en comentarios o en pruebas negativas).
  const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(sinComentarios, /--delete/)
  assert.doesNotMatch(fuente, /service_role|SERVICE_ROLE|password|PRIVATE KEY|sb_secret/i)
  assert.match(fuente, /buildDevSeguro/)
  assert.match(fuente, /fetch\(direccion/)
  assert.equal(SERVIDOR.host, 'cuyo.news')
  assert.equal(SERVIDOR.usuario, 'u800479702')
  assert.equal(SERVIDOR.carpeta, '/home/u800479702/domains/estracom.com.ar/public_html/congregacion')
  assert.equal(SERVIDOR.respaldos, '/home/u800479702/backups')
})

// ---------------------------------------- los comandos remotos, contra un shell local
// Se ejecutan con `sh -c` sobre carpetas temporales de este equipo: no hay red
// ni servidor. Sirve para comprobar que el shell los entiende y que hacen solo
// lo que dicen.

const ejecutarEnShell = async (comando, { path } = {}) => {
  const { stdout } = await promisify(execFile)('sh', ['-c', comando], {
    encoding: 'utf8',
    env: { ...process.env, ...(path ? { PATH: `${path}:${process.env.PATH}` } : {}) },
  })
  return stdout
}

async function sitioLocalDePrueba() {
  const raiz = await mkdtemp(join(tmpdir(), 'publicar-shell-test-'))
  const carpeta = join(raiz, 'congregacion con espacio')
  const respaldos = join(raiz, 'backups')
  await mkdir(join(carpeta, 'assets'), { recursive: true })
  await mkdir(respaldos)
  await writeFile(join(carpeta, 'index.html'), '<script src="/assets/main-A1.js"></script>\n')
  await writeFile(join(carpeta, 'sw.js'), 'sin salto final')
  await writeFile(join(carpeta, 'assets', 'main-A1.js'), 'import "./chunk-B2.js"\n')
  await writeFile(join(carpeta, 'assets', 'chunk-B2.js'), '')
  await writeFile(join(carpeta, 'assets', 'font-C3.woff2'), 'binario')
  await writeFile(join(carpeta, 'assets', 'estilo-D4.css'), 'a{b:c}\n\n')
  await writeFile(join(carpeta, '.DS_Store'), 'x')
  await mkdir(join(carpeta, 'pwa'))
  await writeFile(join(carpeta, 'pwa', '.DS_Store'), 'x')
  return { raiz, carpeta, respaldos }
}

test('shell real: vuelca los .js y .css de assets y el volcado se separa sin perder texto', async () => {
  const sitio = await sitioLocalDePrueba()
  try {
    const marcador = '@@territorios-0123456789abcdef@@'
    const salida = await ejecutarEnShell(comandos.volcarTextoDeAssets({ carpeta: sitio.carpeta, marcador }))
    const archivos = separarVolcado(salida, marcador)
    assert.deepEqual([...archivos.keys()].sort(), ['chunk-B2.js', 'estilo-D4.css', 'main-A1.js'])
    assert.equal(archivos.get('main-A1.js'), 'import "./chunk-B2.js"\n')
    assert.equal(archivos.get('chunk-B2.js'), '')
    assert.equal(archivos.get('estilo-D4.css'), 'a{b:c}\n\n')
    // La fuente binaria no es texto: no se vuelca.
    assert.equal(archivos.has('font-C3.woff2'), false)

    const semillas = separarVolcado(
      await ejecutarEnShell(comandos.volcarArchivos({ directorio: sitio.carpeta, nombres: ['index.html', 'sw.js', 'editor-manzanas.html'], marcador })),
      marcador,
    )
    assert.equal(semillas.get('index.html'), '<script src="/assets/main-A1.js"></script>\n')
    assert.equal(semillas.get('sw.js'), 'sin salto final')
    // Lo que no existe simplemente no aparece (un respaldo viejo puede no tener todos los editores).
    assert.equal(semillas.has('editor-manzanas.html'), false)
  } finally {
    await rm(sitio.raiz, { recursive: true, force: true })
  }
})

test('shell real: el respaldo copia la carpeta entera, se puede comprobar y no pisa uno existente', async () => {
  const sitio = await sitioLocalDePrueba()
  try {
    const nombre = 'congregacion-dev-20261027-v1-pre'
    await ejecutarEnShell(comandos.respaldoLibre({ respaldos: sitio.respaldos, nombre }))
    await ejecutarEnShell(comandos.respaldar({ origen: sitio.carpeta, respaldos: sitio.respaldos, nombre }))
    await ejecutarEnShell(comandos.comprobarRespaldo({ origen: sitio.carpeta, respaldos: sitio.respaldos, nombre }))
    assert.equal(await readFile(join(sitio.respaldos, nombre, 'assets', 'main-A1.js'), 'utf8'), 'import "./chunk-B2.js"\n')

    // Ya existe: respaldoLibre falla, así que nunca se llega a copiar ADENTRO.
    await assert.rejects(() => ejecutarEnShell(comandos.respaldoLibre({ respaldos: sitio.respaldos, nombre })))

    // Un respaldo a medias (falta un archivo) no pasa la comprobación.
    await rm(join(sitio.respaldos, nombre, 'assets', 'chunk-B2.js'))
    await assert.rejects(() => ejecutarEnShell(comandos.comprobarRespaldo({ origen: sitio.carpeta, respaldos: sitio.respaldos, nombre })))
  } finally {
    await rm(sitio.raiz, { recursive: true, force: true })
  }
})

test('shell real: borra solo los assets pedidos y solo los .DS_Store, y quita respaldos por nombre', async () => {
  const sitio = await sitioLocalDePrueba()
  try {
    await ejecutarEnShell(comandos.borrarAssets({ carpeta: sitio.carpeta, nombres: ['chunk-B2.js', 'font-C3.woff2'] }))
    assert.deepEqual((await readdir(join(sitio.carpeta, 'assets'))).sort(), ['estilo-D4.css', 'main-A1.js'])
    // Lo que no es de assets/ no se tocó.
    assert.equal(await readFile(join(sitio.carpeta, 'sw.js'), 'utf8'), 'sin salto final')

    await ejecutarEnShell(comandos.borrarDsStore(sitio.carpeta))
    assert.deepEqual((await readdir(sitio.carpeta)).sort(), ['assets', 'index.html', 'pwa', 'sw.js'])
    assert.deepEqual(await readdir(join(sitio.carpeta, 'pwa')), [])

    // Un respaldo borrado por su nombre; el otro, y la carpeta del sitio, quedan.
    await mkdir(join(sitio.respaldos, 'congregacion-dev-20260101-viejo-pre'))
    await mkdir(join(sitio.respaldos, 'congregacion-dev-20260202-otro-pre'))
    await ejecutarEnShell(comandos.borrarRespaldo({ respaldos: sitio.respaldos, nombre: 'congregacion-dev-20260101-viejo-pre' }))
    assert.deepEqual(await readdir(sitio.respaldos), ['congregacion-dev-20260202-otro-pre'])
    assert.equal((await readdir(sitio.carpeta)).includes('index.html'), true)
  } finally {
    await rm(sitio.raiz, { recursive: true, force: true })
  }
})

test('shell real: el listado de respaldos devuelve mtime y nombre, y solo de congregacion-dev-*', async () => {
  const sitio = await sitioLocalDePrueba()
  const calzado = await mkdtemp(join(tmpdir(), 'publicar-stat-shim-'))
  try {
    // El servidor es Linux (GNU stat -c %Y). Si este equipo es macOS (BSD stat),
    // un stat de mentira, solo para la prueba, traduce esa opción.
    if (process.platform === 'darwin') {
      await writeFile(join(calzado, 'stat'), '#!/bin/sh\nif [ "$1" = "-c" ]; then exec /usr/bin/stat -f %m "$3"; fi\nexec /usr/bin/stat "$@"\n')
      await chmod(join(calzado, 'stat'), 0o755)
    }
    await mkdir(join(sitio.respaldos, 'congregacion-dev-20260920-a-pre'))
    await mkdir(join(sitio.respaldos, 'congregacion-dev-20261001-b-pre'))
    await mkdir(join(sitio.respaldos, 'cuyo-news-semanal'))
    await mkdir(join(sitio.respaldos, 'congregacion-20260904-1515'))
    await writeFile(join(sitio.respaldos, 'congregacion-dev-suelto.txt'), 'no es carpeta')

    const salida = await ejecutarEnShell(comandos.listarRespaldos(sitio.respaldos), { path: calzado })
    const respaldos = analizarListadoDeRespaldos(salida)
    assert.deepEqual(respaldos.map((r) => r.nombre).sort(), ['congregacion-dev-20260920-a-pre', 'congregacion-dev-20261001-b-pre'])
    assert.ok(respaldos.every((r) => r.mtime > 1_000_000_000))
  } finally {
    await rm(sitio.raiz, { recursive: true, force: true })
    await rm(calzado, { recursive: true, force: true })
  }
})
