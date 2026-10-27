/**
 * Pantalla encendida mientras se marca (H6), con Wake Lock.
 *
 * Que la pantalla se apague en plena cuadra y haya que volver a desbloquear
 * corta el trabajo. El navegador suelta el bloqueo solo cuando la pestaña
 * queda oculta, así que se vuelve a pedir al volver (`visibilitychange`).
 * Donde Wake Lock no existe, o el sistema lo niega (ahorro de batería), no
 * pasa nada: la pantalla se apaga como siempre.
 */
import { useEffect } from 'react'

type Centinela = {
  release(): Promise<void>
  addEventListener?(tipo: 'release', escuchador: () => void): void
}
type NavegadorConWakeLock = { wakeLock?: { request(tipo: 'screen'): Promise<Centinela> } }
type DocumentoMinimo = {
  visibilityState: string
  addEventListener(tipo: 'visibilitychange', escuchador: () => void): void
  removeEventListener(tipo: 'visibilitychange', escuchador: () => void): void
}

export type PantallaEncendida = {
  /** Hay Wake Lock en este navegador. */
  soportada: boolean
  activar(): void
  desactivar(): void
  /** Suelta el bloqueo y deja de escuchar. */
  destruir(): void
  /** Hoy tiene el bloqueo tomado. */
  tomada(): boolean
}

export function crearPantallaEncendida(
  entorno: { nav: NavegadorConWakeLock; doc: DocumentoMinimo },
): PantallaEncendida {
  const { nav, doc } = entorno
  let quiere = false
  let centinela: Centinela | null = null
  let pidiendo = false
  let volverAPedir = false
  let destruida = false

  const pedir = async () => {
    if (destruida || !quiere || centinela) return
    if (pidiendo) { volverAPedir = true; return }
    // Con la pestaña oculta el navegador lo rechaza; se pide al volver.
    if (doc.visibilityState !== 'visible') return
    const wakeLock = nav.wakeLock
    if (!wakeLock || typeof wakeLock.request !== 'function') return
    pidiendo = true
    try {
      const nuevo = await wakeLock.request('screen')
      if (destruida || !quiere) {
        await nuevo.release().catch(() => undefined)
      } else {
        centinela = nuevo
        nuevo.addEventListener?.('release', () => { if (centinela === nuevo) centinela = null })
      }
    } catch {
      // Negado (poca batería, sin permiso) o sin soporte real: se sigue sin él.
    } finally {
      pidiendo = false
      if (volverAPedir) { volverAPedir = false; void pedir() }
    }
  }

  const alCambiarVisibilidad = () => { if (doc.visibilityState === 'visible') void pedir() }
  doc.addEventListener('visibilitychange', alCambiarVisibilidad)

  const soltar = () => {
    const actual = centinela
    centinela = null
    if (actual) void actual.release().catch(() => undefined)
  }

  return {
    soportada: Boolean(nav.wakeLock && typeof nav.wakeLock.request === 'function'),
    activar() { quiere = true; void pedir() },
    desactivar() { quiere = false; soltar() },
    destruir() {
      destruida = true
      quiere = false
      doc.removeEventListener('visibilitychange', alCambiarVisibilidad)
      soltar()
    },
    tomada: () => centinela !== null,
  }
}

/** Mantiene la pantalla encendida mientras `quiero` sea verdadero. */
export function usePantallaEncendida(quiero: boolean) {
  useEffect(() => {
    if (!quiero || typeof navigator === 'undefined' || typeof document === 'undefined') return
    const pantalla = crearPantallaEncendida({ nav: navigator as unknown as NavegadorConWakeLock, doc: document })
    pantalla.activar()
    return () => pantalla.destruir()
  }, [quiero])
}
