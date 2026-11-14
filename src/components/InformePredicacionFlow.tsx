import { useCallback, useEffect, useRef, useState } from 'react'
import type { useCoverageOutbox } from '../lib/useCoverageOutbox'
import { bloquearFondo, enfocarSinMover } from '../lib/vistaHermanoFondo'
import { fechaConDiaCorta } from '../lib/vistaHermanoSalidas'
import { Icono } from './Icono'
import { SalidaCoverageForm, type CoverageOuting } from './SalidaCoverageForm'
import { SalidaResultadoForm, type SalidaResultadoEstado } from './SalidaResultadoForm'

// 'resultado' = informar solo el resultado, sin pasar por el mapa.
export type InformePredicacionAction = 'recorrido' | 'completo' | 'no_realizada' | 'resultado'

type Outing = CoverageOuting & {
  fecha: string
  hora: string
  terr?: string
  lugar?: string
  tipo?: string
}

type MarcasPendientes = { commit: () => Promise<void>; lados: number; manzanas: number }

function scheduledIso(outing: Outing) {
  const date = new Date(`${outing.fecha}T${outing.hora}:00`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function InformePredicacionFlow({
  outing,
  action,
  queue,
  canCorrect,
  canCorrectOwn = false,
  yaInformada = false,
  onClose,
}: {
  outing: Outing
  action: InformePredicacionAction
  queue: ReturnType<typeof useCoverageOutbox>
  canCorrect: boolean
  /** Pasar true cuando la base deje que quien informó corrija su propio
   *  informe. Hoy solo puede un administrador. */
  canCorrectOwn?: boolean
  /** La salida ya tiene resultado cargado: no se ofrece marcar el mapa, se
   *  muestra directamente lo que se informó. */
  yaInformada?: boolean
  onClose: () => void
}) {
  // Por teléfono o sin territorio no hay mapa que marcar: se informa solo el
  // resultado.
  const sinMapa = !outing.terrId || outing.tipo === 'telefonica'
  const [stage, setStage] = useState<'confirm' | 'coverage' | 'result' | 'done'>(
    yaInformada || action === 'resultado' || (sinMapa && action !== 'no_realizada')
      ? 'result'
      : action === 'recorrido' ? 'coverage' : 'confirm',
  )
  const [coverageDirty, setCoverageDirty] = useState(false)
  const [resultDirty, setResultDirty] = useState(false)
  const [held, setHeld] = useState<MarcasPendientes | null>(null)
  const [marcasError, setMarcasError] = useState<string | null>(null)
  const [reintentando, setReintentando] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const heldRef = useRef<MarcasPendientes | null>(null)
  const onCloseRef = useRef(onClose)
  const dirtyRef = useRef(false)
  // Hay algo que se pierde si se cierra ahora: marcas del mapa sin guardar o
  // un resultado escrito a medias. Con el informe ya guardado o sin cambios,
  // cerrar no pregunta nada.
  const dirty = (stage === 'coverage' && coverageDirty)
    || (stage === 'result' && (Boolean(held) || resultDirty))
    || (stage === 'done' && Boolean(held))
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { heldRef.current = held }, [held])

  // Se arma una sola vez. Antes dependía de onClose, que la página crea de
  // nuevo en cada actualización: cada vez volvía a enfocar «Cerrar» y el
  // teclado se cerraba solo mientras se escribía.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const soltarFondo = bloquearFondo()
    enfocarSinMover(closeRef.current)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dirtyRef.current) setConfirmClose(true)
        else onCloseRef.current()
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
      soltarFondo()
      window.removeEventListener('keydown', onKeyDown)
      enfocarSinMover(previous)
    }
  }, [])

  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const requestClose = () => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // Solo «No se realizó» trae el resultado decidido. En los demás casos nada
  // viene elegido de antemano.
  const resultState: SalidaResultadoEstado | undefined = action === 'no_realizada' ? 'no_realizada' : undefined

  // El resultado se guardó: recién ahora se guardan las marcas del mapa, así
  // no queda un territorio informado con la salida sin resultado.
  const alGuardarResultado = useCallback(() => {
    const marcas = heldRef.current
    if (!marcas) { setStage('done'); return }
    void marcas.commit().then(() => {
      setHeld(null)
      setMarcasError(null)
    }).catch((failure: unknown) => {
      setMarcasError(failure instanceof Error ? failure.message : 'No pudimos conservar las marcas del mapa.')
    }).finally(() => setStage('done'))
  }, [])

  const reintentarMarcas = async () => {
    if (!held || reintentando) return
    setReintentando(true)
    try {
      await held.commit()
      setHeld(null)
      setMarcasError(null)
    } catch (failure) {
      setMarcasError(failure instanceof Error ? failure.message : 'No pudimos conservar las marcas del mapa.')
    } finally {
      setReintentando(false)
    }
  }

  const irAlResultado = () => { setCoverageDirty(false); setStage('result') }
  const territoryName = outing.terr ? `Territorio ${outing.terr}` : outing.lugar || 'esta salida'

  return <div className="sobre informe-predicacion" role="dialog" aria-modal="true" aria-labelledby="informe-titulo" ref={dialogRef}>
    <header className="sobreBarra">
      <div>
        <h2 id="informe-titulo">Informar predicación</h2>
        <small>{fechaConDiaCorta(outing.fecha)} · {outing.hora}</small>
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
        <button type="button" className="boton principal" onClick={() => setStage(action === 'completo' && !sinMapa ? 'coverage' : 'result')}>
          Sí, continuar
        </button>
      </div>
    </main>}

    {stage === 'coverage' && <main className="informe-mapa-cuerpo">
      <div className="informe-instruccion">
        <strong>{action === 'completo' ? 'Revisá el territorio completo' : 'Marcá lo que recorrieron'}</strong>
        <span>{action === 'completo' ? 'Todos los lados están seleccionados.' : 'Pasá el dedo por las calles o elegí las manzanas por letra.'}</span>
        <button type="button" className="boton secundario" onClick={irAlResultado}>
          No marcar nada: informar solo el resultado
        </button>
      </div>
      <SalidaCoverageForm
        outing={outing}
        queue={queue}
        autoOpen
        autoSelectAll={action === 'completo'}
        onCancel={requestClose}
        onDirtyChange={setCoverageDirty}
        onDeferred={(commit, resumen) => {
          setHeld({ commit, ...resumen })
          setCoverageDirty(false)
          setStage('result')
        }}
      />
    </main>}

    {stage === 'result' && <main className="informe-resultado-cuerpo">
      <div className="informe-instruccion">
        <strong>{yaInformada ? 'Esta salida ya tiene informe'
          : action === 'no_realizada' ? 'Contanos por qué no se realizó'
          : held ? 'Último paso' : 'Contanos cómo salió'}</strong>
        <span>{yaInformada
          ? (canCorrect || canCorrectOwn
            ? 'Este es el resultado cargado. Podés corregirlo.'
            : 'Este es el resultado cargado. Si hay que corregirlo, lo hace un administrador.')
          : action === 'no_realizada'
          ? 'Elegí un motivo y agregá un comentario si hace falta.'
          : held
            ? `Marcaste ${held.lados} ${held.lados === 1 ? 'lado' : 'lados'}. Se guardan junto con el resultado, recién cuando toques Guardar.`
            : sinMapa
              ? 'En esta salida no hay un mapa para marcar. Informá solo el resultado.'
              : 'No marcaste nada en el mapa. Se informa solo el resultado.'}</span>
        {!yaInformada && !sinMapa && action !== 'no_realizada' && action !== 'resultado' && <button type="button" className="boton secundario"
          onClick={() => { setHeld(null); setStage('coverage') }}>
          {held ? 'Cambiar lo marcado en el mapa' : 'Volver al mapa'}
        </button>}
      </div>
      {outing.id ? <SalidaResultadoForm
        salidaId={outing.id}
        canReport
        canCorrect={canCorrect}
        canCorrectOwn={canCorrectOwn}
        initialEstado={resultState}
        occurredAt={scheduledIso(outing)}
        autoEdit
        hideOccurredAt
        onDirtyChange={setResultDirty}
        onSaved={alGuardarResultado}
      /> : <div className="informe-confirmacion">
        <h3>No se encontró la salida</h3>
        <p>Cerrá esta pantalla y volvé a abrir la salida desde la lista.</p>
        <button type="button" className="boton secundario" onClick={onClose}>Cerrar</button>
      </div>}
    </main>}

    {stage === 'done' && <main className="informe-confirmacion" role="status">
      <span className="informe-confirmacion-icono" aria-hidden="true"><Icono nombre={marcasError ? 'pendiente' : 'completo'} tamaño={36} /></span>
      <h3>{marcasError ? 'El resultado se guardó, falta el mapa' : 'Predicación informada'}</h3>
      {marcasError ? <>
        <p>El resultado de la salida quedó guardado, pero no pudimos guardar lo que marcaste en el mapa. {marcasError}</p>
        <div className="informe-confirmacion-acciones">
          <button type="button" className="boton secundario" onClick={() => { setHeld(null); setMarcasError(null); onClose() }}>Salir sin las marcas</button>
          <button type="button" className="boton principal" disabled={reintentando} onClick={() => void reintentarMarcas()}>
            {reintentando ? 'Guardando…' : 'Reintentar'}
          </button>
        </div>
      </> : <>
        <p>El resultado quedó guardado. Si alguna marca estaba sin conexión, el teléfono la conservará hasta que el servidor la confirme.</p>
        <button type="button" className="boton principal" onClick={onClose}>Listo</button>
      </>}
    </main>}
    {confirmClose && <div className="informe-descartar" role="alertdialog" aria-modal="true" aria-labelledby="descartar-titulo">
      <div className="informe-confirmacion">
        <h3 id="descartar-titulo">¿Salir sin guardar?</h3>
        <p>{stage === 'coverage'
          ? 'Todavía no guardaste lo que marcaste en el mapa. Si salís ahora, se pierde.'
          : 'El informe todavía no se guardó. Si salís ahora, se pierde lo que cargaste.'}</p>
        <div className="informe-confirmacion-acciones">
          <button type="button" className="boton secundario" onClick={() => setConfirmClose(false)}>Seguir con el informe</button>
          <button type="button" className="boton principal" onClick={onClose}>Salir sin guardar</button>
        </div>
      </div>
    </div>}
  </div>
}
