import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { withCluster } from './helpers/postgres-local.mjs'

// Cluster local disposable: nunca usa Supabase, DEV remoto ni credenciales.
const port = process.env.TEST_POSTGRES_PORT_PROGRAMA || '55448'
const fixture = resolve('tests/sql/programa-semana.sql')

test('la semana en la base: el seed entra entero, los permisos se respetan y se reemplaza', async () => {
  await withCluster({ prefix: 'territorios-programa-semana', port }, (cluster) => {
    // El fixture crea el esquema mínimo, aplica la migración y verifica adentro
    // con `raise exception`: si algo falla, psql sale con error y el test cae.
    const salida = cluster.psql(['-f', fixture])
    assert.ok(salida.includes('COMMIT') || salida.includes('commit'), 'El fixture tiene que terminar')

    const titulares = cluster.query('select count(*) from public.programa_titulares')
    assert.equal(titulares, '1', 'Después del reemplazo queda un solo titular')
  })
})
