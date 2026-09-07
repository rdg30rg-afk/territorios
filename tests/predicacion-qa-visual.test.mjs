import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'

const root = new URL('..', import.meta.url)
const predicacion = fs.readFileSync(new URL('src/pages/PredicacionPage.tsx', root), 'utf8')
const miCuenta = fs.readFileSync(new URL('src/components/MiCuenta.tsx', root), 'utf8')
const css = fs.readFileSync(new URL('src/styles/vista-hermano.css', root), 'utf8')

function extractBody(name, parameter) {
  const match = predicacion.match(new RegExp(`export function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `no se encontró ${name}`)
  return new Function(parameter, match[1])
}

const isSyntheticQaOuting = extractBody('isSyntheticQaOuting', 'outing')
const showQaFromSearch = extractBody('showQaFromSearch', 'search')

test('los helpers QA solo habilitan la salida sintética por notes y leen qa=1', () => {
  assert.equal(isSyntheticQaOuting({ notes: 'Fixture sintético auditable; caso 1' }), true)
  assert.equal(isSyntheticQaOuting({ notes: 'Salida sintética QA 2026' }), true)
  assert.equal(isSyntheticQaOuting({ notes: 'QA DEV salida' }), false)
  assert.equal(isSyntheticQaOuting({ title: 'QA DEV salida' }), false)
  assert.equal(isSyntheticQaOuting({ notes: 'x Fixture sintético auditable;' }), false)
  assert.equal(showQaFromSearch('?foo=1&qa=1'), true)
  assert.equal(showQaFromSearch('?qa=0'), false)
  assert.equal(showQaFromSearch('?qa=10'), false)
})

test('el botón secundario se lee sobre papel y solo invierte en la tarjeta oscura', () => {
  assert.match(miCuenta, /className="boton secundario cuenta-resumen"/)
  assert.match(predicacion, /actualizar-programa/)
  // Antes el secundario era blanco sobre blanco por defecto y se corregia
  // caso por caso: la grilla de territorios se quedo sin arreglo y no se
  // veia. El contraste tiene que venir del valor por defecto.
  assert.match(css, /\.vh \.boton\.secundario \{[\s\S]*?background:\s*var\(--surface\);[\s\S]*?color:\s*var\(--fg\);[\s\S]*?border:\s*1px solid var\(--line\);/)
  // Y la inversion solo donde el fondo es oscuro de verdad: "consulta" es
  // papel y "lima" es lima, ahi el texto blanco tampoco se lee.
  assert.match(css, /\.vh \.tarjeta:not\(\.consulta\):not\(\.lima\) \.boton\.secundario \{[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*#fff;/)
  assert.match(css, /\.vh \.tarjeta\.lima \.boton\.secundario \{[\s\S]*?color:\s*var\(--ink\);/)
})

test('la vista móvil no usa select nativo y conserva controles de 56 px', () => {
  const coverage = fs.readFileSync(new URL('src/components/SalidaCoverageForm.tsx', root), 'utf8')
  const correction = fs.readFileSync(new URL('src/components/CoverageCorrectionForm.tsx', root), 'utf8')
  assert.doesNotMatch(predicacion, /<select\b/)
  assert.doesNotMatch(coverage, /<select\b/)
  assert.doesNotMatch(correction, /<select\b/)
  assert.match(css, /\.vh button,[\s\S]*?min-height:\s*var\(--tap\)/)
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*?\.vh \.filtros-salidas \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  assert.match(css, /@media \(max-width: 340px\)/)
  assert.match(predicacion, /className="pestaniaIcono"/)
})
