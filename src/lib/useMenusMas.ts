import { useEffect } from 'react'

/**
 * Comportamiento común de los menús `<details class="menu-mas">` del panel
 * («Filtros», «Más», el ≡ de cada fila):
 *  - se cierran con Escape,
 *  - se cierran con un clic (o toque) afuera,
 *  - se cierran al elegir una opción (un botón o enlace de adentro),
 *  - al abrir uno se cierran los demás.
 * Un solo juego de oyentes para toda la app, aunque lo usen varias páginas.
 */

const SELECTOR = 'details.menu-mas'
// Lo que adentro de un menú cuenta como «elegir una opción».
const ELEGIBLE = '.menu-mas-caja, .agenda-filtros-caja'
// Un desplegable (su botón y su lista, que vive en el body) no cierra el menú.
const IGNORAR = '.desplegable, .desplegable-lista, [data-mantener-menu]'

function abiertos(): HTMLDetailsElement[] {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>(`${SELECTOR}[open]`))
}

function cerrarTodos(salvo?: Element | null) {
  for (const menu of abiertos()) if (menu !== salvo) menu.open = false
}

function alPulsar(e: Event) {
  const destino = e.target instanceof Element ? e.target : null
  if (!destino) return
  // Dentro de la lista de un desplegable: no es «afuera» del menú que lo contiene.
  if (destino.closest('.desplegable-lista')) return
  cerrarTodos(destino.closest(SELECTOR))
}

function alHacerClic(e: Event) {
  const destino = e.target instanceof Element ? e.target : null
  if (!destino || destino.closest(IGNORAR)) return
  const accion = destino.closest('button, a')
  if (!accion) return
  const caja = accion.closest(ELEGIBLE)
  const menu = caja?.closest<HTMLDetailsElement>(SELECTOR)
  if (!menu || !menu.open) return
  // Después de que el botón haga lo suyo.
  setTimeout(() => {
    menu.open = false
  }, 0)
}

function alTeclear(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  // Si hay una lista desplegable abierta, el Escape es de ella.
  if (document.querySelector('.desplegable-lista')) return
  const menus = abiertos()
  if (!menus.length) return
  const activo = document.activeElement
  const conFoco = menus.find((m) => activo && m.contains(activo))
  cerrarTodos()
  // Que el foco no se pierda: vuelve al botón del menú.
  conFoco?.querySelector<HTMLElement>('summary')?.focus()
}

function alAbrirAlguno(e: Event) {
  const menu = e.target
  if (menu instanceof HTMLDetailsElement && menu.matches(SELECTOR) && menu.open) cerrarTodos(menu)
}

let usuarios = 0

export function useMenusMas() {
  useEffect(() => {
    usuarios += 1
    if (usuarios === 1) {
      document.addEventListener('pointerdown', alPulsar, true)
      document.addEventListener('click', alHacerClic, true)
      document.addEventListener('keydown', alTeclear)
      // «toggle» no burbujea: se escucha en captura.
      document.addEventListener('toggle', alAbrirAlguno, true)
    }
    return () => {
      usuarios -= 1
      if (usuarios === 0) {
        document.removeEventListener('pointerdown', alPulsar, true)
        document.removeEventListener('click', alHacerClic, true)
        document.removeEventListener('keydown', alTeclear)
        document.removeEventListener('toggle', alAbrirAlguno, true)
      }
    }
  }, [])
}
