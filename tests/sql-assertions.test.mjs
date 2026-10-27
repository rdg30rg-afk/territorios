import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import test from 'node:test'
import { withCluster } from './helpers/postgres-local.mjs'
import { limpiarTexto } from '../src/lib/reportarErrorNucleo.ts'

// Aserciones SQL contra las migraciones reales, en un Postgres local
// descartable: nunca usa Supabase, DEV remoto ni credenciales.
//
// Las migraciones de este repo no arman el esquema desde cero (partieron de una
// base que ya existía), así que se aplican sobre el fixture mínimo
// `access-fixture.sql`, una tras otra y en este orden. Cada grupo corre en una
// sola sesión de psql: fixture, migración(es) y aserciones. Los grupos se
// encadenan sobre el mismo cluster porque cada uno usa lo que dejó el anterior.
const port = process.env.TEST_SQL_ASSERTIONS_POSTGRES_PORT || '55450'

const sql = (nombre) => resolve('tests/sql', nombre)
const migracion = (nombre) => resolve('supabase/migrations', nombre)

const GRUPOS = [
  {
    nombre: 'acceso activo y administración atómica',
    archivos: [
      sql('access-fixture.sql'),
      migracion('20260905010000_acceso_activo_y_administracion_atomica.sql'),
      sql('access-assertions.sql'),
    ],
  },
  {
    nombre: 'reservas por persona',
    archivos: [migracion('20260905020000_reservas_por_persona_y_decisiones.sql'), sql('reservas-assertions.sql')],
  },
  {
    nombre: 'cobertura por RPC idempotente',
    archivos: [migracion('20260905030000_cobertura_por_rpc_idempotente.sql'), sql('coverage-assertions.sql')],
  },
  {
    nombre: 'resultados de salida por RPC',
    archivos: [migracion('20260905040000_resultados_salida_por_rpc.sql'), sql('resultados-assertions.sql')],
  },
  {
    nombre: 'borrador con versión del servidor',
    archivos: [
      sql('borrador-fixture.sql'),
      migracion('20260905050000_borrador_version_servidor.sql'),
      sql('borrador-assertions.sql'),
    ],
  },
  {
    nombre: 'publicación atómica del editor',
    archivos: [
      sql('publicacion-fixture.sql'),
      migracion('20260905060000_publicacion_atomica_editor.sql'),
      sql('publicacion-assertions.sql'),
    ],
  },
  {
    nombre: 'manzanas con revisión compartida',
    archivos: [
      migracion('20260905070000_manzanas_con_revision_compartida.sql'),
      sql('manzanas-revision-fixture.sql'),
      sql('manzanas-revision-assertions.sql'),
    ],
  },
  {
    nombre: 'borrado de territorios protegido',
    archivos: [migracion('20260905080000_proteger_borrado_territorios.sql'), sql('territorio-delete-assertions.sql')],
  },
  {
    nombre: 'renumeración atómica y color (con la corrección de territorio sin polígono)',
    archivos: [
      migracion('20261001010000_renumeracion_editor_atomica.sql'),
      migracion('20261027151000_renumeracion_tolera_territorio_sin_poligono.sql'),
      sql('renumeracion-assertions.sql'),
    ],
  },
  {
    nombre: 'errores del cliente',
    archivos: [
      sql('errores-cliente-fixture.sql'),
      migracion('20261027151500_errores_cliente.sql'),
      sql('errores-cliente-assertions.sql'),
    ],
  },
]

// Archivos de tests/sql que NO son aserciones de este encadenado, y por qué.
// Si agregás un `*-assertions.sql` nuevo, va en GRUPOS; si no, el test de abajo falla.
const SIN_ENCADENAR = new Map([
  ['access-dev-rollback.sql', 'se corre contra la base DEV remota, con rollback exterior'],
  ['borrador-dev-rollback.sql', 'se corre contra la base DEV remota, con rollback exterior'],
  ['publicacion-dev-rollback.sql', 'se corre contra la base DEV remota, con rollback exterior'],
  ['conductor-result-read-dev.sql', 'se corre contra la base DEV remota'],
  ['grupos.sql', 'lo corre tests/grupos-rpc.test.mjs con su propio cluster'],
  ['programa-semana.sql', 'lo corre tests/programa-semana.test.mjs con su propio cluster'],
  ['roles-unificados.sql', 'lo corre tests/roles-unificados.test.mjs con su propio cluster'],
  ['salidas-rpc.sql', 'lo corre tests/salidas-rpc.test.mjs con su propio cluster'],
])

function correr(cluster, grupo) {
  const salida = cluster.psql(grupo.archivos.flatMap((archivo) => ['-f', archivo]))
  if (grupo.archivos.some((archivo) => archivo.endsWith('-assertions.sql'))) {
    assert.match(salida, /PASS/, `${grupo.nombre}: las aserciones no informaron PASS`)
  }
  return salida
}

test('cada tests/sql/*-assertions.sql está registrado en el encadenado', () => {
  const registrados = new Set(GRUPOS.flatMap((grupo) => grupo.archivos.map((archivo) => basename(archivo))))
  const enDisco = readdirSync(resolve('tests/sql'))

  for (const archivo of enDisco.filter((nombre) => nombre.endsWith('-assertions.sql'))) {
    assert.ok(registrados.has(archivo), `${archivo} no corre: agregalo a GRUPOS en tests/sql-assertions.test.mjs`)
  }
  for (const archivo of enDisco.filter((nombre) => nombre.endsWith('.sql'))) {
    assert.ok(
      registrados.has(archivo) || SIN_ENCADENAR.has(archivo),
      `${archivo} no está en GRUPOS ni en SIN_ENCADENAR (con el motivo)`,
    )
  }
  for (const archivo of SIN_ENCADENAR.keys()) {
    assert.ok(enDisco.includes(archivo), `${archivo} figura en SIN_ENCADENAR pero ya no existe`)
  }
})

test('aserciones SQL: las migraciones reales, en orden, contra Postgres local', async (t) => {
  await withCluster({ prefix: 'territorios-sql-assertions', port }, async (cluster) => {
    let fallo = false

    for (const grupo of GRUPOS) {
      await t.test(grupo.nombre, { skip: fallo && 'depende de un grupo anterior que falló' }, () => {
        try {
          correr(cluster, grupo)
        } catch (error) {
          fallo = true
          throw error
        }
      })
    }

    await t.test('limpiarTexto (cliente) y errores_cliente_limpiar (SQL) dan lo mismo', { skip: fallo && 'el encadenado falló' }, () => {
      const casos = JSON.parse(readFileSync(resolve('tests/fixtures/limpieza-errores.json'), 'utf8'))
      for (const caso of casos) {
        // En hexadecimal para no pelear con comillas ni saltos de línea.
        const hex = Buffer.from(caso.entrada, 'utf8').toString('hex')
        const salidaSql = cluster.query(
          `select encode(convert_to(public.errores_cliente_limpiar(convert_from(decode('${hex}','hex'),'UTF8')),'UTF8'),'hex')`,
        )
        const enSql = Buffer.from(salidaSql, 'hex').toString('utf8')
        assert.equal(enSql, caso.salida, `SQL: ${caso.nombre}`)
        assert.equal(limpiarTexto(caso.entrada), caso.salida, `cliente: ${caso.nombre}`)
      }
    })
  })
})

test('sin la migración nueva, la aserción de territorio sin polygon_geojson falla', async () => {
  // Si esto deja de fallar, la aserción dejó de probar algo.
  await withCluster({ prefix: 'territorios-sql-assertions-rojo', port: `${Number(port) + 1}` }, (cluster) => {
    const hastaRenumeracion = GRUPOS.slice(0, GRUPOS.findIndex((grupo) => grupo.nombre.startsWith('renumeración')))
    for (const grupo of hastaRenumeracion) correr(cluster, grupo)

    const sinCorreccion = {
      nombre: 'renumeración sin corregir',
      archivos: [
        migracion('20261001010000_renumeracion_editor_atomica.sql'),
        sql('renumeracion-assertions.sql'),
      ],
    }
    assert.throws(() => correr(cluster, sinCorreccion), /Color no persistió \(territorio sin polygon_geojson\)/)
  })
})
