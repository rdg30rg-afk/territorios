import { useEffect, useId, useRef, type ReactNode } from 'react'
import '../styles/modal.css'
import { Icono } from './Icono'

/**
 * UNA VENTANA QUE SE ABRE ENCIMA, SIN PERDER EL LUGAR
 *
 * El formulario de alta y edicion vivia debajo de la tabla. Apretar
 * "Editar" lo cargaba y no se veia nada: medido en Salidas, el
 * formulario quedaba a 41.614 px de la ventana -- cuarenta y dos
 * pantallas. Llevar la pantalla hasta ahi lo hacia visible pero te sacaba
 * del lugar donde estabas mirando, y volver era buscar de nuevo la fila.
 *
 * Usa el <dialog> del navegador y no un div con position:fixed. Eso trae
 * hechas cuatro cosas que si se reimplementan casi siempre salen mal:
 * el foco queda atrapado adentro, Escape cierra, el fondo se vuelve
 * inerte para el teclado y el lector de pantalla, y al cerrar el foco
 * vuelve solo a donde estaba.
 *
 * Cerrar es siempre posible -- Escape, la X, el fondo, Cancelar-- porque
 * esto no es una confirmacion de algo destructivo: es un formulario.
 */
export function Modal({
  abierto,
  alCerrar,
  titulo,
  bajada,
  children,
}: {
  abierto: boolean
  alCerrar: () => void
  titulo: string
  bajada?: string
  children: ReactNode
}) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()
  // Solo se cierra por el fondo si el botón se apretó Y se soltó ahí: si no,
  // seleccionar texto arrastrando y soltar afuera cerraba el modal.
  const apretoEnElFondo = useRef(false)

  useEffect(() => {
    const nodo = dialogo.current
    if (!nodo) return

    if (abierto && !nodo.open) nodo.showModal()
    if (!abierto && nodo.open) nodo.close()
  }, [abierto])

  // El navegador puede cerrarlo por su cuenta (Escape). Sin esto, el
  // estado de React se quedaria creyendo que sigue abierto y no se
  // volveria a abrir nunca mas.
  useEffect(() => {
    const nodo = dialogo.current
    if (!nodo) return

    const avisar = () => alCerrar()
    nodo.addEventListener('close', avisar)
    return () => nodo.removeEventListener('close', avisar)
  }, [alCerrar])

  return (
    <dialog
      ref={dialogo}
      className="modal"
      aria-labelledby={idTitulo}
      // Un click en el fondo tiene como destino el <dialog> mismo; uno
      // adentro tiene como destino algo de la tarjeta. Asi se distingue
      // sin poner un div extra que tape la pantalla.
      onMouseDown={(evento) => {
        apretoEnElFondo.current = evento.target === dialogo.current
      }}
      onClick={(evento) => {
        const cierra = apretoEnElFondo.current && evento.target === dialogo.current
        apretoEnElFondo.current = false
        if (cierra) alCerrar()
      }}
    >
      <div className="modal-tarjeta">
        <header className="modal-cabecera">
          <div>
            <h3 id={idTitulo}>{titulo}</h3>
            {bajada ? <p>{bajada}</p> : null}
          </div>
          <button
            type="button"
            className="modal-cerrar"
            onClick={alCerrar}
            aria-label="Cerrar"
          >
            <Icono nombre="cerrar" tamaño={18} />
          </button>
        </header>

        <div className="modal-cuerpo">{children}</div>
      </div>
    </dialog>
  )
}
