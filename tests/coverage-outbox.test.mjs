import assert from 'node:assert/strict'
import test from 'node:test'
import { CreateOutbox, CoverageOutboxStorageError } from '../src/lib/coverageOutbox.ts'
class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
}
function locks() {
  const tails = new Map()
  return async (name, task) => {
    const previous = tails.get(name) ?? Promise.resolve()
    let release
    tails.set(name, new Promise(resolve => { release = resolve }))
    await previous
    try { return await task() } finally { release() }
  }
}
const input = (overrides = {}) => ({ lado_id:'side', manzana_id:'block', territory_id:'territory', geometry_version:3, estado:'recorrido', origen:'app_hermano', informado_por:'user', ...overrides })
const setup = () => ({ storage:new MemoryStorage(), lock:locks(), projectRef:'dev', userId:'user' })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r }); return {promise,resolve} }
test('corrección conserva motivo, evento original y UUID al recuperar y reintentar', async () => {
  const options=setup(),box=CreateOutbox(options)
  const queued=await box.enqueue(input({origen:'correccion',corrige_evento_id:'original',nota:'Estado informado por error'}))
  const recovered=CreateOutbox(options),sent=[]
  await recovered.drain(async event=>{sent.push(event);return {confirmed:false,error:'sin red'}})
  await recovered.retryErrors()
  await recovered.drain(async event=>{sent.push(event);return true})
  assert.equal(sent.length,2)
  for(const event of sent) {
    assert.equal(event.id,queued.id);assert.equal(event.corrige_evento_id,'original')
    assert.equal(event.nota,'Estado informado por error');assert.equal(event.origen,'correccion')
  }
  assert.equal(recovered.getEvents().length,0)
})
test('durable, UUID y aislamiento por cuenta/proyecto, sin autor ajeno', async () => {
  const options=setup(), box=CreateOutbox(options), event=await box.enqueue(input())
  assert.match(event.id,/^[0-9a-f-]{36}$/)
  assert.deepEqual(CreateOutbox(options).getEvents(),[event])
  assert.equal(CreateOutbox({...options,userId:'other'}).getEvents().length,0)
  assert.equal(CreateOutbox({...options,projectRef:'other'}).getEvents().length,0)
  await assert.rejects(box.enqueue(input({informado_por:'other'})),/otra cuenta/)
})
test('storage ilegible o lleno no se declara guardado ni se borra', async () => {
  const options=setup()
  const box=CreateOutbox({...options,storage:{getItem:()=>null,setItem:()=>{throw Error('quota')}}})
  await assert.rejects(box.enqueue(input()), e=>e instanceof CoverageOutboxStorageError && e.operation==='write')
  assert.throws(()=>CreateOutbox({...options,storage:{getItem:()=>'{roto',setItem:()=>assert.fail()}}),CoverageOutboxStorageError)
})
test('dos instancias encolan simultáneamente sin perder marcas', async () => {
  const options=setup(), a=CreateOutbox(options), b=CreateOutbox(options)
  const events=await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).enqueue(input({lado_id:`side${i}`}))))
  assert.equal(a.getEvents().length,40);assert.equal(new Set(events.map(e=>e.id)).size,40)
})
test('segunda pestaña no duplica envío activo; encolar no espera red lenta', async () => {
  const options=setup(), start=deferred(), finish=deferred(), a=CreateOutbox(options)
  await a.enqueue(input())
  const drain=a.drain(async()=>{start.resolve();await finish.promise;return true})
  await start.promise
  const b=CreateOutbox(options)
  assert.equal(b.getEvents()[0].status,'sending')
  await b.enqueue(input({lado_id:'another'}))
  const second=b.drain(async()=>assert.fail('no debe duplicar'))
  finish.resolve()
  assert.deepEqual(await drain,{attempted:2,confirmed:2,failed:0,remaining:0})
  assert.deepEqual(await second,{attempted:0,confirmed:0,failed:0,remaining:0})
})
test('envío interrumpido se recupera bajo delivery con ID original', async () => {
  const options=setup(), a=CreateOutbox(options), event=await a.enqueue(input())
  const raw=JSON.parse(options.storage.getItem(a.key));raw.events[0].status='sending'
  options.storage.setItem(a.key,JSON.stringify(raw))
  const b=CreateOutbox(options)
  assert.equal(b.getEvents()[0].status,'sending')
  await b.drain(async received=>{assert.equal(received.id,event.id);return true})
  assert.deepEqual(b.getEvents(),[])
})
test('error bloquea siguientes del mismo lado, no otros; retry mantiene ID', async () => {
  const box=CreateOutbox(setup()), first=await box.enqueue(input())
  const next=await box.enqueue(input({estado:'revisitar'})), other=await box.enqueue(input({lado_id:'other'})), calls=[]
  const result=await box.drain(async e=>{calls.push(e.id);return e.id===first.id?{confirmed:false,error:'Geometría retirada'}:true})
  assert.deepEqual(calls,[first.id,other.id]);assert.deepEqual(result,{attempted:2,confirmed:1,failed:1,remaining:2})
  assert.equal((await box.drain(async()=>assert.fail())).attempted,0)
  assert.equal((await box.retry(first.id)).id,first.id)
  const retried=[];await box.drain(async e=>{retried.push(e.id);return true})
  assert.deepEqual(retried,[first.id,next.id])
})
test('storage falla después de confirmación: conserva ID para replay', async () => {
  const options=setup(), box=CreateOutbox(options), event=await box.enqueue(input()), write=options.storage.setItem.bind(options.storage)
  await assert.rejects(box.drain(async()=>{options.storage.setItem=()=>{throw Error('quota')};return true}),CoverageOutboxStorageError)
  options.storage.setItem=write
  assert.equal(box.getEvents()[0].id,event.id)
  await box.drain(async e=>{assert.equal(e.id,event.id);return true})
  assert.equal(box.getEvents().length,0)
})
test('cambio de sesión detiene cola sin eliminar pendientes', async () => {
  let active=true;const box=CreateOutbox({...setup(),shouldContinue:()=>active})
  await box.enqueue(input());await box.enqueue(input({lado_id:'other'}))
  assert.equal((await box.drain(async()=>{active=false;return true})).remaining,1)
})
test('sin Web Locks ni wrapper no afirma persistencia segura', async () => {
  if(globalThis.navigator?.locks)return
  const options=setup();delete options.lock
  await assert.rejects(CreateOutbox(options).enqueue(input()),/entre pestañas/)
})
