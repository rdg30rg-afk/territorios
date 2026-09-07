import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../scripts/verify-dev-migration-rollback.mjs', import.meta.url), 'utf8')

test('la verificación queda clavada a DEV y a la ruta privada acordada', () => {
  assert.match(source, /rkmioktcsgqqjshrlkmy/)
  assert.match(source, /dwgvzcnarrjgqjotocdw/)
  assert.match(source, /\/tmp\/territorios-dev-db-password/)
  assert.match(source, /Producción está bloqueada/)
})

test('quita sólo la transacción exterior y fuerza rollback', () => {
  assert.match(source, /replace\(\/\^\(\\s\*\(\?:--/)
  assert.match(source, /replace\(\/commit/)
  assert.match(source, /const sql = `begin;\\n\$\{body\}\\nrollback;\\n`/)
  assert.match(source, /ON_ERROR_STOP=1/)
})

test('no imprime la contraseña si psql falla', () => {
  assert.match(source, /stderr\.replaceAll\(password, '\[redacted\]'\)/)
  assert.doesNotMatch(source, /console\.log\(password\)/)
})
