import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FONDO_MAPA, HAY_CLAVE_DE_MAPAS } from './fondoMapa'
import {
  almacenDelTelefono,
  guardarRegistroDePrecarga,
  leerRegistroDePrecarga,
} from './almacenSinSenal'
import {
  NOMBRE_CACHE_TESELAS,
  TOPE_TESELAS,
  TOPE_TESELAS_OSM,
  ZOOM_PRECARGA_MAX,
  ZOOM_PRECARGA_MIN,
  clavePrecarga,
  ejecutarPrecarga,
  planificarTeselas,
  recuadroDeManzanas,
  urlDeTesela,
  type EstadoPrecarga,
} from './teselasPrecarga'

const INACTIVA: EstadoPrecarga = { fase: 'inactiva' }

/** `navigator.connection.saveData`: el "ahorro de datos" que activa el propio hermano. */
function hayAhorroDeDatos() {
  const conexion = (navigator as unknown as { connection?: { saveData?: boolean } }).connection
  return conexion?.saveData === true
}

/** ¿Está esta tesela en la caché del service worker? Sin caché, o sin la tesela, no. */
async function estaEnCache(url: string) {
  try {
    if (typeof caches === 'undefined' || !(await caches.has(NOMBRE_CACHE_TESELAS))) return false
    const cache = await caches.open(NOMBRE_CACHE_TESELAS)
    return Boolean(await cache.match(url, { ignoreVary: true }))
  } catch {
    return false
  }
}

/**
 * Pide la tesela. Quien la guarda es el service worker (caché
 * `teselas-mapa`): acá solo se la pide y se la lee entera para soltar la
 * conexión.
 */
async function traerTesela(url: string, senal?: AbortSignal) {
  const respuesta = await fetch(url, { signal: senal, credentials: 'omit' })
  try {
    await respuesta.arrayBuffer()
  } catch {
    return { ok: false }
  }
  return { ok: respuesta.ok }
}

/**
 * Guarda en el teléfono las teselas del territorio (zooms 15 a 18) para que el
 * fondo del mapa se vea sin señal. Corre una vez por territorio y por sesión; si
 * ya se bajó hace poco y siguen en la caché, no vuelve a pedir nada.
 */
export function useMapaSinSenal(args: {
  activo: boolean
  userId: string | undefined
  territorioId: string | undefined
  manzanas: Parameters<typeof recuadroDeManzanas>[0]
}) {
  const { activo, userId, territorioId, manzanas } = args
  const [estado, setEstado] = useState<EstadoPrecarga>(INACTIVA)
  const [intento, setIntento] = useState(0)
  const forzar = useRef(false)
  const terminada = useRef<string | null>(null)

  const retina = typeof window !== 'undefined' && window.devicePixelRatio > 1
  const tope = HAY_CLAVE_DE_MAPAS ? TOPE_TESELAS : TOPE_TESELAS_OSM
  const proveedor = HAY_CLAVE_DE_MAPAS ? 'maptiler' : 'osm'
  const recuadro = useMemo(() => recuadroDeManzanas(manzanas), [manzanas])
  const clave = recuadro && territorioId
    ? clavePrecarga({
        territorioId, recuadro, retina, tope, proveedor,
        zoomMin: ZOOM_PRECARGA_MIN, zoomMax: ZOOM_PRECARGA_MAX,
      })
    : null
  // El efecto depende de la clave (un texto) y no del recuadro: cada vez que
  // se vuelve a bajar el territorio llega un arreglo nuevo con la misma forma.
  const recuadroActual = useRef(recuadro)
  recuadroActual.current = recuadro

  useEffect(() => {
    const dibujo = recuadroActual.current
    if (!activo || !clave || !dibujo || !userId || !territorioId) {
      setEstado(INACTIVA)
      return
    }
    // En desarrollo no hay service worker: bajar 400 teselas para nada.
    if (import.meta.env.DEV || typeof fetch === 'undefined') return
    const pedidoAMano = forzar.current
    forzar.current = false
    if (!pedidoAMano && terminada.current === clave) {
      setEstado({ fase: 'lista' })
      return
    }

    const control = new AbortController()
    const almacen = almacenDelTelefono()
    const urls = planificarTeselas(dibujo, {
      zoomMin: ZOOM_PRECARGA_MIN, zoomMax: ZOOM_PRECARGA_MAX, tope,
    }).teselas.map((t) => urlDeTesela(FONDO_MAPA.url, t, { retina }))

    ejecutarPrecarga({
      urls,
      clave,
      enLinea: navigator.onLine,
      ahorroDeDatos: hayAhorroDeDatos(),
      forzar: pedidoAMano,
      senal: control.signal,
      alEstado: (nuevo) => { if (!control.signal.aborted) setEstado(nuevo) },
      deps: {
        traer: traerTesela,
        estaEnCache,
        leerRegistro: () => leerRegistroDePrecarga(almacen, userId, territorioId),
        guardarRegistro: (registro) => guardarRegistroDePrecarga(almacen, userId, territorioId, registro),
      },
    })
      .then((final) => {
        if (!control.signal.aborted && final.fase === 'lista') terminada.current = clave
      })
      .catch(() => {
        if (!control.signal.aborted) setEstado({ fase: 'incompleta', motivo: 'fallas' })
      })
    return () => control.abort()
  }, [activo, clave, userId, territorioId, intento, retina, tope])

  // "Reintentar" y "Guardarlo igual" piden lo mismo: bajar de nuevo, aunque
  // el ahorro de datos esté prendido.
  const reintentar = useCallback(() => {
    forzar.current = true
    setIntento((n) => n + 1)
  }, [])

  return { estado, reintentar }
}
