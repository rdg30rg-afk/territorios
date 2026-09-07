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

  // Antes esto era una lista sin estilo: ul, li, strong y dos enlaces
  // sueltos separados por un punto. Cada propuesta ocupaba tres renglones
  // -titulo, motivo, fecha de la ultima marca- y las cinco juntas median
  // media pantalla para decir cinco numeros de territorio.
  return <section className="panel para-revisar" aria-labelledby="territory-suggestions-title">
    <div className="para-revisar-encabezado">
      <div>
        <p className="eyebrow">Cobertura</p>
        <h3 id="territory-suggestions-title">Para revisar</h3>
      </div>
      {/* La consulta no corre sola al entrar mas de una vez: este boton la
          fuerza, y por eso es secundario y no la accion de la pantalla. */}
      <button type="button" className="secondary-button" onClick={()=>setReload(n=>n+1)}>
        Actualizar cobertura
      </button>
    </div>

    <div className="para-revisar-filtro">
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
      <details className="para-revisar-como">
        <summary>Cómo se ordenan</summary>
        <p>Primero va el menor porcentaje recorrido; en empate, la marca más antigua. La última marca no equivale a una ronda completa. Nunca se asigna un territorio automáticamente.</p>
      </details>
    </div>

    {error ? <p className="form-feedback error" role="alert">{error}</p>
      : rows===null ? <div className="para-revisar-esqueleto" role="status"><span className="sr-only">Consultando cobertura…</span><i /><i /><i /></div>
      : visible.length===0 ? <p className="table-hint">No hay territorios en este grupo.</p>
      : <ul className="para-revisar-lista">{displayed.map(row=>
        <li key={row.territory_id}>
          <Link to={`/mapas?territorio=${encodeURIComponent(row.territory_id)}`}>
            <strong>Territorio {row.name}</strong>
            <span>{row.reason}</span>
            <small>{row.age===null ? 'Sin fecha de última marca'
              : row.age===0 ? 'Última marca hoy'
              : `Hace ${row.age} ${row.age===1 ? 'día' : 'días'}`}</small>
            <span className="para-revisar-flecha" aria-hidden="true">→</span>
          </Link>
        </li>)}</ul>}

    <div className="para-revisar-pie">
      {visible.length > 5 ? (
        <button type="button" className="secondary-button" onClick={()=>setShowAll(value=>!value)}>
          {showAll ? 'Ver sólo cinco' : `Ver todos (${visible.length})`}
        </button>
      ) : null}
      <Link className="secondary-button" to="/mapas">Revisar los mapas</Link>
      <Link className="secondary-button" to="/salidas">Abrir el programa</Link>
    </div>
  </section>
}
