import { useEffect, useRef, useState } from 'react'

export type OpcionLista = {
  valor: string
  texto: string
  detalle?: string
}

type ElegirDeListaProps = {
  etiqueta: string
  valor: string
  opciones: OpcionLista[]
  vacio?: string
  deshabilitado?: boolean
  alElegir: (valor: string) => void
}

export function ElegirDeLista({
  etiqueta,
  valor,
  opciones,
  vacio = 'Elegí…',
  deshabilitado = false,
  alElegir,
}: ElegirDeListaProps) {
  const [abierto, setAbierto] = useState(false)
  const primero = useRef<HTMLButtonElement>(null)
  const elegido = opciones.find((opcion) => opcion.valor === valor)

  useEffect(() => {
    if (!abierto) return
    primero.current?.focus()
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [abierto])

  return (
    <>
      <button
        type="button"
        className="boton secundario elegir-lista"
        disabled={deshabilitado}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={() => setAbierto(true)}
      >
        <span>
          <small>{etiqueta}</small>
          <strong>{elegido?.texto ?? vacio}</strong>
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {abierto ? (
        <div className="sobre" role="dialog" aria-modal="true" aria-label={etiqueta}>
          <div className="sobreBarra">
            <h2>{etiqueta}</h2>
            <button type="button" className="boton secundario" onClick={() => setAbierto(false)}>
              Cerrar
            </button>
          </div>
          <div className="sobreCuerpo hoja-cuerpo elegir-lista-cuerpo">
            {opciones.length === 0 ? (
              <p className="sub">No hay nada para elegir.</p>
            ) : (
              opciones.map((opcion, indice) => (
                <button
                  key={opcion.valor || `vacio-${indice}`}
                  ref={indice === 0 ? primero : undefined}
                  type="button"
                  className={
                    opcion.valor === valor
                      ? 'boton secundario elegir-lista-opcion elegida'
                      : 'boton secundario elegir-lista-opcion'
                  }
                  onClick={() => {
                    alElegir(opcion.valor)
                    setAbierto(false)
                  }}
                >
                  <strong>{opcion.texto}</strong>
                  {opcion.detalle ? <small>{opcion.detalle}</small> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
