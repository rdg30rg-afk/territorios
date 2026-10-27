import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCoverageHeatmap } from '../src/lib/loadCoverageHeatmap.ts'

function clientFor(rows,failTable){
  const calls=[]
  return {calls,client:{from(table){
    const q={select(){return q},order(){return q},lte(column,value){calls.push({table,column,value});return q},
      eq(column,value){calls.push({table,eq:column,value});return q},
      async range(from,to){calls.push({table,from,to});return {data:(rows[table]??[]).slice(from,to+1),error:table===failTable?{message:'consulta fallida'}:null}}}
    return q
  }}}
}
test('página más de 1000 territorios y limita eventos/dibujos al instante',async()=>{
  const territories=Array.from({length:1031},(_,i)=>({id:String(i),name:String(i)}))
  const {client,calls}=clientFor({territorios:territories})
  const result=await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z')
  assert.equal(result.territories.length,1031)
  assert.ok(result.territories.every(t=>t.percent===null))
  assert.equal(calls.filter(c=>c.table==='territorios'&&c.from!==undefined).length,3)
  for(const table of ['cobertura_eventos','territorio_manzanas','manzana_lados'])
    assert.ok(calls.some(c=>c.table===table&&c.value==='2026-09-05T10:00:00.000Z'))
})
test('una consulta fallida no devuelve mapa parcial',async()=>{
  const {client}=clientFor({territorios:[{id:'a',name:'57'}]},'cobertura_eventos')
  await assert.rejects(()=>loadCoverageHeatmap(client,'2026-09-05'),/consulta fallida/)
})
test('fecha inválida no hace consultas',async()=>{
  const {client,calls}=clientFor({})
  await assert.rejects(()=>loadCoverageHeatmap(client,'inválida'),/inválida/)
  assert.equal(calls.length,0)
})

test('con un territorio elegido, los dibujos y la bitácora se piden solo de ese territorio',async()=>{
  const {client,calls}=clientFor({territorios:[{id:'a',name:'57'},{id:'b',name:'58'}]})
  await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z','a')
  const acotadas=calls.filter(c=>c.eq==='territory_id')
  assert.deepEqual(acotadas.map(c=>c.table).sort(),['cobertura_eventos','manzana_lados','territorio_manzanas'])
  assert.ok(acotadas.every(c=>c.value==='a'))
  // Los nombres siguen enteros: sin ellos no se puede ni ofrecer la lista para
  // elegir, y son pocos.
  assert.equal(calls.filter(c=>c.table==='territorios'&&c.eq).length,0)
})

test('sin territorio elegido no se acota nada, como antes',async()=>{
  const {client,calls}=clientFor({territorios:[{id:'a',name:'57'}]})
  await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z')
  assert.equal(calls.filter(c=>c.eq).length,0)
})

// Un cliente que además de anotar aplica los filtros, para ver qué filas le
// llegarían de verdad a la pantalla. Entiende `eq` y `lte` y pagina con `range`.
function clientFiltrable(tablas){
  const entregadas={}
  return {entregadas,client:{from(table){
    const filtros=[]
    const q={select(){return q},order(){return q},
      lte(columna,valor){filtros.push(fila=>fila[columna]<=valor);return q},
      eq(columna,valor){filtros.push(fila=>fila[columna]===valor);return q},
      async range(from,to){
        const filas=(tablas[table]??[]).filter(fila=>filtros.every(f=>f(fila))).slice(from,to+1)
        entregadas[table]=(entregadas[table]??[]).concat(filas)
        return {data:filas,error:null}
      }}
    return q
  }}}
}

const vigencia={vigente_desde:'2026-09-01T00:00:00Z',vigente_hasta:null}
function territorioConLado(id,nombre){
  return {
    territorio:{id,name:nombre},
    manzana:{...vigencia,id:`m-${id}`,territory_id:id,geometry_version:1},
    lado:{...vigencia,id:`l-${id}`,manzana_id:`m-${id}`,territory_id:id,geometry_version:1,largo_m:50,
      geometry_geojson:{type:'LineString',coordinates:[[0,0],[1,1]]}},
  }
}

test('con un territorio elegido, la bitácora de los demás no se descarga',async()=>{
  const a=territorioConLado('a','57'),b=territorioConLado('b','58')
  const eventos=[
    {id:'e1',lado_id:'l-a',territory_id:'a',estado:'recorrido',informado_at:'2026-09-02T00:00:00Z'},
    {id:'e2',lado_id:'l-b',territory_id:'b',estado:'no_accesible',informado_at:'2026-09-02T00:00:00Z'},
    {id:'e3',lado_id:'l-b',territory_id:'b',estado:'recorrido',informado_at:'2026-09-03T00:00:00Z'},
  ]
  const {client,entregadas}=clientFiltrable({
    territorios:[a.territorio,b.territorio],territorio_manzanas:[a.manzana,b.manzana],
    manzana_lados:[a.lado,b.lado],cobertura_eventos:eventos,
  })
  const resultado=await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z','a')
  assert.deepEqual(entregadas.cobertura_eventos.map(e=>e.id),['e1'])
  assert.deepEqual(entregadas.manzana_lados.map(l=>l.id),['l-a'])
  assert.deepEqual(resultado.sides.map(l=>[l.id,l.state]),[['l-a','recorrido']])
})

test('con un territorio elegido, el resultado es el mismo que filtrando después de bajarlo todo',async()=>{
  const a=territorioConLado('a','57'),b=territorioConLado('b','58')
  const eventos=[
    {id:'e1',lado_id:'l-a',territory_id:'a',estado:'revisitar',informado_at:'2026-09-02T00:00:00Z'},
    {id:'e2',lado_id:'l-a',territory_id:'a',estado:'recorrido',informado_at:'2026-09-03T00:00:00Z'},
    {id:'e3',lado_id:'l-b',territory_id:'b',estado:'recorrido',informado_at:'2026-09-03T00:00:00Z'},
    // Una marca posterior a la fecha elegida no cuenta, con o sin territorio.
    {id:'e4',lado_id:'l-a',territory_id:'a',estado:'no_accesible',informado_at:'2026-09-09T00:00:00Z'},
  ]
  const tablas={
    territorios:[a.territorio,b.territorio],territorio_manzanas:[a.manzana,b.manzana],
    manzana_lados:[a.lado,b.lado],cobertura_eventos:eventos,
  }
  const todo=await loadCoverageHeatmap(clientFiltrable(tablas).client,'2026-09-05T10:00:00Z')
  const uno=await loadCoverageHeatmap(clientFiltrable(tablas).client,'2026-09-05T10:00:00Z','a')
  const ladosDeA=todo.sides.filter(l=>l.territory_id==='a')
  assert.deepEqual(uno.sides,ladosDeA)
  assert.equal(uno.sides[0].state,'recorrido')
  assert.deepEqual(uno.territories.find(t=>t.id==='a'),todo.territories.find(t=>t.id==='a'))
})

test('el filtro de territorio se aplica en cada página de la bitácora',async()=>{
  // Más de una página de eventos: si el filtro se perdiera a partir de la
  // segunda, se descargaría de todos los territorios sin que nada lo avisara.
  const a=territorioConLado('a','57')
  const eventos=Array.from({length:1100},(_,i)=>({
    id:`e${String(i).padStart(4,'0')}`,lado_id:'l-a',territory_id:'a',estado:'recorrido',
    informado_at:new Date(Date.UTC(2026,8,2,0,0,i)).toISOString(),
  }))
  const {client,calls}=clientFor({territorios:[a.territorio],cobertura_eventos:eventos})
  await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z','a')
  const paginas=calls.filter(c=>c.table==='cobertura_eventos'&&c.from!==undefined)
  const acotadas=calls.filter(c=>c.table==='cobertura_eventos'&&c.eq==='territory_id')
  assert.equal(paginas.length,3)
  assert.equal(acotadas.length,paginas.length)
})

test('la vista "todos" sigue trayendo toda la bitácora',async()=>{
  const a=territorioConLado('a','57'),b=territorioConLado('b','58')
  const eventos=[
    {id:'e1',lado_id:'l-a',territory_id:'a',estado:'recorrido',informado_at:'2026-09-02T00:00:00Z'},
    {id:'e2',lado_id:'l-b',territory_id:'b',estado:'recorrido',informado_at:'2026-09-02T00:00:00Z'},
  ]
  const {client,entregadas}=clientFiltrable({
    territorios:[a.territorio,b.territorio],territorio_manzanas:[a.manzana,b.manzana],
    manzana_lados:[a.lado,b.lado],cobertura_eventos:eventos,
  })
  const resultado=await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z',null)
  assert.equal(entregadas.cobertura_eventos.length,2)
  assert.equal(resultado.sides.length,2)
})

test('la columna que se usa para acotar existe en el esquema de las tres tablas',async()=>{
  // No se crea nada: se leen los archivos que ya están para no filtrar por una
  // columna que la base no tiene. `territorio_manzanas` viene del esquema base;
  // las otras dos, de la migración de cobertura.
  const {readFile}=await import('node:fs/promises')
  const leer=ruta=>readFile(new URL(ruta,import.meta.url),'utf8')
  const cobertura=await leer('../supabase/migrations/20260902120000_cobertura_lados_y_puntos_encuentro.sql')
  const base=await leer('../supabase/schema.sql')
  const origenes={territorio_manzanas:base,manzana_lados:cobertura,cobertura_eventos:cobertura}
  for(const [tabla,sql] of Object.entries(origenes)){
    const cuerpo=sql.match(new RegExp(`create table if not exists ${tabla} \\(([\\s\\S]*?)\\n\\);`))?.[1]
    assert.ok(cuerpo,`no se encontró la tabla ${tabla}`)
    assert.match(cuerpo,/\n\s+territory_id uuid not null references territorios/,`${tabla} sin territory_id`)
  }
  assert.match(cobertura,/cobertura_eventos_territorio_fecha_idx\s+on cobertura_eventos \(territory_id, informado_at desc\)/)
})

test('el texto del panel no fija un peso que cambia con los datos',async()=>{
  const {readFile}=await import('node:fs/promises')
  for(const archivo of ['../src/components/CoverageHeatmapPanel.tsx','../src/lib/loadCoverageHeatmap.ts']){
    const fuente=await readFile(new URL(archivo,import.meta.url),'utf8')
    assert.doesNotMatch(fuente,/\d[,.]\d+\s*MB/,`${archivo} fija un tamaño en MB`)
    assert.doesNotMatch(fuente,/\b2\.735\b/,`${archivo} fija una cantidad de lados`)
  }
})
