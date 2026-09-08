import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const html = await readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8')
const source = html.slice(html.indexOf('let publicacionEnVuelo = false'), html.indexOf('/* ====================================================================\n   PONER LAS LETRAS A MANO'))

test('el panel no duplica el editor que ya vive completo dentro de Mapas', async () => {
  const [shell, mapas] = await Promise.all([
    readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/MapasPage.tsx', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(shell, /href="\/editor-manzanas\.html"/)
  assert.doesNotMatch(shell, />\s*Editor de manzanas\s*</)
  assert.match(mapas, /srcDoc=\{editorHtml\}/)
  assert.match(mapas, /title="Editor completo de manzanas y territorios"/)
})

function fixture({ confirm = true, fail = false, edit = false } = {}) {
  const button = {}, calls = [], dialogs = []
  const manzanas = new Map([['m', {territorio:'a',letra:'A',geom:{type:'Polygon',coordinates:[]}}]])
  const tocados = new Set(['a','b'])
  const context = vm.createContext({
    document:{getElementById:()=>button}, BD_URL:'https://dev.invalid',BD_KEY:'test',
    tokenDeSesion:()=> 'test',activo:'a',territorios:new Map([['a',{id:'a',numero:57}],['b',{id:'b',numero:58}]]),
    manzanas,tocados,carasDeMz:()=>[],centroDe:()=>[0,0],areaM2De:()=>0,
    avisar:()=>{},guardar:()=>{},traerDeLaBase:async()=>{},
    dialogo:async options=>{
      dialogs.push(options)
      if (edit && dialogs.length===1) manzanas.get('m').letra='B'
      return confirm
    },
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body})
      if(url.endsWith('revisar_publicacion_editor')) return {ok:true,text:async()=>JSON.stringify([{nombre:'57',version:1},{nombre:'58',version:2}])}
      if(fail) throw Error('sin conexión')
      return {ok:true,text:async()=>JSON.stringify(body.p_territorios.map(()=>({manzanas:1,lados:0})))}
    },
  })
  vm.runInContext(source,context)
  return {button,calls,dialogs,tocados}
}
test('publica un único lote con origen vacío y versión revisada',async()=>{
  const f=fixture();await f.button.onclick()
  assert.equal(f.calls.length,2)
  assert.match(f.calls[1].url,/publicar_territorios_atomico$/)
  assert.deepEqual(f.calls[1].body.p_territorios[1],{nombre:'58',version_esperada:2,manzanas:[]})
  assert.match(f.dialogs[0].cuerpo,/sin manzanas vigentes/)
  assert.equal(f.tocados.size,0);assert.equal(f.button.disabled,false)
})
test('cancelar no publica y libera el botón',async()=>{
  const f=fixture({confirm:false});await f.button.onclick()
  assert.equal(f.calls.length,1);assert.equal(f.tocados.size,2);assert.equal(f.button.disabled,false)
})
test('fallo de red conserva pendientes y advierte resultado desconocido sin reintentar',async()=>{
  const f=fixture({fail:true});await f.button.onclick()
  assert.equal(f.calls.length,2);assert.equal(f.tocados.size,2)
  assert.match(f.dialogs[1].cuerpo,/podría haberse guardado completo/)
  assert.equal(f.button.disabled,false)
})
test('edición posterior al snapshot no se publica ni se marca guardada',async()=>{
  const f=fixture({edit:true});await f.button.onclick()
  assert.equal(f.calls[1].body.p_territorios[0].manzanas[0].label,'A')
  assert.equal(f.tocados.has('a'),true);assert.equal(f.tocados.has('b'),false)
})
