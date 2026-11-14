import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Icono } from './Icono'
import {
  armarFilasDeSalidas,
  armarTerminados,
  haceCuanto,
  inicioDelDia,
  type CoberturaDeTerritorio,
  type FilaDeSalida,
  type ReservaPersonal,
  type ResultadoReciente,
  type SalidaReciente,
  type TerritorioTerminado,
} from '../lib/inicioAvisos.ts'

/**
 * Lo que ya pasó, para el administrador: las salidas de ayer y de hoy con su
 * resultado (o la falta de él) y los territorios personales que alguien
 * terminó. Los pendientes de "qué te espera" viven aparte.
 */

async function nombresDe(ids: string[]): Promise<Map<string, string>> {
  const nombres = new Map<string, string>()
  if (!supabase || ids.length === 0) return nombres
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids)
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (p.full_name) nombres.set(p.id, p.full_name)
  }
  return nombres
}

const MAX_FILAS = 5

export function SalidasDeHoyYAyer() {
  const [filas, setFilas] = useState<FilaDeSalida[] | null>(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  const [verSinInformar, setVerSinInformar] = useState(false)

  useEffect(() => {
    let vivo = true
    setFilas(null)
    setError(false)
    void (async () => {
      try {
        if (!supabase) throw new Error('sin conexión')
        const ahora = new Date()
        const desde = new Date(inicioDelDia(ahora).getTime() - 86_400_000)
        const hasta = new Date(inicioDelDia(ahora).getTime() + 2 * 86_400_000)
        const salidas = await supabase
          .from('salidas')
          .select('id, title, scheduled_for, tipo')
          .gte('scheduled_for', desde.toISOString())
          .lt('scheduled_for', hasta.toISOString())
          .order('scheduled_for')
          .limit(100)
        if (salidas.error) throw salidas.error
        const lista = (salidas.data ?? []) as SalidaReciente[]
        let resultados: ResultadoReciente[] = []
        if (lista.length) {
          const r = await supabase
            .from('salida_resultado_actual')
            .select('salida_id, estado, motivo, informado_por')
            .in('salida_id', lista.map((s) => s.id))
          if (r.error) throw r.error
          resultados = (r.data ?? []) as ResultadoReciente[]
        }
        const informantes = [...new Set(resultados.map((r) => r.informado_por).filter((x): x is string => !!x))]
        const nombres = await nombresDe(informantes)
        if (vivo) setFilas(armarFilasDeSalidas(lista, resultados, nombres, ahora))
      } catch {
        if (vivo) setError(true)
      }
    })()
    return () => {
      vivo = false
    }
  }, [reload])

  const sinInformar = (filas ?? []).filter((f) => f.puedeInformar)
  const informadas = (filas ?? []).filter((f) => !f.puedeInformar)

  return (
    <section className="panel" aria-labelledby="inicio-salidas-titulo">
      <p className="eyebrow">Salidas</p>
      <h3 id="inicio-salidas-titulo">Salidas de hoy y de ayer</h3>
      {error ? (
        <div className="form-feedback error" role="alert">
          <p>No se pudieron consultar las salidas.</p>
          <button type="button" className="secondary-button" onClick={() => setReload((n) => n + 1)}>
            <Icono nombre="reintentar" tamaño={18} />
            Volver a consultar
          </button>
        </div>
      ) : filas === null ? (
        <p className="lead">Viendo cómo salieron…</p>
      ) : filas.length === 0 ? (
        <p className="table-hint">No hubo salidas programadas ayer ni hoy.</p>
      ) : (
        <ul className="inicio-lista">
          {sinInformar.length >= 3 ? (
            <li className="inicio-aviso">
              <span className="inicio-texto">
                <strong>{sinInformar.length} salidas sin informar</strong>
              </span>
              <button
                type="button"
                className="inicio-accion"
                aria-expanded={verSinInformar}
                onClick={() => setVerSinInformar((v) => !v)}
              >
                {verSinInformar ? 'Ocultar' : 'Ver'} <Icono nombre="siguiente" tamaño={17} />
              </button>
            </li>
          ) : null}
          {sinInformar.length >= 3 && verSinInformar
            ? sinInformar.map((f) => (
                <li key={f.id} className="inicio-aviso">
                  <span className="inicio-texto">
                    <strong>{f.titulo}</strong>
                    <small>
                      {f.cuando} · {f.texto}
                    </small>
                  </span>
                  <Link to={`/salidas?informar=${encodeURIComponent(f.id)}`} className="inicio-accion">
                    Informar <Icono nombre="siguiente" tamaño={17} />
                  </Link>
                </li>
              ))
            : null}
          {(sinInformar.length >= 3 ? informadas : filas).slice(0, MAX_FILAS - (sinInformar.length >= 3 ? 1 : 0)).map((f) => (
            <li key={f.id} className="inicio-aviso">
              <span className="inicio-texto">
                <strong>{f.titulo}</strong>
                <small>
                  {f.cuando} · {f.texto}
                </small>
              </span>
              {f.puedeInformar ? (
                <Link to={`/salidas?informar=${encodeURIComponent(f.id)}`} className="inicio-accion">
                  Informar <Icono nombre="siguiente" tamaño={17} />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {filas && filas.length > MAX_FILAS ? (
        <p className="table-hint"><Link to="/salidas">Ver todas ({filas.length})</Link></p>
      ) : null}
    </section>
  )
}

export function TerritoriosPersonalesTerminados() {
  const [filas, setFilas] = useState<TerritorioTerminado[] | null>(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let vivo = true
    setFilas(null)
    setError(false)
    void (async () => {
      try {
        if (!supabase) throw new Error('sin conexión')
        const ahora = new Date()
        const desde = new Date(ahora.getTime() - 14 * 86_400_000).toISOString()
        const r = await supabase
          .from('territorio_personal_reservas')
          .select('id, territory_id, status, assigned_to, reserved_at, released_at')
          .or(`status.eq.activa,and(status.eq.liberada,released_at.gte.${desde})`)
          .limit(500)
        if (r.error) throw r.error
        const reservas = (r.data ?? []) as ReservaPersonal[]
        const coberturas = new Map<string, CoberturaDeTerritorio>()
        if (reservas.length) {
          const c = await supabase
            .from('cobertura_territorio')
            .select('territory_id, name, pct_metros, ultima_marca, tiene_dato')
            .in('territory_id', [...new Set(reservas.map((x) => x.territory_id))])
          if (c.error) throw c.error
          for (const fila of (c.data ?? []) as CoberturaDeTerritorio[]) coberturas.set(fila.territory_id, fila)
        }
        const nombres = await nombresDe([...new Set(reservas.map((x) => x.assigned_to).filter((x): x is string => !!x))])
        if (vivo) setFilas(armarTerminados(reservas, coberturas, nombres, ahora))
      } catch {
        if (vivo) setError(true)
      }
    })()
    return () => {
      vivo = false
    }
  }, [reload])

  return (
    <section className="panel" aria-labelledby="inicio-terminados-titulo">
      <p className="eyebrow">Territorio personal</p>
      <h3 id="inicio-terminados-titulo">Territorios personales terminados</h3>
      {error ? (
        <div className="form-feedback error" role="alert">
          <p>No se pudieron consultar los territorios personales.</p>
          <button type="button" className="secondary-button" onClick={() => setReload((n) => n + 1)}>
            <Icono nombre="reintentar" tamaño={18} />
            Volver a consultar
          </button>
        </div>
      ) : filas === null ? (
        <p className="lead">Viendo qué territorios se terminaron…</p>
      ) : filas.length === 0 ? (
        <p className="table-hint">Nadie terminó ni devolvió un territorio personal en los últimos 14 días.</p>
      ) : (
        <ul className="inicio-lista">
          {filas.slice(0, MAX_FILAS).map((f) => (
            <li key={f.clave} className="inicio-aviso">
              <span className="inicio-texto">
                <strong>{f.texto}</strong>
                <small>{haceCuanto(f.cuando)}</small>
              </span>
              <Link to="/territorio-personal" className="inicio-accion">
                Ver <Icono nombre="siguiente" tamaño={17} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {filas && filas.length > MAX_FILAS ? (
        <p className="table-hint"><Link to="/territorio-personal">Ver todos ({filas.length})</Link></p>
      ) : null}
    </section>
  )
}
