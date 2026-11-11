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

function fixture({ confirm = true, fail = false, edit = false, renumber = false, color = false } = {}) {
  const button = {}, calls = [], dialogs = []
  const manzanas = new Map([['m', {territorio:'a',letra:'A',geom:{type:'Polygon',coordinates:[]}}]])
  const tocados = new Set(['a','b'])
  const territorios = new Map([['a',{id:'a',numero:renumber ? '58' : 57, ...(renumber ? {numeroBase:'57'} : {})}],['b',{id:'b',numero:renumber ? '57' : 58, ...(renumber ? {numeroBase:'58'} : {})}]])
  if (color) Object.assign(territorios.get('a'), {color:'#01bc73',colorBase:'#407dfe'})
  const context = vm.createContext({
    document:{getElementById:()=>button}, BD_URL:'https://dev.invalid',BD_KEY:'test',
    tokenDeSesion:()=> 'test',activo:'a',territorios, historial:[], rehechos:[],
    manzanas,tocados,carasDeMz:()=>[],centroDe:()=>[0,0],areaM2De:()=>0,
    avisar:()=>{},guardar:()=>{},traerDeLaBase:async()=>{},
    dialogo:async options=>{
      dialogs.push(options)
      if (edit && dialogs.length===1) manzanas.get('m').letra='B'
      return confirm
    },
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body})
      if(url.endsWith('revisar_publicacion_editor')) return {ok:true,text:async()=>JSON.stringify([{nombre:'57',id:'uuid-a',version:1},{nombre:'58',id:'uuid-b',version:2}])}
      if(fail) throw Error('sin conexión')
      return {ok:true,text:async()=>JSON.stringify(body.p_territorios.map(()=>({manzanas:1,lados:0})))}
    },
  })
  vm.runInContext(source,context)
  return {button,calls,dialogs,tocados,territorios}
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

test('intercambio revisa números originales y publica UUIDs y dibujos juntos',async()=>{
  const f=fixture({renumber:true});await f.button.onclick()
  assert.deepEqual(f.calls[0].body.p_nombres,['57','58'])
  assert.match(f.calls[1].url,/publicar_editor_con_renumeracion$/)
  assert.deepEqual(f.calls[1].body.p_renumeraciones,[
    {id:'uuid-a',nombre_anterior:'57',nombre_nuevo:'58'},
    {id:'uuid-b',nombre_anterior:'58',nombre_nuevo:'57'},
  ])
  assert.equal(f.calls[1].body.p_territorios[0].nombre,'58')
  assert.equal(f.calls[1].body.p_territorios[0].version_esperada,1)
  assert.equal(f.territorios.get('a').numeroBase,undefined)
  assert.equal(f.territorios.get('b').numeroBase,undefined)
  assert.equal(f.tocados.size,0)
  assert.match(f.dialogs[0].cuerpo,/57 → 58/)
})
test('fallo de intercambio conserva identidad original para resolver el resultado',async()=>{
  const f=fixture({renumber:true,fail:true});await f.button.onclick()
  assert.equal(f.territorios.get('a').numeroBase,'57')
  assert.equal(f.territorios.get('b').numeroBase,'58')
  assert.equal(f.tocados.size,2)
  assert.equal(f.calls.length,2)
})

test('publica un color sin renumerar y conserva el publicador atómico',async()=>{
  const f=fixture({color:true});await f.button.onclick()
  assert.match(f.calls[1].url,/publicar_editor_con_renumeracion$/)
  assert.deepEqual(f.calls[1].body.p_renumeraciones,[])
  assert.equal(f.calls[1].body.p_territorios[0].color,'#01bc73')
  assert.equal(f.territorios.get('a').colorBase,undefined)
  assert.match(f.dialogs[0].cuerpo,/color/)
})
test('fallo al guardar color conserva el cambio pendiente',async()=>{
  const f=fixture({color:true,fail:true});await f.button.onclick()
  assert.equal(f.territorios.get('a').colorBase,'#407dfe')
})

// La base real: rechaza el lote entero si un número no existe o se repite, y
// contesta la lista de nombres cuando se la pide.
function fixtureBase({ base, abierto, territorios: lista, tocados: tocadosIniciales, conManzanas, nombresFallan = false }) {
  const button = {}, calls = [], dialogs = [], avisos = []
  const manzanas = new Map(conManzanas.map((id, i) => ['m' + i, { territorio: id, letra: 'A', geom: { type: 'Polygon', coordinates: [] } }]))
  const territorios = new Map(lista.map((numero) => [numero, { id: numero, numero }]))
  const tocados = new Set(tocadosIniciales)
  const context = vm.createContext({
    document: { getElementById: () => button }, BD_URL: 'https://dev.invalid', BD_KEY: 'test',
    tokenDeSesion: () => 'test', activo: abierto, territorios, historial: [], rehechos: [],
    manzanas, tocados, carasDeMz: () => [], centroDe: () => [0, 0], areaM2De: () => 0,
    avisar: (texto) => avisos.push(texto), guardar: () => {}, traerDeLaBase: async () => {},
    dialogo: async (options) => { dialogs.push(options); return true },
    fetch: async (url, options = {}) => {
      if (!options.body) {
        calls.push({ url })
        if (nombresFallan) throw Error('sin conexión')
        return { ok: true, json: async () => base.map((name) => ({ name })) }
      }
      const body = JSON.parse(options.body); calls.push({ url, body })
      if (url.endsWith('revisar_publicacion_editor')) {
        if (body.p_nombres.some((n) => base.filter((b) => b === n).length !== 1)) {
          return { ok: false, text: async () => JSON.stringify({ message: 'Territorio inexistente o ambiguo' }) }
        }
        return { ok: true, text: async () => JSON.stringify(body.p_nombres.map((nombre, i) => ({ nombre, id: 'uuid-' + nombre, version: i + 1 }))) }
      }
      return { ok: true, text: async () => JSON.stringify(body.p_territorios.map(() => ({ manzanas: 1, lados: 0 }))) }
    },
  })
  vm.runInContext(source, context)
  return { button, calls, dialogs, avisos, tocados }
}

test('un vacío que la base nunca tuvo queda afuera y no traba al resto', async () => {
  const f = fixtureBase({ base: ['69', '72'], abierto: '72', territorios: ['69', '72', '73'],
    tocados: ['72', '73', '69'], conManzanas: ['72', '69'] })
  await f.button.onclick()
  assert.deepEqual(f.calls.map((c) => c.url.split('/').pop()),
    ['revisar_publicacion_editor', 'territorios?select=name', 'revisar_publicacion_editor', 'publicar_territorios_atomico'])
  assert.deepEqual(f.calls[2].body.p_nombres, ['72', '69'])
  assert.deepEqual(f.calls[3].body.p_territorios.map((x) => x.nombre), ['72', '69'])
  assert.match(f.dialogs[0].titulo, /Guardar 2 territorios/)
  assert.match(f.dialogs[0].cuerpo, /El territorio <b>73<\/b> queda afuera: está vacío y la base nunca lo tuvo/)
  assert.doesNotMatch(f.dialogs[0].cuerpo, /sin manzanas vigentes/)
  assert.equal(f.tocados.size, 0)
  assert.equal(f.button.disabled, false)
})

test('un territorio con manzanas que la base no tiene frena el lote y dice cuál es', async () => {
  const f = fixtureBase({ base: ['72'], abierto: '72', territorios: ['72', '74'],
    tocados: ['72', '74'], conManzanas: ['72', '74'] })
  await f.button.onclick()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls.some((c) => /publicar/.test(c.url)), false)
  assert.match(f.dialogs[0].titulo, /Revisá la publicación/)
  assert.match(f.dialogs[0].cuerpo, /El territorio <b>74<\/b> todavía no existe en la base/)
  assert.match(f.dialogs[0].cuerpo, /No se envió ninguna publicación/)
  assert.equal(f.tocados.size, 2)
  assert.equal(f.button.disabled, false)
})

test('el abierto vacío que la base no tiene sugiere guardar desde otro', async () => {
  const f = fixtureBase({ base: ['72'], abierto: '73', territorios: ['72', '73'],
    tocados: ['72', '73'], conManzanas: ['72'] })
  await f.button.onclick()
  assert.equal(f.calls.some((c) => /publicar/.test(c.url)), false)
  assert.match(f.dialogs[0].cuerpo, /El territorio <b>73<\/b> todavía no existe en la base/)
  assert.match(f.dialogs[0].cuerpo, /abrí uno de ellos y guardá desde ahí/)
  assert.equal(f.tocados.size, 2)
})

test('un número repetido en la base se nombra en vez del error genérico', async () => {
  const f = fixtureBase({ base: ['72', '72'], abierto: '72', territorios: ['72'],
    tocados: ['72'], conManzanas: ['72'] })
  await f.button.onclick()
  assert.equal(f.calls.some((c) => /publicar/.test(c.url)), false)
  assert.match(f.dialogs[0].cuerpo, /El territorio <b>72<\/b> figura más de una vez en la base/)
})

test('si no se puede leer la base queda el error original y no se publica', async () => {
  const f = fixtureBase({ base: ['72'], abierto: '72', territorios: ['72', '73'],
    tocados: ['72', '73'], conManzanas: ['72'], nombresFallan: true })
  await f.button.onclick()
  assert.equal(f.calls.some((c) => /publicar/.test(c.url)), false)
  assert.match(f.dialogs[0].cuerpo, /^Territorio inexistente o ambiguo/)
  assert.equal(f.tocados.size, 2)
  assert.equal(f.button.disabled, false)
})
