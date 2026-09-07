import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import {canReportSalidaCoverage} from '../src/lib/salidaCoverage.ts'

// Ejecutar la conversión real usada por el selector de cierres: el catálogo
// allí está vacío. No reemplazarla por un mock que esconda la integración.
const source=await readFile(new URL('../src/pages/PredicacionPage.tsx',import.meta.url),'utf8')
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='comoSalida')
assert.ok(declaration)
const code=ts.transpileModule(`${declaration.getText(ast)}\nexports.convert=comoSalida`,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const context={exports:{},numeroOpcional:value=>value==null?undefined:Number(value)}
vm.runInNewContext(code,context)
const convert=context.exports.convert
const row={id:'outing',driver_id:'driver',territory_id:'territory',scheduled_for:'2026-09-05T12:00:00Z',territorio_codigo:'57'}
const actor={id:'person',access_status:'active',driver_id:'driver'}
test('cierre conserva FK y habilita conductor exacto sin catálogo de territorios',()=>{
  const outing=convert(row,[])
  assert.equal(outing.terrId,'territory')
  assert.equal(canReportSalidaCoverage(actor,outing),true)
})
test('código textual no inventa relación para autorizar cobertura de una salida',()=>{
  const outing=convert({...row,territory_id:null},[])
  assert.equal(outing.terr,'57');assert.equal(outing.terrId,undefined)
  assert.equal(canReportSalidaCoverage(actor,outing),false)
})
test('el hermano ve el territorio, no el punto 61.1',()=>{
  const outing=convert({...row,territory_id:null,territorio_codigo:'61.1'},[])
  assert.equal(outing.terr,'61')
  assert.equal(outing.terrId,undefined)
})
test('FK prevalece sobre código contradictorio y catálogo incompleto',()=>{
  assert.equal(convert(row,[{id:'another',name:'57'}]).terrId,'territory')
})
test('SG sin tipo en la base se lee como salida de grupos',()=>{
  const outing=convert({...row,territory_id:null,territorio_codigo:'SG',meeting_point_name:'Salidas de Grupos',tipo:null},[])
  assert.equal(outing.tipo,'grupos')
  assert.equal(outing.terr,'SG')
})
