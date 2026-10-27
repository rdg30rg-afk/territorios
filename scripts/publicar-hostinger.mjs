#!/usr/bin/env node
/**
 * Publica el sitio en Hostinger (congregacion.estracom.com.ar), siempre desde
 * un tag de git. Reemplaza lo que hasta ahora se hacía a mano.
 *
 *   node scripts/publicar-hostinger.mjs                 simulación: imprime el plan y no toca nada
 *   node scripts/publicar-hostinger.mjs --dry-run       lo mismo, dicho explícito (es el valor por defecto)
 *   node scripts/publicar-hostinger.mjs --ejecutar      publica de verdad
 *
 * Opciones:
 *   --salida <carpeta>   solo con simulación: usa un paquete ya compilado para mostrar los archivos
 *   --sin-podar          publica pero no borra assets ni respaldos viejos
 *   --host / --usuario / --puerto   otro servidor SSH (por defecto cuyo.news, u800479702, 65002)
 *
 * Pasos de una publicación real, en este orden:
 *   1. Se niega si el árbol de git está sucio o si HEAD no tiene un tag.
 *   2. Corre el build seguro (modo production, solo base DEV) y escribe
 *      version.json con commit, tag y fecha.
 *   3. Respalda la carpeta remota en ~/backups/congregacion-dev-<fecha>-<tag>-pre.
 *   4. Sube primero los assets, después los editores y index.html, y al final sw.js.
 *      Nunca borra nada durante la subida.
 *   5. Verifica el SHA-256 de todo lo subido: por HTTPS lo que se sirve tal
 *      cual, y por SSH, en el disco del servidor, las imágenes, que la CDN de
 *      Hostinger recomprime al servirlas.
 *   6. Solo si la verificación salió bien, poda: deja las últimas 3 versiones de
 *      assets y los últimos 2 respaldos congregacion-dev-*.
 *
 * Requisitos: ssh con la clave cargada (se usa BatchMode: nunca pregunta
 * contraseñas) y rsync con soporte de --files-from.
 */
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { buildDevSeguro, isJunkFile } from './build-dev-seguro.mjs'

const execFileAsync = promisify(execFile)
const RAIZ_DEL_PROYECTO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const SERVIDOR = Object.freeze({
  host: 'cuyo.news',
  usuario: 'u800479702',
  puerto: 65002,
  carpeta: '/home/u800479702/domains/estracom.com.ar/public_html/congregacion',
  respaldos: '/home/u800479702/backups',
  urlPublica: 'https://congregacion.estracom.com.ar',
})

export const PREFIJO_RESPALDO = 'congregacion-dev-'
export const VERSIONES_DE_ASSETS_A_CONSERVAR = 3
export const RESPALDOS_A_CONSERVAR = 2

/** Lo que mira cada versión para saber qué assets necesita (más sw.js, que precachea). */
export const ARCHIVOS_SEMILLA = Object.freeze([
  'index.html',
  'editor-manzanas.html',
  'editor-manzanas-embedded.html',
  'sw.js',
])

/** Rutas del SPA que tienen que contestar 200 después de publicar. */
export const RUTAS_A_COMPROBAR = Object.freeze(['/', '/mapas', '/login'])

export class PublicacionBloqueada extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'PublicacionBloqueada'
  }
}

// --------------------------------------------------------------- argumentos

export function parsearArgumentos(argv) {
  const opciones = {
    ejecutar: false,
    dryRun: true,
    salida: null,
    sinPodar: false,
    ayuda: false,
    host: SERVIDOR.host,
    usuario: SERVIDOR.usuario,
    puerto: SERVIDOR.puerto,
  }
  let pidioDryRun = false

  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice]
    const valor = () => {
      const siguiente = argv[indice + 1]
      if (siguiente === undefined || siguiente.startsWith('--')) {
        throw new PublicacionBloqueada(`Falta el valor de ${argumento}.`)
      }
      indice += 1
      return siguiente
    }
    switch (argumento) {
      case '--dry-run': pidioDryRun = true; break
      case '--ejecutar': opciones.ejecutar = true; break
      case '--sin-podar': opciones.sinPodar = true; break
      case '--salida': opciones.salida = resolve(valor()); break
      case '--host': opciones.host = valor(); break
      case '--usuario': opciones.usuario = valor(); break
      case '--puerto': opciones.puerto = Number(valor()); break
      case '-h':
      case '--ayuda': opciones.ayuda = true; break
      default:
        throw new PublicacionBloqueada(`Opción desconocida: ${argumento}. Corré con --ayuda para ver las que existen.`)
    }
  }

  if (pidioDryRun && opciones.ejecutar) {
    throw new PublicacionBloqueada('No se puede pedir --dry-run y --ejecutar a la vez: elegí una.')
  }
  opciones.dryRun = !opciones.ejecutar
  if (opciones.salida && !opciones.dryRun) {
    throw new PublicacionBloqueada(
      '--salida solo se puede usar en simulación: una publicación real siempre compila desde el tag, para que lo publicado sea exactamente ese commit.',
    )
  }
  // El host y el usuario terminan en la línea de ssh: nada que empiece con "-"
  // (sería una opción) ni con caracteres raros.
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(opciones.host)) {
    throw new PublicacionBloqueada(`El host SSH no es válido: ${opciones.host}`)
  }
  if (!/^[a-z_][a-z0-9_-]*$/i.test(opciones.usuario)) {
    throw new PublicacionBloqueada(`El usuario SSH no es válido: ${opciones.usuario}`)
  }
  if (!Number.isInteger(opciones.puerto) || opciones.puerto < 1 || opciones.puerto > 65535) {
    throw new PublicacionBloqueada('El puerto SSH tiene que ser un número entre 1 y 65535.')
  }
  return opciones
}

export const TEXTO_DE_AYUDA = `Uso: node scripts/publicar-hostinger.mjs [opciones]

  (sin opciones)   Simulación: imprime el plan y no toca nada. Es el valor por defecto.
  --dry-run        Lo mismo, dicho explícito.
  --ejecutar       Publica de verdad (exige árbol limpio y HEAD con tag).
  --salida <dir>   Solo con simulación: usa un paquete ya compilado para listar los archivos.
  --sin-podar      Publica pero no borra assets ni respaldos viejos.
  --host, --usuario, --puerto   Otro servidor SSH.
  -h, --ayuda      Esta ayuda.`

// ---------------------------------------------------------------------- git

/**
 * Decide si se puede publicar. Recibe la salida cruda de
 * `git status --porcelain` y de `git tag --points-at HEAD --sort=-creatordate`.
 * Un archivo sin versionar también ensucia el árbol: lo publicado tiene que
 * salir entero de un commit.
 */
export function evaluarEstadoGit({ estado, etiquetas }) {
  const problemas = []
  const cambios = String(estado).split('\n').map((linea) => linea.trim()).filter(Boolean)
  if (cambios.length > 0) {
    const muestra = cambios.slice(0, 5).join('; ')
    problemas.push(
      `El árbol de git está sucio (${cambios.length} cambio${cambios.length === 1 ? '' : 's'}: ${muestra}${cambios.length > 5 ? '; ...' : ''}). Commiteá o descartá todo antes de publicar.`,
    )
  }
  const tags = String(etiquetas).split('\n').map((linea) => linea.trim()).filter(Boolean)
  if (tags.length === 0) {
    problemas.push('HEAD no tiene ningún tag. Publicamos siempre desde un tag: creá uno (git tag v...) en este commit.')
  }
  return { ok: problemas.length === 0, problemas, tag: tags[0] ?? null, tags }
}

export async function leerEstadoGit(git) {
  const [estado, commit, etiquetas] = await Promise.all([
    git(['status', '--porcelain']),
    git(['rev-parse', 'HEAD']),
    git(['tag', '--points-at', 'HEAD', '--sort=-creatordate']),
  ])
  return { ...evaluarEstadoGit({ estado, etiquetas }), commit: String(commit).trim() }
}

// ------------------------------------------------------------ nombres y fechas

/** AAAAMMDD en hora local: es la fecha que ve quien publica, no la de UTC. */
export function fechaCompacta(fecha) {
  const dos = (numero) => String(numero).padStart(2, '0')
  return `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}`
}

export function nombreDeRespaldo({ fecha, tag }) {
  const nombre = String(tag).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  if (!nombre) throw new PublicacionBloqueada(`El tag "${tag}" no sirve para nombrar el respaldo.`)
  return `${PREFIJO_RESPALDO}${fechaCompacta(fecha)}-${nombre}-pre`
}

/**
 * Si ya existe un respaldo con ese nombre (se publicó el mismo tag dos veces el
 * mismo día), se le suma un número antes del "-pre". Nunca se pisa uno
 * existente: `cp -a` sobre una carpeta que existe copiaría ADENTRO de ella.
 */
export function nombreDeRespaldoLibre(base, existentes) {
  const usados = new Set(existentes)
  if (!usados.has(base)) return base
  const raiz = base.replace(/-pre$/, '')
  for (let numero = 2; numero < 1000; numero += 1) {
    const candidato = `${raiz}-${numero}-pre`
    if (!usados.has(candidato)) return candidato
  }
  throw new PublicacionBloqueada(`Hay demasiados respaldos llamados ${base}.`)
}

export function crearVersionJson({ commit, tag, fecha }) {
  return `${JSON.stringify({ commit, tag, fecha: fecha.toISOString() }, null, 2)}\n`
}

// ----------------------------------------------------------- archivos locales

export function normalizarRuta(ruta) {
  return ruta.split('\\').join('/')
}

export async function listarArchivos(directorio, prefijo = '') {
  const entradas = await readdir(directorio, { withFileTypes: true })
  const archivos = []
  for (const entrada of entradas) {
    const relativa = prefijo ? `${prefijo}/${entrada.name}` : entrada.name
    if (entrada.isDirectory()) archivos.push(...(await listarArchivos(join(directorio, entrada.name), relativa)))
    else if (entrada.isFile()) archivos.push(relativa)
  }
  return archivos.sort()
}

export function sha256(contenido) {
  return createHash('sha256').update(contenido).digest('hex')
}

/**
 * Reparte los archivos en los tres grupos que se suben EN ESTE ORDEN:
 *   1. assets: todo lo que las páginas referencian (assets/ con hash, el
 *      runtime de Workbox, íconos, datos). Hasta que no esté arriba, nada
 *      apunta a ellos.
 *   2. páginas: index.html, los editores, el manifest y version.json. Recién
 *      ahora el sitio empieza a pedir los assets nuevos. Después va .htaccess
 *      solo, y se comprueba que el sitio siga contestando 200 (un .htaccess
 *      con un error tira abajo todo el sitio).
 *   3. service worker: sw.js, lo último. Precachea lo de arriba; si lo
 *      subiéramos antes, intentaría instalar archivos que todavía no existen.
 * Los archivos basura del sistema operativo no se suben nunca.
 */
export function clasificarArchivos(rutas) {
  const grupos = { assets: [], paginas: [], servidor: [], serviceWorker: [], omitidos: [] }
  for (const original of rutas) {
    const ruta = normalizarRuta(original)
    if (isJunkFile(ruta)) {
      grupos.omitidos.push(ruta)
    } else if (ruta === 'sw.js') {
      grupos.serviceWorker.push(ruta)
    } else if (ruta === '.htaccess') {
      grupos.servidor.push(ruta)
    } else if (
      !ruta.includes('/') &&
      (ruta.endsWith('.html') || ['manifest.webmanifest', 'registerSW.js', 'version.json'].includes(ruta))
    ) {
      grupos.paginas.push(ruta)
    } else {
      grupos.assets.push(ruta)
    }
  }
  for (const grupo of Object.values(grupos)) grupo.sort()
  return grupos
}

/** Pone permisos 755/644: el paquete sale de un directorio temporal que puede ser 700. */
async function normalizarPermisos(directorio) {
  await chmod(directorio, 0o755)
  for (const entrada of await readdir(directorio, { withFileTypes: true })) {
    const ruta = join(directorio, entrada.name)
    if (entrada.isDirectory()) await normalizarPermisos(ruta)
    else if (entrada.isFile()) await chmod(ruta, 0o644)
  }
}

export async function construirManifiesto(directorio) {
  const rutas = (await listarArchivos(directorio)).filter((ruta) => !isJunkFile(ruta))
  const manifiesto = []
  for (const ruta of rutas) {
    const contenido = await readFile(join(directorio, ruta))
    manifiesto.push({ ruta, sha256: sha256(contenido), bytes: contenido.length })
  }
  return manifiesto
}

// ------------------------------------------------------------------ ssh/rsync

/** Entrecomilla un valor para el shell remoto. */
export function shQuote(valor) {
  return `'${String(valor).replace(/'/g, `'\\''`)}'`
}

export function opcionesSsh(servidor) {
  return ['-p', String(servidor.puerto), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15']
}

export function argumentosSsh(servidor, comandoRemoto) {
  return [...opcionesSsh(servidor), `${servidor.usuario}@${servidor.host}`, comandoRemoto]
}

/**
 * rsync sin --delete (nunca se borra al subir), sin --perms (para no copiar al
 * servidor el permiso 700 de un directorio temporal: ver DEPLOY-HOSTINGER.md)
 * y con la lista exacta de archivos del grupo.
 */
export function argumentosRsync({ servidor, origen, archivoDeLista, destino }) {
  return [
    '-rt',
    '--no-perms',
    '-v',
    `--files-from=${archivoDeLista}`,
    '-e',
    `ssh ${opcionesSsh(servidor).join(' ')}`,
    `${origen.replace(/\/+$/, '')}/`,
    `${servidor.usuario}@${servidor.host}:${destino.replace(/\/+$/, '')}/`,
  ]
}

const NOMBRE_DE_ASSET_SEGURO = /^[A-Za-z0-9._@~-]+$/
const NOMBRE_DE_RESPALDO_SEGURO = /^congregacion-dev-[A-Za-z0-9._-]+$/

export function esNombreDeAssetSeguro(nombre) {
  return NOMBRE_DE_ASSET_SEGURO.test(nombre) && nombre !== '.' && nombre !== '..'
}

export function esNombreDeRespaldoSeguro(nombre) {
  return NOMBRE_DE_RESPALDO_SEGURO.test(nombre) && !nombre.includes('..')
}

function exigirRespaldoSeguro(nombre) {
  if (!esNombreDeRespaldoSeguro(nombre)) {
    throw new PublicacionBloqueada(`Nombre de respaldo no permitido: ${nombre}`)
  }
}

/** Comandos que se ejecutan en el servidor. Todo valor interpolado va entrecomillado. */
export const comandos = {
  existeCarpeta: (carpeta) => `test -d ${shQuote(carpeta)}`,

  /** Falla si ya existe: cp -a sobre una carpeta que existe copiaría ADENTRO de ella. */
  respaldoLibre: ({ respaldos, nombre }) => {
    exigirRespaldoSeguro(nombre)
    return `test ! -e ${shQuote(`${respaldos}/${nombre}`)}`
  },

  respaldar: ({ origen, respaldos, nombre }) => {
    exigirRespaldoSeguro(nombre)
    const destino = `${respaldos}/${nombre}`
    return `mkdir -p ${shQuote(respaldos)} && cp -a ${shQuote(origen)} ${shQuote(destino)} && touch ${shQuote(destino)}`
  },

  /** El respaldo tiene tantos archivos como la carpeta original: se cortó a medias si no. */
  comprobarRespaldo: ({ origen, respaldos, nombre }) => {
    exigirRespaldoSeguro(nombre)
    return `test "$(find ${shQuote(origen)} -type f | wc -l)" = "$(find ${shQuote(`${respaldos}/${nombre}`)} -type f | wc -l)"`
  },

  /** Limpia un respaldo que quedó a medias (cuota llena). Solo nombres congregacion-dev-*. */
  quitarRespaldo: ({ respaldos, nombre }) => {
    exigirRespaldoSeguro(nombre)
    return `rm -rf -- ${shQuote(`${respaldos}/${nombre}`)}`
  },

  listarAssets: (carpeta) => `ls -1A ${shQuote(`${carpeta}/assets`)}`,

  listarRespaldos: (respaldos) =>
    `cd ${shQuote(respaldos)} && for d in ${PREFIJO_RESPALDO}*; do [ -d "$d" ] && printf '%s\\t%s\\n' "$(stat -c %Y "$d")" "$d"; done; true`,

  /** Vuelca el contenido de varios archivos, separados por un marcador. Solo lee. */
  volcarArchivos: ({ directorio, nombres, marcador }) => {
    for (const nombre of nombres) {
      if (!/^[A-Za-z0-9._@~/-]+$/.test(nombre)) throw new PublicacionBloqueada(`Nombre de archivo no permitido: ${nombre}`)
    }
    return `cd ${shQuote(directorio)} && for f in ${nombres.map(shQuote).join(' ')}; do if [ -f "$f" ]; then printf '%s%s\\n' ${shQuote(marcador)} "$f"; cat "$f"; printf '\\n'; fi; done; true`
  },

  /** SHA-256 de cada archivo tal como quedó en el disco del servidor. Solo lee. */
  sumasSha256: ({ carpeta, rutas }) => {
    if (rutas.length === 0) throw new PublicacionBloqueada('No hay archivos para sumar.')
    for (const ruta of rutas) {
      if (!/^[A-Za-z0-9._@~/-]+$/.test(ruta) || ruta.split('/').includes('..')) {
        throw new PublicacionBloqueada(`Nombre de archivo no permitido: ${ruta}`)
      }
    }
    return `cd ${shQuote(carpeta)} && for f in ${rutas.map(shQuote).join(' ')}; do if [ -f "$f" ]; then sha256sum -- "$f"; fi; done; true`
  },

  /** Vuelca todos los .js, .mjs y .css de una carpeta. Solo lee. */
  volcarTextoDeAssets: ({ carpeta, marcador }) =>
    `cd ${shQuote(`${carpeta}/assets`)} && for f in *.js *.mjs *.css; do if [ -f "$f" ]; then printf '%s%s\\n' ${shQuote(marcador)} "$f"; cat "$f"; printf '\\n'; fi; done; true`,

  borrarAssets: ({ carpeta, nombres }) => {
    if (nombres.length === 0) throw new PublicacionBloqueada('No hay assets para borrar.')
    for (const nombre of nombres) {
      if (!esNombreDeAssetSeguro(nombre)) throw new PublicacionBloqueada(`Nombre de asset no permitido: ${nombre}`)
    }
    return `cd ${shQuote(`${carpeta}/assets`)} && rm -f -- ${nombres.map(shQuote).join(' ')}`
  },

  borrarRespaldo: ({ respaldos, nombre }) => {
    exigirRespaldoSeguro(nombre)
    return `rm -rf -- ${shQuote(`${respaldos}/${nombre}`)}`
  },

  borrarDsStore: (carpeta) => `find ${shQuote(carpeta)} -name .DS_Store -type f -delete`,

  restaurar: ({ carpeta, respaldos, nombre }) => {
    exigirRespaldoSeguro(nombre)
    return `rsync -rt --no-perms ${shQuote(`${respaldos}/${nombre}/`)} ${shQuote(`${carpeta}/`)}`
  },
}

/** Separa la salida de volcarArchivos/volcarTextoDeAssets en un Map nombre -> texto. */
export function separarVolcado(salida, marcador) {
  const archivos = new Map()
  const partes = String(salida).split(marcador)
  for (const parte of partes.slice(1)) {
    const corte = parte.indexOf('\n')
    if (corte < 0) continue
    const nombre = parte.slice(0, corte)
    let texto = parte.slice(corte + 1)
    if (texto.endsWith('\n')) texto = texto.slice(0, -1)
    archivos.set(nombre, texto)
  }
  return archivos
}

export function analizarListadoDeRespaldos(salida) {
  const respaldos = []
  for (const linea of String(salida).split('\n')) {
    const [mtime, nombre] = linea.split('\t')
    if (!nombre || !esNombreDeRespaldoSeguro(nombre.trim())) continue
    respaldos.push({ nombre: nombre.trim(), mtime: Number(mtime) || 0 })
  }
  return respaldos
}

// ------------------------------------------------------------------------ poda

/** La fecha AAAAMMDD que lleva el nombre, o 0 si no tiene. */
export function fechaDelNombreDeRespaldo(nombre) {
  const coincidencia = /^congregacion-dev-(\d{8})(?:-|$)/.exec(nombre)
  return coincidencia ? Number(coincidencia[1]) : 0
}

/** Del más nuevo al más viejo: fecha del nombre, después mtime, después el nombre. */
export function ordenarRespaldos(respaldos) {
  return [...respaldos].sort(
    (a, b) =>
      fechaDelNombreDeRespaldo(b.nombre) - fechaDelNombreDeRespaldo(a.nombre) ||
      (b.mtime ?? 0) - (a.mtime ?? 0) ||
      (a.nombre < b.nombre ? 1 : a.nombre > b.nombre ? -1 : 0),
  )
}

/**
 * Qué respaldos conservar y cuáles borrar. Solo toca carpetas llamadas
 * congregacion-dev-*: cualquier otra cosa de ~/backups (el sitio de noticias,
 * respaldos con otro nombre) queda como está. El respaldo recién hecho nunca
 * se borra.
 */
export function elegirRespaldosAPodar(respaldos, { conservar = RESPALDOS_A_CONSERVAR, protegido } = {}) {
  const candidatos = ordenarRespaldos(respaldos.filter((respaldo) => esNombreDeRespaldoSeguro(respaldo.nombre)))
  if (protegido && !candidatos.some((respaldo) => respaldo.nombre === protegido)) {
    throw new PublicacionBloqueada(
      `El respaldo recién hecho (${protegido}) no aparece en el listado del servidor: no se poda nada.`,
    )
  }
  const aConservar = []
  if (protegido) aConservar.push(protegido)
  for (const respaldo of candidatos) {
    if (aConservar.length >= conservar) break
    if (!aConservar.includes(respaldo.nombre)) aConservar.push(respaldo.nombre)
  }
  const aBorrar = candidatos.map((respaldo) => respaldo.nombre).filter((nombre) => !aConservar.includes(nombre))
  return { conservar: aConservar, borrar: aBorrar }
}

/**
 * Nombres de assets que un texto menciona. Se parte el texto en "palabras con
 * extensión" y se cruzan con los archivos que existen: un nombre de más solo
 * hace que se conserve un archivo de más, nunca que se borre uno que se usa.
 */
export function referenciasAAssets(texto, existentes) {
  const referencias = new Set()
  for (const coincidencia of String(texto).matchAll(/[A-Za-z0-9_@~][A-Za-z0-9_.@~-]*\.[A-Za-z0-9]+/g)) {
    if (existentes.has(coincidencia[0])) referencias.add(coincidencia[0])
  }
  return referencias
}

const EXTENSIONES_CON_REFERENCIAS = /\.(?:js|mjs|css)$/

/**
 * Los assets que una versión necesita: lo que referencian sus páginas y su
 * service worker, y todo lo que esos archivos referencian a su vez (imports de
 * JS, url() de CSS), hasta que no aparezca nada nuevo.
 *
 * @param archivosDeVersion  Map nombre -> texto de index.html, editores y sw.js
 * @param existentes         Set con los nombres que hay en assets/
 * @param leerAsset          nombre -> texto del asset, o null si no se tiene
 */
export function assetsDeUnaVersion({ archivosDeVersion, existentes, leerAsset }) {
  const necesarios = new Set()
  const pendientes = []
  const agregar = (texto) => {
    for (const nombre of referenciasAAssets(texto, existentes)) {
      if (!necesarios.has(nombre)) {
        necesarios.add(nombre)
        pendientes.push(nombre)
      }
    }
  }
  for (const texto of archivosDeVersion.values()) agregar(texto)
  while (pendientes.length > 0) {
    const nombre = pendientes.pop()
    if (!EXTENSIONES_CON_REFERENCIAS.test(nombre)) continue
    const texto = leerAsset(nombre)
    if (texto) agregar(texto)
  }
  return necesarios
}

/**
 * Decide qué assets borrar: todo lo que no necesita ninguna de las versiones a
 * conservar (la nueva y las de los respaldos que se quedan).
 *
 * Se niega a podar si algo huele mal:
 *  - la versión nueva no tiene assets propios (lectura vacía o equivocada);
 *  - la versión nueva referencia un asset que no está en el servidor;
 *  - la poda dejaría el directorio vacío.
 */
export function planDePodaDeAssets({ existentes, versiones, leerAsset }) {
  const existentesSet = new Set(existentes)
  const conservar = new Set()
  const porVersion = []
  for (const version of versiones) {
    const necesarios = assetsDeUnaVersion({ archivosDeVersion: version.archivos, existentes: existentesSet, leerAsset })
    porVersion.push({ nombre: version.nombre, assets: necesarios.size })
    for (const nombre of necesarios) conservar.add(nombre)
  }

  const nueva = versiones[0]
  if (!nueva || porVersion[0].assets === 0) {
    throw new PublicacionBloqueada('La versión nueva no referencia ningún asset del servidor: no se poda nada.')
  }
  for (const texto of nueva.archivos.values()) {
    for (const coincidencia of String(texto).matchAll(/(?:^|[^A-Za-z0-9_.@~-])assets\/([A-Za-z0-9_.@~-]+\.[A-Za-z0-9]+)/g)) {
      if (!existentesSet.has(coincidencia[1])) {
        throw new PublicacionBloqueada(
          `La versión nueva referencia assets/${coincidencia[1]} y no está en el servidor: no se poda nada.`,
        )
      }
    }
  }

  const borrar = [...existentesSet].filter((nombre) => !conservar.has(nombre) && esNombreDeAssetSeguro(nombre)).sort()
  if (borrar.length > 0 && borrar.length === existentesSet.size) {
    throw new PublicacionBloqueada('La poda borraría todos los assets: no se poda nada.')
  }
  return { conservar: [...conservar].sort(), borrar, porVersion }
}

// ---------------------------------------------------------------- verificación

/**
 * La CDN de Hostinger (hcdn) recomprime las imágenes al servirlas: el ícono de
 * 512 px sale de 74.763 bytes en el disco y llega en 51.113. Por HTTPS nunca
 * coinciden, así que se comparan en el disco del servidor, por SSH.
 */
export function seComparaPorSsh(ruta) {
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(ruta)
}

/**
 * Pide cada archivo por HTTPS y compara su SHA-256 con el del paquete local.
 * La consulta lleva un parámetro cambiante y `cache-control: no-cache` para no
 * leer una copia vieja de la CDN. .htaccess no se sirve (el servidor lo
 * esconde) y las imágenes las recomprime la CDN, así que ninguno de los dos
 * se verifica por HTTPS.
 */
export async function verificarPorHttps({ baseUrl, manifiesto, fetchFn, concurrencia = 8, nonce = randomBytes(4).toString('hex') }) {
  const aVerificar = manifiesto.filter((archivo) => archivo.ruta !== '.htaccess' && !seComparaPorSsh(archivo.ruta))
  const fallas = []
  let siguiente = 0

  async function trabajar() {
    while (siguiente < aVerificar.length) {
      const archivo = aVerificar[siguiente]
      siguiente += 1
      const direccion = `${baseUrl.replace(/\/+$/, '')}/${archivo.ruta.split('/').map(encodeURIComponent).join('/')}?verif=${nonce}`
      try {
        const respuesta = await fetchFn(direccion, { headers: { 'cache-control': 'no-cache' }, redirect: 'manual' })
        if (respuesta.status !== 200) {
          fallas.push({ ruta: archivo.ruta, motivo: `HTTP ${respuesta.status}` })
          continue
        }
        const obtenido = sha256(Buffer.from(await respuesta.arrayBuffer()))
        if (obtenido !== archivo.sha256) {
          fallas.push({ ruta: archivo.ruta, motivo: `SHA-256 distinto (local ${archivo.sha256.slice(0, 12)}…, servidor ${obtenido.slice(0, 12)}…)` })
        }
      } catch (error) {
        fallas.push({ ruta: archivo.ruta, motivo: `no se pudo pedir: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencia, aVerificar.length) }, trabajar))
  return { verificados: aVerificar.length - fallas.length, total: aVerificar.length, fallas: fallas.sort((a, b) => (a.ruta < b.ruta ? -1 : 1)) }
}

/** Lee la salida de sha256sum ("<hash>  <ruta>" por línea) en un Map ruta -> hash. */
export function analizarSumas(salida) {
  const sumas = new Map()
  for (const linea of salida.split('\n')) {
    const partes = /^([0-9a-f]{64}) [ *](.+)$/.exec(linea)
    if (partes) sumas.set(partes[2], partes[1])
  }
  return sumas
}

/** Compara por SSH, en el disco del servidor, lo que la CDN no sirve tal cual. */
export async function verificarPorSsh({ carpeta, manifiesto, ssh }) {
  const aVerificar = manifiesto.filter((archivo) => seComparaPorSsh(archivo.ruta))
  if (aVerificar.length === 0) return { verificados: 0, total: 0, fallas: [] }
  let sumas
  try {
    sumas = analizarSumas(await ssh(comandos.sumasSha256({ carpeta, rutas: aVerificar.map((archivo) => archivo.ruta) })))
  } catch (error) {
    const motivo = `no se pudo leer por SSH: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    return { verificados: 0, total: aVerificar.length, fallas: aVerificar.map((archivo) => ({ ruta: archivo.ruta, motivo })) }
  }
  const fallas = []
  for (const archivo of aVerificar) {
    const obtenido = sumas.get(archivo.ruta)
    if (!obtenido) {
      fallas.push({ ruta: archivo.ruta, motivo: 'no está en el servidor' })
    } else if (obtenido !== archivo.sha256) {
      fallas.push({ ruta: archivo.ruta, motivo: `SHA-256 distinto en el disco del servidor (local ${archivo.sha256.slice(0, 12)}…, servidor ${obtenido.slice(0, 12)}…)` })
    }
  }
  return { verificados: aVerificar.length - fallas.length, total: aVerificar.length, fallas: fallas.sort((a, b) => (a.ruta < b.ruta ? -1 : 1)) }
}

export async function comprobarRutas({ baseUrl, rutas = RUTAS_A_COMPROBAR, fetchFn }) {
  const fallas = []
  for (const ruta of rutas) {
    try {
      const respuesta = await fetchFn(`${baseUrl.replace(/\/+$/, '')}${ruta}`, { headers: { 'cache-control': 'no-cache' }, redirect: 'manual' })
      if (respuesta.status !== 200) fallas.push({ ruta, motivo: `HTTP ${respuesta.status}` })
    } catch (error) {
      fallas.push({ ruta, motivo: `no se pudo pedir: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  return fallas
}

/**
 * Avisos (no fallas) sobre los encabezados que pide .htaccess. Si el servidor
 * los ignora, el sitio anda igual; solo queda sin la mejora.
 */
export async function revisarEncabezados({ baseUrl, ejemploDeAsset, fetchFn }) {
  const avisos = []
  const base = baseUrl.replace(/\/+$/, '')
  const leer = async (ruta) => {
    try {
      return (await fetchFn(`${base}${ruta}`, { headers: { 'cache-control': 'no-cache' }, redirect: 'manual' })).headers
    } catch {
      return null
    }
  }
  const manifest = await leer('/manifest.webmanifest')
  const tipo = manifest?.get('content-type') ?? ''
  if (manifest && !/application\/manifest\+json/i.test(tipo)) {
    avisos.push(`El manifest sale como "${tipo || 'sin tipo'}" y no como application/manifest+json: el servidor no aplicó AddType.`)
  }
  if (ejemploDeAsset) {
    const asset = await leer(`/${ejemploDeAsset}`)
    const cache = asset?.get('cache-control') ?? ''
    if (asset && !/immutable/i.test(cache)) {
      avisos.push(`Los assets con hash salen con Cache-Control "${cache || 'sin valor'}" y no con immutable: el servidor no aplicó la regla de /assets/.`)
    }
  }
  const pagina = await leer('/')
  if (pagina && !pagina.get('content-security-policy-report-only')) {
    avisos.push('No llegó el encabezado Content-Security-Policy-Report-Only: el servidor no aplicó la CSP.')
  }
  return avisos
}

// ------------------------------------------------------------------------- plan

/**
 * `rutas` son TODOS los archivos del paquete, basura incluida: así el plan
 * puede decir cuáles no se suben. Sin ellas se usan las del manifiesto.
 */
export function armarPlan({ servidor = SERVIDOR, opciones, git, fecha, manifiesto = null, rutas = null }) {
  const tag = git.tag ?? '<sin tag>'
  const base = git.tag ? nombreDeRespaldo({ fecha, tag: git.tag }) : `${PREFIJO_RESPALDO}${fechaCompacta(fecha)}-<tag>-pre`
  const todas = rutas ?? manifiesto?.map((archivo) => archivo.ruta) ?? null
  const grupos = todas ? clasificarArchivos(todas) : null
  return { servidor, opciones, git, tag, fecha, nombreDeRespaldo: base, grupos, manifiesto }
}

export function formatearPlan(plan) {
  const { servidor, opciones, git, grupos } = plan
  const lineas = []
  const ssh = `${servidor.usuario}@${servidor.host} (puerto ${opciones.puerto ?? servidor.puerto})`
  lineas.push(opciones.dryRun ? 'PUBLICACIÓN A HOSTINGER — SIMULACIÓN (no se toca nada)' : 'PUBLICACIÓN A HOSTINGER — EJECUCIÓN REAL')
  lineas.push('')
  lineas.push(`Servidor : ${ssh}`)
  lineas.push(`Carpeta  : ${servidor.carpeta}`)
  lineas.push(`Sitio    : ${servidor.urlPublica}`)
  lineas.push(`Commit   : ${git.commit ? git.commit.slice(0, 12) : '<desconocido>'}   Tag: ${plan.tag}`)
  lineas.push(`Respaldo : ${servidor.respaldos}/${plan.nombreDeRespaldo}`)
  lineas.push('')
  lineas.push('Pasos, en este orden:')
  lineas.push(`  1. Comprobar git: árbol limpio y HEAD con tag. ${git.ok ? 'Hoy: OK.' : 'Hoy: BLOQUEADO (ver abajo).'}`)
  lineas.push('  2. Compilar con el build seguro (modo production, solo base DEV, sin jsxDEV, sin .DS_Store).')
  lineas.push(`  3. Escribir version.json con commit ${git.commit ? git.commit.slice(0, 12) : '<commit>'}, tag ${plan.tag} y la fecha.`)
  lineas.push(`  4. Respaldar la carpeta remota en ${servidor.respaldos}/${plan.nombreDeRespaldo}.`)
  const cuenta = (grupo) => (grupos ? ` (${grupo.length} archivo${grupo.length === 1 ? '' : 's'})` : ' (se cuenta al compilar)')
  lineas.push(`  5. Subir, sin borrar nada, en cuatro tandas:`)
  lineas.push(`       a) assets, Workbox, íconos y datos${cuenta(grupos?.assets ?? [])}`)
  lineas.push(`       b) editores, index.html, manifest y version.json${cuenta(grupos?.paginas ?? [])}`)
  lineas.push(`       c) .htaccess, y se comprueba que el sitio siga contestando 200${cuenta(grupos?.servidor ?? [])}`)
  lineas.push(`       d) sw.js, lo último${cuenta(grupos?.serviceWorker ?? [])}`)
  lineas.push(`  6. Verificar el SHA-256 de lo subido pidiéndolo por HTTPS a ${servidor.urlPublica} (las imágenes, que la CDN recomprime, en el disco del servidor por SSH), y que ${RUTAS_A_COMPROBAR.join(', ')} contesten 200.`)
  if (opciones.sinPodar) {
    lineas.push('  7. Podar: OMITIDO (--sin-podar).')
  } else {
    lineas.push(
      `  7. Podar, solo si el paso 6 salió bien: dejar las últimas ${VERSIONES_DE_ASSETS_A_CONSERVAR} versiones de assets (las que referencian el index.html y los editores de la versión nueva y de los ${RESPALDOS_A_CONSERVAR} respaldos que quedan), dejar los últimos ${RESPALDOS_A_CONSERVAR} respaldos ${PREFIJO_RESPALDO}* y borrar los .DS_Store del servidor.`,
    )
  }
  if (grupos && grupos.omitidos.length > 0) {
    lineas.push('')
    lineas.push(`No se suben (basura del sistema): ${grupos.omitidos.join(', ')}`)
  }
  if (!git.ok) {
    lineas.push('')
    lineas.push('Una publicación real se negaría por esto:')
    for (const problema of git.problemas) lineas.push(`  - ${problema}`)
  }
  lineas.push('')
  if (opciones.dryRun) {
    lineas.push('Nada de lo anterior se ejecutó. Para publicar de verdad: node scripts/publicar-hostinger.mjs --ejecutar')
  }
  return lineas
}

// ------------------------------------------------------------------ orquestación

/**
 * Ejecuta (o simula) la publicación. Todo lo que toca algo de afuera entra por
 * `deps`, así los tests lo reemplazan con datos falsos y sin red:
 *   git(args)                     -> stdout
 *   construir()                   -> { outputDir }
 *   ssh(comandoRemoto)            -> stdout
 *   rsync({ origen, lista, destino }) -> void
 *   fetchFn(url, opciones)        -> Response
 *   ahora()                       -> Date
 *   log(linea)
 */
export async function publicar({ opciones, deps, servidor = SERVIDOR }) {
  const { log } = deps
  const git = await leerEstadoGit(deps.git)
  const configuracion = { ...servidor, host: opciones.host, usuario: opciones.usuario, puerto: opciones.puerto }

  if (opciones.dryRun) {
    let manifiesto = null
    let rutas = null
    if (opciones.salida) {
      rutas = await listarArchivos(opciones.salida)
      manifiesto = await construirManifiesto(opciones.salida)
    }
    const plan = armarPlan({ servidor: configuracion, opciones, git, fecha: deps.ahora(), manifiesto, rutas })
    for (const linea of formatearPlan(plan)) log(linea)
    return { dryRun: true, plan, bloqueado: !git.ok }
  }

  // ---- 1. git: antes de compilar, antes de tocar nada.
  if (!git.ok) {
    throw new PublicacionBloqueada(`Publicación bloqueada.\n  - ${git.problemas.join('\n  - ')}`)
  }
  const fecha = deps.ahora()
  const nombreBase = nombreDeRespaldo({ fecha, tag: git.tag })

  // ---- 2. build y version.json
  log('Paso 2 de 7: compilando con el build seguro…')
  const { outputDir } = await deps.construir()
  await writeFile(join(outputDir, 'version.json'), crearVersionJson({ commit: git.commit, tag: git.tag, fecha }))
  await normalizarPermisos(outputDir)
  const rutas = await listarArchivos(outputDir)
  const manifiesto = await construirManifiesto(outputDir)
  const grupos = clasificarArchivos(rutas)
  const plan = armarPlan({ servidor: configuracion, opciones, git, fecha, manifiesto, rutas })
  for (const linea of formatearPlan(plan)) log(linea)

  // ---- 3. respaldo
  log('Paso 4 de 7: respaldando la carpeta remota…')
  await deps.ssh(comandos.existeCarpeta(configuracion.carpeta)).catch(() => {
    throw new PublicacionBloqueada(`No existe la carpeta remota ${configuracion.carpeta}. No se tocó nada.`)
  })
  const existentes = analizarListadoDeRespaldos(await deps.ssh(comandos.listarRespaldos(configuracion.respaldos)))
  const nombre = nombreDeRespaldoLibre(nombreBase, existentes.map((respaldo) => respaldo.nombre))
  await deps.ssh(comandos.respaldoLibre({ respaldos: configuracion.respaldos, nombre })).catch(() => {
    throw new PublicacionBloqueada(`Ya existe el respaldo ${nombre}. No se tocó nada.`)
  })
  try {
    await deps.ssh(comandos.respaldar({ origen: configuracion.carpeta, respaldos: configuracion.respaldos, nombre }))
    await deps.ssh(comandos.comprobarRespaldo({ origen: configuracion.carpeta, respaldos: configuracion.respaldos, nombre }))
  } catch (error) {
    // Una cuota llena deja el respaldo a medias: se saca lo que se creó. Es
    // seguro porque respaldoLibre ya comprobó que ese nombre no existía.
    await deps.ssh(comandos.quitarRespaldo({ respaldos: configuracion.respaldos, nombre })).catch(() => undefined)
    throw new PublicacionBloqueada(
      `No se pudo hacer el respaldo (${error instanceof Error ? error.message.split('\n')[0] : error}). ` +
        'Puede ser la cuota de la cuenta, que comparte con cuyo.news. No se subió nada: el sitio sigue como estaba.',
    )
  }
  log(`  Respaldo listo: ${configuracion.respaldos}/${nombre}`)

  const comandoDeRestauracion = comandos.restaurar({ carpeta: configuracion.carpeta, respaldos: configuracion.respaldos, nombre })
  const ayudaParaVolver = () =>
    `Para volver a como estaba: ssh -p ${configuracion.puerto} ${configuracion.usuario}@${configuracion.host} ${shQuote(comandoDeRestauracion)}`

  // ---- 4. subida, en orden
  const carpetaDeListas = await mkdtemp(join(tmpdir(), 'publicar-hostinger-'))
  try {
    const tandas = [
      { clave: 'a', titulo: 'a) assets', archivos: grupos.assets },
      { clave: 'b', titulo: 'b) editores e index.html', archivos: grupos.paginas },
      { clave: 'c', titulo: 'c) .htaccess', archivos: grupos.servidor, despues: 'comprobar-sitio' },
      { clave: 'd', titulo: 'd) sw.js', archivos: grupos.serviceWorker },
    ]
    for (const tanda of tandas) {
      if (tanda.archivos.length === 0) continue
      log(`Paso 5 de 7: subiendo ${tanda.titulo} (${tanda.archivos.length})…`)
      const lista = join(carpetaDeListas, `lista-${tanda.clave}.txt`)
      await writeFile(lista, `${tanda.archivos.join('\n')}\n`)
      try {
        await deps.rsync({ origen: outputDir, lista, destino: configuracion.carpeta, archivos: tanda.archivos })
      } catch (error) {
        throw new PublicacionBloqueada(
          `Falló la subida de ${tanda.titulo}: ${error instanceof Error ? error.message : error}. ${ayudaParaVolver()}`,
        )
      }
      if (tanda.despues === 'comprobar-sitio') {
        // Un .htaccess con un error tira abajo todo el sitio: se mira ahora,
        // antes de subir sw.js.
        const caidas = await comprobarRutas({ baseUrl: configuracion.urlPublica, rutas: ['/', '/index.html'], fetchFn: deps.fetchFn })
        if (caidas.length > 0) {
          throw new PublicacionBloqueada(
            `Después de subir .htaccess el sitio no contesta bien (${caidas.map((falla) => `${falla.ruta}: ${falla.motivo}`).join(', ')}). No se subió sw.js. ${ayudaParaVolver()}`,
          )
        }
      }
    }
  } finally {
    await rm(carpetaDeListas, { recursive: true, force: true })
  }

  // ---- 5. verificación
  log('Paso 6 de 7: verificando SHA-256 (por HTTPS, y las imágenes por SSH)…')
  const porHttps = await verificarPorHttps({ baseUrl: configuracion.urlPublica, manifiesto, fetchFn: deps.fetchFn })
  const porSsh = await verificarPorSsh({ carpeta: configuracion.carpeta, manifiesto, ssh: deps.ssh })
  const fallas = [...porHttps.fallas, ...porSsh.fallas].sort((a, b) => (a.ruta < b.ruta ? -1 : 1))
  const rutasMalas = await comprobarRutas({ baseUrl: configuracion.urlPublica, fetchFn: deps.fetchFn })
  if (fallas.length > 0 || rutasMalas.length > 0) {
    const detalle = [...fallas, ...rutasMalas].slice(0, 10).map((falla) => `  - ${falla.ruta}: ${falla.motivo}`).join('\n')
    throw new PublicacionBloqueada(
      `La verificación falló (${fallas.length} archivos, ${rutasMalas.length} rutas). No se podó nada.\n${detalle}\n${ayudaParaVolver()}`,
    )
  }
  log(
    `  ${porHttps.verificados + porSsh.verificados} de ${porHttps.total + porSsh.total} archivos coinciden` +
      (porSsh.total > 0 ? ` (${porSsh.total} imágenes comparadas en el servidor por SSH)` : '') +
      ` y ${RUTAS_A_COMPROBAR.join(', ')} contestan 200.`,
  )
  const ejemploDeAsset = grupos.assets.find((ruta) => ruta.startsWith('assets/') && ruta.endsWith('.js'))
  const avisos = await revisarEncabezados({ baseUrl: configuracion.urlPublica, ejemploDeAsset, fetchFn: deps.fetchFn })
  for (const aviso of avisos) log(`  AVISO: ${aviso}`)

  // ---- 6. poda
  let poda = null
  if (opciones.sinPodar) {
    log('Paso 7 de 7: poda omitida (--sin-podar).')
  } else {
    log('Paso 7 de 7: podando assets y respaldos viejos…')
    poda = await podarServidor({ configuracion, deps, outputDir, nombreDeRespaldoNuevo: nombre })
  }

  log('')
  log(`Publicación terminada: ${git.tag} (${git.commit.slice(0, 12)}) en ${configuracion.urlPublica}`)
  const verificacion = { verificados: porHttps.verificados + porSsh.verificados, total: porHttps.total + porSsh.total, fallas: [], porHttps, porSsh }
  return { dryRun: false, plan, nombreDeRespaldo: nombre, verificacion, avisos, poda }
}

/** Lee del servidor lo que hace falta y aplica la poda. Solo se llama con la verificación aprobada. */
export async function podarServidor({ configuracion, deps, outputDir, nombreDeRespaldoNuevo }) {
  const { log } = deps
  const marcador = `@@territorios-${randomBytes(8).toString('hex')}@@`

  const respaldos = analizarListadoDeRespaldos(await deps.ssh(comandos.listarRespaldos(configuracion.respaldos)))
  const respaldosPlan = elegirRespaldosAPodar(respaldos, { conservar: RESPALDOS_A_CONSERVAR, protegido: nombreDeRespaldoNuevo })

  const existentes = String(await deps.ssh(comandos.listarAssets(configuracion.carpeta)))
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
  const textoDeAssets = separarVolcado(await deps.ssh(comandos.volcarTextoDeAssets({ carpeta: configuracion.carpeta, marcador })), marcador)

  // Versión 0: la que se acaba de subir (sale del paquete local).
  const archivosNuevos = new Map()
  for (const nombre of ARCHIVOS_SEMILLA) {
    try {
      archivosNuevos.set(nombre, await readFile(join(outputDir, nombre), 'utf8'))
    } catch {
      // editor-manzanas-embedded.html y otros pueden faltar en un paquete mínimo.
    }
  }
  const versiones = [{ nombre: 'nueva', archivos: archivosNuevos }]

  // Versiones anteriores: lo que había antes de cada publicación, o sea, los respaldos que se quedan.
  for (const respaldo of respaldosPlan.conservar) {
    const directorio = `${configuracion.respaldos}/${respaldo}`
    const volcado = separarVolcado(
      await deps.ssh(comandos.volcarArchivos({ directorio, nombres: [...ARCHIVOS_SEMILLA], marcador })),
      marcador,
    )
    versiones.push({ nombre: respaldo, archivos: volcado })
  }

  const assets = planDePodaDeAssets({ existentes, versiones, leerAsset: (nombre) => textoDeAssets.get(nombre) ?? null })
  log(`  Assets: ${existentes.length} en el servidor, se conservan ${existentes.length - assets.borrar.length}, se borran ${assets.borrar.length}.`)
  for (const version of assets.porVersion) log(`    - ${version.nombre}: ${version.assets} assets`)

  // Se borra en tandas para no armar una línea de comandos enorme.
  for (let inicio = 0; inicio < assets.borrar.length; inicio += 50) {
    await deps.ssh(comandos.borrarAssets({ carpeta: configuracion.carpeta, nombres: assets.borrar.slice(inicio, inicio + 50) }))
  }

  log(`  Respaldos ${PREFIJO_RESPALDO}*: se conservan ${respaldosPlan.conservar.join(', ')}; se borran ${respaldosPlan.borrar.length}.`)
  for (const nombre of respaldosPlan.borrar) {
    await deps.ssh(comandos.borrarRespaldo({ respaldos: configuracion.respaldos, nombre }))
    log(`    - borrado ${nombre}`)
  }

  await deps.ssh(comandos.borrarDsStore(configuracion.carpeta))
  log('  Archivos .DS_Store del servidor: borrados.')
  return { assets, respaldos: respaldosPlan }
}

// --------------------------------------------------------------- dependencias reales

export function crearDependenciasReales({ opciones, rootDir = RAIZ_DEL_PROYECTO } = {}) {
  const servidor = { ...SERVIDOR, host: opciones.host, usuario: opciones.usuario, puerto: opciones.puerto }
  return {
    git: async (args) => (await execFileAsync('git', args, { cwd: rootDir, encoding: 'utf8' })).stdout,
    construir: async () => buildDevSeguro({ rootDir }),
    ssh: async (comandoRemoto) =>
      (await execFileAsync('ssh', argumentosSsh(servidor, comandoRemoto), { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })).stdout,
    rsync: ({ origen, lista, destino }) =>
      new Promise((resolver, rechazar) => {
        const hijo = spawn('rsync', argumentosRsync({ servidor, origen, archivoDeLista: lista, destino }), { stdio: 'inherit' })
        hijo.on('error', (error) => rechazar(new Error(`No se pudo ejecutar rsync: ${error.message}`)))
        hijo.on('exit', (codigo) => (codigo === 0 ? resolver() : rechazar(new Error(`rsync terminó con código ${codigo}`))))
      }),
    fetchFn: (direccion, opcionesDeFetch) => fetch(direccion, { ...opcionesDeFetch, signal: AbortSignal.timeout(30_000) }),
    ahora: () => new Date(),
    log: (linea) => console.log(linea),
  }
}

async function main() {
  let opciones
  try {
    opciones = parsearArgumentos(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
    return
  }
  if (opciones.ayuda) {
    console.log(TEXTO_DE_AYUDA)
    return
  }
  try {
    const resultado = await publicar({ opciones, deps: crearDependenciasReales({ opciones }) })
    if (resultado.bloqueado) process.exitCode = 1
  } catch (error) {
    console.error(`\nPublicación detenida: ${error.message}`)
    process.exitCode = 1
  }
}

const invocadoComo = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invocadoComo === import.meta.url) {
  main()
}
