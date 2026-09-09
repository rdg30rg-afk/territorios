import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Ejecuta el componente real con hooks y transporte controlados. No sustituye
// React DOM ni la aceptación visual: comprueba las transiciones del formulario.
const source = await readFile(new URL('../src/components/SalidaResultadoForm.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
function harness({loadError=false,saveError=false,refreshError=false,pending=null}={}) {
  const slots=[], effects=[], calls=[]
  let cursor=0, loads=0, tree
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots)) slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]},
    useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} )},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)) slots[i]={fn,deps};return slots[i].fn},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i],deps)){slots[i]=deps;effects.push(fn)}},
  }
  const client={
    from(){return {select(){return this},eq(){return this},async maybeSingle(){loads++;return {data:null,error:loadError||(refreshError&&loads>1)?{message:'falló lectura'}:null}}}},
    async rpc(name,payload){calls.push({name,payload});return {error:saveError?{message:'sin respuesta'}:null}},
  }
  const exports={}
  const jsx=(type,props)=>({type,props})
  vm.runInNewContext(code, {exports,require(name){
    if(name==='react') return hooks
    if(name==='react/jsx-runtime') return {jsx,jsxs:jsx}
    if(name.endsWith('Desplegable')) return {Desplegable:'Desplegable'}
    if(name.endsWith('Icono')) return {Icono:()=>null}
    if(name.endsWith('supabase')) return {supabase:client}
    if(name.endsWith('resultDelivery')) return {
      async pendingResult(){return {userId:'user',payload:pending}},
      async deliverResult(payload){pending??=payload;const result=await client.rpc('informar_resultado_salida',pending);if(result.error)throw result.error;pending=null},
    }
    if(name.endsWith('decirElError')) return {decirElError:e=>e.message}
    throw Error(name)
  },crypto:{randomUUID:()=>`attempt-${calls.length+1}`},window:{addEventListener(){},removeEventListener(){}},Date,Intl})
  function render(){cursor=0;tree=exports.SalidaResultadoForm({salidaId:'salida-qa',canReport:true,canCorrect:true});return tree}
  function nodes(node=tree){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n ?? null));return [node,...nodes(node.props?.children ?? null)]}
  function text(node){if(node==null)return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children)}
  async function settle(){for(let i=0;i<5;i++){render();for(const fn of effects.splice(0))fn();await new Promise(r=>setImmediate(r))}render()}
  async function click(label){const n=nodes().find(n=>n.type==='button'&&text(n)===label);assert.ok(n,`Botón ausente: ${label}`);assert.ok(!n.props.disabled);await n.props.onClick();await settle()}
  async function submit(){const form=nodes().find(n=>n.type==='form');assert.ok(form);await form.props.onSubmit({preventDefault(){}});await settle()}
  return {settle,click,submit,nodes,text:()=>text(tree),calls}
}
test('error de lectura no se presenta como ausencia de resultado ni habilita informar',async()=>{
  const h=harness({loadError:true});await h.settle()
  assert.match(h.text(),/No se pudo verificar/)
  assert.doesNotMatch(h.text(),/Sin resultado informado/)
  assert.ok(!h.nodes().some(n=>n.type==='button'&&n.props.children==='Informar resultado'))
})
test('un informe nuevo empieza en Realizada y no ofrece Sin dato como resultado',async()=>{
  const h=harness();await h.settle();await h.click('Informar resultado')
  const realizada=h.nodes().find(n=>n.type==='button'&&n.props.children==='Realizada')
  assert.equal(realizada?.props['aria-pressed'],true)
  assert.ok(!h.nodes().some(n=>n.type==='button'&&n.props.children==='Sin dato'))
})
test('respuesta perdida bloquea edición y reintenta el mismo UUID y payload',async()=>{
  const h=harness({saveError:true});await h.settle();await h.click('Informar resultado');await h.submit()
  assert.match(h.text(),/Reintentar el mismo envío/)
  for(const n of h.nodes().filter(n=>['textarea','input'].includes(n.type)))assert.equal(n.props.disabled,true)
  for(const n of h.nodes().filter(n=>n.type==='Desplegable'))assert.equal(n.props.deshabilitado,true)
  await h.submit();assert.equal(h.calls.length,2)
  assert.deepEqual(h.calls[0].payload,h.calls[1].payload)
})
test('RPC confirmada seguida de lectura fallida cierra formulario y no habilita duplicar',async()=>{
  const h=harness({refreshError:true});await h.settle();await h.click('Informar resultado');await h.submit()
  assert.equal(h.calls.length,1)
  assert.match(h.text(),/se guardó, pero no se pudo volver a cargar/)
  assert.ok(!h.nodes().some(n=>n.type==='form'))
  assert.match(h.text(),/Volver a consultar/)
})
test('dos submits antes del siguiente render hacen una sola llamada',async()=>{
  const h=harness({saveError:true});await h.settle();await h.click('Informar resultado')
  const form=h.nodes().find(n=>n.type==='form')
  await Promise.all([form.props.onSubmit({preventDefault(){}}),form.props.onSubmit({preventDefault(){}})])
  assert.equal(h.calls.length,1)
  await h.settle();await h.submit()
  assert.equal(h.calls.length,2)
  assert.deepEqual(h.calls[0].payload,h.calls[1].payload)
})
test('recupera envío tras remontar y mantiene UUID aunque el resultado actual esté vacío',async()=>{
  const pending={p_id:'recovered',p_salida_id:'salida-qa',p_estado:'parcial',p_motivo:'clima',p_observaciones:'llovió',p_ocurrio_at:null,p_corrige_id:null}
  const h=harness({pending});await h.settle()
  assert.match(h.text(),/envío conservado/)
  await h.submit();assert.deepEqual(h.calls[0].payload,pending)
})
test('consultar después de respuesta perdida no descarta el intento pendiente',async()=>{
  const h=harness({saveError:true});await h.settle();await h.click('Informar resultado');await h.submit()
  const original=h.calls[0].payload
  await h.click('Consultar qué quedó guardado')
  assert.match(h.text(),/Reintentar el mismo envío/)
  await h.submit();assert.deepEqual(h.calls[1].payload,original)
})
