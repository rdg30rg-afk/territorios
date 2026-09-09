import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url)
const [predicacion, miCuenta, css] = await Promise.all([
  readFile(new URL('src/pages/PredicacionPage.tsx', root), 'utf8'),
  readFile(new URL('src/components/MiCuenta.tsx', root), 'utf8'),
  readFile(new URL('src/styles/vista-hermano.css', root), 'utf8'),
])

test('Mi cuenta vive en la barra y conserva una variante compacta accesible', () => {
  const barra = predicacion.match(/<header className="barra">([\s\S]*?)<\/header>/)?.[1]
  assert.ok(barra, 'no se encontró la barra de la vista hermano')
  assert.match(barra, /<MiCuenta key=\{profile\?\.id\} compact \/>/)
  assert.match(barra, /className="btnIcono"/)
  assert.match(miCuenta, /compact\?: boolean/)
  assert.match(miCuenta, /className=\{compact \? 'miCuenta compacto' : 'panel'\}/)
  assert.match(miCuenta, /aria-label="Abrir Mi cuenta"/)
})

test('Actualizar programa aparece una sola vez y solo en Salidas', () => {
  const salidas = predicacion.indexOf('{/* -------------------------------------------------------- SALIDAS */}')
  assert.ok(salidas >= 0)
  const ocurrencias = [...predicacion.matchAll(/actualizar-programa/g)]
  assert.equal(ocurrencias.length, 1)
  assert.ok(ocurrencias[0].index > salidas)
  assert.match(predicacion, /aria-label="Actualizar programa"/)
  assert.match(predicacion, /aria-controls="lista-salidas"/)
  assert.match(predicacion, />\s*Actualizar programa\s*<\/button>/)
  assert.match(predicacion, /showQA \? salidas : salidas\.filter\(\(salida\) => !isSyntheticQaOuting\(salida\)\)/)
})

test('el desplegable de cuenta queda acotado y usable en mobile', () => {
  assert.match(css, /\.vh \.miCuenta\.compacto \.auth-form\s*\{[\s\S]*?width: min\(360px, calc\(100vw - 24px\)\);[\s\S]*?overflow-y: auto;/)
  assert.match(css, /max-height: min\(520px, calc\(100dvh - 88px\)\)/)
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.cuentaTexto \{ display: none; \}/)
  assert.match(css, /\.vh \.barra-controles\s*\{[\s\S]*?gap: 8px;/)
})

test('la hora destacada no se parte en teléfonos angostos', () => {
  assert.match(predicacion, /className="numeroHora"/)
  assert.match(css, /\.vh \.numeroHora \{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/)
})
