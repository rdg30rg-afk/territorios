#!/usr/bin/env node
/**
 * Genera el favicon y los íconos de la PWA a partir de src/lib/marca.ts.
 *
 *   node --experimental-strip-types scripts/generar-iconos.mjs
 *
 * Necesita ImageMagick (`magick`) para pasar el SVG a PNG. Los PNG van a
 * sangre completa: el teléfono los recorta (redondeados en iPhone, en círculo
 * o "squircle" en Android) una sola vez.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { simboloSvg } from '../src/lib/marca.ts'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLICO = join(RAIZ, 'public')

// A 16 px el contorno de la casa necesita más grosor para no perderse.
const FAVICON = simboloSvg({ trazo: 4.5 })

export const ICONOS = [
  { archivo: 'pwa/icon-180.png', tamaño: 180, svg: simboloSvg() },
  { archivo: 'pwa/icon-192.png', tamaño: 192, svg: simboloSvg() },
  { archivo: 'pwa/icon-512.png', tamaño: 512, svg: simboloSvg() },
  // Android recorta el maskable a un círculo del 80 %: la casa se achica
  // para quedar adentro.
  { archivo: 'pwa/icon-maskable-512.png', tamaño: 512, svg: simboloSvg({ escala: 0.8 }) },
]

async function main() {
  await writeFile(join(PUBLICO, 'favicon.svg'), FAVICON)
  const temporal = await mkdtemp(join(tmpdir(), 'iconos-territorios-'))
  try {
    for (const icono of ICONOS) {
      const origen = join(temporal, 'icono.svg')
      await writeFile(origen, icono.svg)
      await promisify(execFile)('magick', [
        '-background', 'none',
        '-density', String(Math.ceil((icono.tamaño / 64) * 72 * 2)),
        origen,
        '-resize', `${icono.tamaño}x${icono.tamaño}`,
        '-depth', '8',
        '-strip',
        join(PUBLICO, icono.archivo),
      ])
      console.log(`  ${icono.archivo} (${icono.tamaño} px)`)
    }
    console.log('  favicon.svg')
  } finally {
    await rm(temporal, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
