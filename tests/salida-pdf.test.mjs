import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const sourceUrl = new URL('../src/lib/salidaPdf.ts', import.meta.url)
const pageUrl = new URL('../src/pages/SalidasPage.tsx', import.meta.url)
const brotherPageUrl = new URL('../src/pages/PredicacionPage.tsx', import.meta.url)

async function importarHelpers() {
  const source = await readFile(sourceUrl, 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
}

test('el PDF usa coordenadas cuando existen y la dirección escrita como respaldo', async () => {
  const { enlaceMapaSalida } = await importarHelpers()

  assert.equal(
    enlaceMapaSalida({ title: 'Salida', scheduledFor: '2026-09-12T10:00:00-03:00', meetingCoords: [-68.54, -31.53] }),
    'https://www.google.com/maps?q=-31.53,-68.54',
  )
  assert.equal(
    enlaceMapaSalida({ title: 'Salida', scheduledFor: '2026-09-12T10:00:00-03:00', meetingPointName: 'Salón del Reino, San Juan' }),
    'https://www.google.com/maps/search/?api=1&query=Sal%C3%B3n%20del%20Reino%2C%20San%20Juan',
  )
  assert.equal(
    enlaceMapaSalida({ title: 'Salida', scheduledFor: '2026-09-12T10:00:00-03:00' }),
    null,
  )
})

test('el archivo tiene un nombre legible, estable y sin caracteres problemáticos', async () => {
  const { nombrePdfSalida } = await importarHelpers()

  assert.equal(
    nombrePdfSalida({
      title: 'Salida de predicación',
      scheduledFor: '2026-09-12T10:00:00-03:00',
      territoryName: 'Territorio 61 Á',
    }),
    'salida-2026-09-12-territorio-61-a.pdf',
  )
})

test('la UI exporta agenda y ficha, captura errores y no exige GPS', async () => {
  const page = await readFile(pageUrl, 'utf8')
  const brotherPage = await readFile(brotherPageUrl, 'utf8')

  assert.match(page, /'Agenda PDF'/)
  assert.match(page, />Compartí esta salida</)
  assert.match(page, /Descargar PDF/)
  assert.match(page, /handleShareSavedPdf/)
  assert.match(page, /No se pudo preparar el PDF de la salida/)
  assert.doesNotMatch(page, /no tiene coordenadas; no se puede generar el PDF/)
  assert.match(brotherPage, /Descargar PDF de la salida/)
  assert.match(brotherPage, /<BotonPdfSalida salida=\{salida\} contexto=\{contexto\}/)
})
