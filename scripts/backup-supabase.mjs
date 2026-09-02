import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const projectRef = process.env.SUPABASE_PROJECT_REF
const serviceRoleKeyFile = process.env.SUPABASE_SERVICE_ROLE_KEY_FILE
const outputDir = process.env.SUPABASE_BACKUP_DIR

if (!projectRef || !serviceRoleKeyFile || !outputDir) {
  throw new Error(
    'Faltan SUPABASE_PROJECT_REF, SUPABASE_SERVICE_ROLE_KEY_FILE o SUPABASE_BACKUP_DIR.',
  )
}

const serviceRoleKey = (await readFile(serviceRoleKeyFile, 'utf8')).trim()
const baseUrl = `https://${projectRef}.supabase.co`
const repoRoot = path.resolve(import.meta.dirname, '..')
const publicTables = [
  'pending_users',
  'profiles',
  'conductores',
  'territorios',
  'grupos_servicio',
  'user_module_access',
  'territorio_manzanas',
  'territorio_personal_reservas',
  'salidas',
]

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(`${response.status} ${response.statusText}: ${body}`)
  }

  return response
}

async function writeJson(relativePath, value) {
  const destination = path.join(outputDir, relativePath)
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

async function exportTable(table) {
  const rows = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const response = await request(
      `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Profile': 'public',
          Prefer: 'count=exact',
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      },
    )
    const page = await response.json()
    rows.push(...page)

    if (page.length < pageSize) break
  }

  await writeJson(`public/${table}.json`, rows)
  return rows.length
}

function sanitizeAuthUser(user) {
  return Object.fromEntries(
    Object.entries(user).filter(
      ([key]) => !/(password|token|secret)/i.test(key),
    ),
  )
}

async function exportAuthUsers() {
  const users = []

  for (let page = 1; ; page += 1) {
    const response = await request(
      `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`,
    )
    const payload = await response.json()
    const pageUsers = payload.users ?? []
    users.push(...pageUsers.map(sanitizeAuthUser))

    if (pageUsers.length < 1000) break
  }

  await writeJson('auth/users.json', users)
  return users.length
}

async function listStorageObjects(bucketId, prefix = '') {
  const objects = []

  for (let offset = 0; ; offset += 100) {
    const response = await request(
      `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucketId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
      },
    )
    const page = await response.json()
    objects.push(...page)
    if (page.length < 100) break
  }

  return objects
}

async function exportStoragePrefix(bucketId, prefix = '') {
  const objects = await listStorageObjects(bucketId, prefix)
  let fileCount = 0

  for (const object of objects) {
    const objectPath = prefix ? `${prefix}/${object.name}` : object.name

    if (object.id === null) {
      fileCount += await exportStoragePrefix(bucketId, objectPath)
      continue
    }

    const response = await request(
      `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucketId)}/${objectPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
    )
    const destination = path.resolve(outputDir, 'storage', bucketId, objectPath)
    const storageRoot = path.resolve(outputDir, 'storage', bucketId)

    if (!destination.startsWith(`${storageRoot}${path.sep}`)) {
      throw new Error(`Ruta de Storage insegura: ${objectPath}`)
    }

    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await writeFile(destination, Buffer.from(await response.arrayBuffer()), { mode: 0o600 })
    fileCount += 1
  }

  return fileCount
}

async function exportStorage() {
  const response = await request(`${baseUrl}/storage/v1/bucket`)
  const buckets = await response.json()
  await writeJson('storage/buckets.json', buckets)
  const counts = {}

  for (const bucket of buckets) {
    counts[bucket.id] = await exportStoragePrefix(bucket.id)
  }

  return { buckets: buckets.length, filesByBucket: counts }
}

async function listFiles(directory, prefix = '') {
  const files = []

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name)
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files.sort()
}

await mkdir(outputDir, { recursive: true, mode: 0o700 })

const tableCounts = {}
for (const table of publicTables) {
  tableCounts[table] = await exportTable(table)
  console.log(`${table}: ${tableCounts[table]}`)
}

const authUsers = await exportAuthUsers()
console.log(`auth.users sanitizados: ${authUsers}`)

const storage = await exportStorage()
console.log(`storage buckets: ${storage.buckets}`)

await mkdir(path.join(outputDir, 'schema'), { recursive: true, mode: 0o700 })
await cp(path.join(repoRoot, 'supabase', 'schema.sql'), path.join(outputDir, 'schema', 'schema.sql'))

const migrationsSource = path.join(repoRoot, 'supabase', 'migrations')
try {
  if ((await stat(migrationsSource)).isDirectory()) {
    await cp(migrationsSource, path.join(outputDir, 'schema', 'migrations'), { recursive: true })
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const checksums = {}
for (const relativePath of await listFiles(outputDir)) {
  if (relativePath === 'manifest.json') continue
  const content = await readFile(path.join(outputDir, relativePath))
  checksums[relativePath] = createHash('sha256').update(content).digest('hex')
}

await writeJson('manifest.json', {
  format: 'territorios-supabase-application-backup-v1',
  projectRef,
  createdAt: new Date().toISOString(),
  publicTables: tableCounts,
  authUsers,
  storage,
  checksums,
  notes: [
    'Los usuarios Auth se exportan sin contraseñas, tokens ni secretos.',
    'schema.sql y migrations son la copia local versionada; no un pg_dump del catálogo vivo.',
  ],
})

console.log(`Backup completo: ${outputDir}`)
