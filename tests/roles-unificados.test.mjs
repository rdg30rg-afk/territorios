import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

// Cluster local descartable: nunca usa Supabase, DEV remoto ni credenciales.
const pgBin = process.env.TEST_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@15/bin'
const port = process.env.TEST_ROLES_UNIFICADOS_POSTGRES_PORT || '55449'
const fixture = resolve('tests/sql/roles-unificados.sql')

function run(binName, args) {
  try {
    return execFileSync(join(pgBin, binName), args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stdout = String(error.stdout || '')
    const stderr = String(error.stderr || '')
    throw new Error(
      `${binName} terminó con código ${error.status ?? 'desconocido'}\n${stderr}${stdout}`,
      { cause: error },
    )
  }
}

function makePsqlArgs(directory) {
  return [
    '-X',
    '-h',
    directory,
    '-p',
    port,
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ]
}

test('roles unificados: migración real, idempotencia, RLS y auditoría', () => {
  const directory = mkdtempSync(join(tmpdir(), 'territorios-roles-unificados-'))
  let started = false

  try {
    run('initdb', ['-D', join(directory, 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run('pg_ctl', [
      '-D',
      join(directory, 'data'),
      '-l',
      join(directory, 'server.log'),
      '-o',
      `-F -h '' -k ${directory} -p ${port}`,
      '-w',
      'start',
    ])
    started = true

    const output = run('psql', [...makePsqlArgs(directory), '-f', fixture])
    assert.match(output, /PASS: roles unificados, RLS y auditoría/)
  } finally {
    if (started) {
      run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'])
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
