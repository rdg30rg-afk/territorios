import test from 'node:test'
import assert from 'node:assert/strict'
import { resultAttemptStore } from '../src/lib/resultAttempt.ts'
const payload={p_id:'one',p_salida_id:'outing',p_estado:'sin_dato',p_motivo:null,p_observaciones:null,p_ocurrio_at:null,p_corrige_id:null}
function memory(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}
test('remount/retry retains original payload and correction reference, not newer input',()=>{
  const storage=memory(), first=resultAttemptStore(storage,'dev','user','outing')
  const correction={...payload,p_corrige_id:'original',p_observaciones:'correction'}
  first.prepare(correction)
  const recovered=resultAttemptStore(storage,'dev','user','outing')
  assert.deepEqual(recovered.prepare({...payload,p_id:'two',p_estado:'realizada'}),correction)
  recovered.confirm('two');assert.deepEqual(recovered.read(),correction)
  recovered.confirm('one');assert.equal(recovered.read(),null)
})
test('isolates account, project and outing',()=>{
  const storage=memory();resultAttemptStore(storage,'dev','user','outing').prepare(payload)
  for(const scope of [['other','user','outing'],['dev','other','outing'],['dev','user','other']])
    assert.equal(resultAttemptStore(storage,...scope).read(),null)
})
test('storage failure or corrupted record does not overwrite an uncertain attempt',()=>{
  const storage=memory(),box=resultAttemptStore(storage,'dev','user','outing')
  storage.setItem(box.key,'broken')
  assert.throws(()=>box.prepare(payload));assert.equal(storage.getItem(box.key),'broken')
  assert.throws(()=>resultAttemptStore({...storage,setItem(){throw Error('quota')}},'dev','new','outing').prepare(payload),/quota/)
})
