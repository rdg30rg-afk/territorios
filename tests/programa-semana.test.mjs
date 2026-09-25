import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

// Cluster local disposable: nunca usa Supabase, DEV remoto ni credenciales.
const pgBin = process.env.TEST_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@15/bin'
const port = process.env.TEST_POSTGRES_PORT_PROGRAMA || '55448'
const fixture = resolve('tests/sql/programa-semana.sql')

function run(binName, args) {
  return execFileSync(join(pgBin, binName), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function makePsqlArgs(directory, extra = []) {
  return ['-X', '-h', directory, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...extra]
}

test('la semana en la base: el seed entra entero, los permisos se respetan y se reemplaza', () => {
  const directory = mkdtempSync(join(tmpdir(), 'territorios-programa-semana-'))
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

    // El fixture crea el esquema mínimo, aplica la migración y verifica adentro
    // con `raise exception`: si algo falla, psql sale con error y el test cae.
    const salida = run('psql', [...makePsqlArgs(directory), '-f', fixture])
    assert.ok(salida.includes('COMMIT') || salida.includes('commit'), 'El fixture tiene que terminar')

    const titulares = run('psql', [...makePsqlArgs(directory, ['-At']), '-c', 'select count(*) from public.programa_titulares']).trim()
    assert.equal(titulares, '1', 'Después del reemplazo queda un solo titular')
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'])
      } catch {
        /* Si el cluster ya estaba abajo, no importa. */
      }
    }
  }
})
