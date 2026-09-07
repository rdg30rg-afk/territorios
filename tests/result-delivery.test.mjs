import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { resultAttemptStore } from '../src/lib/resultAttempt.ts'

const source=await readFile(new URL('../src/lib/resultDelivery.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source.replace('import.meta.env.VITE_SUPABASE_URL','TEST_URL'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const payload={p_id:'stable',p_salida_id:'outing',p_estado:'parcial',p_motivo:null,p_observaciones:'lluvia',p_ocurrio_at:null,p_corrige_id:null}
function harness({wrongProject=false,quota=false,changeInLock=false,noLocks=false,fail=false}={}){
  const values=new Map(),calls=[]
  let user='author',fails=fail
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(quota)throw Error('quota');values.set(key,value)},removeItem:key=>values.delete(key)}
  const client={auth:{async getSession(){return {data:{session:{user:{id:user},access_token:`jwt-${user}`}},error:null}}},
    rpc(name,data){return {async setHeader(nameHeader,token){calls.push({name,data,nameHeader,token,stored:values.size});if(fails)throw Error('respuesta perdida');return {error:null}}}}}
  const exports={}
  vm.runInNewContext(code,{exports,TEST_URL:`https://${wrongProject?'dwgvzcnarrjgqjotocdw':'rkmioktcsgqqjshrlkmy'}.supabase.co`,localStorage:storage,
    navigator:{locks:noLocks?undefined:{async request(key,fn){if(changeInLock)user='other';return fn()}}},
    require(name){if(name==='./supabase')return {supabase:client};if(name==='./resultAttempt')return {resultAttemptStore};throw Error(name)}})
  return {...exports,calls,values,setFail(value){fails=value}}
}
test('persiste antes de enviar y fija el JWT del autor; borra solo tras confirmar',async()=>{
  const h=harness();await h.deliverResult(payload,'author')
  assert.equal(h.calls[0].stored,1);assert.equal(h.calls[0].token,'Bearer jwt-author')
  assert.equal(h.values.size,0)
})
test('respuesta perdida recupera el mismo intento para reintentar',async()=>{
  const h=harness({fail:true});await assert.rejects(h.deliverResult(payload,'author'),/perdida/)
  assert.deepEqual((await h.pendingResult('outing')).payload,payload)
  h.setFail(false);await h.deliverResult({...payload,p_id:'different'},'author')
  assert.deepEqual(h.calls[1].data,payload);assert.equal(h.values.size,0)
})
test('rechaza producción, cambio de cuenta y falta de locks sin enviar',async()=>{
  for(const options of [{wrongProject:true},{changeInLock:true},{noLocks:true}]){
    const h=harness(options);await assert.rejects(h.deliverResult(payload,'author'))
    assert.equal(h.calls.length,0);assert.equal(h.values.size,0)
  }
  const h=harness();await assert.rejects(h.deliverResult(payload,'another'));assert.equal(h.calls.length,0)
})
test('almacenamiento lleno falla antes de llamar a la RPC',async()=>{
  const h=harness({quota:true});await assert.rejects(h.deliverResult(payload,'author'),/quota/)
  assert.equal(h.calls.length,0)
})
