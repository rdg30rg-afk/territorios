/**
 * Lógica pura del aviso "Hay una versión nueva".
 *
 * Vive aparte del componente para poder probarla sin navegador ni React, y
 * porque la regla de oro es una sola: una actualización nunca se aplica
 * mientras haya marcas de cobertura sin enviar.
 *
 * Cómo se sabe si hay marcas sin enviar: la cola (`coverageOutbox.ts`) guarda
 * en localStorage, bajo una clave por proyecto y usuario, un JSON
 * `{ version, projectRef, userId, events: [...] }`. Acá solo se LEE ese JSON;
 * este archivo nunca escribe ni borra nada de la cola.
 *
 * Cuentan todas las marcas que siguen en la cola, sea cual sea su estado
 * (`pending`, `sending` o `error`): igual que el aviso de `beforeunload` de
 * `useCoverageOutbox`, una marca que sigue ahí es una marca que no llegó.
 */

/**
 * Prefijo de las claves de la cola. Se busca el prefijo sin la versión
 * ("v1") para que un cambio de versión de la cola no deje pasar una
 * actualización con marcas guardadas.
 */
export const PREFIJO_COLA_COBERTURA = 'coverage-outbox:'

/** Cada cuánto se vuelve a mirar la cola mientras el aviso está visible. */
export const INTERVALO_REVISION_MS = 2000

/** Cada cuánto se le pregunta al servidor si hay un worker nuevo. */
export const INTERVALO_BUSCAR_VERSION_MS = 60 * 60 * 1000

type AlmacenLectura = Pick<Storage, 'length' | 'key' | 'getItem'>

export type LecturaCola = {
  /** Marcas que siguen en la cola, sumando todas las cuentas de este navegador. */
  marcas: number
  /** Hay una entrada de la cola que no se pudo leer: no se puede descartar que tenga marcas. */
  ilegible: boolean
}

export type DecisionActualizacion =
  | { puedeActualizar: true; motivo: 'libre'; marcas: 0 }
  | { puedeActualizar: false; motivo: 'marcas'; marcas: number }
  | { puedeActualizar: false; motivo: 'ilegible'; marcas: number }

/**
 * Cuenta las marcas que siguen en la cola de cobertura.
 *
 * Es conservadora: lo que no entiende no lo ignora, lo marca como ilegible
 * (y entonces no se actualiza). Prefiere demorar una actualización antes que
 * pisar una cola que no pudo revisar.
 */
export function leerColaCobertura(almacen: AlmacenLectura): LecturaCola {
  let marcas = 0
  let ilegible = false
  try {
    for (let indice = 0; indice < almacen.length; indice += 1) {
      const clave = almacen.key(indice)
      if (!clave || !clave.startsWith(PREFIJO_COLA_COBERTURA)) continue
      const crudo = almacen.getItem(clave)
      if (crudo === null) continue
      try {
        const eventos = (JSON.parse(crudo) as { events?: unknown } | null)?.events
        if (Array.isArray(eventos)) marcas += eventos.length
        else ilegible = true
      } catch {
        ilegible = true
      }
    }
  } catch {
    // Si ni siquiera se puede recorrer el almacenamiento, no hay forma de
    // saber qué hay adentro.
    ilegible = true
  }
  return { marcas, ilegible }
}

/**
 * Lee la cola del navegador. `localStorage` puede tirar una excepción apenas
 * se lo nombra (ventana privada, datos bloqueados): en ese caso no hay cola
 * que proteger, porque la cola tampoco pudo guardar nada ahí.
 */
export function leerColaDelNavegador(): LecturaCola {
  let almacen: Storage
  try {
    almacen = window.localStorage
  } catch {
    return { marcas: 0, ilegible: false }
  }
  return leerColaCobertura(almacen)
}

export function decidirActualizacion(lectura: LecturaCola): DecisionActualizacion {
  if (lectura.marcas > 0) return { puedeActualizar: false, motivo: 'marcas', marcas: lectura.marcas }
  if (lectura.ilegible) return { puedeActualizar: false, motivo: 'ilegible', marcas: lectura.marcas }
  return { puedeActualizar: true, motivo: 'libre', marcas: 0 }
}

/** Dos lecturas iguales no tienen que volver a dibujar el aviso. */
export function mismaLectura(a: LecturaCola, b: LecturaCola): boolean {
  return a.marcas === b.marcas && a.ilegible === b.ilegible
}

/** Texto de apoyo bajo el título, o null si no hay nada que aclarar. */
export function textoDeEspera(decision: DecisionActualizacion): string | null {
  if (decision.motivo === 'marcas') {
    const cuantas = decision.marcas === 1 ? 'Tenés 1 marca sin enviar' : `Tenés ${decision.marcas} marcas sin enviar`
    return `${cuantas}. Cuando se envíen, tocá Actualizar.`
  }
  if (decision.motivo === 'ilegible') {
    return 'No pudimos revisar tus marcas sin enviar, así que no actualizamos. Probá de nuevo en un rato.'
  }
  return null
}
