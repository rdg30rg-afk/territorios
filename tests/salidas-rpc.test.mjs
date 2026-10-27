import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { withCluster } from './helpers/postgres-local.mjs'

// Cluster local disposable: nunca usa Supabase, DEV remoto ni credenciales.
const port = process.env.TEST_POSTGRES_PORT || '55447'
const fixture = resolve('tests/sql/salidas-rpc.sql')

function session(cluster) {
  const child = cluster.spawnPsql()
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
  await withCluster({ prefix: 'territorios-salidas-rpc', port }, async (cluster) => {
    const sessions = []

    try {
      cluster.psql(['-f', fixture])

      const first = session(cluster)
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

      const second = session(cluster)
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
        () => cluster.query(
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
        cluster.query("select count(*) from public.salidas where title like 'rpc-lock-%'"),
        '2',
      )
      assert.equal(
        cluster.query("select count(*) from public.salidas where title like 'Campo forjado'"),
        '0',
      )
    } finally {
      for (const current of sessions) {
        if (current.child.exitCode === null) {
          current.child.kill('SIGTERM')
        }
      }
      await Promise.allSettled(sessions.map((current) => current.finished))
    }
  })
})
