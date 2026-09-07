import test from 'node:test'
import assert from 'node:assert/strict'
import { coordsDeMapsUrl, urlComoLlegar, textoDestino } from '../src/lib/comoLlegar.ts'

test('centro de cámara y enlaces cortos no se promueven a un punto confirmado', () => {
  for (const url of ['https://www.google.com/maps/@-31.5,-68.5,15z', 'https://maps.google.com/?ll=-31.5,-68.5', 'https://maps.app.goo.gl/ejemplo']) {
    assert.equal(coordsDeMapsUrl(url), null)
  }
})
test('destino explícito prevalece sobre cámara y valida dominio/rango', () => {
  assert.deepEqual(coordsDeMapsUrl('https://www.google.com/maps/@0,0,10z?destination=-31.5%2C-68.5'), { lat: -31.5, lng: -68.5 })
  assert.deepEqual(coordsDeMapsUrl('https://www.google.com/maps?q=0,0'), { lat: 0, lng: 0 })
  for (const url of ['https://evil.example/?q=-31.5,-68.5', 'https://google.com.evil.example/?q=0,0', 'https://google.com/?q=91,0', 'https://google.com/?q=0,181', 'https://google.com/?destination=esquina&ll=0,0']) {
    assert.equal(coordsDeMapsUrl(url), null)
  }
})
test('sin ubicación no se inventa ruta al centro de la ciudad', () => {
  assert.equal(textoDestino('  '), '')
  for (const lugar of [undefined, '', ' ', 'Sin dato', 'Sin dirección', 'A confirmar']) {
    assert.equal(urlComoLlegar({ modo: 'driving', lugar }), null)
  }
  assert.equal(urlComoLlegar({ modo: 'driving', lat: NaN, lng: 0 }), null)
  assert.equal(urlComoLlegar({ modo: 'driving', lat: 95, lng: 0 }), null)
})
test('solo hay ruta cuando hay coordenadas, nunca con un texto', () => {
  const point = new URL(urlComoLlegar({ modo: 'driving', lat: 0, lng: 0, lugar: 'otra cosa' }) ?? '')
  assert.equal(point.searchParams.get('destination'), '0,0')
  assert.equal(urlComoLlegar({ modo: 'transit', lugar: 'Zaballa y Talcahuano' }), null)
  assert.equal(urlComoLlegar({ modo: 'driving', lugar: 'Salidas de Grupos' }), null)
})
