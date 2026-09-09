import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import {readFile} from 'node:fs/promises'
const source=await readFile(new URL('../src/context/AuthContext.tsx',import.meta.url),'utf8')
const code=ts.transpileModule(source.replace('import.meta.env.VITE_SUPABASE_URL',JSON.stringify('https://dev.supabase.co')),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
function harness({warning=null,confirm=true}={}){
  const logouts=[],prompts=[]
  const slots=[],timers=new Map(),replies=[];let cursor=0,effects=[],listener,tree,next=0
  const session={user:{id:'a'}}
  const client={auth:{async signOut(){logouts.push(true);return {error:null}},async getSession(){return {data:{session}}},onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){}}}}}},
    from(table){const query={select(){return this},eq(){return this},maybeSingle(){return this},then(resolve){replies.push({table,resolve})}};return query}}
  const exports={};const jsx=(type,props)=>({type,props})
  vm.runInNewContext(code,{exports,URL,localStorage:{},window:{confirm(text){prompts.push(text);return confirm}},setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},require(name){
    if(name==='react')return {useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef(initial){const i=cursor++;return slots[i]??={current:initial}},useCallback(fn){return fn},useEffect(fn,deps){const i=cursor++;const previous=slots[i];const changed=!previous||!deps||!previous.deps||deps.length!==previous.deps.length||deps.some((value,index)=>!Object.is(value,previous.deps[index]));if(changed){previous?.cleanup?.();slots[i]={deps,cleanup:null};effects.push(()=>{slots[i].cleanup=fn()})}}}
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx}
    if(name.endsWith('/supabase'))return {supabase:client,isSupabaseConfigured:true}
    if(name.endsWith('/access'))return {
      hasActiveAccess:p=>p?.access_status==='active',
      hasModuleAccess:()=>false,
      canOpenAdminPanel:p=>p?.access_status==='active'&&p?.role==='admin',
      canManageAdministrators:()=>false,
      isSystemRole:()=>false,
    }
    if(name.endsWith('/readAllRows'))return {}
    if(name.endsWith('/pendingBeforeLogout'))return {pendingBeforeLogout:()=>warning}
    if(name.endsWith('/authRedirect'))return {confirmationRedirectUrl(origin){const url=new URL('/login',origin);url.searchParams.set('confirmado','1');return url.toString()}}
    if(name==='./AuthTypes')return {AuthContext:{Provider:'provider'}}
    throw Error(name)
  }})
  function render(){cursor=0;tree=exports.AuthProvider({children:'screen'});return tree.props.value}
  function runEffects(){effects.splice(0).forEach(fn=>fn())}
  async function flush(){await new Promise(r=>setImmediate(r));render();runEffects()}
  async function tick(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn()}await flush()}
  async function answer(status='active',error=null){for(const r of replies.splice(0))r.resolve({data:r.table==='profiles'?{id:'a',role:'viewer',access_status:status}:[],error});await flush()}
  render();runEffects()
  return {render,flush,runEffects,tick,answer,event:(s=session)=>listener('SIGNED_IN',s),replies,logouts,prompts}
}
test('revalidar misma cuenta conserva perfil y pantalla mientras consulta, y aplica revocación',async()=>{
  const h=harness();await h.flush();await h.answer()
  assert.equal(h.render().isLoading,false);assert.equal(h.render().isApproved,true)
  h.event();await h.tick(0)
  assert.equal(h.render().isLoading,false);assert.equal(h.render().profile.id,'a')
  await h.answer('inactive');assert.equal(h.render().isApproved,false)
})
test('avisos duplicados comparten consulta pendiente y cambiar cuenta invalida inmediatamente',async()=>{
  const h=harness();await h.flush();h.event();await h.tick(0)
  assert.equal(h.replies.length,3)
  await h.answer();h.event({user:{id:'b'}})
  assert.equal(h.render().profile,null);assert.equal(h.render().isLoading,true)
})
test('timeout termina carga y descarta respuestas tardías',async()=>{
  const h=harness();await h.flush();await h.tick(15000)
  assert.equal(h.render().isLoading,false);assert.match(h.render().authError,/demasiado/)
  await h.answer();assert.equal(h.render().profile,null)
})
test('error en comprobación de fondo cierra acceso; logout no conserva perfil',async()=>{
  const h=harness();await h.flush();await h.answer();h.event();await h.tick(0)
  await h.answer('active',{message:'network'});assert.equal(h.render().profile,null);assert.ok(h.render().authError)
  h.event(null);await h.tick(0);assert.equal(h.render().isAuthenticated,false)
})
test('renovar sin cambios conserva identidad del perfil para no reiniciar formularios',async()=>{
  const h=harness();await h.flush();await h.answer()
  const original=h.render().profile
  h.event();await h.tick(0);await h.answer()
  assert.equal(h.render().profile,original)
  assert.equal(h.render().isLoading,false)
  h.event();await h.tick(0);await h.answer('inactive')
  assert.notEqual(h.render().profile,original)
  assert.equal(h.render().isApproved,false)
})
test('reintentar la misma sesión no desmonta la pantalla mientras revalida',async()=>{
  const h=harness();await h.flush();await h.answer()
  const before=h.render();const original=before.profile
  before.retryAuth();h.render();h.runEffects();await h.flush()
  assert.equal(h.render().isLoading,false)
  assert.equal(h.render().profile,original)
  assert.equal(h.replies.length,3)
})
test('cancelar aviso de pendientes impide logout desde el proveedor común',async()=>{
  const h=harness({warning:'Pendientes QA',confirm:false});await h.flush();await h.answer()
  await h.render().signOut()
  assert.deepEqual(h.prompts,['Pendientes QA']);assert.equal(h.logouts.length,0)
  assert.equal(h.render().isAuthenticated,true)
})
test('confirmar salida con pendientes llama Auth sin borrar almacenamiento',async()=>{
  const h=harness({warning:'Pendientes QA'});await h.flush();await h.answer()
  await h.render().signOut();assert.equal(h.logouts.length,1);assert.equal(h.prompts.length,1)
})
test('sin pendientes cierra sin confirmación adicional',async()=>{
  const h=harness();await h.flush();await h.answer()
  await h.render().signOut();assert.equal(h.logouts.length,1);assert.equal(h.prompts.length,0)
})
