import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../scripts/seed-dev-legacy-editor-territories.mjs', import.meta.url), 'utf8')

test('el recuperador está clavado a DEV y ensaya por defecto', () => {
  assert.match(source, /rkmioktcsgqqjshrlkmy/)
  assert.match(source, /dwgvzcnarrjgqjotocdw/)
  assert.match(source, /\/tmp\/territorios-dev-db-password/)
  assert.match(source, /const apply = process\.argv\.includes\('--apply'\)/)
  assert.match(source, /if \(!apply\)/)
})

test('deriva un único Polygon de las manzanas efectivas', () => {
  assert.match(source, /discarded\.has\(sourceKey\) \? null : candidates\.get\(sourceKey\)/)
  assert.match(source, /union\(featureCollection/)
  assert.match(source, /outline\.geometry\.type !== 'Polygon'/)
})

test('respalda y usa una sola transacción antes de insertar', () => {
  const backup = source.indexOf("'before.json'")
  const transaction = source.indexOf('begin;')
  const insert = source.indexOf('insert into public.territorios')
  const commit = source.indexOf('commit;')
  assert.ok(backup > 0 && backup < transaction)
  assert.ok(transaction < insert && insert < commit)
  assert.match(source, /lock table public\.territorios/)
})
