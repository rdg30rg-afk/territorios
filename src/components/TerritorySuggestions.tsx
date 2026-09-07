import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Desplegable } from './Desplegable'
import { supabase } from '../lib/supabase'
import { readAllRows } from '../lib/readAllRows'
import { suggestTerritories, type TerritoryCoverage } from '../lib/territorySuggestions'

export function TerritorySuggestions() {
  const [rows,setRows] = useState<ReturnType<typeof suggestTerritories> | null>(null)
  const [error,setError] = useState<string | null>(null)
  const [reload,setReload] = useState(0)
  const [filter,setFilter] = useState('completar')
  const [showAll,setShowAll] = useState(false)
  useEffect(()=>{
    let live=true
    setRows(null);setError(null)
    const client=supabase
    void (async()=>{
      try {
        if(!client) throw Error('La base no está configurada.')
        const data=await readAllRows<TerritoryCoverage>((from,to)=>client.from('cobertura_territorio')
          .select('territory_id,name,lados,lados_hechos,pct_metros,ultima_marca,tiene_dato,reservado')
          .order('territory_id').range(from,to))
        if(live) setRows(suggestTerritories(data))
      } catch(e) {if(live) setError(e instanceof Error ? e.message : 'No se pudo consultar la cobertura.')}
    })()
    return ()=>{live=false}
  },[reload])
  const visible=rows?.filter(row=>row.category===filter) ?? []
  const displayed=showAll ? visible : visible.slice(0, 5)
  return <section className="panel" aria-labelledby="territory-suggestions-title">
    <h3 id="territory-suggestions-title">Qué territorios conviene revisar</h3>
    <p>Hasta cinco propuestas para decidir qué revisar primero. Nunca asignan un territorio automáticamente.</p>
    <details>
      <summary>Cómo se ordenan</summary>
      <p>Primero va el menor porcentaje recorrido; en empate, la marca más antigua. La última marca no equivale a una ronda completa.</p>
    </details>
    <Desplegable
      etiqueta="Mostrar"
      valor={filter}
      alElegir={(value)=>{setFilter(value);setShowAll(false)}}
      opciones={[
        {valor:'completar',texto:'Con cobertura pendiente'},
        {valor:'verificar',texto:'Sin datos concluyentes'},
        {valor:'completo',texto:'Con cobertura completa registrada'},
        {valor:'sin_geometria',texto:'Sin lados suficientes'},
        {valor:'asignado',texto:'Con reserva activa'},
      ]}
    />
    <button type="button" className="ghost-button" onClick={()=>setReload(n=>n+1)}>Actualizar cobertura</button>
    {error ? <p role="alert">{error}</p> : rows===null ? <p role="status">Consultando cobertura…</p>
      : visible.length===0 ? <p>No hay territorios en este grupo.</p>
      : <ul>{displayed.map(row=><li key={row.territory_id}>
        <strong>Territorio {row.name}</strong> — {row.reason}
        <p>{row.age===null ? 'Sin fecha válida de última marca.' : `Última marca hace ${row.age} días.`}</p>
        <Link to={`/mapas?territorio=${encodeURIComponent(row.territory_id)}`}>
          Abrir en el mapa
        </Link>
      </li>)}</ul>}
    {visible.length > 5 ? <button type="button" className="secondary-button" onClick={()=>setShowAll(value=>!value)}>{showAll ? 'Ver sólo cinco' : `Ver todos (${visible.length})`}</button> : null}
    <Link to="/mapas">Revisar los mapas</Link>{' · '}<Link to="/salidas">Abrir el programa</Link>
  </section>
}
