import test from 'node:test'
import assert from 'node:assert/strict'
import {pendingBeforeLogout} from '../src/lib/pendingBeforeLogout.ts'
function storage(entries){const map=new Map(entries);return {length:map.size,key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null}}
test('sin pendientes no exige confirmación',()=>assert.equal(pendingBeforeLogout(storage([]),'dev','user'),null))
test('cuenta marcas y resultados propios sin leer ni borrar el contenido del resultado',()=>{
  const s=storage([
    ['coverage-outbox:v1:dev:user',JSON.stringify({version:1,projectRef:'dev',userId:'user',events:[{},{}]})],
    ['territorios:result-attempt:v1:dev:user:outing','pending'],
    ['territorios:result-attempt:v1:dev:other:outing','pending'],
    ['territorios:result-attempt:v1:other:user:outing','pending'],
  ])
  assert.match(pendingBeforeLogout(s,'dev','user'),/2 marcas y 1 resultados/)
  assert.equal(s.length,4)
})
test('almacenamiento inaccesible o corrupto advierte incertidumbre',()=>{
  assert.match(pendingBeforeLogout({getItem(){throw Error('denied')}},'dev','user'),/No pudimos comprobar/)
  assert.match(pendingBeforeLogout(storage([['coverage-outbox:v1:dev:user','broken']]),'dev','user'),/No pudimos comprobar/)
})
