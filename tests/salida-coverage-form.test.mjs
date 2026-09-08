import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import {canReportSalidaCoverage,prepareSalidaCoverage} from '../src/lib/salidaCoverage.ts'
import {linePoints} from '../src/lib/heatmapGeometry.ts'

// Ejecuta el componente TSX real transpilado con hooks, Leaflet y transporte
// controlados. No reemplaza React DOM ni la aceptación visual en navegador.
const source=await readFile(new URL('../src/components/SalidaCoverageForm.tsx',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText

const validSide={
  id:'side-good',manzana_id:'block-1',territory_id:'territory',orden:1,
  geometry_version:1,vigente_hasta:null,
  geometry_geojson:{type:'LineString',coordinates:[[-68.5,-31.5],[-68.49,-31.5]]},
}
const validBlocks=[{id:'block-1',label:'A-01'}]
const outing={id:'outing',driverId:'driver',terrId:'territory'}
const driverProfile={id:'person',access_status:'active',driver_id:'driver'}
const DesplegableMock=()=>null

function harness({profile=driverProfile,contexto=null,sides=[validSide],blocks=validBlocks,enqueueImpl=null,queueError=null}={}) {
  const slots=[],effects=[],enqueued=[],loadTables=[],syncs=[]
  let cursor=0
  let tree=null
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]))
  const hooks={
    useState(initial){
      const index=cursor++
      if(!(index in slots))slots[index]=initial
      return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value}]
    },
    useRef(initial){
      const index=cursor++
      return slots[index]??=( {current:initial} )
    },
    useEffect(effect,deps){
      const index=cursor++
      if(!same(slots[index],deps)){slots[index]=deps;effects.push(effect)}
    },
  }
  const client={
    from(table){
      loadTables.push(table)
      const data=table==='manzana_lados'?sides:blocks
      const query={
        select(){return query},eq(){return query},is(){return query},order(){return query},
        range(){return Promise.resolve({data,error:null})},
      }
      return query
    },
  }
  const queue={
    events:[],confirmed:[],error:queueError,sending:false,
    async enqueue(payload){
      enqueued.push(payload)
      if(enqueueImpl)return enqueueImpl(payload)
      return {id:`event-${enqueued.length}`}
    },
    async sync(){syncs.push(true)},
    async retry(){},
  }
  const jsx=(type,props)=>({type,props:props??{}})
  const Leaflet={
    map(){return {fitBounds(){},remove(){}}},
    tileLayer(){return {addTo(){}}},
    polyline(){return {addTo(){return this},getBounds(){return {pad(){return {}}}}}},
  }
  const exports={}
  vm.runInNewContext(code,{exports,require(name){
    if(name==='react')return hooks
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'}
    if(name==='leaflet')return Leaflet
    if(name.endsWith('useAuth'))return {useAuth:()=>({profile,contexto})}
    if(name.endsWith('supabase'))return {supabase:client}
    if(name.endsWith('readAllRows'))return {readAllRows:async request=>{
      const result=await request(0,999)
      if(result.error)throw result.error
      return result.data??[]
    }}
    if(name.endsWith('salidaCoverage'))return {canReportSalidaCoverage,prepareSalidaCoverage}
    if(name.endsWith('heatmapGeometry'))return {linePoints}
    if(name.endsWith('fondoMapa'))return {ponerFondo(){}}
    if(name.endsWith('Desplegable'))return {Desplegable:DesplegableMock}
    if(name.endsWith('Icono'))return {Icono:()=>null}
    throw Error(`Dependencia inesperada: ${name}`)
  },Error,Promise,setTimeout,clearTimeout})
  function render(){cursor=0;tree=exports.SalidaCoverageForm({outing,queue});return tree}
  function nodes(node=tree){
    if(!node||typeof node!=='object')return []
    if(Array.isArray(node))return node.flatMap(value=>nodes(value??null))
    return [node,...nodes(node.props?.children??null)]
  }
  function text(node){
    if(node==null||typeof node==='boolean')return ''
    if(typeof node!=='object')return String(node)
    if(Array.isArray(node))return node.map(text).join('')
    return text(node.props?.children)
  }
  async function settle(){
    for(let attempt=0;attempt<8;attempt++){
      render()
      for(const effect of effects.splice(0))effect()
      await new Promise(resolve=>setImmediate(resolve))
    }
    render()
  }
  function button(label){
    const node=nodes().find(value=>value.type==='button'&&text(value)===label)
    assert.ok(node,`Botón ausente: ${label}`)
    return node
  }
  function sideSelect(){
    const node=nodes().find(value=>value.type===DesplegableMock&&value.props.etiqueta==='Lado de la calle')
    assert.ok(node,'Selector de lado ausente')
    return node
  }
  async function openAndSelect(sideId='side-good'){
    await settle()
    button('Marcar lo que recorrió el grupo').props.onClick()
    await settle()
    sideSelect().props.alElegir(sideId)
    await settle()
  }
  return {button,sideSelect,openAndSelect,nodes,text:()=>text(tree),settle,render,enqueued,loadTables,syncs,queue}
}

test('modo inicial no carga lados ni encola marcas',async()=>{
  const h=harness()
  await h.settle()
  assert.equal(h.loadTables.length,0)
  assert.equal(h.enqueued.length,0)
})

test('abrir y seleccionar un lado no encola una marca',async()=>{
  const h=harness()
  await h.openAndSelect()
  assert.deepEqual(h.loadTables.sort(),['manzana_lados','territorio_manzanas'])
  assert.equal(h.sideSelect().props.valor,'side-good')
  assert.equal(h.enqueued.length,0)
})

test('dos clics antes del siguiente render envían una sola marca',async()=>{
  const h=harness()
  await h.openAndSelect()
  const send=h.button('Informar estado de este lado')
  assert.equal(send.props.disabled,false)
  await Promise.all([send.props.onClick(),send.props.onClick()])
  await h.settle()
  assert.equal(h.enqueued.length,1)
  assert.deepEqual(h.enqueued[0],{
    lado_id:'side-good',manzana_id:'block-1',territory_id:'territory',geometry_version:1,
    estado:'recorrido',origen:'cierre_salida',salida_id:'outing',informado_por:'person',
  })
  assert.equal(h.syncs.length,1)
})

test('error de enqueue no anuncia guardado y conserva la selección',async()=>{
  const h=harness({enqueueImpl:async()=>{throw Error('almacenamiento local lleno')}})
  await h.openAndSelect()
  await h.button('Informar estado de este lado').props.onClick()
  await h.settle()
  assert.match(h.text(),/almacenamiento local lleno/)
  assert.doesNotMatch(h.text(),/Última marca (?:conservada|confirmada)/)
  assert.equal(h.sideSelect().props.valor,'side-good')
  assert.equal(h.enqueued.length,1)
})

test('geometría inválida bloquea el envío',async()=>{
  const invalid={...validSide,geometry_geojson:{type:'LineString',coordinates:[[-68.5,-31.5]]}}
  const h=harness({sides:[invalid]})
  await h.openAndSelect()
  assert.match(h.text(),/Este lado no tiene un dibujo legible/)
  assert.equal(h.button('Informar estado de este lado').props.disabled,true)
  assert.equal(h.enqueued.length,0)
})

test('otro conductor también puede informar la salida',async()=>{
  const h=harness({profile:{...driverProfile,driver_id:'other-driver'}})
  await h.settle()
  assert.notEqual(h.render(),null)
  assert.equal(h.loadTables.length,0)
  assert.equal(h.enqueued.length,0)
})

test('publicador sin capacidad no ve el formulario',async()=>{
  const h=harness({profile:{...driverProfile,driver_id:null},contexto:{puede_informar_salidas:false}})
  await h.settle()
  assert.equal(h.render(),null)
  assert.equal(h.nodes().length,0)
})
