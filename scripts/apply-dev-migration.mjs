import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

process.umask(0o077)
const ref = 'rkmioktcsgqqjshrlkmy'
if (process.env.SUPABASE_PROJECT_REF !== ref) throw new Error('Ref no autorizado: solo el clon DEV')
if (!process.env.SUPABASE_DB_PASSWORD_FILE) throw new Error('La contraseña debe leerse desde un archivo')
const migrations = path.resolve('supabase/migrations')
const file = path.resolve(process.argv[2] || '')
if (path.dirname(file) !== migrations || !file.endsWith('.sql')) throw new Error('Elegí un archivo de supabase/migrations')
const password = (await readFile(process.env.SUPABASE_DB_PASSWORD_FILE,'utf8')).trim()
if (!password) throw new Error('El archivo de contraseña está vacío')
const sql = await readFile(file)
const directory = path.resolve('backups/migrations', `${path.basename(file,'.sql')}-${Date.now()}`)
await mkdir(directory, { recursive: true, mode: 0o700 })
const output = await new Promise((resolve, reject) => {
  const proc = spawn('/opt/homebrew/opt/libpq/bin/psql', [
    '-X', '--dbname', `postgresql://postgres@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
    '--no-password', '--set', 'ON_ERROR_STOP=1', '--file', file,
  ], { env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c statement_timeout=60000 -c lock_timeout=5000' }, stdio: ['ignore','pipe','pipe'] })
  let stdout='', stderr=''
  proc.stdout.on('data', data => { stdout += data })
  proc.stderr.on('data', data => { stderr += data })
  proc.on('error', reject)
  proc.on('close', code => resolve({ code, stdout, stderr }))
})
const result = { projectRef: ref, file: path.basename(file), sha256: createHash('sha256').update(sql).digest('hex'), ...output, finishedAt: new Date().toISOString() }
await writeFile(path.join(directory,'result.json'), JSON.stringify(result,null,2), { mode: 0o600 })
console.log(JSON.stringify({ projectRef: ref, file: result.file, exitCode: output.code, logDirectory: directory }))
if (output.code !== 0) { console.error(output.stderr.replaceAll(password,'[redacted]')); process.exitCode = 1 }
