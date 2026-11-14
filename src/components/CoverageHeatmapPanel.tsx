import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { agruparPorManzana, haceCuanto, rotuloManzana } from '../lib/coverageDetalle'
import { ponerFondo } from '../lib/fondoMapa'
import { Icono } from './Icono'
import { loadCoverageHeatmap } from '../lib/loadCoverageHeatmap'
import { coverageLegend } from '../lib/coverageHeatmap'
import { linePoints } from '../lib/heatmapGeometry'
import { ordenarTerritorios } from '../lib/ordenarTerritorios'
import '../styles/coverage-heatmap.css'

type Snapshot = Awaited<ReturnType<typeof loadCoverageHeatmap>>
function localDateValue(date: Date) {
  const pad=(n:number)=>String(n).padStart(2,'0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// La pestaña se desmonta al cambiar de solapa en Mapas: el territorio elegido
// se recuerda mientras dure la sesión del navegador.
const CLAVE_ELEGIDO='territorios.cobertura.elegido'
function leerElegido() {
  try {return window.sessionStorage.getItem(CLAVE_ELEGIDO) ?? ''} catch {return ''}
}
function guardarElegido(id:string) {
  try {if(id) window.sessionStorage.setItem(CLAVE_ELEGIDO,id); else window.sessionStorage.removeItem(CLAVE_ELEGIDO)} catch {/* sin almacenamiento: no se recuerda */}
}
const nombreEstado:Record<string,string>={recorrido:'Recorrida',revisitar:'Para revisitar',no_accesible:'No accesible',sin_dato:'Sin marcar'}
function fechaCorta(iso:string|null) {
  if(!iso) return ''
  const d=new Date(iso)
  return Number.isNaN(d.getTime())?'':d.toLocaleDateString('es-AR',{day:'numeric',month:'short',year:'numeric'})
}

export function CoverageHeatmapPanel({initialTerritoryId=null}:{initialTerritoryId?:string|null}) {
  const {profile}=useAuth()
  const [selected,setSelected]=useState(()=>initialTerritoryId ?? leerElegido())
  // Ver todos juntos baja los dibujos y la bitácora de todos los territorios, y
  // crece con los datos. Se puede, pero se pide.
  const [verTodo,setVerTodo]=useState(false)
  const [errorLista,setErrorLista]=useState<string|null>(null)
  const [nombres,setNombres]=useState<Record<string,string>>({})
  const [misTerritorios,setMisTerritorios]=useState<Set<string>>(()=>new Set())
  const [busqueda,setBusqueda]=useState('')
  // Una sola manzana abierta a la vez; null = no se tocó (si hay una sola, se abre), '' = cerradas.
  const [manzanaAbierta,setManzanaAbierta]=useState<string|null>(null)
  const [lista,setLista]=useState<{id:string;name:string}[]>([])
  const [dateInput,setDateInput]=useState(()=>localDateValue(new Date()))
  const [instant,setInstant]=useState(()=>new Date().toISOString())
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [validation,setValidation]=useState<string|null>(null)
  const [loading,setLoading]=useState(false)
  const [retry,setRetry]=useState(0)
  const box=useRef<HTMLDivElement|null>(null)
  const map=useRef<L.Map|null>(null)
  const layer=useRef<L.FeatureGroup|null>(null)

  useEffect(()=>{
    if(!box.current) return
    const m=L.map(box.current,{scrollWheelZoom:false}).setView([-31.5375,-68.5364],12)
    ponerFondo(L,m)
    map.current=m;layer.current=L.featureGroup().addTo(m)
    const observer=new ResizeObserver(()=>m.invalidateSize())
    observer.observe(box.current)
    return ()=>{observer.disconnect();m.remove();map.current=null;layer.current=null}
  },[])
  // Los nombres, para poder elegir. Son 4 kB y no dependen de la fecha.
  useEffect(()=>{
    let live=true
    void (async()=>{
      if(!supabase) return
      const {data,error:fallo}=await supabase.from('territorios').select('id,name')
      if(!live) return
      if(fallo) {setErrorLista('No se pudo leer la lista de territorios. Probá de nuevo en un rato.');return}
      setErrorLista(null)
      if(data) setLista(ordenarTerritorios(data as {id:string;name:string}[]))
    })()
    return ()=>{live=false}
  },[])
  useEffect(()=>{guardarElegido(selected);setManzanaAbierta(null)},[selected])
  // Los territorios que tengo a mi nombre: son los únicos que la pantalla de
  // marcado deja marcar.
  useEffect(()=>{
    let live=true
    void (async()=>{
      if(!supabase||!profile?.id) return
      const {data}=await supabase.from('territorio_personal_reservas').select('territory_id').eq('status','activa').eq('assigned_to',profile.id)
      if(live&&data) setMisTerritorios(new Set((data as {territory_id:string}[]).map(r=>r.territory_id)))
    })()
    return ()=>{live=false}
  },[profile?.id])

  // Sin territorio elegido no se pide nada. Antes esta pantalla abría
  // descargando los lados de todos los territorios, y toda la bitácora de
  // cobertura, para pintarlos juntos en un mapa de la ciudad entera, donde un
  // lado mide dos píxeles y ninguno se distingue del vecino. Con uno elegido
  // se pide sólo ese (ver `loadCoverageHeatmap`).
  // Mientras se bajan todos juntos, un contador a la vista: sin esto parece colgado.
  const [segundos,setSegundos]=useState(0)
  useEffect(()=>{
    if(!loading||!verTodo){setSegundos(0);return}
    const inicio=Date.now()
    const id=window.setInterval(()=>setSegundos(Math.round((Date.now()-inicio)/1000)),1000)
    return ()=>window.clearInterval(id)
  },[loading,verTodo])
  useEffect(()=>{
    if(!selected&&!verTodo){setSnapshot(null);setError(null);setLoading(false);return}
    let live=true
    setLoading(true);setError(null);setSnapshot(null)
    void (async()=>{
      try {
        if(!supabase) throw Error('La base no está configurada.')
        const result=await loadCoverageHeatmap(supabase,instant,verTodo?null:selected)
        if(live) setSnapshot(result)
      } catch(e){if(live) setError(e instanceof Error?e.message:'No se pudo leer la cobertura.')}
      finally{if(live) setLoading(false)}
    })()
    return ()=>{live=false}
  },[instant,retry,selected,verTodo])
  const sides=useMemo(()=>snapshot?.sides.filter(s=>!selected||s.territory_id===selected)??[],[snapshot,selected])
  const mapped=useMemo(()=>sides.map(side=>({side,points:linePoints(side.geometry_geojson)})),[sides])
  const invalid=mapped.filter(item=>!item.points).length
  const summaries=snapshot?.territories.filter(t=>!selected||t.id===selected)??[]
  const manzanas=useMemo(()=>selected?agruparPorManzana(sides):[],[selected,sides])
  const ultima=useMemo(()=>sides.reduce<{at:string;by:string|null}|null>((acc,side)=>{
    if(!side.informedAt) return acc
    return !acc||Date.parse(side.informedAt)>Date.parse(acc.at)?{at:side.informedAt,by:side.informedBy}:acc
  },null),[sides])
  useEffect(()=>{
    const ids=[...new Set(sides.map(side=>side.informedBy).filter((id):id is string=>Boolean(id)))]
    if(!selected||!supabase||ids.length===0) return
    let live=true
    void (async()=>{
      const {data}=await supabase!.from('profiles').select('id,full_name').in('id',ids)
      if(live&&data) setNombres(Object.fromEntries((data as {id:string;full_name:string|null}[]).map(p=>[p.id,p.full_name?.trim()||'un hermano'])))
    })()
    return ()=>{live=false}
  },[selected,sides])
  const quien=(id:string|null)=>id?nombres[id]??'un hermano':'sin autor'
  useEffect(()=>{
    const group=layer.current,m=map.current
    if(!group||!m) return
    group.clearLayers()
    const names=new Map(snapshot?.territories.map(t=>[t.id,t.name]))
    for(const {side,points} of mapped) {
      if(!points) continue
      const style=coverageLegend[side.state]
      const detail=document.createElement('span')
      detail.textContent=`Territorio ${names.get(side.territory_id)??'sin nombre'}${side.blockLabel?` · Manzana ${rotuloManzana(side.blockLabel)}`:''} · ${style.label} · ${side.informedAt===null?'Sin marcar todavía':side.state==='sin_dato'?`Se quitó la marca ${haceCuanto(side.informedAt)}`:haceCuanto(side.informedAt)}`
      L.polyline(points,{color:style.color,dashArray:style.dash,weight:5,opacity:.9}).bindTooltip(detail).addTo(group)
    }
    if(group.getLayers().length) m.fitBounds(group.getBounds(),{padding:[24,24],maxZoom:17})
  },[mapped,snapshot])
  const hayPedido=Boolean(selected)||verTodo
  const elegido=useMemo(()=>lista.find(t=>t.id===selected)??null,[lista,selected])
  const coincidencias=useMemo(()=>{
    const texto=busqueda.trim().toLowerCase()
    // Sin texto no se tiran 12 botones encima del mapa: en telefono eso
    // era otra pantalla antes de llegar al dibujo. Se busca por numero.
    if(!texto) return []
    const soloNumero=/^\d+$/.test(texto)
    return lista.filter(t=>{
      const nombre=t.name.toLowerCase()
      return soloNumero ? nombre===texto || nombre.startsWith(texto) : nombre.includes(texto)
    }).slice(0,24)
  },[busqueda,lista])

  function elegirTerritorio(id:string) {
    setSelected(id)
    setVerTodo(false)
  }

  function aplicarFecha(valor:string) {
    const value=Date.parse(valor)
    if(!Number.isFinite(value)||value>Date.now()) {setValidation('Elegí una fecha y hora válida, no futura.');return}
    setValidation(null);setInstant(new Date(value).toISOString())
  }

  const leyenda=<ul className="coverage-legend">{Object.entries(coverageLegend).map(([state,item])=><li key={state}>
    <svg aria-hidden="true" width="28" height="10"><line x1="0" x2="28" y1="5" y2="5" stroke={item.color} strokeWidth="3" strokeDasharray={item.dash}/></svg>
    {item.label}{hayPedido?` ${sides.filter(side=>side.state===state).length}`:''}
  </li>)}</ul>

  return <section className="coverage-heatmap" aria-labelledby="coverage-heading">
    <h3 id="coverage-heading" className="sr-only">Cobertura por cuadra</h3>

    {/* El mapa es la vista. Territorio y fecha caben en una barra; el
        parrafo que explicaba que consultar no asigna, y los dos botones
        lima de "Consultar fecha" / "Ver ahora", empujaban el mapa fuera
        de la pantalla en un telefono. */}
    <div className="coverage-barra">
      {elegido ? (
        <div className="coverage-elegido">
          <strong>Territorio {elegido.name}</strong>
          <button type="button" className="ghost-button" onClick={()=>{setSelected('');setVerTodo(false);setBusqueda('')}}>
            <Icono nombre="cerrar" tamaño={18}/>
            Cambiar
          </button>
        </div>
      ) : verTodo ? (
        <div className="coverage-elegido">
          <strong>Los {lista.length} juntos</strong>
          <button type="button" className="ghost-button" onClick={()=>setVerTodo(false)}><Icono nombre="territorios" tamaño={18}/>Elegir uno</button>
        </div>
      ) : (
        <div className="coverage-elector">
          <label className="coverage-buscar">
            <span className="sr-only">Territorio</span>
            <input type="search" value={busqueda} autoComplete="off"
              onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar territorio"/>
          </label>
          {busqueda.trim() ? (
          <div className="coverage-opciones">
            {coincidencias.length===0?<p className="coverage-vacio">Ningún territorio con ese número.</p>
              :coincidencias.map(t=><button key={t.id} type="button" onClick={()=>elegirTerritorio(t.id)}>{t.name}</button>)}
          </div>
          ) : null}
          {lista.length>0?<button type="button" className="ghost-button coverage-todos" onClick={()=>setVerTodo(true)}>
            <Icono nombre="territorios" tamaño={18}/>
            Ver los {lista.length} juntos
          </button>:null}
        </div>
      )}

      <div className="coverage-cuando">
        <label>
          <span className="sr-only">Fecha y hora</span>
          <input type="datetime-local" required value={dateInput} onChange={e=>{
            setDateInput(e.target.value)
            aplicarFecha(e.target.value)
          }}/>
        </label>
        <button className="ghost-button" disabled={loading} type="button" onClick={()=>{
          const now=new Date();const valor=localDateValue(now)
          setDateInput(valor);setInstant(now.toISOString());setValidation(null)
        }}><Icono nombre="reintentar" tamaño={18}/>Ahora</button>
      </div>
    </div>

    {validation?<p role="alert">{validation}</p>:null}

    <div className="coverage-map-wrap">
      <div className="coverage-map" ref={box} role="region" aria-label="Mapa de cobertura, de solo lectura"/>
      {hayPedido?leyenda:null}
      {!hayPedido?<p className="coverage-map-aviso">Elegí un territorio para ver sus cuadras.</p>:null}
      {loading?<p className="coverage-map-aviso" role="status">{verTodo
      ?`Cargando los ${lista.length} territorios juntos… ${segundos} s. Trae todo el historial de marcas y puede tardar cerca de un minuto.`
      :'Cargando cobertura…'}</p>:null}
    </div>

    {errorLista?<p role="alert">{errorLista}</p>:null}
    {error?<div role="alert"><p>{error}</p><button className="secondary-button" onClick={()=>setRetry(n=>n+1)}><Icono nombre="reintentar" tamaño={18}/>Volver a intentar</button></div>:null}
    {snapshot?<p className="coverage-cifra">{sides.length} {sides.length===1?'cuadra':'cuadras'} · al {new Date(snapshot.instant).toLocaleString('es-AR')}</p>:null}
    {!!snapshot?.inconsistentSides||invalid>0?<p role="alert">No se dibujaron {snapshot?.inconsistentSides??0} cuadras con referencias incoherentes y {invalid} con dibujo inválido.</p>:null}
    {hayPedido&&!loading&&!error&&sides.length===0?<p>No hay cuadras dibujadas para este territorio en esa fecha.</p>:null}

    {selected&&snapshot&&!error&&sides.length>0?<section className="coverage-detalle" aria-label="Lo marcado en este territorio">
      <div className="coverage-detalle-cabeza">
        <p>{ultima
          ? <>Última marca: <strong>{haceCuanto(ultima.at)}</strong> ({fechaCorta(ultima.at)}) por {quien(ultima.by)}.</>
          : <>Todavía no se marcó ninguna cuadra de este territorio.</>}</p>
        {misTerritorios.has(selected)
          ? <Link className="primary-button" to="/predicacion"><Icono nombre="marcar" tamaño={18}/>Marcar lo recorrido</Link>
          : <p className="coverage-nota">Las marcas las hace desde su celular quien tiene el territorio.</p>}
      </div>
      <ul className="coverage-manzanas">{manzanas.map(m=><li key={m.id}>
        <details open={(manzanaAbierta??(manzanas.length===1?m.id:''))===m.id}
          onToggle={e=>{const abierta=e.currentTarget.open;setManzanaAbierta(actual=>abierta?m.id:(actual===m.id||actual===null?'':actual))}}>
          <summary><strong>Manzana {m.label}</strong> · {m.recorridas} de {m.total} {m.total===1?'cuadra recorrida':'cuadras recorridas'}</summary>
          <ul className="coverage-cuadras">{m.cuadras.map((c,i)=><li key={c.id} className={`coverage-cuadra estado-${c.state}`}>
            <span className="coverage-cuadra-nombre">Cuadra {i+1}</span>
            <span className="coverage-cuadra-estado">{nombreEstado[c.state]}</span>
            <span className="coverage-cuadra-cuando">{c.informedAt&&c.state==='sin_dato'?`Se quitó la marca · ${fechaCorta(c.informedAt)} · ${quien(c.informedBy)}`:c.informedAt?`${haceCuanto(c.informedAt)} · ${fechaCorta(c.informedAt)} · ${quien(c.informedBy)}${c.origen==='correccion'?' (corrección)':''}`:'Sin marca'}</span>
            {c.nota?<span className="coverage-cuadra-nota">Nota: {c.nota}</span>:null}
          </li>)}</ul>
        </details>
      </li>)}</ul>
    </section>:null}

    {snapshot&&!error&&!selected?<div className="coverage-table-wrap"><table>
      <caption>Cuadras por estado. El avance es el porcentaje de metros recorridos; la última marca no define una ronda.</caption>
      <thead><tr><th>Territorio</th><th>Recorridas</th><th>Para revisitar</th><th>No accesibles</th><th>Sin marcar</th><th>Avance</th></tr></thead>
      <tbody>{summaries.map(t=><tr key={t.id}><th scope="row"><button type="button" className="ghost-button" onClick={()=>elegirTerritorio(t.id)}><Icono nombre="territorios" tamaño={18}/>{t.name}</button></th>
        <td>{t.counts.recorrido}</td><td>{t.counts.revisitar}</td><td>{t.counts.no_accesible}</td><td>{t.counts.sin_dato}</td>
        <td>{t.percent===null?'—' :`${t.percent}%`}{t.complete?' · completo':''}</td>
      </tr>)}</tbody>
    </table></div>:null}
  </section>
}
