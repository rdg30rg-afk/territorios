import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { readAllRows } from '../lib/readAllRows'
import { canReportSalidaCoverage, prepareSalidaCoverage } from '../lib/salidaCoverage'
import { linePoints } from '../lib/heatmapGeometry'
import type { CoverageState } from '../lib/coverageSummary'
import { ponerFondo } from '../lib/fondoMapa'
import { Desplegable } from './Desplegable'
import type { useCoverageOutbox } from '../lib/useCoverageOutbox'

type Side = { id:string; manzana_id:string; territory_id:string; orden:number; geometry_version:number; vigente_hasta:null; geometry_geojson:unknown }
type Outing = { id?:string; driverId?:string; terrId?:string }

export function SalidaCoverageForm({outing,queue}:{outing:Outing;queue:ReturnType<typeof useCoverageOutbox>}) {
  const {profile}=useAuth()
  const [editing,setEditing]=useState(false)
  const [sides,setSides]=useState<Side[]>([])
  const [labels,setLabels]=useState<Record<string,string>>({})
  const [selected,setSelected]=useState('')
  const [state,setState]=useState<CoverageState>('recorrido')
  const [error,setError]=useState<string|null>(null)
  const [loading,setLoading]=useState(false)
  const [revision,setRevision]=useState(0)
  const [busy,setBusy]=useState(false)
  const [lastSent,setLastSent]=useState<string|null>(null)
  const [confirmed,setConfirmed]=useState(false)
  const running=useRef(false)
  const mapElement=useRef<HTMLDivElement>(null)
  const allowed=canReportSalidaCoverage(profile,outing)
  const side=sides.find(item=>item.id===selected)
  const pending=queue.events.filter(item=>item.salida_id===outing.id)

  useEffect(()=>{
    if(lastSent&&queue.confirmed.some(item=>item.id===lastSent))setConfirmed(true)
  },[lastSent,queue.confirmed])

  useEffect(()=>{
    if(!editing||!allowed||!supabase||!outing.terrId)return
    let live=true
    setLoading(true);setError(null);setSides([]);setSelected('')
    void Promise.all([
      readAllRows<Side>((from,to)=>supabase!.from('manzana_lados')
        .select('id, manzana_id, territory_id, orden, geometry_version, vigente_hasta, geometry_geojson')
        .eq('territory_id',outing.terrId!).is('vigente_hasta',null).order('manzana_id').order('orden').order('id').range(from,to)),
      readAllRows<{id:string;label:string}>((from,to)=>supabase!.from('territorio_manzanas')
        .select('id, label').eq('territory_id',outing.terrId!).is('vigente_hasta',null).order('id').range(from,to)),
    ]).then(([loaded,blocks])=>{
      if(!live)return
      setSides(loaded);setLabels(Object.fromEntries(blocks.map(block=>[block.id,block.label])))
    }).catch(()=>{if(live)setError('No se pudo cargar el dibujo. Volvé a intentar.')})
      .finally(()=>{if(live)setLoading(false)})
    return ()=>{live=false}
  },[editing,allowed,outing.terrId,revision])

  useEffect(()=>{
    if(!editing||!mapElement.current||!side)return
    const points=linePoints(side.geometry_geojson)
    if(!points)return
    const map=L.map(mapElement.current,{scrollWheelZoom:false,zoomAnimation:false})
    map.attributionControl.setPrefix(false)
    ponerFondo(L,map)
    const line=L.polyline(points,{color:'#345f46',weight:7}).addTo(map)
    map.fitBounds(line.getBounds().pad(.5),{maxZoom:18,animate:false})
    return ()=>{map.remove()}
  },[editing,side])

  if(!allowed)return null
  return <section className="module-detail-list">
    <h3>Lo que recorrió el grupo</h3>
    <p>Informás como conductor de esta salida. Elegí un lado y comprobá la calle en el mapa antes de enviar. No cambia el resultado general de la salida.</p>
    {lastSent&&<p role="status">{confirmed?'Última marca confirmada por el servidor.':'Última marca conservada en este dispositivo; esperando confirmación.'}</p>}
    {pending.length>0&&<p role="status">{pending.length} marca(s) pendientes de confirmación de esta salida.
      <button type="button" className="boton secundario" disabled={queue.sending} onClick={()=>void queue.retry()}>Reintentar pendientes</button></p>}
    {(error||queue.error)&&<p role="alert">{error||queue.error}</p>}
    {pending.filter(item=>item.lastError).map(item=><p role="alert" key={item.id}>{item.lastError}</p>)}
    <button type="button" className="boton" disabled={busy} aria-expanded={editing} onClick={()=>setEditing(!editing)}>{editing?'Listo':'Marcar lo que recorrió el grupo'}</button>
    {editing&&<div className="form-stack">
      <button type="button" className="boton secundario" disabled={loading||busy} onClick={()=>setRevision(value=>value+1)}>Actualizar dibujo</button>
      {loading?<p>Cargando lados…</p>:!sides.length?<p>No hay lados disponibles. No se puede informar cobertura todavía.</p>:<>
        <label>Lado de la calle<Desplegable className="vh-desplegable" etiqueta="Lado de la calle" valor={selected} deshabilitado={busy} alElegir={setSelected} opciones={[
          {valor:'',texto:'Elegí un lado'},
          ...sides.map(item=>({valor:item.id,texto:`Manzana ${labels[item.manzana_id]??'sin rótulo'} · lado ${item.orden}`})),
        ]}/></label>
        {side&&<div ref={mapElement} style={{height:260}} aria-label="Calle seleccionada para informar"/>}
        {side&&!linePoints(side.geometry_geojson)&&<p role="alert">Este lado no tiene un dibujo legible. No se puede marcar.</p>}
        <label>Estado informado<Desplegable className="vh-desplegable" etiqueta="Estado informado" valor={state} deshabilitado={busy} alElegir={value=>setState(value as CoverageState)} opciones={[
          {valor:'recorrido',texto:'Recorrido'}, {valor:'revisitar',texto:'Revisitar'},
          {valor:'no_accesible',texto:'No accesible'}, {valor:'sin_dato',texto:'Sin dato'},
        ]}/></label>
        <button type="button" className="boton primario" disabled={busy||!side||!linePoints(side.geometry_geojson)||!!queue.error} onClick={async()=>{
          if(!side||running.current)return
          running.current=true;setBusy(true);setError(null)
          try {
            const saved=await queue.enqueue(prepareSalidaCoverage(profile,outing,side,state))
            setLastSent(saved.id);setConfirmed(false)
            setSelected('')
            void queue.sync()
          }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo conservar la marca.')}
          finally{running.current=false;setBusy(false)}
        }}>{busy?'Conservando…':'Informar estado de este lado'}</button>
      </>}
    </div>}
  </section>
}
