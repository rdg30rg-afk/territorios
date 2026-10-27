import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { textoDeEnvio } from '../src/lib/marcasPendientes.ts'
import { describirPrecarga } from '../src/lib/teselasPrecarga.ts'
import { TEXTO_DESHECHO, textoDeMarca } from '../src/lib/deshacerMarca.ts'
import { mensajeDeCopia } from '../src/lib/copiaDeMapa.ts'

const root = new URL('..', import.meta.url)
const leer = (ruta) => fs.readFileSync(new URL(ruta, root), 'utf8')

const calleCss = leer('src/styles/vista-hermano-calle.css')
const baseCss = leer('src/styles/vista-hermano.css')
const pagina = leer('src/pages/PredicacionPage.tsx')
const sprite = leer('public/iconos-territorios/sprite.svg')
const iconosTs = leer('src/lib/iconos.ts')
const componentes = {
  'AvisoDeshacer.tsx': leer('src/components/AvisoDeshacer.tsx'),
  'MarcasPendientes.tsx': leer('src/components/MarcasPendientes.tsx'),
  'MapaSinSenal.tsx': leer('src/components/MapaSinSenal.tsx'),
}

// ----------------------------------------------------------- medir el CSS
// Se lee el CSS como lo lee el navegador: variables resueltas, @media aplanado.

function variablesDeLaEscala() {
  const bloque = baseCss.match(/\.vh \{([^}]*)\}/)?.[1]
  assert.ok(bloque, 'no se encontró el bloque de variables de .vh')
  const vars = {}
  for (const [, nombre, valor] of bloque.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[nombre] = valor.trim()
  return vars
}
const VARS = variablesDeLaEscala()

/** Un valor de CSS en píxeles, o null si no se puede resolver. `paso` es la perilla de tamaño del texto. */
function aPx(valor, paso = 1) {
  const v = valor.trim()
  let m
  if ((m = v.match(/^(\d+(?:\.\d+)?)px$/))) return Number(m[1])
  if ((m = v.match(/^var\((--[\w-]+)\)$/))) return VARS[m[1]] ? aPx(VARS[m[1]], paso) : null
  if ((m = v.match(/^calc\(\s*(\d+(?:\.\d+)?)px\s*\*\s*var\(--step\)\s*\)$/))) return Number(m[1]) * paso
  return null
}

function reglasDe(css) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const reglas = []
  for (const [, selectores, cuerpo] of sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declaraciones = []
    for (const par of cuerpo.split(';')) {
      const i = par.indexOf(':')
      if (i > 0) declaraciones.push([par.slice(0, i).trim(), par.slice(i + 1).trim()])
    }
    reglas.push({ selectores: selectores.split(',').map((s) => s.trim()), declaraciones })
  }
  return reglas
}
const REGLAS = reglasDe(calleCss)

/** El tamaño de letra de una declaración `font-size` o `font`. */
function tamanioDeLetra([propiedad, valor], paso = 1) {
  if (propiedad === 'font-size') return aPx(valor, paso)
  if (propiedad === 'font') {
    const m = valor.match(/(var\(--t-[a-z0-9]+\)|\d+(?:\.\d+)?px)(?:\/[\d.]+)?/)
    return m ? aPx(m[1], paso) : null
  }
  return undefined
}

const declaracionesDe = (selector) =>
  REGLAS.filter((r) => r.selectores.includes(selector)).flatMap((r) => r.declaraciones)

test('la medición lee la escala real: 16 px de etiqueta y 56 px de toque', () => {
  assert.equal(aPx('var(--t-label)'), 16)
  assert.equal(aPx('var(--t-body)'), 18)
  assert.equal(aPx('var(--tap)'), 56)
  assert.equal(aPx('var(--t-label)', 1.3), 20.8)
  assert.ok(REGLAS.length >= 15, 'el parser tiene que ver las reglas del archivo, incluidas las de @media')
})

test('regla 1: ninguna letra de los avisos nuevos baja de 16 px, con el texto normal ni agrandado', () => {
  const medidos = new Set()
  for (const regla of REGLAS) {
    for (const declaracion of regla.declaraciones) {
      for (const paso of [1, 1.15, 1.3]) {
        const px = tamanioDeLetra(declaracion, paso)
        if (px === undefined) continue
        assert.notEqual(px, null, `no se pudo medir ${declaracion.join(': ')} en ${regla.selectores[0]}`)
        assert.ok(px >= 16, `${regla.selectores[0]}: ${declaracion.join(': ')} da ${px}px`)
        medidos.add(regla.selectores[0])
      }
    }
  }
  // Los cuatro componentes con texto tienen su tamaño declarado y medido.
  assert.deepEqual([...medidos].sort(), [
    '.vh .avisoCalle', '.vh .avisoCalleBoton', '.vh .estadoSinSenal', '.vh .estadoSinSenalBoton',
  ])
})

test('regla 2: todo lo que se toca mide 56 px de alto como mínimo', () => {
  const botones = [...new Set(REGLAS.flatMap((r) => r.selectores).filter((s) => /Boton$/.test(s)))]
  const propios = botones.filter((s) => s.split(' ').length === 2)
  assert.deepEqual(propios.sort(), ['.vh .avisoCalleBoton', '.vh .estadoSinSenalBoton'])
  // Las variantes (el botón de adentro de un aviso de color) solo cambian el color.
  for (const variante of botones.filter((s) => !propios.includes(s))) {
    for (const [propiedad] of declaracionesDe(variante)) {
      assert.match(propiedad, /^(background|color)$/, `${variante} cambia ${propiedad}`)
    }
  }
  for (const selector of propios) {
    const alto = declaracionesDe(selector).find(([p]) => p === 'min-height')
    assert.ok(alto, `${selector} no declara min-height`)
    assert.ok(aPx(alto[1]) >= 56, `${selector}: ${alto[1]}`)
  }
  // Los avisos enteros también: el de deshacer es de 56 px.
  for (const selector of ['.vh .avisoCalle', '.vh .estadoSinSenal']) {
    const alto = declaracionesDe(selector).find(([p]) => p === 'min-height')
    assert.ok(alto && aPx(alto[1]) >= 56, `${selector}: ${alto?.[1]}`)
  }
})

test('regla 2: ninguna regla fija una altura que achique un control por debajo de 56 px', () => {
  for (const regla of REGLAS) {
    for (const [propiedad, valor] of regla.declaraciones) {
      if (propiedad !== 'height' && propiedad !== 'max-height') continue
      const px = aPx(valor)
      assert.ok(px === null || px >= 56, `${regla.selectores[0]}: ${propiedad}: ${valor}`)
    }
  }
  // En teléfonos angostos el botón crece a todo el ancho; no se achica.
  const angosto = calleCss.slice(calleCss.indexOf('@media (max-width: 360px)'))
  assert.doesNotMatch(angosto, /min-height:\s*(?:[0-4]?\d)px/)
})

test('el estilo base de botones de la vista no se pisa: los nuevos nacen de .vh', () => {
  for (const regla of REGLAS) {
    for (const selector of regla.selectores) assert.match(selector, /^\.vh\b/, selector)
  }
  assert.match(calleCss, /\.vh \.avisoCalle\[hidden\] \{ display: none; \}/)
  assert.match(calleCss, /\.vh \.estadoSinSenal\[hidden\] \{ display: none; \}/)
})

// ------------------------------------------------- icono más palabra

const iconosPermitidos = new Set([...iconosTs.matchAll(/\| '([a-z-]+)'/g)].map((m) => m[1]))
const iconosEnSprite = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]))
const palabras = (texto) => texto.trim().split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p))

function estadosDeLosAvisos() {
  const envio = []
  for (const enLinea of [true, false]) {
    for (const conError of [true, false]) {
      for (const cantidad of [1, 3]) envio.push(textoDeEnvio('pendientes', { cantidad, conError, enLinea }))
    }
  }
  envio.push(textoDeEnvio('enviado', { cantidad: 0, conError: false, enLinea: true }))
  const precarga = [
    { fase: 'guardando', hechas: 3, total: 90 }, { fase: 'lista' },
    { fase: 'incompleta', motivo: 'fallas' }, { fase: 'incompleta', motivo: 'sin-cache' },
    { fase: 'ahorro-de-datos' },
  ].map(describirPrecarga)
  const marca = ['recorrido', 'no_accesible', 'revisitar', 'sin_dato']
    .map((estado) => ({ texto: textoDeMarca(estado, { tipo: 'manzana', etiqueta: 'b' }), icono: 'completo' }))
  const copia = ['red', 'otra'].map((causa) => ({ texto: mensajeDeCopia(new Date().toISOString(), causa), icono: 'sin-conexion' }))
  return { envio, precarga, marca, copia }
}

test('regla 3: cada aviso lleva un icono que existe y palabras enteras', () => {
  const { envio, precarga, marca, copia } = estadosDeLosAvisos()
  const todos = [
    ...envio, ...precarga, ...marca, ...copia,
    { texto: TEXTO_DESHECHO, icono: 'deshacer' },
    { texto: 'Deshacer', icono: 'deshacer' },
    ...precarga.flatMap((p) => (p.accion ? [{ texto: p.accion.etiqueta, icono: p.accion.icono }] : [])),
  ]
  assert.ok(todos.length >= 20)
  for (const aviso of todos) {
    assert.ok(iconosPermitidos.has(aviso.icono), `icono fuera del tipo IconoNombre: ${aviso.icono}`)
    assert.ok(iconosEnSprite.has(aviso.icono), `icono sin dibujo en el sprite: ${aviso.icono}`)
    assert.ok(palabras(aviso.texto).length >= 1 && /\p{L}{4,}/u.test(aviso.texto), `sin palabras: ${aviso.texto}`)
  }
  // Los avisos de estado dicen más que una palabra suelta.
  for (const aviso of [...envio, ...precarga, ...copia]) assert.ok(palabras(aviso.texto).length >= 2, aviso.texto)
})

test('regla 3: los estados que cambian de color también cambian de icono y de palabras', () => {
  const { precarga } = estadosDeLosAvisos()
  const [guardando, lista, incompleta, , ahorro] = precarga
  const distintos = (a, b) => a.icono !== b.icono && a.texto !== b.texto
  for (const [x, y] of [[guardando, lista], [lista, incompleta], [lista, ahorro], [incompleta, ahorro], [guardando, incompleta]]) {
    assert.ok(distintos(x, y), `${x.texto} / ${y.texto}`)
  }
  const pendientes = textoDeEnvio('pendientes', { cantidad: 2, conError: false, enLinea: false })
  const enviando = textoDeEnvio('pendientes', { cantidad: 2, conError: false, enLinea: true })
  const trabadas = textoDeEnvio('pendientes', { cantidad: 2, conError: true, enLinea: true })
  const enviado = textoDeEnvio('enviado', { cantidad: 0, conError: false, enLinea: true })
  for (const [x, y] of [[pendientes, enviado], [enviando, enviado], [trabadas, enviado], [trabadas, enviando], [pendientes, trabadas]]) {
    assert.ok(distintos(x, y), `${x.texto} / ${y.texto}`)
  }
})

test('regla 3: cada botón nuevo lleva un <Icono> y su palabra', () => {
  let botones = 0
  for (const [archivo, fuente] of Object.entries(componentes)) {
    for (const [, cuerpo] of fuente.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      botones++
      assert.match(cuerpo, /<Icono nombre=/, `${archivo}: un botón sin icono`)
      const sinIcono = cuerpo.replace(/<Icono[^>]*\/>/g, '').trim()
      assert.ok(/\p{L}{4,}/u.test(sinIcono) || /\{[\w.]*etiqueta\}/.test(sinIcono), `${archivo}: un botón sin palabra: ${sinIcono}`)
    }
  }
  assert.equal(botones, 3, 'Deshacer, Reintentar (marcas) y el botón del mapa guardado')
})

test('regla 3: cada aviso muestra su icono junto a su texto, no uno de los dos', () => {
  assert.match(componentes['AvisoDeshacer.tsx'], /<Icono nombre="completo"[^>]*\/>\s*<span className="avisoCalleTexto">\{marca\.texto\}<\/span>/)
  assert.match(componentes['MarcasPendientes.tsx'], /<Icono nombre=\{frase\.icono\}[^>]*\/>\s*<span className="avisoCalleTexto">\{frase\.texto\}<\/span>/)
  assert.match(componentes['MapaSinSenal.tsx'], /<Icono nombre=\{vista\.icono\}[^>]*\/>\s*<span className="estadoSinSenalTexto">\{vista\.texto\}<\/span>/)
  assert.match(componentes['MapaSinSenal.tsx'], /<Icono nombre="sin-conexion"[^>]*\/>\s*<span className="avisoCalleTexto">\{mensajeDeCopia/)
  // Las regiones de estado viven siempre (aunque estén ocultas) para que se anuncien.
  for (const fuente of Object.values(componentes)) assert.match(fuente, /role="status"/)
})

// ------------------------------------------------- la página los usa

test('la página arma la vista de la calle con los cuatro pedidos', () => {
  // H6: pantalla encendida solo con el mapa propio en modo marcar.
  assert.match(pagina, /usePantallaEncendida\(editando && vista === 'territorio'\)/)
  // H3: aviso de deshacer y el camino de siempre (eventos nuevos, no borrado).
  assert.match(pagina, /<AvisoDeshacer marca=\{enMapa \? reciente : null\}/)
  assert.match(pagina, /entradasParaDeshacer\(reciente\.cambios, miTerritorio\.id, profile\.id\)/)
  assert.match(pagina, /await enqueue\(entrada\)/)
  // H4: marcas pendientes a partir de la cola.
  assert.match(pagina, /resumirCola\(cola\.events\)/)
  assert.match(pagina, /<MarcasPendientes[\s\S]*?enLinea=\{online\}/)
  // H1: copia al cargar, copia si falla, y límite de espera.
  assert.match(pagina, /guardarCopiaDeMapa\(almacenDelTelefono\(\)/)
  assert.match(pagina, /leerCopiaDeMapa<Manzana, Lado>\(almacenDelTelefono\(\)/)
  assert.match(pagina, /conLimiteDeCarga\(Promise\.all\([\s\S]*?\), LIMITE_CARGA_MAPA_MS\)/)
  assert.match(pagina, /<EstadoMapaSinSenal estado=\{mapaSinSenal\.estado\}/)
  assert.match(pagina, /<AvisoDeCopia copia=/)
  assert.match(pagina, /import '\.\.\/styles\/vista-hermano-calle\.css'/)
})

test('la copia solo se guarda del territorio propio y solo desde lo que trajo la base', () => {
  const guardado = pagina.match(/if \(asignadoRef\.current && perfilIdRef\.current\) \{([\s\S]*?)\n      \}\n/)
  assert.ok(guardado, 'no se encontró el guardado de la copia')
  assert.match(guardado[1], /manzanas: manzanasNuevas/)
  assert.match(guardado[1], /lados: ladosNuevos/)
  assert.match(guardado[1], /estados: estadosNuevos/)
  assert.match(guardado[1], /guardadoEl: new Date\(\)\.toISOString\(\)/)
  // Las marcas pendientes no se mezclan en la copia: viven en la cola.
  assert.doesNotMatch(guardado[1], /cola\./)
})

test('el algoritmo de caras y el dibujo de las líneas siguen como estaban', () => {
  assert.match(pagina, /function haciaAdentro\(punto: \[number, number\], centro: \[number, number\]\): \[number, number\] \{/)
  assert.match(pagina, /const k = d \? Math\.min\(9 \/ d, 0\.35\) : 0/)
  assert.match(pagina, /\(centro\[1\] - punto\[1\]\) \* Math\.cos\(\(punto\[0\] \* Math\.PI\) \/ 180\) \* 111320/)
  assert.match(pagina, /\(centro\[0\] - punto\[0\]\) \* 110540/)
  assert.match(pagina, /haciaAdentro\(\[y, x\], centro\)/)
  assert.match(pagina, /L\.polyline\(linea, \{ color: '#000', opacity: 0, weight: 26 \}\)/)
  assert.match(pagina, /weight: ok \? 7 : 5,/)
})

test('las piezas de lógica no dependen del navegador ni de Vite, así que se prueban en Node', () => {
  for (const archivo of ['teselasPrecarga', 'copiaDeMapa', 'almacenSinSenal', 'deshacerMarca', 'marcasPendientes', 'pantallaEncendida']) {
    const fuente = leer(`src/lib/${archivo}.ts`)
    assert.doesNotMatch(fuente, /import\.meta\.env/, archivo)
    assert.doesNotMatch(fuente, /from '\.\/(?:fondoMapa|supabase)/, archivo)
  }
})

test('la precarga toma las URLs de fondoMapa, respeta el ahorro de datos y usa la caché acordada', () => {
  const gancho = leer('src/lib/useMapaSinSenal.ts')
  assert.match(gancho, /FONDO_MAPA\.url/)
  assert.match(gancho, /saveData === true/)
  assert.match(gancho, /NOMBRE_CACHE_TESELAS/)
  assert.match(gancho, /devicePixelRatio > 1/)
  assert.match(leer('src/lib/teselasPrecarga.ts'), /NOMBRE_CACHE_TESELAS = 'teselas-mapa'/)
})
