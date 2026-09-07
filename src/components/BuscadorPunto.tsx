import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buscarPuntos,
  esCodigoExacto,
  textoPunto,
  type PuntoEncuentro,
} from '../lib/puntosEncuentro'
import '../styles/desplegable.css'

type BuscadorPuntoProps = {
  puntos: PuntoEncuentro[]
  valorId: string | null
  textoLibre: string
  deshabilitado?: boolean
  etiqueta?: string
  alElegir: (punto: PuntoEncuentro | null, texto: string) => void
}

export function BuscadorPunto({
  puntos,
  valorId,
  textoLibre,
  deshabilitado = false,
  etiqueta = 'Punto de encuentro',
  alElegir,
}: BuscadorPuntoProps) {
  const [abierto, setAbierto] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [activa, setActiva] = useState(0)
  const [caja, setCaja] = useState<{ top: number; left: number; width: number }>()
  const [donde, setDonde] = useState<HTMLElement | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)

  const elegido = puntos.find((punto) => punto.id === valorId) ?? null
  const visibles = useMemo(
    () => buscarPuntos(puntos, consulta || textoLibre),
    [consulta, puntos, textoLibre],
  )

  const rotulo = elegido
    ? textoPunto(elegido)
    : textoLibre

  useLayoutEffect(() => {
    if (!abierto) return
    const nodo = campo.current
    if (!nodo) return
    const r = nodo.getBoundingClientRect()
    const altoLista = Math.min(320, visibles.length * 44 + 12)
    const abajo = window.innerHeight - r.bottom
    const arriba = abajo < altoLista && r.top > abajo
    setCaja({
      top: arriba ? Math.max(8, r.top - altoLista - 4) : r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 280),
    })
    const alMover = () => {
      const actual = campo.current?.getBoundingClientRect()
      if (!actual) return
      setCaja({
        top: actual.bottom + 4,
        left: actual.left,
        width: Math.max(actual.width, 280),
      })
    }
    window.addEventListener('scroll', alMover, true)
    window.addEventListener('resize', alMover)
    return () => {
      window.removeEventListener('scroll', alMover, true)
      window.removeEventListener('resize', alMover)
    }
  }, [abierto, visibles.length])

  useEffect(() => {
    if (!abierto) return
    const afuera = (evento: MouseEvent) => {
      const destino = evento.target as Node
      if (!campo.current?.contains(destino) && !lista.current?.contains(destino)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', afuera)
    return () => document.removeEventListener('mousedown', afuera)
  }, [abierto])

  const abrir = () => {
    if (deshabilitado) return
    setDonde(campo.current?.closest('dialog[open]') ?? document.body)
    setConsulta(elegido ? '' : textoLibre)
    setActiva(0)
    setAbierto(true)
  }

  const elegirPunto = (punto: PuntoEncuentro) => {
    alElegir(punto, punto.nombre)
    setConsulta('')
    setAbierto(false)
  }

  const confirmarTexto = () => {
    const coincidencia =
      visibles.length === 1 && esCodigoExacto(consulta || textoLibre)
        ? visibles[0]
        : null
    if (coincidencia) {
      elegirPunto(coincidencia)
      return
    }
    const texto = (consulta || textoLibre).trim()
    alElegir(null, texto)
    setAbierto(false)
  }

  const porTeclado = (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === 'Escape') {
      evento.preventDefault()
      setAbierto(false)
      return
    }
    if (evento.key === 'Enter') {
      evento.preventDefault()
      const visible = visibles[activa]
      if (abierto && visible) {
        elegirPunto(visible)
        return
      }
      confirmarTexto()
      return
    }
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault()
      if (!abierto) {
        abrir()
        return
      }
      const salto = evento.key === 'ArrowDown' ? 1 : -1
      setActiva((actual) => {
        const total = visibles.length
        if (!total) return 0
        return (actual + salto + total) % total
      })
    }
  }

  return (
    <>
      <input
        ref={campo}
        className="buscador-punto"
        value={abierto ? consulta : rotulo}
        disabled={deshabilitado}
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-autocomplete="list"
        role="combobox"
        placeholder="61,1 o una esquina"
        onFocus={abrir}
        onChange={(evento) => {
          setConsulta(evento.target.value)
          setActiva(0)
          if (!abierto) abrir()
          alElegir(null, evento.target.value)
        }}
        onKeyDown={porTeclado}
      />

      {abierto && caja && donde
        ? createPortal(
            <div
              ref={lista}
              className="desplegable-lista buscador-punto-lista"
              role="listbox"
              aria-label={etiqueta}
              style={{ top: caja.top, left: caja.left, width: caja.width }}
            >
              <div className="desplegable-opciones">
                {visibles.length === 0 ? (
                  <p className="desplegable-nada">
                    No hay un punto con eso. Se guarda como dirección nueva.
                  </p>
                ) : (
                  visibles.map((punto, indice) => (
                    <button
                      key={punto.id}
                      type="button"
                      role="option"
                      aria-selected={punto.id === valorId}
                      data-activa={indice === activa ? 'si' : 'no'}
                      className={
                        punto.id === valorId
                          ? 'desplegable-opcion elegida'
                          : 'desplegable-opcion'
                      }
                      onMouseEnter={() => setActiva(indice)}
                      onClick={() => elegirPunto(punto)}
                    >
                      <strong>{textoPunto(punto)}</strong>
                      {punto.barrio ? <small>{punto.barrio}</small> : null}
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
