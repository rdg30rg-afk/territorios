import { spawn } from 'node:child_process'
import { readFile, readdir, rm, stat, mkdtemp } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadEnv } from 'vite'

export const DEV_SUPABASE_REF = 'rkmioktcsgqqjshrlkmy'
export const PRODUCTION_SUPABASE_REF = 'dwgvzcnarrjgqjotocdw'
export const DEV_SUPABASE_URL = `https://${DEV_SUPABASE_REF}.supabase.co`
export const BUILD_MODE = 'development'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICE_WORKER_CONTRACT =
  'Contrato requerido: vite.config.ts debe generar sw.js, precachear solo archivos presentes y mantener la exclusión de public/datos y banco-ato.html; no se modificó ese archivo.'

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
])

const PUBLISH_ONLY_DIRS = ['backups', 'respaldos', 'datos']
const PROTOTYPE_OUTPUT_FILES = [
  'banco-ato.html',
  'banco-tema.html',
  'bench-manzanas.html',
  'comparar-mapa.html',
  'demo-manzanas.html',
]

export class BuildSafetyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BuildSafetyError'
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeSupabaseUrl(value) {
  if (!nonEmptyString(value)) {
    throw new BuildSafetyError('Falta VITE_SUPABASE_URL para el build DEV seguro.')
  }

  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new BuildSafetyError('VITE_SUPABASE_URL no es una URL válida.')
  }

  if (parsed.protocol !== 'https:' || !/^.+\.supabase\.co$/i.test(parsed.hostname)) {
    throw new BuildSafetyError('VITE_SUPABASE_URL debe ser un host HTTPS de Supabase.')
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new BuildSafetyError('VITE_SUPABASE_URL no debe incluir ruta, query, hash ni credenciales.')
  }

  return parsed.origin.toLowerCase()
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

export function decodeJwtPayload(token) {
  if (!nonEmptyString(token)) {
    throw new BuildSafetyError('Falta VITE_SUPABASE_ANON_KEY.')
  }

  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new BuildSafetyError('VITE_SUPABASE_ANON_KEY debe ser un JWT público.')
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload no objeto')
    }
    return payload
  } catch {
    throw new BuildSafetyError('No se pudo leer el payload de VITE_SUPABASE_ANON_KEY.')
  }
}

function isSupabaseJwtPayload(payload) {
  return (
    payload?.iss?.toLowerCase?.() === 'supabase' ||
    nonEmptyString(payload?.ref) ||
    ['anon', 'authenticated', 'service_role'].includes(payload?.role)
  )
}

function runtimeTargetViolations(text) {
  const violations = []
  const jwtPattern = /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g

  for (const match of text.matchAll(jwtPattern)) {
    let payload
    try {
      payload = decodeJwtPayload(match[1])
    } catch {
      continue
    }
    if (!isSupabaseJwtPayload(payload)) continue
    if (payload.ref !== DEV_SUPABASE_REF || payload.role !== 'anon') {
      violations.push('un JWT Supabase con ref o rol no permitido')
      break
    }
  }

  if (/\bsb_secret_[A-Za-z0-9_-]+/i.test(text)) {
    violations.push('un token sb_secret_')
  }

  const supabaseUrlPattern = /https:\/\/([a-z0-9]{20})\.supabase\.co\b/gi
  for (const match of text.matchAll(supabaseUrlPattern)) {
    if (match[1].toLowerCase() !== DEV_SUPABASE_REF) {
      violations.push('una URL Supabase distinta de DEV')
      break
    }
  }

  return violations
}

function serviceRoleEnvEntries(env) {
  return Object.entries(env).filter(
    ([key, value]) =>
      nonEmptyString(value) && /service[ _-]?role/i.test(key),
  )
}

export function validateEnvironment(env) {
  const actualUrl = normalizeSupabaseUrl(env.VITE_SUPABASE_URL)
  const productionUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`

  if (actualUrl.includes(PRODUCTION_SUPABASE_REF) || actualUrl === productionUrl) {
    throw new BuildSafetyError(
      `Build bloqueado: VITE_SUPABASE_URL apunta al proyecto de producción ${PRODUCTION_SUPABASE_REF}.`,
    )
  }

  if (actualUrl !== DEV_SUPABASE_URL) {
    throw new BuildSafetyError(
      `Build bloqueado: VITE_SUPABASE_URL debe ser el proyecto DEV ${DEV_SUPABASE_REF}.`,
    )
  }

  if (env.VITE_APP_ENV !== 'development') {
    throw new BuildSafetyError('Build bloqueado: VITE_APP_ENV debe ser exactamente development.')
  }

  if (
    nonEmptyString(env.VITE_PRODUCTION_SUPABASE_REF) &&
    env.VITE_PRODUCTION_SUPABASE_REF !== PRODUCTION_SUPABASE_REF
  ) {
    throw new BuildSafetyError(
      'Build bloqueado: VITE_PRODUCTION_SUPABASE_REF no coincide con la referencia de producción protegida.',
    )
  }

  const jwtPayload = decodeJwtPayload(env.VITE_SUPABASE_ANON_KEY)
  if (jwtPayload.ref !== DEV_SUPABASE_REF) {
    throw new BuildSafetyError(
      `Build bloqueado: el JWT público no pertenece al proyecto DEV ${DEV_SUPABASE_REF}.`,
    )
  }

  if (jwtPayload.role !== 'anon') {
    throw new BuildSafetyError('Build bloqueado: VITE_SUPABASE_ANON_KEY no tiene rol JWT anon.')
  }

  const publicServiceRoleKeys = serviceRoleEnvEntries(env)
    .filter(([key]) => key.startsWith('VITE_'))
    .map(([key]) => key)
  if (publicServiceRoleKeys.length > 0) {
    throw new BuildSafetyError(
      `Build bloqueado: una variable VITE_* expone un service role (${publicServiceRoleKeys.join(', ')}).`,
    )
  }

  return {
    supabaseUrl: actualUrl,
    supabaseRef: jwtPayload.ref,
    jwtRole: jwtPayload.role,
  }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)))
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath })
    }
  }

  return files
}

async function readRuntimeTextFiles(outputDir) {
  const files = await listFiles(outputDir)
  const textFiles = []

  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file.relativePath).toLowerCase())) continue
    textFiles.push({
      ...file,
      text: await readFile(file.absolutePath, 'utf8'),
    })
  }

  return textFiles
}

function normalizeOutputReference(value) {
  if (!nonEmptyString(value)) return null
  const trimmed = value.trim()
  if (/^(?:[a-z]+:|data:|#)/i.test(trimmed)) return null

  const withoutQuery = trimmed.split(/[?#]/, 1)[0]
  const clean = withoutQuery.replace(/^\.\//, '').replace(/^\/+/, '')
  if (!clean || clean === '.' || clean.includes('..')) return null
  return clean
}

function isStaticOutputReference(reference) {
  return (
    reference.startsWith('assets/') ||
    reference.startsWith('ato/') ||
    reference.startsWith('pwa/') ||
    /(?:^|\/)[^/]+\.[A-Za-z0-9]{1,12}$/.test(reference)
  )
}

function htmlLocalReferences(text) {
  const references = new Set()
  const pattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi
  for (const match of text.matchAll(pattern)) {
    const reference = normalizeOutputReference(match[1])
    if (reference && isStaticOutputReference(reference)) references.add(reference)
  }
  return references
}

function atoReferences(text) {
  const references = new Set()
  const pattern = /\/?ato\/[A-Za-z0-9._~!$&'*+,;=:@%/-]+/g
  for (const match of text.matchAll(pattern)) {
    const reference = match[0]
      .replace(/^\/+/, '')
      .replace(/[),;\]}>'"`]+$/, '')
    if (reference) references.add(reference)
  }
  return references
}

function serviceWorkerUrls(text) {
  const urls = []
  const pattern = /["']?url["']?\s*:\s*["']([^"']+)["']/g
  for (const match of text.matchAll(pattern)) {
    const url = normalizeOutputReference(match[1])
    if (url) urls.push(url)
  }
  return urls
}

function outputPath(outputDir, relativePath) {
  const absolutePath = resolve(outputDir, relativePath)
  const normalizedRoot = resolve(outputDir)
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}${sep}`)) {
    throw new BuildSafetyError(`Ruta de paquete fuera del directorio temporal: ${relativePath}.`)
  }
  return absolutePath
}

async function removeEmptyDirectories(directory) {
  if (!(await pathExists(directory))) return
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirectories(join(directory, entry.name))
  }

  const remaining = await readdir(directory)
  if (remaining.length === 0) await rm(directory, { recursive: true, force: true })
}

export async function prunePublishableOutput(outputDir) {
  const removed = []

  for (const directory of PUBLISH_ONLY_DIRS) {
    const relativePath = directory
    const absolutePath = outputPath(outputDir, relativePath)
    if (await pathExists(absolutePath)) {
      await rm(absolutePath, { recursive: true, force: true })
      removed.push(relativePath)
    }
  }

  for (const file of PROTOTYPE_OUTPUT_FILES) {
    const absolutePath = outputPath(outputDir, file)
    if (await pathExists(absolutePath)) {
      await rm(absolutePath, { force: true })
      removed.push(file)
    }
  }

  const runtimeFiles = await readRuntimeTextFiles(outputDir)
  const referencedAtoFiles = new Set()
  for (const file of runtimeFiles) {
    for (const reference of atoReferences(file.text)) referencedAtoFiles.add(reference)
  }

  const atoDirectory = outputPath(outputDir, 'ato')
  if (await pathExists(atoDirectory)) {
    const atoFiles = await listFiles(atoDirectory)
    if (referencedAtoFiles.size === 0) {
      await rm(atoDirectory, { recursive: true, force: true })
      removed.push('ato')
    } else {
      for (const file of atoFiles) {
        const relativePath = file.relativePath.split(sep).join('/')
        if (referencedAtoFiles.has(`ato/${relativePath}`)) continue
        await rm(file.absolutePath, { force: true })
        removed.push(`ato/${relativePath}`)
      }
      await removeEmptyDirectories(atoDirectory)
    }
  }

  return { removed, referencedAtoFiles: [...referencedAtoFiles].sort() }
}

export async function assertAppEditorEntries(outputDir, expectedSupabaseUrl = DEV_SUPABASE_URL) {
  const appPath = outputPath(outputDir, 'index.html')
  const editorPath = outputPath(outputDir, 'editor-manzanas.html')
  if (!(await pathExists(appPath))) throw new BuildSafetyError('El paquete no genera la app en /index.html.')
  if (!(await pathExists(editorPath))) {
    throw new BuildSafetyError('El paquete no genera el editor en /editor-manzanas.html.')
  }

  const appHtml = await readFile(appPath, 'utf8')
  const editorHtml = await readFile(editorPath, 'utf8')
  const appReferences = htmlLocalReferences(appHtml)
  const editorReferences = htmlLocalReferences(editorHtml)

  if (![...appReferences].some((reference) => reference.startsWith('assets/'))) {
    throw new BuildSafetyError('La URL efectiva de la app no tiene un entrypoint local en /assets/.')
  }

  const referencedFiles = new Map()
  for (const reference of new Set([...appReferences, ...editorReferences])) {
    const absolutePath = outputPath(outputDir, reference)
    if (!(await pathExists(absolutePath))) {
      throw new BuildSafetyError(`La entrada app/editor referencia un archivo inexistente: ${reference}.`)
    }
    if (TEXT_EXTENSIONS.has(extname(reference).toLowerCase())) {
      referencedFiles.set(reference, await readFile(absolutePath, 'utf8'))
    }
  }

  const appRuntime = [appHtml]
  for (const reference of appReferences) {
    if (referencedFiles.has(reference)) appRuntime.push(referencedFiles.get(reference))
  }
  if (!appRuntime.some((text) => text.includes(expectedSupabaseUrl))) {
    throw new BuildSafetyError(
      `La URL efectiva de la app no contiene el proyecto DEV ${DEV_SUPABASE_REF}.`,
    )
  }

  const editorRuntime = [editorHtml]
  for (const reference of editorReferences) {
    if (referencedFiles.has(reference)) editorRuntime.push(referencedFiles.get(reference))
  }
  if (editorRuntime.some((text) => text.includes('import.meta.env'))) {
    throw new BuildSafetyError('La URL efectiva del editor quedó sin reemplazar por Vite (import.meta.env).')
  }
  if (!editorRuntime.some((text) => text.includes(expectedSupabaseUrl))) {
    throw new BuildSafetyError(
      `La URL efectiva del editor no contiene el proyecto DEV ${DEV_SUPABASE_REF}.`,
    )
  }

  return {
    app: '/',
    editor: '/editor-manzanas.html',
    supabaseUrl: expectedSupabaseUrl,
  }
}

export async function assertRuntimeSecretsAbsent(outputDir, env = {}) {
  const runtimeFiles = await readRuntimeTextFiles(outputDir)
  const serviceEntries = serviceRoleEnvEntries(env)
  const productionUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`

  for (const file of runtimeFiles) {
    if (file.text.includes(productionUrl)) {
      throw new BuildSafetyError(
        `El runtime contiene la URL de producción en ${file.relativePath}; build cancelado.`,
      )
    }
    if (/\bservice[_ -]?role\b/i.test(file.text)) {
      throw new BuildSafetyError(
        `El runtime contiene una referencia service role en ${file.relativePath}; build cancelado.`,
      )
    }

    const targetViolations = runtimeTargetViolations(file.text)
    if (targetViolations.length > 0) {
      throw new BuildSafetyError(
        `El runtime contiene ${targetViolations[0]} en ${file.relativePath}; build cancelado.`,
      )
    }

    for (const [key, value] of serviceEntries) {
      if (file.text.includes(value)) {
        throw new BuildSafetyError(
          `El runtime contiene el valor de ${key} en ${file.relativePath}; build cancelado.`,
        )
      }
    }
  }

  return { checkedFiles: runtimeFiles.length }
}

export async function assertServiceWorkerConsistent(outputDir) {
  const serviceWorkerPath = outputPath(outputDir, 'sw.js')
  if (!(await pathExists(serviceWorkerPath))) {
    throw new BuildSafetyError(`No se generó sw.js. ${SERVICE_WORKER_CONTRACT}`)
  }

  const rootFiles = await readdir(outputDir)
  if (!rootFiles.some((file) => /^workbox-.+\.js$/.test(file))) {
    throw new BuildSafetyError(`Falta el runtime Workbox del service worker. ${SERVICE_WORKER_CONTRACT}`)
  }
  for (const required of ['manifest.webmanifest', 'registerSW.js']) {
    if (!(await pathExists(outputPath(outputDir, required)))) {
      throw new BuildSafetyError(`Falta ${required} junto con el service worker. ${SERVICE_WORKER_CONTRACT}`)
    }
  }
  const registerServiceWorkerText = await readFile(outputPath(outputDir, 'registerSW.js'), 'utf8')
  if (!/register\(\s*["']\/?sw\.js["']/.test(registerServiceWorkerText)) {
    throw new BuildSafetyError(`registerSW.js no registra sw.js. ${SERVICE_WORKER_CONTRACT}`)
  }

  const serviceWorkerText = await readFile(serviceWorkerPath, 'utf8')
  const precacheUrls = serviceWorkerUrls(serviceWorkerText)
  if (!precacheUrls.includes('index.html') || !precacheUrls.includes('editor-manzanas.html')) {
    throw new BuildSafetyError(
      `El service worker no precachea de forma consistente app y editor. ${SERVICE_WORKER_CONTRACT}`,
    )
  }
  if (!/editor-manzanas/i.test(serviceWorkerText) || !/denylist/i.test(serviceWorkerText)) {
    throw new BuildSafetyError(
      `El service worker no conserva la exclusión de fallback para el editor. ${SERVICE_WORKER_CONTRACT}`,
    )
  }

  for (const relativePath of precacheUrls) {
    if (relativePath.startsWith('datos/') || relativePath === 'banco-ato.html') {
      throw new BuildSafetyError(
        `El service worker todavía precachea un archivo excluido (${relativePath}). ${SERVICE_WORKER_CONTRACT}`,
      )
    }
    if (!(await pathExists(outputPath(outputDir, relativePath)))) {
      throw new BuildSafetyError(
        `El service worker referencia un archivo ausente (${relativePath}). ${SERVICE_WORKER_CONTRACT}`,
      )
    }
  }

  return { serviceWorker: 'sw.js', precacheCount: precacheUrls.length }
}

function runProcess(command, args, options) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
    })
    child.on('error', rejectProcess)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveProcess()
        return
      }
      rejectProcess(
        new BuildSafetyError(
          `El build DEV terminó con ${signal ? `señal ${signal}` : `código ${code ?? 'desconocido'}`}.`,
        ),
      )
    })
  })
}

export async function buildDevSeguro({ rootDir = PROJECT_ROOT } = {}) {
  const env = loadEnv(BUILD_MODE, rootDir, '')
  const environment = validateEnvironment(env)
  const outputDir = await mkdtemp(join(tmpdir(), 'territorios-build-dev-'))
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const childEnv = { ...process.env }

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('VITE_')) childEnv[key] = value
  }
  childEnv.NODE_ENV = BUILD_MODE

  try {
    await runProcess(
      npmCommand,
      ['run', 'build:development', '--', '--outDir', outputDir],
      { cwd: rootDir, env: childEnv },
    )
    const pruned = await prunePublishableOutput(outputDir)
    const entries = await assertAppEditorEntries(outputDir, environment.supabaseUrl)
    const runtime = await assertRuntimeSecretsAbsent(outputDir, env)
    const serviceWorker = await assertServiceWorkerConsistent(outputDir)

    return {
      outputDir,
      environment,
      entries,
      pruned,
      runtime,
      serviceWorker,
    }
  } catch (error) {
    if (error instanceof BuildSafetyError) {
      throw new BuildSafetyError(`${error.message} Salida temporal: ${outputDir}`)
    }
    throw error
  }
}

async function main() {
  const result = await buildDevSeguro()
  console.log('Build DEV seguro OK.')
  console.log(`Supabase efectivo: ${result.environment.supabaseUrl} (${result.environment.jwtRole})`)
  console.log('Entradas verificadas: / y /editor-manzanas.html.')
  console.log(`Service worker consistente: ${result.serviceWorker.precacheCount} archivos precacheados.`)
  console.log(`Salida temporal publicable: ${result.outputDir}`)
  if (result.pruned.removed.length > 0) {
    const namedExclusions = result.pruned.removed.filter(
      (path) => !path.startsWith('ato/'),
    )
    const atoRemoved = result.pruned.removed.length - namedExclusions.length
    const summary = namedExclusions.join(', ') || 'Ato no referenciado'
    console.log(
      `Exclusiones aplicadas solo al paquete (${result.pruned.removed.length}): ${summary}${atoRemoved > 0 ? `; ${atoRemoved} recursos Ato no referenciados` : ''}`,
    )
  }
  if (result.pruned.referencedAtoFiles.length > 0) {
    console.log(
      `Ato conservado de forma acotada por referencias runtime/service worker: ${result.pruned.referencedAtoFiles.length} archivos.`,
    )
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Build DEV seguro bloqueado: ${error.message}`)
    process.exitCode = 1
  })
}
