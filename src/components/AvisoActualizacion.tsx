/// <reference types="vite-plugin-pwa/react" />
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  INTERVALO_BUSCAR_VERSION_MS,
  INTERVALO_REVISION_MS,
  decidirActualizacion,
  leerColaDelNavegador,
  mismaLectura,
  textoDeEspera,
  type LecturaCola,
} from './avisoActualizacionEstado'
import './AvisoActualizacion.css'

let temporizadorBusqueda: number | undefined

/**
 * Aviso fijo abajo: "Hay una versión nueva · Actualizar".
 *
 * Antes la PWA se actualizaba sola y recargaba la pantalla en pleno uso. Ahora
 * el service worker nuevo queda esperando y esta barra le da a la persona la
 * decisión. Dos reglas:
 *
 * - Nunca actualiza sola: solo lo hace al tocar "Actualizar".
 * - Mientras haya marcas de cobertura sin enviar, tampoco al tocar: avisa
 *   cuántas faltan y se habilita sola cuando la cola queda vacía. Recargar
 *   con una marca a medio enviar es justo lo que la cola trata de evitar.
 *
 * Es la vista del hermano: texto de 16 px o más, controles de 56 px de alto
 * como mínimo, y nada que dependa solo del color (icono más palabra).
 */
export function AvisoActualizacion() {
  const [lectura, setLectura] = useState<LecturaCola>(() => leerColaDelNavegador())
  const [aplicando, setAplicando] = useState(false)
  const [fallo, setFallo] = useState(false)
  const barraRef = useRef<HTMLDivElement>(null)

  const {
    needRefresh: [hayVersionNueva],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_urlDelWorker, registro) {
      if (!registro) return
      // Una PWA abierta días seguidos no vuelve a pedir sw.js por su cuenta:
      // se le pregunta una vez por hora si salió una versión nueva. Sin red
      // no se pregunta (fallaría y no sirve de nada).
      window.clearInterval(temporizadorBusqueda)
      temporizadorBusqueda = window.setInterval(() => {
        if (navigator.onLine) void registro.update().catch(() => undefined)
      }, INTERVALO_BUSCAR_VERSION_MS)
    },
  })

  const decision = decidirActualizacion(lectura)

  // Mientras el aviso está a la vista se mira la cola cada pocos segundos: el
  // evento "storage" solo avisa de cambios hechos en OTRA pestaña, y las
  // marcas de esta se guardan sin que nadie lo anuncie.
  useEffect(() => {
    if (!hayVersionNueva) return
    const revisar = () => {
      const nueva = leerColaDelNavegador()
      setLectura((anterior) => (mismaLectura(anterior, nueva) ? anterior : nueva))
    }
    revisar()
    const temporizador = window.setInterval(revisar, INTERVALO_REVISION_MS)
    window.addEventListener('storage', revisar)
    window.addEventListener('online', revisar)
    window.addEventListener('focus', revisar)
    return () => {
      window.clearInterval(temporizador)
      window.removeEventListener('storage', revisar)
      window.removeEventListener('online', revisar)
      window.removeEventListener('focus', revisar)
    }
  }, [hayVersionNueva])

  // La barra tapa el borde de abajo: se avisa su alto para que las barras
  // fijas de la vista del hermano (pestañas y acción pegajosa) se corran
  // hacia arriba en vez de quedar escondidas atrás. Ver AvisoActualizacion.css.
  useEffect(() => {
    const barra = barraRef.current
    if (!hayVersionNueva || !barra) return
    const raiz = document.documentElement
    const medir = () => raiz.style.setProperty('--aviso-actualizacion-alto', `${barra.offsetHeight}px`)
    raiz.classList.add('con-aviso-actualizacion')
    medir()
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    observador?.observe(barra)
    return () => {
      observador?.disconnect()
      raiz.classList.remove('con-aviso-actualizacion')
      raiz.style.removeProperty('--aviso-actualizacion-alto')
    }
  }, [hayVersionNueva])

  const actualizar = useCallback(async () => {
    // Se vuelve a leer la cola justo ahora: lo que se vio hace dos segundos
    // pudo haber cambiado.
    const ahora = leerColaDelNavegador()
    setLectura((anterior) => (mismaLectura(anterior, ahora) ? anterior : ahora))
    if (!decidirActualizacion(ahora).puedeActualizar) return
    setFallo(false)
    setAplicando(true)
    try {
      // Le manda SKIP_WAITING al worker que espera y recarga cuando toma el
      // control.
      await updateServiceWorker(true)
    } catch {
      setAplicando(false)
      setFallo(true)
    }
  }, [updateServiceWorker])

  if (!hayVersionNueva) return null

  const espera = textoDeEspera(decision)
  const bloqueado = !decision.puedeActualizar

  return (
    <div ref={barraRef} className="aviso-actualizacion" role="status" aria-live="polite">
      <div className="aviso-actualizacion-texto">
        <strong>Hay una versión nueva</strong>
        {espera ? <span>{espera}</span> : null}
        {fallo ? <span>No se pudo actualizar. Tocá Actualizar para probar de nuevo.</span> : null}
      </div>
      <button
        type="button"
        className="aviso-actualizacion-boton"
        // aria-disabled y no disabled: el botón sigue enfocable y se lee, y el
        // motivo de la espera está escrito al lado.
        aria-disabled={bloqueado || aplicando}
        onClick={() => {
          if (aplicando) return
          void actualizar()
        }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path
            d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {aplicando ? 'Actualizando…' : 'Actualizar'}
      </button>
    </div>
  )
}
