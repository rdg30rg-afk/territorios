// Postgres local descartable para los tests de SQL.
//
// Nunca usa Supabase, una base remota ni credenciales: cada llamada levanta un
// cluster nuevo en un directorio temporal, escucha solo en un socket Unix y se
// borra al terminar.
//
// Dónde busca los binarios (initdb, pg_ctl, psql), en este orden:
//   1. PG_BIN (o TEST_POSTGRES_BIN, el nombre viejo). Si está definida y no
//      sirve, falla: no se cae silenciosamente a otra versión.
//   2. Postgres 15 en las rutas conocidas: Homebrew (Apple Silicon e Intel) y
//      el paquete de Debian/Ubuntu (/usr/lib/postgresql/15/bin).
//   3. Lo que haya en el PATH y el `pg_config --bindir` del PATH.
//   4. Otras versiones instaladas en esas mismas rutas.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'

const BINARIOS_NECESARIOS = ['initdb', 'pg_ctl', 'psql']
const VERSIONES_ALTERNATIVAS = [17, 16, 14]

function tieneBinarios(directorio) {
  return BINARIOS_NECESARIOS.every((nombre) => existsSync(join(directorio, nombre)))
}

function binDeConfiguracion() {
  try {
    const salida = execFileSync('pg_config', ['--bindir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return salida ? [salida] : []
  } catch {
    return []
  }
}

function candidatos() {
  const enElPath = (process.env.PATH || '').split(delimiter).filter(Boolean)
  return [
    '/opt/homebrew/opt/postgresql@15/bin',
    '/usr/local/opt/postgresql@15/bin',
    '/usr/lib/postgresql/15/bin',
    ...enElPath,
    ...binDeConfiguracion(),
    ...VERSIONES_ALTERNATIVAS.flatMap((version) => [
      `/opt/homebrew/opt/postgresql@${version}/bin`,
      `/usr/local/opt/postgresql@${version}/bin`,
      `/usr/lib/postgresql/${version}/bin`,
    ]),
  ]
}

let binCacheado

/** Directorio con initdb, pg_ctl y psql. Falla con un mensaje que dice qué hacer. */
export function findPgBin() {
  if (binCacheado) return binCacheado

  const explicito = process.env.PG_BIN || process.env.TEST_POSTGRES_BIN
  if (explicito) {
    if (!tieneBinarios(explicito)) {
      throw new Error(
        `PG_BIN apunta a ${explicito}, pero ahí no están ${BINARIOS_NECESARIOS.join(', ')}. ` +
          'Definila con el directorio bin de PostgreSQL 15 (o sacá la variable para que lo busque solo).',
      )
    }
    binCacheado = explicito
    return binCacheado
  }

  const encontrado = candidatos().find(tieneBinarios)
  if (!encontrado) {
    throw new Error(
      `No encontré PostgreSQL (${BINARIOS_NECESARIOS.join(', ')}). ` +
        'Instalá PostgreSQL 15 (brew install postgresql@15, o apt install postgresql-15) ' +
        'o definí PG_BIN con su directorio bin.',
    )
  }
  binCacheado = encontrado
  return binCacheado
}

function localesInstalados() {
  try {
    return execFileSync('locale', ['-a'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((nombre) => normalizarLocale(nombre))
  } catch {
    return []
  }
}

// `locale -a` lista "en_US.utf8" en Linux y "en_US.UTF-8" en macOS.
function normalizarLocale(nombre) {
  return nombre.trim().toLowerCase().replace('utf-8', 'utf8')
}

let localeCacheado

/**
 * Locale para los procesos de Postgres. En macOS, sin LC_ALL válido el
 * postmaster aborta con "se volvió multi-hilo durante la partida".
 * Respeta un LC_ALL ya definido; si no, elige uno que exista en esta máquina.
 */
export function pgLocale() {
  if (process.env.LC_ALL) return process.env.LC_ALL
  if (localeCacheado) return localeCacheado
  const instalados = localesInstalados()
  localeCacheado =
    ['en_US.UTF-8', 'C.UTF-8'].find((nombre) => instalados.includes(normalizarLocale(nombre))) || 'C'
  return localeCacheado
}

/** Entorno de los procesos hijo: el actual más LC_ALL y LANG definidos. */
export function pgEnv() {
  const locale = pgLocale()
  return { ...process.env, LC_ALL: locale, LANG: process.env.LANG || locale }
}

function fallo(nombre, error) {
  const salida = `${error.stderr || ''}${error.stdout || ''}`.trim()
  return new Error(`${nombre} terminó con código ${error.status ?? 'desconocido'}\n${salida}`, {
    cause: error,
  })
}

/** Corre un binario de Postgres y devuelve su stdout. Si falla, el error trae stderr y stdout. */
export function run(binName, args, options = {}) {
  try {
    return execFileSync(join(findPgBin(), binName), args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
      env: pgEnv(),
    })
  } catch (error) {
    throw fallo(binName, error)
  }
}

/** Igual que `run` pero devuelve el proceso, para sesiones concurrentes. */
export function spawnPg(binName, args, options = {}) {
  return spawn(join(findPgBin(), binName), args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
    env: pgEnv(),
  })
}

function colaDelLog(directorio) {
  try {
    return readFileSync(join(directorio, 'server.log'), 'utf8').trim().split('\n').slice(-15).join('\n')
  } catch {
    return '(sin server.log)'
  }
}

/**
 * Levanta un cluster descartable, llama a `usar(cluster)` y siempre lo apaga y
 * borra, aunque `usar` falle. `cluster` trae:
 *   directory, port
 *   psqlArgs(extra)  argumentos de psql contra este cluster
 *   psql(extra)      corre psql y devuelve stdout (ej. ['-f', archivo])
 *   query(sql)       corre una consulta y devuelve el texto sin adornos
 *   spawnPsql()      sesión interactiva de psql (stdin/stdout abiertos)
 */
export async function withCluster({ prefix, port }, usar) {
  const directory = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const data = join(directory, 'data')
  let started = false

  const psqlArgs = (extra = []) => [
    '-X',
    '-h',
    directory,
    '-p',
    String(port),
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    ...extra,
  ]
  const cluster = {
    directory,
    port,
    psqlArgs,
    psql: (extra = []) => run('psql', psqlArgs(extra)),
    query: (sql) => run('psql', psqlArgs(['-At', '-c', sql])).trim(),
    spawnPsql: () => spawnPg('psql', psqlArgs()),
  }

  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'])
    try {
      run('pg_ctl', [
        '-D',
        data,
        '-l',
        join(directory, 'server.log'),
        '-o',
        `-F -h '' -k ${directory} -p ${port}`,
        '-w',
        'start',
      ])
    } catch (error) {
      error.message += `\n--- server.log ---\n${colaDelLog(directory)}`
      throw error
    }
    started = true
    return await usar(cluster)
  } finally {
    try {
      if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
