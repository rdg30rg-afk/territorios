import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

// Cluster local disposable: nunca usa Supabase, DEV remoto ni credenciales.
const pgBin = process.env.TEST_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@15/bin'
const port = process.env.TEST_POSTGRES_PORT || '55447'
const fixture = resolve('tests/sql/salidas-rpc.sql')

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

function query(directory, sql) {
  return run('psql', [...makePsqlArgs(directory, ['-At']), '-c', sql]).trim()
}

function session(directory) {
  const child = spawn(join(pgBin, 'psql'), makePsqlArgs(directory), {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  let error = ''
  const finished = new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolvePromise({ code, signal, output, error }))
  })
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    error += chunk
  })
  return { child, finished, output: () => output }
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 8000
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(message)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
}

test('salidas RPC: autorización, lote atómico, linaje y lock de territorio', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'territorios-salidas-rpc-'))
  let started = false
  const sessions = []

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

    run('psql', [...makePsqlArgs(directory), '-f', fixture])

    const first = session(directory)
    sessions.push(first)
    first.child.stdin.write(`
set application_name = 'salidas-rpc-lock-a';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select id from public.territorios
where id = '30000000-0000-0000-0000-000000000001'
for update;
\\echo TERRITORY_LOCKED
`)
    await waitUntil(
      () => first.output().includes('TERRITORY_LOCKED'),
      'La sesión A no tomó el lock de territorio',
    )

    const second = session(directory)
    sessions.push(second)
    second.child.stdin.end(`
set application_name = 'salidas-rpc-lock-b';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.crear_salida(
  'general', 'rpc-lock-b', '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', null, null, 'Punto lock B',
  -31.5375, -68.5364, '2026-09-20 12:00:00+00', null
);
commit;
`)

    await waitUntil(
      () => query(
        directory,
        "select count(*) from pg_stat_activity where application_name = 'salidas-rpc-lock-b' and wait_event_type = 'Lock'",
      ) === '1',
      'La segunda RPC no esperó el lock de territorio',
    )

    first.child.stdin.end(`
select public.crear_salida(
  'general', 'rpc-lock-a', '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', null, null, 'Punto lock A',
  -31.5375, -68.5364, '2026-09-20 11:00:00+00', null
);
commit;
`)

    const [firstResult, secondResult] = await Promise.all([first.finished, second.finished])
    assert.equal(firstResult.code, 0, firstResult.error)
    assert.equal(secondResult.code, 0, secondResult.error)
    assert.equal(
      query(directory, "select count(*) from public.salidas where title like 'rpc-lock-%'"),
      '2',
    )
    assert.equal(
      query(directory, "select count(*) from public.salidas where title like 'Campo forjado'"),
      '0',
    )
  } finally {
    for (const current of sessions) {
      if (current.child.exitCode === null) {
        current.child.kill('SIGTERM')
      }
    }
    await Promise.allSettled(sessions.map((current) => current.finished))
    if (started) {
      run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'])
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
