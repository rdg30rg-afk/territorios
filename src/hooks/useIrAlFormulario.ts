import { useEffect, useRef } from 'react'

/**
 * LLEVAR A LA PERSONA HASTA EL FORMULARIO AL EMPEZAR A EDITAR
 *
 * Apretar "Editar" cargaba la fila en el formulario y no pasaba nada
 * visible, porque el formulario vive debajo de la tabla. Medido en
 * Salidas: el titulo cambiaba de "Nueva salida" a "Editar salida" a
 * 41.614 px de la ventana -- cuarenta y dos pantallas para abajo. La
 * accion funcionaba; lo que faltaba era verla.
 *
 * El salto es instantaneo a proposito. Animar cuarenta mil pixeles tarda
 * segundos y marea; aparecer directamente en el formulario se entiende.
 *
 * Ademas se lleva el foco al primer campo: quien usa teclado o lector de
 * pantalla no se entera de un scroll, pero si de donde quedo el cursor.
 */
export function useIrAlFormulario(editandoId: string | null) {
  const formulario = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!editandoId) return

    const nodo = formulario.current
    if (!nodo) return

    nodo.scrollIntoView({ block: 'start' })

    const primero = nodo.querySelector<HTMLElement>(
      'input:not([type="checkbox"]):not([type="radio"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )
    primero?.focus({ preventScroll: true })
  }, [editandoId])

  return formulario
}
