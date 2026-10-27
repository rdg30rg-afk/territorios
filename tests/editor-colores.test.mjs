import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html=await readFile(new URL('../editor-manzanas.html',import.meta.url),'utf8')
const source=html.slice(html.indexOf('function cambiarColorTerritorio'),html.indexOf("document.getElementById('colorTerritorio').onchange"))
function fixture(inFlight=false) {
 const territorios=new Map([['a',{id:'a',numero:'5',color:'#407DFE'}],['b',{id:'b',numero:'12',color:'#FA5D27'}]])
 const history=[]
 const context=vm.createContext({activo:'a',territorios,publicacionEnVuelo:inFlight,
  instantanea:()=>history.push(JSON.stringify([...territorios])),refrescar:()=>{},avisar:()=>{}})
 vm.runInContext(source,context)
 return {territorios,history,change:color=>vm.runInContext(`cambiarColorTerritorio(${JSON.stringify(color)})`,context)}
}
test('cambia solo el color del territorio seleccionado y conserva la base para guardar',()=>{
 const f=fixture();f.change('#01bc73')
 assert.equal(f.territorios.get('a').color,'#01bc73')
 assert.equal(f.territorios.get('a').colorBase,'#407DFE')
 assert.equal(f.territorios.get('b').color,'#FA5D27')
 assert.equal(f.history.length,1)
 f.change('#8d5af8');assert.equal(f.territorios.get('a').colorBase,'#407DFE')
 f.change('#407dfe');assert.equal(f.territorios.get('a').colorBase,undefined)
})
test('no acepta colores inválidos, evita duplicar cambios y bloquea durante publicación',()=>{
 const f=fixture();f.change('#407dfe');f.change('red;invalid')
 assert.equal(f.history.length,0)
 const g=fixture(true);g.change('#01bc73');assert.equal(g.history.length,0)
})
