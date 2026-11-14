import test from 'node:test'
import assert from 'node:assert/strict'
import { decirElError, comoErrorDeLaBase } from '../src/lib/decirElError.ts'

test('un mensaje bueno del servidor no se pisa con un genérico', () => {
  const e = { code: '23505', message: 'Esa persona ya tiene un territorio' }
  assert.equal(decirElError(e), 'Esa persona ya tiene un territorio')
})

test('el crudo de Postgres sí se traduce', () => {
  const e = { code: '23505', message: 'duplicate key value violates unique constraint "x"' }
  assert.equal(decirElError(e), 'Ya existe uno con esos datos.')
  const f = { code: '23503', message: 'violates foreign key constraint "y"' }
  assert.match(decirElError(f), /No se puede borrar/)
})

test('permiso: respeta el texto de la función y traduce el de RLS', () => {
  assert.equal(
    decirElError({ code: '42501', message: 'No tenés permiso para cambiar el código' }),
    'No tenés permiso para cambiar el código',
  )
  assert.match(decirElError({ code: '42501', message: 'new row violates row-level security policy' }), /no tiene permiso/)
})

test('un mensaje en inglés que no se reconoce no llega a la pantalla', () => {
  const t = decirElError({ message: 'invalid input syntax for type uuid: "abc"' }, 'No se pudo guardar.')
  assert.doesNotMatch(t, /invalid input/)
  assert.match(t, /^No se pudo guardar\./)
})

test('un mensaje en castellano sin código se muestra tal cual', () => {
  assert.equal(decirElError({ message: 'Ese código no es de ningún grupo' }), 'Ese código no es de ningún grupo')
})

test('sin red y sesión vencida', () => {
  assert.match(decirElError({ message: 'Failed to fetch' }), /internet/)
  assert.match(decirElError({ code: 'PGRST303', message: 'JWT expired' }), /sesión/)
})

test('comoErrorDeLaBase acepta textos, errores y nada', () => {
  assert.equal(comoErrorDeLaBase(null), null)
  assert.equal(comoErrorDeLaBase('hola')?.message, 'hola')
  assert.equal(comoErrorDeLaBase(new Error('x'))?.message, 'x')
})
