import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

// Cluster local disposable: nunca usa Supabase, DEV remoto ni credenciales.
const pgBin = process.env.TEST_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@15/bin'
const port = process.env.TEST_GRUPOS_POSTGRES_PORT || '55448'
const fixture = resolve('tests/sql/grupos.sql')

function run(binName, args) {
  return execFileSync(join(pgBin, binName), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function makePsqlArgs(directory, extra = []) {
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
    ...extra,
  ]
}

test('grupos RPC: código, confirmación, reserva del grupo y punto', () => {
  const directory = mkdtempSync(join(tmpdir(), 'territorios-grupos-rpc-'))
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
    assert.match(output, /PASS: unirme, confirmar, reserva del grupo y punto/)
  } finally {
    if (started) {
      run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'])
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
