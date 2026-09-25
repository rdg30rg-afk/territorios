import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FaltaLaMigracion,
  cargarConfigSemana,
  guardarConfigSemana,
} from '../src/features/programa/configSemana.ts'

/* Un cliente de mentira: alcanza con que responda lo que responden las tablas
   y la RPC, para probar las dos cosas que importan: de dónde sale la semana y
   qué pasa cuando la base todavía no la tiene. */
function clienteFalso({ tablas = {}, rpc = null } = {}) {
  return {
    from(nombre) {
      const respuesta = tablas[nombre] ?? { data: [], error: null }
      const consulta = {
        select: () => consulta,
        order: () => consulta,
        then: (resolver) => Promise.resolve(respuesta).then(resolver),
      }
      return consulta
    },
    rpc: (nombre, parametros) => Promise.resolve(rpc ? rpc(nombre, parametros) : { error: null }),
  }
}

const SIN_TABLAS = {
  programa_horarios: { data: null, error: { code: '42P01', message: 'no existe' } },
  programa_titulares: { data: null, error: { code: '42P01', message: 'no existe' } },
  programa_telefono: { data: null, error: { code: '42P01', message: 'no existe' } },
  programa_grupos: { data: null, error: { code: '42P01', message: 'no existe' } },
}

test('si las tablas no existen, la semana queda en null y manda la del código', async () => {
  const config = await cargarConfigSemana(clienteFalso({ tablas: SIN_TABLAS }))
  assert.equal(config, null)
})

test('una tabla recién creada y vacía tampoco es una semana', async () => {
  const config = await cargarConfigSemana(clienteFalso())
  assert.equal(config, null)
})

test('la semana se arma con los horarios, los titulares y los días especiales', async () => {
  const config = await cargarConfigSemana(
    clienteFalso({
      tablas: {
        programa_horarios: {
          data: [
            { dow: 1, turno: 'manana', hora: '09:30:00' },
            { dow: 6, turno: 'tarde', hora: '17:00:00' },
          ],
          error: null,
        },
        programa_titulares: {
          data: [
            { dow: 2, turno: 'manana', orden: 1, conductor_id: 'c1' },
            { dow: 2, turno: 'manana', orden: 2, conductor_id: 'c2' },
          ],
          error: null,
        },
        programa_telefono: { data: [{ dow: 1, hora: '19:30:00' }], error: null },
        programa_grupos: { data: [{ dow: 6, hora: '10:00:00' }], error: null },
      },
    }),
  )

  // La hora llega con segundos de Postgres y la pantalla la usa corta.
  assert.equal(config?.horarios['1-manana'], '09:30')
  assert.equal(config?.horarios['6-tarde'], '17:00')
  // Dos titulares del mismo turno quedan en orden: alternan.
  assert.deepEqual(config?.titulares['2-manana'], ['c1', 'c2'])
  assert.deepEqual(config?.telefono, [{ dow: 1, hora: '19:30' }])
  assert.deepEqual(config?.grupos, [{ dow: 6, hora: '10:00' }])
})

test('al guardar, la semana viaja aplanada como la espera la RPC', async () => {
  let recibido = null
  const cliente = clienteFalso({
    rpc: (nombre, parametros) => {
      recibido = { nombre, parametros }
      return { error: null }
    },
  })

  await guardarConfigSemana(cliente, {
    horarios: { '1-manana': '09:30' },
    titulares: { '2-manana': ['c1', 'c2'] },
    telefono: [{ dow: 1, hora: '19:30' }],
    grupos: [{ dow: 6, hora: '10:00' }],
  })

  assert.equal(recibido?.nombre, 'guardar_programa_semanal')
  assert.deepEqual(recibido?.parametros.p_horarios, [{ dow: 1, turno: 'manana', hora: '09:30' }])
  // El orden del array es el orden de la alternancia: el primero conduce primero.
  assert.deepEqual(recibido?.parametros.p_titulares, [
    { dow: 2, turno: 'manana', orden: 1, conductor_id: 'c1' },
    { dow: 2, turno: 'manana', orden: 2, conductor_id: 'c2' },
  ])
  assert.deepEqual(recibido?.parametros.p_telefono, [{ dow: 1, hora: '19:30' }])
  assert.deepEqual(recibido?.parametros.p_grupos, [{ dow: 6, hora: '10:00' }])
})

test('si falta la migración, se dice con esas palabras y no con el error crudo', async () => {
  const cliente = clienteFalso({
    rpc: () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.guardar_programa_semanal' } }),
  })
  await assert.rejects(
    () => guardarConfigSemana(cliente, { horarios: {}, titulares: {}, telefono: [], grupos: [] }),
    (error) => error instanceof FaltaLaMigracion,
  )
})
