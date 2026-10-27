import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { withCluster } from './helpers/postgres-local.mjs'

// Cluster local descartable: nunca usa Supabase, DEV remoto ni credenciales.
const port = process.env.TEST_ROLES_UNIFICADOS_POSTGRES_PORT || '55449'
const fixture = resolve('tests/sql/roles-unificados.sql')

test('roles unificados: migración real, idempotencia, RLS y auditoría', async () => {
  await withCluster({ prefix: 'territorios-roles-unificados', port }, (cluster) => {
    const output = cluster.psql(['-f', fixture])
    assert.match(output, /PASS: roles unificados, RLS y auditoría/)
  })
})
