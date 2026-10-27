import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html = await readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8')
const source = html.slice(html.indexOf('function cambiarNumeroTerritorio'), html.indexOf('// Dividir un territorio'))
function fixture({ input='5', confirm=true, inFlight=false }={}) {
  const button={}, messages=[], confirmations=[], history=[]
  const territorios=new Map([['a',{id:'a',numero:'12'}],['b',{id:'b',numero:'5'}],['c',{id:'c',numero:'60'}]])
  const tocados=new Set()
  const context=vm.createContext({document:{getElementById:()=>button},territorios,tocados,activo:'a',publicacionEnVuelo:inFlight,
    pedir:async()=>input,confirmar:async(...args)=>{confirmations.push(args);return confirm},
    avisar:msg=>messages.push(msg),instantanea:()=>history.push(JSON.stringify([...territorios])),refrescar:()=>{}})
  vm.runInContext(source,context)
  return {button,territorios,tocados,messages,confirmations,history,context}
}
test('número ocupado intercambia solo dos territorios y permite deshacer juntos',async()=>{
  const f=fixture();await f.button.onclick()
  assert.equal(f.territorios.get('a').numero,'5')
  assert.equal(f.territorios.get('b').numero,'12')
  assert.equal(f.territorios.get('c').numero,'60')
  assert.equal(f.territorios.get('a').numeroBase,'12')
  assert.equal(f.territorios.get('b').numeroBase,'5')
  assert.equal(f.tocados.size,2);assert.equal(f.history.length,1)
  assert.equal(f.confirmations.length,1)
})
test('cancelar conserva ambos números',async()=>{
  const f=fixture({confirm:false});await f.button.onclick()
  assert.equal(f.territorios.get('a').numero,'12')
  assert.equal(f.territorios.get('b').numero,'5')
  assert.equal(f.history.length,0);assert.equal(f.tocados.size,0)
})
test('número libre modifica uno y conserva el original entre varios cambios',async()=>{
  const f=fixture({input:' 70 '});await f.button.onclick()
  assert.equal(f.territorios.get('a').numero,'70')
  vm.runInContext("cambiarNumeroTerritorio(territorios.get('a'), '71')",f.context)
  assert.equal(f.territorios.get('a').numeroBase,'12')
  vm.runInContext("cambiarNumeroTerritorio(territorios.get('a'), '12')",f.context)
  assert.equal(f.territorios.get('a').numeroBase,undefined)
})
test('no modifica mientras se publica ni acepta HTML como número',async()=>{
  for(const options of [{inFlight:true},{input:'<b>5</b>'},{input:'12'},{input:' '}]) {
    const f=fixture(options);await f.button.onclick()
    assert.equal(f.history.length,0);assert.equal(f.territorios.get('a').numero,'12')
  }
})
