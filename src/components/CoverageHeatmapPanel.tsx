import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { supabase } from '../lib/supabase'
import { ponerFondo } from '../lib/fondoMapa'
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

export function CoverageHeatmapPanel({initialTerritoryId=null}:{initialTerritoryId?:string|null}) {
  const [selected,setSelected]=useState(initialTerritoryId ?? '')
  // Ver los 70 juntos cuesta 1,3 MB. Se puede, pero se pide.
  const [verTodo,setVerTodo]=useState(false)
  const [busqueda,setBusqueda]=useState('')
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
      const {data}=await supabase.from('territorios').select('id,name')
      if(live&&data) setLista(ordenarTerritorios(data as {id:string;name:string}[]))
    })()
    return ()=>{live=false}
  },[])

  // Sin territorio elegido no se pide nada. Antes esta pantalla abría
  // descargando los 2.735 lados de los 70 territorios -1,3 MB en diez
  // páginas- para pintarlos todos juntos en un mapa de la ciudad entera,
  // donde un lado mide dos píxeles y ninguno se distingue del vecino.
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
  useEffect(()=>{
    const group=layer.current,m=map.current
    if(!group||!m) return
    group.clearLayers()
    const names=new Map(snapshot?.territories.map(t=>[t.id,t.name]))
    for(const {side,points} of mapped) {
      if(!points) continue
      const style=coverageLegend[side.state]
      const detail=document.createElement('span')
      detail.textContent=`Territorio ${names.get(side.territory_id)??'sin nombre'} · ${style.label} · ${side.ageDays===null?'Sin fecha de marca':`Marca de hace ${side.ageDays} días`}`
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
    <h3 id="coverage-heading" className="sr-only">Cobertura por lado</h3>

    {/* El mapa es la vista. Territorio y fecha caben en una barra; el
        parrafo que explicaba que consultar no asigna, y los dos botones
        lima de "Consultar fecha" / "Ver ahora", empujaban el mapa fuera
        de la pantalla en un telefono. */}
    <div className="coverage-barra">
      {elegido ? (
        <div className="coverage-elegido">
          <strong>Territorio {elegido.name}</strong>
          <button type="button" className="ghost-button" onClick={()=>{setSelected('');setVerTodo(false);setBusqueda('')}}>
            Cambiar
          </button>
        </div>
      ) : verTodo ? (
        <div className="coverage-elegido">
          <strong>Los {lista.length} juntos</strong>
          <button type="button" className="ghost-button" onClick={()=>setVerTodo(false)}>Elegir uno</button>
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
        }}>Ahora</button>
      </div>
    </div>

    {validation?<p role="alert">{validation}</p>:null}

    <div className="coverage-map-wrap">
      <div className="coverage-map" ref={box} role="region" aria-label="Mapa de cobertura, de solo lectura"/>
      {hayPedido?leyenda:null}
      {!hayPedido?<p className="coverage-map-aviso">Elegí un territorio para ver sus lados.</p>:null}
      {loading?<p className="coverage-map-aviso" role="status">Cargando cobertura…</p>:null}
    </div>

    {error?<div role="alert"><p>{error}</p><button className="secondary-button" onClick={()=>setRetry(n=>n+1)}>Volver a intentar</button></div>:null}
    {snapshot?<p className="coverage-cifra">{sides.length} lados · {new Date(snapshot.instant).toLocaleString('es-AR')}</p>:null}
    {!!snapshot?.inconsistentSides||invalid>0?<p role="alert">No se dibujaron {snapshot?.inconsistentSides??0} lados con referencias incoherentes y {invalid} con geometría inválida.</p>:null}
    {hayPedido&&!loading&&!error&&sides.length===0?<p>No hay lados para este territorio y fecha.</p>:null}

    {snapshot&&!error?<div className="coverage-table-wrap"><table>
      <caption>Porcentaje por metros recorridos. La última marca no define una ronda.</caption>
      <thead><tr><th>Territorio</th><th>Recorrido</th><th>Revisitar</th><th>No accesible</th><th>Sin dato</th><th>Metros</th></tr></thead>
      <tbody>{summaries.map(t=><tr key={t.id}><th scope="row"><button type="button" className="ghost-button" onClick={()=>elegirTerritorio(t.id)}>{t.name}</button></th>
        <td>{t.counts.recorrido}</td><td>{t.counts.revisitar}</td><td>{t.counts.no_accesible}</td><td>{t.counts.sin_dato}</td>
        <td>{t.percent===null?'—' :`${t.percent}%`}{t.complete?' · completo':''}</td>
      </tr>)}</tbody>
    </table></div>:null}
  </section>
}
