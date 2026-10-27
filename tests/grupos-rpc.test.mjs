import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { withCluster } from './helpers/postgres-local.mjs'

// Cluster local disposable: nunca usa Supabase, DEV remoto ni credenciales.
const port = process.env.TEST_GRUPOS_POSTGRES_PORT || '55448'
const fixture = resolve('tests/sql/grupos.sql')

test('grupos RPC: código, confirmación, reserva del grupo y punto', async () => {
  await withCluster({ prefix: 'territorios-grupos-rpc', port }, (cluster) => {
    const output = cluster.psql(['-f', fixture])
    assert.match(output, /PASS: unirme, confirmar, reserva del grupo y punto/)
  })
})
