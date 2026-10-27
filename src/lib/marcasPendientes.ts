/**
 * Marcas pendientes a la vista (H4).
 *
 * Da confianza para seguir trabajando sin señal ("3 marcas esperando señal")
 * y avisa si algo se trabó. Cuando la cola se vacía, pasa a "Todo enviado"
 * unos segundos y desaparece. Se lee de la cola de `useCoverageOutbox`, que
 * no se toca.
 */
import { useEffect, useState } from 'react'
import type { IconoNombre } from './iconos.ts'

/** Cuánto se queda "Todo enviado" antes de irse. */
export const TODO_ENVIADO_MS = 4000

export type ModoDeEnvio = 'oculto' | 'pendientes' | 'enviado'

/**
 * Con marcas en la cola se muestra la cuenta. Que la cola pase de tener marcas
 * a quedar vacía es lo que dispara "Todo enviado"; una cola que ya estaba
 * vacía no dice nada, porque nadie mandó nada.
 */
export function siguienteModoDeEnvio(actual: ModoDeEnvio, cantidad: number): ModoDeEnvio {
  if (cantidad > 0) return 'pendientes'
  return actual === 'pendientes' ? 'enviado' : actual
}

export function resumirCola(eventos: ReadonlyArray<{ status: string }>) {
  return {
    cantidad: eventos.length,
    conError: eventos.some((e) => e.status === 'error'),
  }
}

const marcas = (n: number) => (n === 1 ? '1 marca' : `${n} marcas`)

/**
 * La frase y el icono de cada estado. Siempre van los dos: el color del aviso
 * acompaña, no informa solo.
 */
export function textoDeEnvio(
  modo: ModoDeEnvio,
  datos: { cantidad: number; conError: boolean; enLinea: boolean },
): { texto: string; icono: IconoNombre } | null {
  if (modo === 'oculto') return null
  if (modo === 'enviado') return { texto: 'Todo enviado', icono: 'completo' }
  const { cantidad, conError, enLinea } = datos
  if (!enLinea) return { texto: `${marcas(cantidad)} esperando señal`, icono: 'sin-conexion' }
  if (conError) return { texto: `${marcas(cantidad)} sin enviar`, icono: 'error' }
  return { texto: `Enviando ${marcas(cantidad)}`, icono: 'guardar' }
}

/** El modo que se muestra, con el cambio a "enviado" y el retiro a los pocos segundos. */
export function useModoDeEnvio(cantidad: number): ModoDeEnvio {
  const [modo, setModo] = useState<ModoDeEnvio>(() => siguienteModoDeEnvio('oculto', cantidad))

  useEffect(() => {
    setModo((actual) => siguienteModoDeEnvio(actual, cantidad))
  }, [cantidad])

  useEffect(() => {
    if (modo !== 'enviado') return
    const timer = setTimeout(() => setModo('oculto'), TODO_ENVIADO_MS)
    return () => clearTimeout(timer)
  }, [modo])

  return modo
}
