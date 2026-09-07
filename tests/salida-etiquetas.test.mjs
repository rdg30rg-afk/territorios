import test from 'node:test'
import assert from 'node:assert/strict'
import {
  textoConductor,
  textoTerritorio,
  textoPuntoSalida,
  saleSinConductor,
  rotuloTerritorio,
} from '../src/lib/salidaEtiquetas.ts'

test('usa el texto importado cuando no hay conductor vinculado', () => {
  assert.equal(
    textoConductor({ driver_id: null, conductor_texto: 'Ariel Riveros' }),
    'Ariel Riveros',
  )
  assert.equal(saleSinConductor({ driver_id: null, conductor_texto: 'Ariel Riveros' }), false)
})

test('el nombre vinculado manda sobre el texto', () => {
  assert.equal(
    textoConductor({
      driver_id: 'abc',
      driverName: 'Mateo Luna',
      conductor_texto: 'Ariel Riveros',
    }),
    'Mateo Luna',
  )
})

test('sin FK ni texto sigue diciendo Sin conductor', () => {
  assert.equal(textoConductor({ driver_id: null }), 'Sin conductor')
  assert.equal(saleSinConductor({ driver_id: null }), true)
})

test('el código textual alcanza para nombrar el territorio', () => {
  assert.equal(textoTerritorio({ territory_id: null, territorio_codigo: '61.2' }), '61')
  assert.equal(textoTerritorio({ territory_id: null, territorio_codigo: '7' }), '7')
})

test('la agenda muestra código y dirección juntos', () => {
  assert.equal(
    textoPuntoSalida({
      codigo: '61.1',
      nombre: 'Rastreador Calivar y Roberto Fontanarrosa',
    }),
    '61.1 · Rastreador Calivar y Roberto Fontanarrosa',
  )
  assert.equal(textoPuntoSalida({ codigo: 'TEL', nombre: '' }), 'TEL')
})

test('rotula un número suelto como Territorio N', () => {
  assert.equal(rotuloTerritorio('1'), 'Territorio 1')
  assert.equal(rotuloTerritorio('Centro'), 'Centro')
  assert.equal(rotuloTerritorio(''), 'Territorio sin nombre')
})
