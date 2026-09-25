import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url)
const [sql, grupo, hoja, predicacion, salidas] = await Promise.all([
  readFile(new URL('supabase/migrations/20260921020000_lugar_sin_gps_obligatorio.sql', root), 'utf8'),
  readFile(new URL('src/components/GestionSalidasGrupo.tsx', root), 'utf8'),
  readFile(new URL('src/components/HojaMiGrupo.tsx', root), 'utf8'),
  readFile(new URL('src/pages/PredicacionPage.tsx', root), 'utf8'),
  readFile(new URL('src/pages/SalidasPage.tsx', root), 'utf8'),
])

test('una salida nueva pide lugar, no coordenadas', () => {
  assert.match(sql, /necesita territorio, conductor y dónde se juntan/)
  assert.doesNotMatch(sql, /dirección y GPS/)
  assert.match(sql, /Las coordenadas del punto de encuentro deben venir juntas/)
  assert.match(sql, /function public\.salidas_rpc_bloquear_territorios/)
  assert.match(sql, /function public\.salidas_rpc_bloquear_grupos/)
  assert.doesNotMatch(sql, /function public\.crear_salida/)
})

test('el grupo programa con un nombre y el mapa queda para cómo llegar', () => {
  assert.match(grupo, /Una esquina, una casa o Zoom/)
  assert.match(grupo, /p_meeting_point_lat: lat/)
  assert.doesNotMatch(grupo, /Primero cargá arriba el punto/)
  assert.doesNotMatch(hoja, /Falta el GPS/)
  assert.match(predicacion, /Puede ser una casa, una esquina o Zoom/)
  assert.doesNotMatch(predicacion, /El punto no tiene ubicación todavía/)
  assert.doesNotMatch(salidas, /Falta marcar en el mapa dónde se juntan/)
})
