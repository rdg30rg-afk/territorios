import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../scripts/cargar-candidatas-editor-dev.mjs', import.meta.url),
  'utf8',
)

test('el cargador seco valida las 1144 candidatas sin escribir', () => {
  const output = execFileSync(
    process.execPath,
    ['scripts/cargar-candidatas-editor-dev.mjs', '--dry-run'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  )
  assert.match(output, /Candidatas válidas: 1144/)
  assert.match(output, /Ensayo: no se escribió nada/)
})

test('bloquea producción y exige la ruta privada acordada', () => {
  assert.match(source, /if \(projectRef === PROD_REF\) throw new Error\('Producción está bloqueada/)
  assert.match(source, /projectRef !== DEV_REF/)
  assert.match(source, /keyFile !== '\/tmp\/territorios-dev-service-role'/)
})

test('sube primero toda la versión y recién después desactiva las anteriores', () => {
  const upload = source.indexOf('for (let offset = 0; offset < rows.length')
  const deactivate = source.indexOf('const deactivate = await fetch')
  assert.ok(upload >= 0 && deactivate > upload)
  assert.match(source, /on_conflict=dataset_version,source_key/)
  assert.match(source, /resolution=merge-duplicates/)
})
