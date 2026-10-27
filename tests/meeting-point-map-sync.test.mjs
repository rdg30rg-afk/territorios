import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  crearAlHacerClic,
  crearSincronizadorDelSelector,
  limitesDelPoligono,
  mismaPosicion,
  ID_FUENTE_TERRITORIO,
} from '../src/lib/meetingPointMapSync.ts'

// Un mapa de mentira que se comporta como MapLibre en lo que importa acá:
// agregar o quitar fuentes y capas antes de que el estilo termine de cargar
// tira "Style is not done loading.", igual que el real.
function mapaFalso() {
  const registro = []
  const fuentes = new Map()
  const capas = new Map()
  let estiloListo = false
  const exigirEstilo = () => {
    if (!estiloListo) throw new Error('Style is not done loading.')
  }
  return {
    registro,
    fuentes,
    capas,
    cargarEstilo() {
      estiloListo = true
    },
    // El estilo se recarga y se lleva lo que se había agregado.
    recargarEstilo() {
      fuentes.clear()
      capas.clear()
    },
    getSource: (id) => fuentes.get(id),
    getLayer: (id) => capas.get(id),
    addSource(id, especificacion) {
      exigirEstilo()
      if (fuentes.has(id)) throw new Error(`Source "${id}" already exists.`)
      registro.push(['addSource', id])
      fuentes.set(id, {
        data: especificacion.data,
        setData(datos) {
          registro.push(['setData', datos])
          this.data = datos
        },
      })
    },
    addLayer(especificacion) {
      exigirEstilo()
      registro.push(['addLayer', especificacion.id])
      capas.set(especificacion.id, especificacion)
    },
    removeLayer(id) {
      exigirEstilo()
      registro.push(['removeLayer', id])
      capas.delete(id)
    },
    removeSource(id) {
      exigirEstilo()
      registro.push(['removeSource', id])
      fuentes.delete(id)
    },
    easeTo: (opciones) => registro.push(['easeTo', opciones]),
    fitBounds: (limites, opciones) => registro.push(['fitBounds', limites, opciones]),
  }
}

function armar() {
  const mapa = mapaFalso()
  const marcadores = []
  const sincronizador = crearSincronizadorDelSelector({
    mapa,
    crearMarcador(posicion) {
      const marcador = {
        posicion,
        quitado: false,
        movimientos: [],
        setLngLat(nueva) {
          this.movimientos.push(nueva)
          this.posicion = nueva
          return this
        },
        remove() {
          this.quitado = true
        },
      }
      marcadores.push(marcador)
      return marcador
    },
  })
  return { mapa, marcadores, sincronizador }
}

const territorio = {
  type: 'Polygon',
  coordinates: [[[-68.53, -31.54], [-68.52, -31.54], [-68.52, -31.53], [-68.53, -31.53], [-68.53, -31.54]]],
}
const otroTerritorio = {
  type: 'Polygon',
  coordinates: [[[-68.6, -31.6], [-68.59, -31.6], [-68.59, -31.59], [-68.6, -31.6]]],
}
const llamadas = (mapa, nombre) => mapa.registro.filter(([que]) => que === nombre)

test('el marcador aparece aunque el estilo todavía no haya cargado', () => {
  // Este era el bug: el efecto del marcador salía si el estilo no estaba
  // cargado y nada lo repetía después.
  const { mapa, marcadores, sincronizador } = armar()
  sincronizador.ponerPosicion([-68.5, -31.5])
  assert.equal(marcadores.length, 1)
  assert.deepEqual(marcadores[0].posicion, [-68.5, -31.5])
  assert.equal(llamadas(mapa, 'easeTo').length, 1)
})

test('el territorio no toca el estilo antes de tiempo y se dibuja cuando carga', () => {
  const { mapa, sincronizador } = armar()
  // Con el estilo sin cargar, el mapa de mentira tira error si le piden algo.
  sincronizador.ponerTerritorio(territorio)
  assert.equal(llamadas(mapa, 'addSource').length, 0)
  assert.equal(llamadas(mapa, 'addLayer').length, 0)

  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  assert.equal(llamadas(mapa, 'addSource').length, 1)
  assert.deepEqual(
    llamadas(mapa, 'addLayer').map(([, id]) => id),
    [`${ID_FUENTE_TERRITORIO}-fill`, `${ID_FUENTE_TERRITORIO}-line`],
  )
  assert.equal(mapa.fuentes.get(ID_FUENTE_TERRITORIO).data.geometry, territorio)
})

test('las señales del estilo se pueden repetir sin duplicar nada', () => {
  // `load`, `style.load` y `styledata` llegan juntas, y `styledata` vuelve a
  // llegar cada vez que el mapa agrega una capa.
  const { mapa, sincronizador } = armar()
  sincronizador.ponerTerritorio(territorio)
  mapa.cargarEstilo()
  for (let i = 0; i < 5; i += 1) sincronizador.estiloCargado()
  assert.equal(llamadas(mapa, 'addSource').length, 1)
  assert.equal(llamadas(mapa, 'addLayer').length, 2)
  assert.equal(llamadas(mapa, 'setData').length, 0)
})

test('si el territorio llega con el estilo ya cargado, se dibuja enseguida', () => {
  const { mapa, sincronizador } = armar()
  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  sincronizador.ponerTerritorio(territorio)
  assert.equal(llamadas(mapa, 'addSource').length, 1)
  assert.equal(llamadas(mapa, 'addLayer').length, 2)
})

test('cambiar de territorio actualiza la fuente y no agrega otra', () => {
  const { mapa, sincronizador } = armar()
  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  sincronizador.ponerTerritorio(territorio)
  sincronizador.ponerTerritorio(otroTerritorio)
  assert.equal(llamadas(mapa, 'addSource').length, 1)
  assert.equal(llamadas(mapa, 'addLayer').length, 2)
  assert.equal(llamadas(mapa, 'setData').length, 1)
  assert.equal(mapa.fuentes.get(ID_FUENTE_TERRITORIO).data.geometry, otroTerritorio)
})

test('sacar el territorio quita las capas y la fuente', () => {
  const { mapa, sincronizador } = armar()
  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  sincronizador.ponerTerritorio(territorio)
  sincronizador.ponerTerritorio(null)
  assert.equal(mapa.capas.size, 0)
  assert.equal(mapa.fuentes.size, 0)
})

test('si el estilo se recarga y se lleva el territorio, vuelve a dibujarse', () => {
  const { mapa, sincronizador } = armar()
  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  sincronizador.ponerTerritorio(territorio)
  mapa.recargarEstilo()
  sincronizador.estiloCargado()
  assert.equal(mapa.fuentes.size, 1)
  assert.equal(mapa.capas.size, 2)
})

test('una capa que faltó en un intento anterior se repone en el siguiente', () => {
  const { mapa, sincronizador } = armar()
  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  sincronizador.ponerTerritorio(territorio)
  mapa.capas.delete(`${ID_FUENTE_TERRITORIO}-line`)
  sincronizador.estiloCargado()
  assert.equal(mapa.capas.size, 2)
  assert.equal(llamadas(mapa, 'addSource').length, 1)
})

test('el flujo completo del componente: props primero, estilo después', () => {
  // Es el orden real al abrir el selector con un punto y un territorio: React
  // corre los efectos con las props, y el estilo carga un cuadro más tarde.
  const { mapa, marcadores, sincronizador } = armar()
  sincronizador.ponerPosicion([-68.5, -31.5])
  sincronizador.ponerTerritorio(territorio)
  assert.equal(marcadores.length, 1)

  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  assert.equal(marcadores.length, 1)
  assert.equal(mapa.fuentes.size, 1)
  assert.equal(mapa.capas.size, 2)
  // Con punto elegido manda el punto: no se encuadra el territorio.
  assert.equal(llamadas(mapa, 'fitBounds').length, 0)
})

test('mover el punto reutiliza el marcador y vuela una vez por cambio real', () => {
  const { mapa, marcadores, sincronizador } = armar()
  sincronizador.ponerPosicion([-68.5, -31.5])
  sincronizador.ponerPosicion([-68.5, -31.5])
  // La vista previa de solo lectura arma un arreglo nuevo en cada render.
  sincronizador.ponerPosicion([-68.5, -31.5])
  assert.equal(llamadas(mapa, 'easeTo').length, 1)

  sincronizador.ponerPosicion([-68.51, -31.51])
  assert.equal(marcadores.length, 1)
  assert.deepEqual(marcadores[0].movimientos, [[-68.51, -31.51]])
  assert.equal(llamadas(mapa, 'easeTo').length, 2)
  assert.deepEqual(llamadas(mapa, 'easeTo')[1][1], {
    center: [-68.51, -31.51],
    zoom: 13,
    duration: 700,
  })
})

test('sin punto, el mapa se acomoda al territorio', () => {
  const { mapa, sincronizador } = armar()
  sincronizador.ponerTerritorio(territorio)
  const [[, limites, opciones]] = llamadas(mapa, 'fitBounds')
  assert.deepEqual(limites, [[-68.53, -31.54], [-68.52, -31.53]])
  assert.deepEqual(opciones, { padding: 34, duration: 700, maxZoom: 15 })
})

test('al sacar el punto, el marcador se va y el mapa vuelve al territorio', () => {
  const { mapa, marcadores, sincronizador } = armar()
  sincronizador.ponerPosicion([-68.5, -31.5])
  sincronizador.ponerTerritorio(territorio)
  assert.equal(llamadas(mapa, 'fitBounds').length, 0)

  sincronizador.ponerPosicion(null)
  assert.equal(marcadores[0].quitado, true)
  assert.equal(llamadas(mapa, 'fitBounds').length, 1)

  // Volver a decir "sin punto" no repite el encuadre.
  sincronizador.ponerPosicion(null)
  assert.equal(llamadas(mapa, 'fitBounds').length, 1)

  // Después de sacar el punto se puede elegir otro: marcador nuevo.
  sincronizador.ponerPosicion([-68.4, -31.4])
  assert.equal(marcadores.length, 2)
  assert.equal(marcadores[1].quitado, false)
})

test('el mismo territorio por segunda vez no vuelve a encuadrar', () => {
  const { mapa, sincronizador } = armar()
  sincronizador.ponerTerritorio(territorio)
  sincronizador.ponerTerritorio(territorio)
  assert.equal(llamadas(mapa, 'fitBounds').length, 1)
})

test('un territorio sin vértices no rompe el encuadre', () => {
  const { mapa, sincronizador } = armar()
  mapa.cargarEstilo()
  sincronizador.estiloCargado()
  sincronizador.ponerTerritorio({ type: 'Polygon', coordinates: [] })
  assert.equal(llamadas(mapa, 'fitBounds').length, 0)
})

test('destruir saca el marcador y deja de reaccionar a lo que llegue tarde', () => {
  const { mapa, marcadores, sincronizador } = armar()
  sincronizador.ponerPosicion([-68.5, -31.5])
  sincronizador.destruir()
  assert.equal(marcadores[0].quitado, true)

  mapa.cargarEstilo()
  sincronizador.ponerTerritorio(territorio)
  sincronizador.estiloCargado()
  sincronizador.ponerPosicion([-68.4, -31.4])
  assert.equal(mapa.fuentes.size, 0)
  assert.equal(marcadores.length, 1)
})

test('mismaPosicion compara por valor y entiende el vacío', () => {
  assert.equal(mismaPosicion(null, null), true)
  assert.equal(mismaPosicion([1, 2], [1, 2]), true)
  assert.equal(mismaPosicion([1, 2], [1, 3]), false)
  assert.equal(mismaPosicion([1, 2], null), false)
  assert.equal(mismaPosicion(null, [1, 2]), false)
})

test('limitesDelPoligono devuelve la caja del anillo exterior', () => {
  assert.deepEqual(limitesDelPoligono(territorio.coordinates), [[-68.53, -31.54], [-68.52, -31.53]])
  assert.equal(limitesDelPoligono([]), null)
  assert.equal(limitesDelPoligono([[]]), null)
})

test('el clic usa el onPick de ahora, no el de cuando se creó el mapa', () => {
  const recibidos = []
  let estado = { soloLectura: false, alElegir: (c) => recibidos.push(['viejo', c]) }
  const alHacerClic = crearAlHacerClic(() => estado)

  alHacerClic({ lngLat: { lng: -68.5, lat: -31.5 } })
  // Cada render de SalidasPage trae una función nueva.
  estado = { soloLectura: false, alElegir: (c) => recibidos.push(['nuevo', c]) }
  alHacerClic({ lngLat: { lng: -68.4, lat: -31.4 } })

  assert.deepEqual(recibidos, [
    ['viejo', [-68.5, -31.5]],
    ['nuevo', [-68.4, -31.4]],
  ])
})

test('en solo lectura o sin onPick, tocar el mapa no elige nada', () => {
  const recibidos = []
  const alElegir = (c) => recibidos.push(c)
  crearAlHacerClic(() => ({ soloLectura: true, alElegir }))({ lngLat: { lng: 1, lat: 2 } })
  crearAlHacerClic(() => ({ soloLectura: false }))({ lngLat: { lng: 1, lat: 2 } })
  assert.deepEqual(recibidos, [])
})

// Lo que no se puede probar sin navegador es que React no rearme el mapa. Lo
// que sí se puede es fijar, sobre el texto del componente, las dos cosas que
// lo causaban: el mapa se crea en un efecto sin dependencias y `onPick` no es
// una de ellas.
test('el componente crea el mapa una sola vez y lee onPick desde un ref', async () => {
  const fuente = await readFile(
    new URL('../src/components/MeetingPointPickerMap.tsx', import.meta.url),
    'utf8',
  )
  assert.equal(fuente.match(/new maplibregl\.Map\(/g)?.length, 1)

  const inicio = fuente.indexOf('new maplibregl.Map(')
  const cierre = fuente.indexOf('\n  }, [', inicio)
  assert.ok(cierre > inicio, 'el efecto que crea el mapa debe tener arreglo de dependencias')
  assert.match(fuente.slice(cierre, cierre + 14), /^\n  \}, \[\]\)/)

  assert.match(fuente, /estadoDelClicRef\.current = \{ soloLectura: readOnly, alElegir: onPick \}/)
  assert.match(fuente, /map\.on\('style\.load'/)
  assert.match(fuente, /map\.on\('load'/)
  assert.match(fuente, /map\.on\('styledata'/)
  // Ya no hay una guarda `if (!map.isStyleLoaded()) return` que descarte el dibujo.
  assert.doesNotMatch(fuente, /!\s*map\??\.isStyleLoaded\(\)/)
})
