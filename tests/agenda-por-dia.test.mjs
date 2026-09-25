import test from 'node:test'
import assert from 'node:assert/strict'
import { partirAgenda, agruparPorDia, ordenarSalidasDelDia, etiquetaDelDia, claveDelDia } from '../src/lib/agendaPorDia.ts'

// Mediodia para que el corte por dia no dependa del huso.
const ahora = new Date(2026, 8, 7, 12, 0)
const en = (anio, mes, dia, hora = 10) => new Date(anio, mes - 1, dia, hora).toISOString()

test('lo de hoy cuenta como próximo aunque la hora ya haya pasado', () => {
  const salidas = [
    { id: 'temprano-hoy', scheduled_for: en(2026, 9, 7, 8) },
    { id: 'manana', scheduled_for: en(2026, 9, 8) },
    { id: 'ayer', scheduled_for: en(2026, 9, 6) },
  ]
  const { proximas, anteriores } = partirAgenda(salidas, ahora)
  // Una salida de las 8 de hoy sigue siendo parte del dia que se esta
  // viviendo: mandarla al pasado a las 12 esconde el resultado que todavia
  // hay que informar.
  assert.deepEqual(proximas.map((s) => s.id), ['temprano-hoy', 'manana'])
  assert.deepEqual(anteriores.map((s) => s.id), ['ayer'])
})

test('las próximas van de la más cercana a la más lejana y las viejas al revés', () => {
  const salidas = [
    { id: 'lejana', scheduled_for: en(2026, 9, 20) },
    { id: 'vieja', scheduled_for: en(2026, 9, 1) },
    { id: 'cercana', scheduled_for: en(2026, 9, 9) },
    { id: 'reciente', scheduled_for: en(2026, 9, 5) },
  ]
  const { proximas, anteriores } = partirAgenda(salidas, ahora)
  assert.deepEqual(proximas.map((s) => s.id), ['cercana', 'lejana'])
  assert.deepEqual(anteriores.map((s) => s.id), ['reciente', 'vieja'])
})

test('una fecha ilegible no se pierde ni se hace pasar por futura', () => {
  const salidas = [
    { id: 'rota', scheduled_for: 'no es una fecha' },
    { id: 'buena', scheduled_for: en(2026, 9, 9) },
  ]
  const { proximas, anteriores } = partirAgenda(salidas, ahora)
  assert.deepEqual(proximas.map((s) => s.id), ['buena'])
  assert.deepEqual(anteriores.map((s) => s.id), ['rota'])
})

test('agrupar no reordena y junta solo días consecutivos iguales', () => {
  const salidas = [
    { id: 'a', scheduled_for: en(2026, 9, 9, 9) },
    { id: 'b', scheduled_for: en(2026, 9, 9, 17) },
    { id: 'c', scheduled_for: en(2026, 9, 10) },
  ]
  const dias = agruparPorDia(salidas)
  assert.deepEqual(dias.map((d) => d.salidas.length), [2, 1])
  assert.equal(dias[0].clave, '2026-09-09')
  assert.equal(dias[1].clave, '2026-09-10')
})

test('la agenda respeta el orden manual guardado dentro del día y no cambia las salidas antiguas', () => {
  const salidas = [
    { id: 'tarde', scheduled_for: en(2026, 9, 9, 17), programa_orden: 1 },
    { id: 'manana', scheduled_for: en(2026, 9, 9, 9), programa_orden: 2 },
    { id: 'manual', scheduled_for: en(2026, 9, 9, 19), programa_orden: null },
  ]
  const porHora = partirAgenda(salidas, ahora).proximas
  assert.deepEqual(ordenarSalidasDelDia(porHora).map((s) => s.id), ['tarde', 'manana', 'manual'])
  assert.deepEqual(ordenarSalidasDelDia(porHora.filter((s) => s.programa_orden == null)).map((s) => s.id), ['manual'])
  const agregadasDespues = [
    { id: 'primera-guardada', scheduled_for: en(2026, 9, 9, 9) },
    { id: 'telefono', scheduled_for: en(2026, 9, 9, 19), programa_orden: 2 },
    { id: 'tarde-nueva', scheduled_for: en(2026, 9, 9, 17), programa_orden: 3 },
  ]
  assert.deepEqual(ordenarSalidasDelDia(agregadasDespues).map((s) => s.id),
    ['primera-guardada', 'telefono', 'tarde-nueva'])
})

test('la etiqueta dice hoy, mañana y ayer sin dejar de mostrar la fecha', () => {
  assert.match(etiquetaDelDia(claveDelDia(new Date(2026, 8, 7)), ahora), /^Hoy · /)
  assert.match(etiquetaDelDia(claveDelDia(new Date(2026, 8, 8)), ahora), /^Mañana · /)
  assert.match(etiquetaDelDia(claveDelDia(new Date(2026, 8, 6)), ahora), /^Ayer · /)
  assert.doesNotMatch(etiquetaDelDia(claveDelDia(new Date(2026, 8, 12)), ahora), /Hoy|Mañana|Ayer/)
  assert.equal(etiquetaDelDia('sin-fecha', ahora), 'Sin fecha')
})

test('la etiqueta arranca en mayúscula', () => {
  assert.match(etiquetaDelDia('2026-09-12', ahora), /^[A-ZÁÉÍÓÚ]/)
})
