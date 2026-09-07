import { useEffect, useMemo, useRef, useState } from 'react'

export type TerritorioOpcion = {
  id: string
  name: string
  marca?: 'tuyo' | 'pedido' | 'reservado' | null
}

type ElegirTerritorioProps = {
  territorios: TerritorioOpcion[]
  valorId: string | null
  etiqueta?: string
  deshabilitado?: boolean
  alElegir: (id: string | null) => void
}

export function ElegirTerritorio({
  territorios,
  valorId,
  etiqueta = 'Elegir territorio',
  deshabilitado = false,
  alElegir,
}: ElegirTerritorioProps) {
  const [abierto, setAbierto] = useState(false)
  const [consulta, setConsulta] = useState('')
  const campo = useRef<HTMLInputElement>(null)
  const elegido = territorios.find((territorio) => territorio.id === valorId)

  const visibles = useMemo(() => {
    const q = consulta.trim()
    if (!q) return territorios
    return territorios.filter((territorio) => territorio.name.replace(/\s+/g, '').includes(q))
  }, [consulta, territorios])

  useEffect(() => {
    if (!abierto) return
    campo.current?.focus()
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
        className="boton secundario elegir-territorio"
        disabled={deshabilitado}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={() => {
          setConsulta('')
          setAbierto(true)
        }}
      >
        <span>
          <small>{etiqueta}</small>
          <strong>{elegido ? `Territorio ${elegido.name}` : 'Elegí uno…'}</strong>
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {abierto ? (
        <div className="sobre" role="dialog" aria-modal="true" aria-label={etiqueta}>
          <div className="sobreBarra">
            <h2>
              {etiqueta}
              <small>Escribí el número o tocá uno</small>
            </h2>
            <button type="button" className="boton secundario" onClick={() => setAbierto(false)}>
              Cerrar
            </button>
          </div>
          <div className="sobreCuerpo elegir-territorio-cuerpo">
            <label className="sub">
              Número del territorio
              <input
                ref={campo}
                className="boton secundario"
                inputMode="numeric"
                autoComplete="off"
                value={consulta}
                onChange={(evento) => setConsulta(evento.target.value.replace(/\D/g, ''))}
              />
            </label>
            <div className="elegir-territorio-grilla">
              {visibles.map((territorio) => (
                <button
                  key={territorio.id}
                  type="button"
                  className={
                    territorio.id === valorId
                      ? 'boton secundario elegir-territorio-celda elegida'
                      : 'boton secundario elegir-territorio-celda'
                  }
                  onClick={() => {
                    alElegir(territorio.id)
                    setAbierto(false)
                  }}
                >
                  <strong>{territorio.name}</strong>
                  {territorio.marca === 'tuyo' ? <small>Tuyo</small> : null}
                  {territorio.marca === 'pedido' ? <small>Pedido</small> : null}
                  {territorio.marca === 'reservado' ? <small>Reservado</small> : null}
                </button>
              ))}
            </div>
            {visibles.length === 0 ? (
              <p className="sub">Ningún territorio tiene ese número.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
