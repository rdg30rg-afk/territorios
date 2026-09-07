import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buscarPuntos,
  esCodigoExacto,
  normalizarCodigo,
  territorioDelCodigo,
  textoPunto,
} from '../src/lib/puntosEncuentro.ts'

const puntos = [
  {
    id: 'a',
    nombre: 'Rastreador Calivar y Roberto Fontanarrosa',
    barrio: 'Bo. SOEVA 3',
    lat: -31.5,
    lng: -68.5,
    maps_url: null,
    territory_id: 't61',
    activo: true,
    codigo: '61.1',
  },
  {
    id: 'b',
    nombre: 'Casa Flia. Rodolfo Gómez',
    barrio: 'Bo.AMED 1',
    lat: null,
    lng: null,
    maps_url: null,
    territory_id: 't61',
    activo: true,
    codigo: '61.2',
  },
  {
    id: 'c',
    nombre: 'Av. Libertador e Hipólito Vieytes',
    barrio: 'Bo. San Carlos',
    lat: null,
    lng: null,
    maps_url: null,
    territory_id: 't56',
    activo: true,
    codigo: '56.1',
  },
  {
    id: 'd',
    nombre: 'Predicación telefónica',
    barrio: null,
    lat: null,
    lng: null,
    maps_url: null,
    territory_id: null,
    activo: true,
    codigo: 'TEL',
  },
]

test('normaliza 61,1 61 1 y 61.1 al mismo código', () => {
  assert.equal(normalizarCodigo('61,1'), '61.1')
  assert.equal(normalizarCodigo('61 1'), '61.1')
  assert.equal(normalizarCodigo('61.1'), '61.1')
  assert.equal(normalizarCodigo(61.1), '61.1')
})

test('61 es el territorio; 61.1 es el punto', () => {
  assert.equal(territorioDelCodigo('61.1'), '61')
  assert.equal(esCodigoExacto('61,1'), true)
  assert.equal(esCodigoExacto('61'), false)
  assert.equal(esCodigoExacto('TEL'), true)
})

test('escribir 61 lista los puntos de ese territorio', () => {
  const hallados = buscarPuntos(puntos, '61')
  assert.deepEqual(hallados.map((punto) => punto.codigo), ['61.1', '61.2'])
  assert.equal(
    buscarPuntos(puntos, '6').some((punto) => (punto.codigo ?? '').startsWith('61')),
    false,
  )
})

test('61,1 selecciona el punto exacto', () => {
  const hallados = buscarPuntos(puntos, '61,1')
  assert.equal(hallados.length, 1)
  assert.equal(hallados[0]?.codigo, '61.1')
})

test('busca por dirección y barrio sin tildes', () => {
  assert.equal(buscarPuntos(puntos, 'calivar')[0]?.codigo, '61.1')
  assert.equal(buscarPuntos(puntos, 'soeva')[0]?.codigo, '61.1')
  assert.equal(buscarPuntos(puntos, 'hipolito')[0]?.codigo, '56.1')
})

test('TEL entra por código especial', () => {
  assert.equal(buscarPuntos(puntos, 'tel')[0]?.codigo, 'TEL')
})

test('arma el rótulo que se lee en la fila', () => {
  assert.equal(
    textoPunto({ codigo: '61.1', nombre: 'Rastreador Calivar y Roberto Fontanarrosa' }),
    '61.1 · Rastreador Calivar y Roberto Fontanarrosa',
  )
})
