/**
 * Mientras una pantalla completa está abierta (el mapa grande, el historial,
 * el informe), la página de atrás no se mueve. `overflow: hidden` en el cuerpo
 * no alcanza en el teléfono: un toque en el mapa podía hacerla correr ~200 px y
 * dejaba el mapa corrido, con una franja en blanco, y los toques siguientes se
 * perdían. Acá el cuerpo queda fijo en su lugar y al cerrar se vuelve al mismo
 * punto. Varias pantallas abiertas a la vez se cuentan: el fondo se suelta
 * recién cuando se cierra la última.
 */
let bloqueos = 0
let guardado: { y: number; style: Partial<CSSStyleDeclaration> } | null = null

export function bloquearFondo(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const body = document.body
  if (bloqueos === 0) {
    const y = window.scrollY || window.pageYOffset || 0
    guardado = {
      y,
      style: {
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
      },
    }
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${y}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
  }
  bloqueos++
  let suelto = false
  return () => {
    if (suelto) return
    suelto = true
    bloqueos = Math.max(0, bloqueos - 1)
    if (bloqueos > 0 || !guardado) return
    const { y, style } = guardado
    guardado = null
    body.style.overflow = style.overflow ?? ''
    body.style.position = style.position ?? ''
    body.style.top = style.top ?? ''
    body.style.left = style.left ?? ''
    body.style.right = style.right ?? ''
    body.style.width = style.width ?? ''
    window.scrollTo(0, y)
  }
}

/** Devuelve el foco sin que la página se desplace hacia él. */
export function enfocarSinMover(el: HTMLElement | null | undefined) {
  try { el?.focus?.({ preventScroll: true }) } catch { /* sin foco */ }
}
