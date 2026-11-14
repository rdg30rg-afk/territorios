import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { run, withCluster } from './helpers/postgres-local.mjs'

// Migraciones de noviembre de 2026 (borrar_salida, cambiar de grupo, reservas,
// cobertura de administradores, lectura básica, login y sembrado de encargados).
//
// Cada etapa corre en una base nueva del mismo cluster descartable: arma el
// fixture (esquema mínimo + las migraciones reales anteriores), muestra el
// problema con el código viejo, aplica DOS VECES la migración nueva y verifica.
// Nunca usa Supabase ni ninguna base remota.
const port = process.env.TEST_BASE_2026_11_POSTGRES_PORT || '55460'
const carpeta = resolve('tests/sql/base')

const ETAPAS = [
  ['10-borrar-salida.sql', /PASS: borrar_salida/],
  ['11-grupo-cambiar-salir.sql', /PASS: cambiar de grupo y salir del grupo/],
  ['12-reservas-territorio-asignado.sql', /PASS: reservas, territorio asignado/],
  ['13-cobertura-admin.sql', /PASS: cobertura marcada por administradores/],
  ['14-lectura-basica-no-admin.sql', /PASS: lectura básica/],
  ['15-login-email.sql', /PASS: resolve_login_email acotado/],
  ['16-sembrado-por-conductor.sql', /PASS: sembrado de responsables por conductor/],
]

test('las migraciones nuevas son posteriores a la última aplicada', () => {
  const nuevas = readdirSync(resolve('supabase/migrations')).filter((n) => n >= '20261113')
  assert.ok(nuevas.length >= 7, 'faltan migraciones de noviembre')
  for (const nombre of nuevas) assert.ok(nombre > '20261027151500', nombre)
})

test('noviembre 2026: cada migración, sobre el esquema real, aplicada dos veces', async () => {
  await withCluster({ prefix: 'territorios-base-2026-11', port }, async (cluster) => {
    for (const [indice, [archivo, esperado]] of ETAPAS.entries()) {
      const base = `etapa_${indice}`
      cluster.query(`create database ${base}`)
      const args = cluster
        .psqlArgs(['-f', resolve(carpeta, '00-fixture.sql'), '-f', resolve(carpeta, archivo)])
        .map((valor, i, todos) => (todos[i - 1] === '-d' ? base : valor))
      const salida = run('psql', args)
      assert.match(salida, esperado, `${archivo}: las aserciones no informaron PASS`)
    }
  })
})
