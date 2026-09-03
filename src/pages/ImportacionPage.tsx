import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import '../styles/importacion.css'

/**
 * REVISION DE LO IMPORTADO
 *
 * El ETL dejo 3.345 registros del Excel en el staging y ni uno solo paso
 * todavia a las tablas operativas. Eso es a proposito: el origen tiene
 * 4.841 formulas y 33 errores, y hay filas donde la casilla dice una
 * cosa y la observacion escrita dice otra. Ninguna cuenta puede resolver
 * eso; lo resuelve alguien que conoce la congregacion.
 *
 * Esta pantalla es ese paso. Y tiene una regla que la define:
 *
 *   LA PERSONA NO RE-TIPEA EL DATO. Deja registrada su DECISION.
 *
 * El ETL es el unico que sabe leer la forma del Excel. Si acá se
 * permitiera corregir valores a mano, habria dos lugares que interpretan
 * el archivo y se irian separando. Lo que se guarda es
 * `normalizado.decision_humana`, y al aplicar, el ETL vuelve a leer la
 * fila y usa esa decision en lugar del dato ambiguo.
 */

type Importacion = {
  id: string
  archivo: string
  drive_id: string | null
  nota: string | null
  estado: 'en_curso' | 'aplicada' | 'revertida'
  corrida_at: string
}

type Celda = {
  columna: string
  valor: unknown
  tipo?: string
  formula?: unknown
  valor_calculado?: unknown
  hipervinculo?: string
}

type Bruto = {
  hoja?: string
  fila?: number
  celdas?: Celda[]
  errores_formula?: string[]
}

type Registro = {
  id: string
  pestania: string
  fila: number
  rango: string | null
  tipo: string
  bruto: Bruto | null
  normalizado: Record<string, unknown> | null
  estado: 'pendiente' | 'aplicado' | 'conflicto' | 'descartado'
  motivo: string | null
  destino_tabla: string | null
  revisado_at: string | null
}

/** Qué decisión tiene sentido pedir según lo que sea la fila. */
const DECISIONES: Record<string, { campo: string; opciones: [string, string][] }> = {
  salida: {
    campo: 'estado',
    opciones: [
      ['realizada', 'Se hizo'],
      ['parcial', 'Se hizo a medias'],
      ['no_realizada', 'No se hizo'],
      ['cancelada', 'Se suspendió'],
      ['sin_dato', 'No se puede saber'],
    ],
  },
  historial_territorio: {
    campo: 'clase',
    opciones: [
      ['trabajado', 'Se trabajó'],
      ['bloqueo', 'Es un bloqueo'],
      ['excepcion', 'Es una excepción'],
      ['sin_dato', 'No se puede saber'],
    ],
  },
}

type Resumen = {
  total: number
  porEstado: Record<string, number>
  porTipo: Record<string, number>
}

const ESTADOS = ['pendiente', 'aplicado', 'conflicto', 'descartado'] as const
const TIPOS = [
  'salida', 'resultado', 'historial_territorio', 'territorio',
  'conductor', 'grupo', 'punto_encuentro', 'territorio_personal', 'otro',
] as const

const NOMBRE_TIPO: Record<string, string> = {
  salida: 'Salidas',
  resultado: 'Resultados',
  historial_territorio: 'Historial de territorios',
  territorio: 'Territorios',
  conductor: 'Conductores',
  grupo: 'Grupos',
  punto_encuentro: 'Puntos de encuentro',
  territorio_personal: 'Territorio personal',
  otro: 'Otros',
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })

/** El Excel guarda celdas vacías igual que las llenas; solo estorban. */
function celdasConAlgo(bruto: Bruto | null): Celda[] {
  return (bruto?.celdas ?? []).filter(
    (c) => c.valor !== null && c.valor !== undefined && String(c.valor).trim() !== '',
  )
}

function textoCorto(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return t.length > 120 ? t.slice(0, 117) + '…' : t
}

export function ImportacionPage() {
  const { profile } = useAuth()
  const esAdmin = profile?.role === 'admin'

  const [corridas, setCorridas] = useState<Importacion[] | null>(null)
  const [corrida, setCorrida] = useState<string | null>(null)
  const [resumen, setResumen] = useState<Resumen>({ total: 0, porEstado: {}, porTipo: {} })
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [filtroEstado, setFiltroEstado] = useState<string>('conflicto')
  const [registros, setRegistros] = useState<Registro[] | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)

  // ------------------------------------------------------- las corridas
  useEffect(() => {
    if (!supabase || !esAdmin) return
    let vivo = true
    void (async () => {
      const { data, error: e } = await supabase
        .from('importaciones')
        .select('id, archivo, drive_id, nota, estado, corrida_at')
        .order('corrida_at', { ascending: false })
      if (!vivo) return
      if (e) {
        setError(e.message)
        setCorridas([])
        return
      }
      const lista = (data as Importacion[]) ?? []
      setCorridas(lista)
      // La que sirve es la última que no quedó revertida.
      setCorrida((lista.find((c) => c.estado !== 'revertida') ?? lista[0])?.id ?? null)
    })()
    return () => {
      vivo = false
    }
  }, [esAdmin])

  // --------------------------------------------- el resumen de la corrida
  // Se cuenta EN EL SERVIDOR. La primera version traia las filas y las
  // contaba aca, y decia "1000 filas" sobre 3.345: PostgREST corta en mil
  // y el numero salia redondo y creible. Un total equivocado en un tablero
  // de importacion es peor que no tener tablero.
  const cargarResumen = useCallback(async () => {
    if (!supabase || !corrida) return
    const cliente = supabase
    const contar = async (col: 'tipo' | 'estado' | null, valor: string | null) => {
      let q = cliente
        .from('importacion_registros')
        .select('id', { count: 'exact', head: true })
        .eq('importacion_id', corrida)
      if (col && valor) q = q.eq(col, valor)
      const { count } = await q
      return count ?? 0
    }
    const [total, estados, tipos] = await Promise.all([
      contar(null, null),
      Promise.all(ESTADOS.map(async (e) => [e, await contar('estado', e)] as const)),
      Promise.all(TIPOS.map(async (t) => [t, await contar('tipo', t)] as const)),
    ])
    setResumen({
      total,
      porEstado: Object.fromEntries(estados),
      porTipo: Object.fromEntries(tipos.filter(([, n]) => n > 0)),
    })
  }, [corrida])

  useEffect(() => {
    void cargarResumen()
  }, [cargarResumen])

  // ---------------------------------------------------- las filas visibles
  const cargarRegistros = useCallback(async () => {
    if (!supabase || !corrida) return
    setRegistros(null)
    let q = supabase
      .from('importacion_registros')
      .select('id, pestania, fila, rango, tipo, bruto, normalizado, estado, motivo, destino_tabla, revisado_at')
      .eq('importacion_id', corrida)
      .order('pestania', { ascending: true })
      .order('fila', { ascending: true })
      .limit(200)
    if (filtroTipo !== 'todos') q = q.eq('tipo', filtroTipo)
    if (filtroEstado !== 'todos') q = q.eq('estado', filtroEstado)
    const { data, error: e } = await q
    if (e) {
      setError(e.message)
      setRegistros([])
      return
    }
    setRegistros((data as Registro[]) ?? [])
  }, [corrida, filtroTipo, filtroEstado])

  useEffect(() => {
    void cargarRegistros()
  }, [cargarRegistros])

  // ------------------------------------------------------------ decidir
  const decidir = useCallback(
    async (r: Registro, campo: string | null, valor: string | null, nota: string) => {
      if (!supabase || !profile?.id) return
      setGuardando(r.id)
      setError(null)

      const decision = {
        ...(campo && valor ? { [campo]: valor } : {}),
        nota: nota || null,
        por: profile.id,
        at: new Date().toISOString(),
      }
      // Descartar no necesita decisión de contenido: la fila no entra.
      const descarta = campo === null
      const { error: e } = await supabase
        .from('importacion_registros')
        .update({
          normalizado: { ...(r.normalizado ?? {}), decision_humana: decision },
          estado: descarta ? 'descartado' : 'pendiente',
          motivo: descarta ? nota || r.motivo : r.motivo,
          revisado_por: profile.id,
          revisado_at: new Date().toISOString(),
        })
        .eq('id', r.id)

      setGuardando(null)
      if (e) {
        setError(e.message)
        return
      }
      setAviso(
        descarta
          ? `Fila ${r.pestania}:${r.fila} descartada. Sigue en el staging, marcada.`
          : `Fila ${r.pestania}:${r.fila} resuelta. Queda lista para aplicar.`,
      )
      setAbierto(null)
      await Promise.all([cargarRegistros(), cargarResumen()])
    },
    [profile?.id, cargarRegistros, cargarResumen],
  )

  if (!esAdmin) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <p className="eyebrow">Importación</p>
            <h2>Revisión del Excel</h2>
            <p className="lead">
              Esta pantalla es solo para administradores. Lo que se decide acá cambia qué
              datos entran al sistema.
            </p>
          </div>
        </section>
      </div>
    )
  }

  const corridaActual = corridas?.find((c) => c.id === corrida)

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Importación</p>
          <h2>Revisión del Excel</h2>
          <p className="lead">
            Nada de esto entró todavía al sistema. Acá se decide fila por fila, y la
            decisión queda con nombre y fecha.
          </p>
        </div>
      </section>

      {error && <p className="form-feedback error">{error}</p>}
      {aviso && <p className="form-feedback success">{aviso}</p>}

      <section className="module-hero">
        <div className="module-hero-copy">
          <p className="eyebrow">Corrida</p>
          {corridas === null ? (
            <h3>Cargando…</h3>
          ) : !corridas.length ? (
            <h3>Todavía no se importó nada</h3>
          ) : (
            <>
              <select
                className="module-search-field"
                value={corrida ?? ''}
                onChange={(e) => setCorrida(e.target.value)}
              >
                {corridas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fecha(c.corrida_at)} · {c.archivo}
                    {c.estado === 'revertida' ? ' · REVERTIDA' : ''}
                  </option>
                ))}
              </select>
              {corridaActual?.estado === 'revertida' && (
                <p>
                  Esta corrida quedó <strong>revertida</strong>: falló a mitad de camino y
                  se conserva solo como auditoría. No la uses para decidir.
                </p>
              )}
            </>
          )}
        </div>

        <div className="module-hero-stats">
          <article className="module-stat-card">
            <span>En el staging</span>
            <strong>{resumen.total}</strong>
            <small>filas del Excel</small>
          </article>
          <article className="module-stat-card">
            <span>Necesitan decisión</span>
            <strong>{resumen.porEstado.conflicto ?? 0}</strong>
            <small>ninguna cuenta las resuelve</small>
          </article>
          <article className="module-stat-card">
            <span>Listas para aplicar</span>
            <strong>{resumen.porEstado.pendiente ?? 0}</strong>
            <small>todavía sin aplicar</small>
          </article>
          <article className="module-stat-card">
            <span>Descartadas</span>
            <strong>{resumen.porEstado.descartado ?? 0}</strong>
            <small>no entran, y se ve por qué</small>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="module-registry-toolbar">
          <label className="inline-filter">
            Qué
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="todos">todo ({resumen.total})</option>
              {Object.entries(resumen.porTipo)
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => (
                  <option key={t} value={t}>
                    {NOMBRE_TIPO[t] ?? t} ({n})
                  </option>
                ))}
            </select>
          </label>
          <label className="inline-filter">
            Estado
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
              <option value="conflicto">necesitan decisión</option>
              <option value="pendiente">listas para aplicar</option>
              <option value="descartado">descartadas</option>
              <option value="aplicado">aplicadas</option>
              <option value="todos">todas</option>
            </select>
          </label>
        </div>

        {registros === null ? (
          <p className="lead">Cargando…</p>
        ) : !registros.length ? (
          <p className="lead">
            {filtroEstado === 'conflicto'
              ? 'No queda ninguna fila esperando una decisión.'
              : 'No hay filas con ese filtro.'}
          </p>
        ) : (
          <ul className="imp-lista">
            {registros.map((r) => (
              <FilaRegistro
                key={r.id}
                registro={r}
                abierto={abierto === r.id}
                guardando={guardando === r.id}
                onAbrir={() => setAbierto(abierto === r.id ? null : r.id)}
                onDecidir={decidir}
              />
            ))}
            {registros.length === 200 && (
              <li className="imp-mas">
                Se muestran las primeras 200. Resolvé estas y volvé a filtrar.
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  )
}

function FilaRegistro({
  registro: r,
  abierto,
  guardando,
  onAbrir,
  onDecidir,
}: {
  registro: Registro
  abierto: boolean
  guardando: boolean
  onAbrir: () => void
  onDecidir: (r: Registro, campo: string | null, valor: string | null, nota: string) => void
}) {
  const [nota, setNota] = useState('')
  const decision = DECISIONES[r.tipo]
  const celdas = celdasConAlgo(r.bruto)
  const errores = r.bruto?.errores_formula ?? []
  const yaDecidida = (r.normalizado as { decision_humana?: unknown } | null)?.decision_humana

  return (
    <li className={`imp-fila imp-${r.estado}`}>
      <button type="button" className="imp-cabecera" onClick={onAbrir} aria-expanded={abierto}>
        <span className="imp-donde">
          {r.pestania} <strong>fila {r.fila}</strong>
        </span>
        <span className="imp-tipo">{NOMBRE_TIPO[r.tipo] ?? r.tipo}</span>
        <span className="imp-motivo">{r.motivo ?? 'sin observaciones'}</span>
        <span className="imp-flecha" aria-hidden="true">
          {abierto ? '⌃' : '⌄'}
        </span>
      </button>

      {abierto && (
        <div className="imp-cuerpo">
          {errores.length > 0 && (
            <p className="imp-alerta">
              El Excel devuelve error en {errores.length === 1 ? 'la columna' : 'las columnas'}{' '}
              <strong>{errores.join(', ')}</strong>. Un error de fórmula no es un dato.
            </p>
          )}

          <p className="eyebrow">La fila, tal cual está en el Excel</p>
          <table className="module-table imp-tabla">
            <tbody>
              {celdas.map((c) => (
                <tr key={c.columna} className={errores.includes(c.columna) ? 'imp-mala' : ''}>
                  <th scope="row">{c.columna}</th>
                  <td>{textoCorto(c.valor)}</td>
                  <td className="imp-extra">
                    {c.formula ? `fórmula → ${textoCorto(c.valor_calculado)}` : ''}
                    {c.hipervinculo ? `enlace: ${textoCorto(c.hipervinculo)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {yaDecidida ? (
            <p className="imp-alerta">
              Esta fila ya tiene una decisión tomada. Volver a decidir la reemplaza.
            </p>
          ) : null}

          <p className="eyebrow">Qué hacemos con esta fila</p>
          <label className="imp-nota">
            Por qué (queda guardado)
            <input
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej: el conductor confirmó que ese día llovió"
            />
          </label>

          <div className="imp-acciones">
            {decision?.opciones.map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                className="ghost-button"
                disabled={guardando}
                onClick={() => onDecidir(r, decision.campo, valor, nota)}
              >
                {texto}
              </button>
            ))}
            {!decision && (
              <button
                type="button"
                className="ghost-button"
                disabled={guardando}
                onClick={() => onDecidir(r, 'revisado', 'ok', nota)}
              >
                Está bien, que entre
              </button>
            )}
            <button
              type="button"
              className="danger-button"
              disabled={guardando}
              onClick={() => onDecidir(r, null, null, nota)}
            >
              Descartar
            </button>
          </div>

          <p className="imp-pie">
            Se guarda tu decisión, no el dato corregido: al aplicar, el importador vuelve a
            leer la fila del Excel y usa lo que decidiste en lugar del valor dudoso.
          </p>
        </div>
      )}
    </li>
  )
}
