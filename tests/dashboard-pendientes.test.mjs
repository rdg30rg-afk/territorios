import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source=await readFile(new URL('../src/pages/DashboardPage.tsx',import.meta.url),'utf8')
const component=source.slice(source.indexOf('function QueNecesitaAtencion()'),source.indexOf('function UserAccessPanel()'))
const compiled=ts.transpileModule(component+'\nexport { QueNecesitaAtencion };',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
}).outputText
async function render({failTable=null,missingClient=false,usersError=null,counts={}}={}) {
  const slots=[],effects=[]
  let cursor=0,tree
  const users=[]
  const same=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
  const client={from(table){
    const q={select(){return q},neq(){return q},order(){return q},eq(){return q},is(){return q},or(){return q},gte(){return q},limit(){return q},
      then(resolve,reject){return Promise.resolve({data:table==='importaciones'?[{id:'run'}]:null,count:counts[table]??0,error:table===failTable?{message:'sin conexión'}:null}).then(resolve,reject)}}
    return q
  }}
  const exports={}
  const jsx=(type,props)=>({type,props})
  vm.runInNewContext(compiled,{
    exports,require:()=>({jsx,jsxs:jsx}),Link:'a',Date,
    supabase:missingClient?null:client,Icono:()=>null,
    useAuth:()=>({profile:{role:'admin'},managedUsers:users,managedUsersError:usersError,loadManagedUsers:async()=>{}}),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
    useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i],deps)){slots[i]=deps;effects.push(fn)}},
  })
  for(let n=0;n<5;n++) {
    cursor=0;tree=exports.QueNecesitaAtencion()
    for(const effect of effects.splice(0))effect()
    await new Promise(resolve=>setImmediate(resolve))
  }
  const text=node=>node==null?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children)
  return text(tree)
}
test('solo confirma al día cuando todas las consultas respondieron sin pendientes',async()=>{
  assert.match(await render(),/No hay nada esperándote/)
})
test('error en cada fuente o falta de cliente impide falso al día',async()=>{
  for(const failTable of ['importaciones','importacion_registros','salidas','territorio_personal_reservas']) {
    const output=await render({failTable})
    assert.match(output,/No se pudo comprobar/);assert.doesNotMatch(output,/No hay nada esperándote/)
  }
  for(const options of [{missingClient:true},{usersError:'falló acceso'}]) {
    const output=await render(options)
    assert.match(output,/No se pudo comprobar/);assert.doesNotMatch(output,/No hay nada esperándote/)
  }
})
test('conserva pendientes confirmados aunque falle otra fuente',async()=>{
  const output=await render({failTable:'salidas',counts:{territorio_personal_reservas:3}})
  assert.match(output,/3 hermanos pidieron territorio/)
  assert.match(output,/salidas sin conductor/)
})
