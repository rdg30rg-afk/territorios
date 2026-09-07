// Compila una migración contra DEV dentro de una transacción que siempre revierte.
// No acepta producción ni otra ruta de contraseña.
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const DEV_REF = 'rkmioktcsgqqjshrlkmy'
const PROD_REF = 'dwgvzcnarrjgqjotocdw'
const PASSWORD_FILE = '/tmp/territorios-dev-db-password'
const projectRef = process.env.SUPABASE_PROJECT_REF
const passwordFile = process.env.SUPABASE_DB_PASSWORD_FILE
const migrationsDirectory = path.resolve('supabase/migrations')
const migrationFile = path.resolve(process.argv[2] ?? '')

if (projectRef === PROD_REF) throw new Error('Producción está bloqueada.')
if (projectRef !== DEV_REF) throw new Error('Esta verificación acepta únicamente el clon DEV.')
if (passwordFile !== PASSWORD_FILE) {
  throw new Error(`La contraseña DEV debe venir de ${PASSWORD_FILE}.`)
}
if (path.dirname(migrationFile) !== migrationsDirectory || !migrationFile.endsWith('.sql')) {
  throw new Error('Elegí un archivo SQL dentro de supabase/migrations.')
}

const password = (await readFile(passwordFile, 'utf8')).trim()
if (!password) throw new Error('El archivo de contraseña DEV está vacío.')
const source = await readFile(migrationFile, 'utf8')
if (!/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(source) || !/commit\s*;\s*$/i.test(source)) {
  throw new Error('La migración debe tener una transacción exterior BEGIN/COMMIT.')
}

const body = source
  .replace(/^(\s*(?:--[^\n]*\n\s*)*)begin\s*;/i, '$1')
  .replace(/commit\s*;\s*$/i, '')
const sql = `begin;\n${body}\nrollback;\n`

const result = await new Promise((resolve, reject) => {
  const child = spawn('/opt/homebrew/opt/libpq/bin/psql', [
    '-X',
    '--dbname', `postgresql://postgres@db.${DEV_REF}.supabase.co:5432/postgres?sslmode=require`,
    '--no-password',
    '--set', 'ON_ERROR_STOP=1',
  ], {
    env: {
      ...process.env,
      PGPASSWORD: password,
      PGCONNECT_TIMEOUT: '15',
      PGOPTIONS: '-c statement_timeout=60000 -c lock_timeout=5000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (code) => resolve({ code, stdout, stderr }))
  child.stdin.end(sql)
})

if (result.code !== 0) {
  process.stderr.write(result.stderr.replaceAll(password, '[redacted]'))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    projectRef: DEV_REF,
    migration: path.basename(migrationFile),
    compiled: true,
    rolledBack: true,
  }))
}
