import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import { supabase } from '../lib/supabase'
import { ponerFondo } from '../lib/fondoMapa'
import { loadCoverageHeatmap } from '../lib/loadCoverageHeatmap'
import { coverageLegend } from '../lib/coverageHeatmap'
import { linePoints } from '../lib/heatmapGeometry'
import '../styles/coverage-heatmap.css'

type Snapshot = Awaited<ReturnType<typeof loadCoverageHeatmap>>
function localDateValue(date: Date) {
  const pad=(n:number)=>String(n).padStart(2,'0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function CoverageHeatmapPanel({initialTerritoryId=null}:{initialTerritoryId?:string|null}) {
  const [selected,setSelected]=useState(initialTerritoryId ?? '')
  const [dateInput,setDateInput]=useState(()=>localDateValue(new Date()))
  const [instant,setInstant]=useState(()=>new Date().toISOString())
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [validation,setValidation]=useState<string|null>(null)
  const [loading,setLoading]=useState(true)
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
  useEffect(()=>{
    let live=true
    setLoading(true);setError(null);setSnapshot(null)
    void (async()=>{
      try {
        if(!supabase) throw Error('La base no está configurada.')
        const result=await loadCoverageHeatmap(supabase,instant)
        if(live) setSnapshot(result)
      } catch(e){if(live) setError(e instanceof Error?e.message:'No se pudo leer la cobertura.')}
      finally{if(live) setLoading(false)}
    })()
    return ()=>{live=false}
  },[instant,retry])
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
  function applyDate(event:FormEvent) {
    event.preventDefault()
    const value=Date.parse(dateInput)
    if(!Number.isFinite(value)||value>Date.now()) {setValidation('Elegí una fecha y hora válida, no futura.');return}
    setValidation(null);setInstant(new Date(value).toISOString());setRetry(n=>n+1)
  }
  return <section className="coverage-heatmap" aria-labelledby="coverage-heading">
    <h3 id="coverage-heading">Cobertura por lado</h3>
    <p>Lo que se conocía en la fecha elegida. Una corrección posterior no cambia esta vista histórica. Consultar no marca ni asigna territorios.</p>
    <form className="coverage-controls" onSubmit={applyDate}>
      <label>Territorio<select value={selected} onChange={e=>setSelected(e.target.value)}>
        <option value="">Todos los territorios</option>
        {selected&&!snapshot?.territories.some(t=>t.id===selected)?<option value={selected}>Territorio solicitado</option>:null}
        {snapshot?.territories.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <label>Fecha y hora local<input type="datetime-local" required value={dateInput} onChange={e=>setDateInput(e.target.value)}/></label>
      <button className="primary-button" disabled={loading} type="submit">Consultar fecha</button>
      <button className="secondary-button" disabled={loading} type="button" onClick={()=>{
        const now=new Date();setDateInput(localDateValue(now));setInstant(now.toISOString());setValidation(null)
      }}>Ver ahora</button>
    </form>
    {validation?<p role="alert">{validation}</p>:null}
    <ul className="coverage-legend">{Object.entries(coverageLegend).map(([state,item])=><li key={state}>
      <svg aria-hidden="true" width="34" height="12"><line x1="0" x2="34" y1="6" y2="6" stroke={item.color} strokeWidth="4" strokeDasharray={item.dash}/></svg>
      {item.label} ({sides.filter(side=>side.state===state).length})
    </li>)}</ul>
    {loading?<p role="status">Cargando dibujos y cobertura…</p>:null}
    {error?<div role="alert"><p>{error}</p><button className="secondary-button" onClick={()=>setRetry(n=>n+1)}>Volver a intentar</button></div>:null}
    {snapshot?<p>Consulta: {new Date(snapshot.instant).toLocaleString('es-AR')}. {sides.length} lados. Sin dato no equivale a 0%.</p>:null}
    {!!snapshot?.inconsistentSides||invalid>0?<p role="alert">No se dibujaron {snapshot?.inconsistentSides??0} lados con referencias incoherentes y {invalid} con geometría inválida. Revisar antes de planificar.</p>:null}
    {!loading&&!error&&sides.length===0?<p>No hay lados disponibles para este territorio y fecha. No significa que esté completo.</p>:null}
    <div className="coverage-map" ref={box} role="region" aria-label="Mapa de cobertura, de solo lectura"/>
    {snapshot&&!error?<div className="coverage-table-wrap"><table>
      <caption>Resumen de cobertura; porcentajes por metros, redondeados. La última marca no define una ronda.</caption>
      <thead><tr><th>Territorio</th><th>Recorrido</th><th>Revisitar</th><th>No accesible</th><th>Sin dato</th><th>Metros recorridos</th></tr></thead>
      <tbody>{summaries.map(t=><tr key={t.id}><th scope="row"><button type="button" className="ghost-button" onClick={()=>setSelected(t.id)}>{t.name}</button></th>
        <td>{t.counts.recorrido}</td><td>{t.counts.revisitar}</td><td>{t.counts.no_accesible}</td><td>{t.counts.sin_dato}</td>
        <td>{t.percent===null?'Sin porcentaje válido':`${t.percent}%`}{t.complete?' · todos los lados recorridos':''}</td>
      </tr>)}</tbody>
    </table></div>:null}
  </section>
}
