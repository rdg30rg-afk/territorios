import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/desplegable.css'

export type Opcion = { valor: string; texto: string; deshabilitada?: boolean }

/**
 * UNA LISTA DESPLEGABLE QUE SE PUEDE MIRAR
 *
 * El <select> del navegador se deja estilar por fuera -- borde, flecha,
 * tipografia-- pero la lista que se abre es del sistema operativo y no la
 * toca ninguna CSS. En Salidas hay 113 desplegables con 4.170 opciones
 * entre todos: ahi el desplegable no es un detalle, es el control
 * principal de la pantalla.
 *
 * Tres cosas que hay que resolver y que no son obvias:
 *
 * 1. RECORTE. La grilla del planificador vive dentro de
 *    .outing-schedule-shell, que tiene overflow:hidden. Una lista dibujada
 *    en su lugar quedaria cortada. Por eso va a un portal en el body con
 *    posicion fija, y se reubica sola al hacer scroll o cambiar el tamanio.
 *
 * 2. TECLADO. Un <select> nativo se maneja con flechas, Inicio, Fin, Enter
 *    y escribiendo las primeras letras. Si se reemplaza hay que devolver
 *    todo eso o se pierde para quien no usa mouse.
 *
 * 3. LISTAS LARGAS. La de conductores tiene 28 nombres. A partir de ocho
 *    aparece un buscador: bajar 28 renglones con la flecha es peor que
 *    escribir tres letras.
 *
 * De paso, las opciones solo existen en el DOM mientras la lista esta
 * abierta. Antes los 4.170 <option> estaban siempre presentes.
 */
export function Desplegable({
  valor,
  opciones,
  alElegir,
  deshabilitado = false,
  etiqueta,
  className = '',
}: {
  valor: string
  opciones: Opcion[]
  alElegir: (valor: string) => void
  deshabilitado?: boolean
  etiqueta: string
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [activa, setActiva] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const [caja, setCaja] = useState<{ top: number; left: number; width: number; arriba: boolean }>()

  const disparador = useRef<HTMLButtonElement>(null)
  // Donde se dibuja la lista. Normalmente el body, pero si el desplegable
  // esta adentro de un <dialog> abierto tiene que ir adentro de ese
  // dialog: showModal() lo pone en el "top layer" del navegador, que esta
  // por encima de cualquier z-index, asi que una lista colgada del body
  // queda tapada por la ventana. Se veia justo asi -- solo asomaba el
  // pedazo que sobresalia de la tarjeta.
  const [donde, setDonde] = useState<HTMLElement | null>(null)
  const lista = useRef<HTMLDivElement>(null)
  const tecleado = useRef({ texto: '', cuando: 0 })

  const elegida = opciones.find((o) => o.valor === valor)
  const conBuscador = opciones.length > 8

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return opciones
    return opciones.filter((o) => o.texto.toLowerCase().includes(q))
  }, [opciones, busqueda])

  const ubicar = () => {
    const nodo = disparador.current
    if (!nodo) return
    const r = nodo.getBoundingClientRect()
    const altoLista = Math.min(320, visibles.length * 38 + (conBuscador ? 52 : 0) + 12)
    const abajo = window.innerHeight - r.bottom
    // Si no entra abajo pero si arriba, se abre para arriba. Una lista que
    // se sale de la pantalla no se puede usar.
    const arriba = abajo < altoLista && r.top > abajo
    setCaja({
      top: arriba ? r.top - altoLista - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      arriba,
    })
  }

  useLayoutEffect(() => {
    if (!abierto) return
    ubicar()
    const alMover = () => ubicar()
    window.addEventListener('scroll', alMover, true)
    window.addEventListener('resize', alMover)
    return () => {
      window.removeEventListener('scroll', alMover, true)
      window.removeEventListener('resize', alMover)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, visibles.length])

  useEffect(() => {
    if (!abierto) return
    const afuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (!disparador.current?.contains(t) && !lista.current?.contains(t)) cerrar()
    }
    document.addEventListener('mousedown', afuera)
    return () => document.removeEventListener('mousedown', afuera)
  })

  // La opcion activa siempre a la vista: sin esto, bajar con la flecha
  // mueve una seleccion que no se ve.
  useEffect(() => {
    if (!abierto) return
    lista.current
      ?.querySelector<HTMLElement>('[data-activa="si"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activa, abierto])

  const abrir = () => {
    if (deshabilitado) return
    setDonde(disparador.current?.closest('dialog[open]') ?? document.body)
    const i = visibles.findIndex((o) => o.valor === valor)
    setActiva(i >= 0 ? i : 0)
    setBusqueda('')
    setAbierto(true)
  }

  const cerrar = () => {
    setAbierto(false)
    setBusqueda('')
    disparador.current?.focus()
  }

  const elegir = (o: Opcion) => {
    if (o.deshabilitada) return
    alElegir(o.valor)
    cerrar()
  }

  const porTeclado = (e: React.KeyboardEvent) => {
    if (!abierto) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        abrir()
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      cerrar()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const o = visibles[activa]
      if (o) elegir(o)
      return
    }
    if (e.key === 'Tab') {
      cerrar()
      return
    }

    const saltos: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 }
    if (saltos[e.key]) {
      e.preventDefault()
      setActiva((i) => {
        const n = visibles.length
        if (!n) return 0
        let j = i
        // Se saltea lo deshabilitado: parar en algo que no se puede elegir
        // deja la flecha "trabada" sin explicacion.
        for (let paso = 0; paso < n; paso++) {
          j = (j + saltos[e.key] + n) % n
          if (!visibles[j].deshabilitada) return j
        }
        return i
      })
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActiva(e.key === 'Home' ? 0 : visibles.length - 1)
      return
    }

    // Escribir letras salta al primero que empieza asi, como el nativo.
    if (!conBuscador && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const ahora = Date.now()
      const t = tecleado.current
      t.texto = ahora - t.cuando > 900 ? e.key : t.texto + e.key
      t.cuando = ahora
      const i = visibles.findIndex((o) =>
        o.texto.toLowerCase().startsWith(t.texto.toLowerCase()),
      )
      if (i >= 0) setActiva(i)
    }
  }

  return (
    <>
      <button
        ref={disparador}
        type="button"
        role="combobox"
        aria-expanded={abierto}
        aria-haspopup="listbox"
        aria-label={etiqueta}
        disabled={deshabilitado}
        className={`desplegable ${elegida && elegida.valor ? '' : 'desplegable-vacio'} ${className}`}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={porTeclado}
      >
        <span className="desplegable-texto">{elegida?.texto ?? etiqueta}</span>
        <span className="desplegable-flecha" aria-hidden="true" />
      </button>

      {abierto && caja && donde
        ? createPortal(
            <div
              ref={lista}
              className={`desplegable-lista ${className}`}
              role="listbox"
              aria-label={etiqueta}
              style={{ top: caja.top, left: caja.left, width: caja.width }}
              onKeyDown={porTeclado}
            >
              {conBuscador ? (
                <input
                  autoFocus
                  className="desplegable-buscar"
                  value={busqueda}
                  placeholder="Buscar…"
                  onChange={(e) => {
                    setBusqueda(e.target.value)
                    setActiva(0)
                  }}
                  onKeyDown={porTeclado}
                />
              ) : null}

              <div className="desplegable-opciones">
                {visibles.length === 0 ? (
                  <p className="desplegable-nada">No hay ninguna que coincida.</p>
                ) : (
                  visibles.map((o, i) => (
                    <button
                      key={o.valor + o.texto}
                      type="button"
                      role="option"
                      aria-selected={o.valor === valor}
                      data-activa={i === activa ? 'si' : 'no'}
                      disabled={o.deshabilitada}
                      className={
                        o.valor === valor ? 'desplegable-opcion elegida' : 'desplegable-opcion'
                      }
                      onMouseEnter={() => setActiva(i)}
                      onClick={() => elegir(o)}
                    >
                      {o.texto}
                    </button>
                  ))
                )}
              </div>
            </div>,
            donde,
          )
        : null}
    </>
  )
}
