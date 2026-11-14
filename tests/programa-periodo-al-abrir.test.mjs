import test from 'node:test'
import assert from 'node:assert/strict'
import { periodoAlAbrir } from '../src/features/programa/periodoAlAbrir.ts'

const viernes = new Date(2026, 10, 13, 23, 46)
const guardado = { preset: 'personalizado', desde: '2026-11-16', hasta: '2026-11-29' }

test('un viernes abre la semana en curso aunque haya un período futuro guardado vacío', () => {
  const p = periodoAlAbrir(guardado, { filas: {}, dias: {} }, viernes)
  assert.equal(p.preset, 'esta-semana')
  assert.equal(p.desde, '2026-11-13')
  assert.equal(p.hasta, '2026-11-15')
})

test('si hay trabajo armado en el período futuro, se conserva', () => {
  const p = periodoAlAbrir(guardado, { filas: { '2026-11-17-manana': {} } }, viernes)
  assert.deepEqual(p, guardado)
})

test('un período guardado que ya incluye hoy se conserva', () => {
  const actual = { preset: 'esta-semana', desde: '2026-11-09', hasta: '2026-11-15' }
  assert.deepEqual(periodoAlAbrir(actual, {}, viernes), actual)
})

test('uno vencido se reemplaza', () => {
  const viejo = { preset: 'esta-semana', desde: '2026-11-02', hasta: '2026-11-08' }
  assert.equal(periodoAlAbrir(viejo, {}, viernes).desde, '2026-11-13')
})
