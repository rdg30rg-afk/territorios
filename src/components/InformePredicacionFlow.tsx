import { useEffect, useRef, useState } from 'react'
import type { useCoverageOutbox } from '../lib/useCoverageOutbox'
import { Icono } from './Icono'
import { SalidaCoverageForm, type CoverageOuting } from './SalidaCoverageForm'
import { SalidaResultadoForm, type SalidaResultadoEstado } from './SalidaResultadoForm'

export type InformePredicacionAction = 'recorrido' | 'completo' | 'no_realizada'

type Outing = CoverageOuting & {
  fecha: string
  hora: string
  terr?: string
  lugar?: string
}

function scheduledIso(outing: Outing) {
  const date = new Date(`${outing.fecha}T${outing.hora}:00`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function InformePredicacionFlow({
  outing,
  action,
  queue,
  canCorrect,
  onClose,
}: {
  outing: Outing
  action: InformePredicacionAction
  queue: ReturnType<typeof useCoverageOutbox>
  canCorrect: boolean
  onClose: () => void
}) {
  const [stage, setStage] = useState<'confirm' | 'coverage' | 'result' | 'done'>(
    action === 'recorrido' ? 'coverage' : 'confirm',
  )
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const dirtyRef = useRef(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dirtyRef.current) setConfirmClose(true)
        else onClose()
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = oldOverflow
      window.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [onClose])

  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const requestClose = () => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  const resultState: SalidaResultadoEstado = action === 'no_realizada' ? 'no_realizada' : 'realizada'
  const territoryName = outing.terr ? `Territorio ${outing.terr}` : outing.lugar || 'esta salida'

  return <div className="sobre informe-predicacion" role="dialog" aria-modal="true" aria-labelledby="informe-titulo" ref={dialogRef}>
    <header className="sobreBarra">
      <div>
        <h2 id="informe-titulo">Informar predicación</h2>
        <small>{outing.fecha} · {outing.hora} · {territoryName}</small>
      </div>
      <button ref={closeRef} type="button" className="boton secundario" onClick={requestClose}>
        <Icono nombre="cerrar" tamaño={18} />Cerrar
      </button>
    </header>

    {stage === 'confirm' && <main className="informe-confirmacion">
      <span className="informe-confirmacion-icono" aria-hidden="true"><Icono nombre={action === 'completo' ? 'completo' : 'pendiente'} tamaño={36} /></span>
      <h3>{action === 'completo' ? '¿Marcar todo el territorio?' : '¿Confirmás que no se realizó?'}</h3>
      <p>{action === 'completo'
        ? `Se informarán como recorridos todos los lados de ${territoryName}. Antes de guardar vas a poder revisarlos en el mapa.`
        : 'Esta opción informa que la salida no se hizo. No cambia ninguna manzana del territorio.'}</p>
      <div className="informe-confirmacion-acciones">
        <button type="button" className="boton secundario" onClick={onClose}>Volver</button>
        <button type="button" className="boton principal" onClick={() => setStage(action === 'completo' ? 'coverage' : 'result')}>
          Sí, continuar
        </button>
      </div>
    </main>}

    {stage === 'coverage' && <main className="informe-mapa-cuerpo">
      {!outing.terrId ? <div className="informe-confirmacion">
        <h3>Falta vincular el territorio</h3>
        <p>Un administrador tiene que vincular esta salida con su territorio antes de que puedas marcar el mapa.</p>
        <button type="button" className="boton secundario" onClick={onClose}>Cerrar</button>
      </div> : <>
        <div className="informe-instruccion">
          <strong>{action === 'completo' ? 'Revisá el territorio completo' : 'Marcá lo que recorrieron'}</strong>
          <span>{action === 'completo' ? 'Todos los lados están seleccionados.' : 'Pasá el dedo por las calles o elegí las manzanas por letra.'}</span>
        </div>
        <SalidaCoverageForm
          outing={outing}
          queue={queue}
          autoOpen
          autoSelectAll={action === 'completo'}
          onCancel={requestClose}
          onDirtyChange={setDirty}
          onSaved={() => setStage('result')}
        />
      </>}
    </main>}

    {stage === 'result' && <main className="informe-resultado-cuerpo">
      <div className="informe-instruccion">
        <strong>{action === 'no_realizada' ? 'Contanos por qué no se realizó' : 'Último paso'}</strong>
        <span>{action === 'no_realizada' ? 'Elegí un motivo y agregá un comentario si hace falta.' : 'Podés dejar una casa para volver o algún comentario útil.'}</span>
      </div>
      <SalidaResultadoForm
        salidaId={outing.id!}
        canReport
        canCorrect={canCorrect}
        initialEstado={resultState}
        occurredAt={scheduledIso(outing)}
        autoEdit
        hideOccurredAt
        onSaved={() => setStage('done')}
      />
    </main>}

    {stage === 'done' && <main className="informe-confirmacion" role="status">
      <span className="informe-confirmacion-icono" aria-hidden="true"><Icono nombre="completo" tamaño={36} /></span>
      <h3>Predicación informada</h3>
      <p>El resultado quedó guardado. Si alguna marca estaba sin conexión, el teléfono la conservará hasta que el servidor la confirme.</p>
      <button type="button" className="boton principal" onClick={onClose}>Listo</button>
    </main>}
    {confirmClose && <div className="informe-descartar" role="alertdialog" aria-modal="true" aria-labelledby="descartar-titulo">
      <div className="informe-confirmacion">
        <h3 id="descartar-titulo">¿Descartar lo marcado?</h3>
        <p>Todavía no guardaste esta selección.</p>
        <div className="informe-confirmacion-acciones">
          <button type="button" className="boton secundario" onClick={() => setConfirmClose(false)}>Seguir marcando</button>
          <button type="button" className="boton principal" onClick={onClose}>Descartar y salir</button>
        </div>
      </div>
    </div>}
  </div>
}
