/**
 * VISTA DEL HERMANO
 *
 * Quien entra: un publicador de 70 anios, parado en una esquina, con sol de
 * frente y el telefono en la mano. Viene a una de dos cosas, y no siempre a
 * la misma: saber donde y a que hora es la salida de hoy, o saber que le
 * falta de su territorio personal.
 *
 * Vive fuera del AppShell a proposito: tiene sus propias pestanias abajo y
 * dos navegaciones a la vez no son navegacion.
 *
 * Tres reglas que gobiernan el CSS (src/styles/vista-hermano.css):
 *   1. Nada por debajo de 16px. Afuera y con sol, 14 no alcanza.
 *   2. Todo lo que se toca mide 56px de alto como minimo.
 *   3. El color nunca es el unico portador de significado: siempre va con
 *      un icono y con una palabra.
 *
 * Diferencia con el prototipo: los lados ya NO se calculan aca. Vienen de
 * manzana_lados, con id propio. El calculo en el navegador era derivado del
 * poligono, asi que al redibujar cambiaban de cantidad y de orden, y la
 * cobertura habria quedado apuntando a otra calle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { readAllRows } from '../lib/readAllRows'
import { latestEventsAt, validAt } from '../lib/coverageHistory'
import { coverageSummary } from '../lib/coverageSummary'
import { useCoverageOutbox } from '../lib/useCoverageOutbox'
import type { CoverageInput } from '../lib/coverageOutbox'
import { canReportSalida } from '../lib/salidaPermissions'
import { SalidaResultadoForm } from '../components/SalidaResultadoForm'
import { SalidaCoverageForm } from '../components/SalidaCoverageForm'
import { MiCuenta } from '../components/MiCuenta'
import { CoverageCorrectionForm } from '../components/CoverageCorrectionForm'
import { prepareCoverageCorrection } from '../lib/coverageCorrection'
import { ponerFondo as ponerTeselas } from '../lib/fondoMapa'
import {
  coordenadasDePuntoCatalogado,
  sePuedeLlegar,
  urlComoLlegar,
  type ModoLlegar,
  type PuntoParaLlegar,
} from '../lib/comoLlegar'
import {
  esMiembroPendiente,
  filtrosSalidas,
  panelesHoy,
  puedePedirTerritorio,
  salidaCorrespondeAlGrupo,
  tieneGrupo,
  tituloSalidaGrupo,
  type ContextoHermano,
} from '../lib/vistaHermano'
import { ElegirDeLista } from '../components/ElegirDeLista'
import { ElegirTerritorio } from '../components/ElegirTerritorio'
import { CampoCodigoGrupo } from '../components/CampoCodigoGrupo'
import { HojaMiGrupo } from '../components/HojaMiGrupo'
import { Icono } from '../components/Icono'
import '../styles/vista-hermano.css'

// Los tres mapas de la pantalla se arman igual.
//
// El nombre de la calle viene pintado adentro de la misma imagen que las
// cuadras, asi que un relleno opaco lo tacha, y parado en la esquina saber
// en que calle estas es la mitad de lo que se le pide a un mapa. La capa de
// manzanas se pinta en modo "multiply": el color se multiplica contra lo que
// hay debajo en vez de reemplazarlo, y lo oscuro de abajo -las lineas de las
// calles y sus nombres- atraviesa el color entero.
function ponerFondo(m: L.Map) {
  // Quien hace el mapa va nombrado: es la condicion de uso de las teselas.
  // Sin el "Leaflet |" adelante, que no le dice nada a nadie.
  m.attributionControl.setPrefix(false)
  ponerTeselas(L, m)
  m.getPane('overlayPane')!.style.mixBlendMode = 'multiply'
}

// Se piden las proximas, no todas. Sesenta son mas de un mes de programa:
// nadie parado en una esquina esta averiguando la salida de dentro de dos
// meses, y pedir de mas es lo que rompio esta pantalla.
const SALIDAS_QUE_SE_TRAEN = 60
const LIMITE_CARGA_PROGRAMA_MS = 15_000
const MENSAJE_CARGA_PROGRAMA_LENTA = 'La carga del programa tardó demasiado.'

const TAMANIO_GUARDADO = 'vh-tamanio-del-texto'

// Una consulta de red que no resuelve no puede dejar la vista en "Cargando…"
// para siempre. El request subyacente no se cancela aquí, pero la pantalla sí
// recupera el control y permite reintentar sin desmontar el contenido actual.
export function conLimiteDeCarga<T>(request: PromiseLike<T>, timeoutMs = LIMITE_CARGA_PROGRAMA_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(MENSAJE_CARGA_PROGRAMA_LENTA)), timeoutMs)
    Promise.resolve(request).then(
      (value) => {
        if (timer) clearTimeout(timer)
        resolve(value)
      },
      (failure) => {
        if (timer) clearTimeout(timer)
        reject(failure)
      },
    )
  })
}

// Las manzanas que hoy existen. Una manzana retirada por un redibujado
// sigue en la tabla porque los eventos de cobertura apuntan a ella, pero
// no se dibuja.
//
// El filtro puede no existir todavia (base sin la migracion de
// redibujado): si la columna no esta se pide sin filtrar, en vez de
// dejar el mapa vacio mientras el esquema y el cliente van en dos
// entregas distintas.
function manzanasVigentes(cliente: NonNullable<typeof supabase>, territoryId: string) {
  const campos = 'id, label, lat, lng, geometry_geojson'
  const orden = { ascending: true } as const
  return cliente
    .from('territorio_manzanas')
    .select(campos)
    .eq('territory_id', territoryId)
    .is('vigente_hasta', null)
    .order('label', orden)
    .then((res) =>
      res.error?.code === '42703'
        ? cliente
            .from('territorio_manzanas')
            .select(campos)
            .eq('territory_id', territoryId)
            .order('label', orden)
        : res,
    )
}

// Lo que el programa dice de cada salida. Las cuatro ultimas columnas las
// agrega la migracion 20260904120000: mientras no este aplicada, la base
// responde 42703 (la columna no existe) y se pide lo de antes. Que el
// esquema y el cliente viajen en dos entregas distintas no puede dejar al
// hermano sin saber a que hora se sale.
const CAMPOS_SALIDA =
  'id, driver_id, title, notes, territory_id, group_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, tipo, conductor_texto, barrio, priorizar, territorio_codigo'
const CAMPOS_SALIDA_VIEJOS =
  'id, title, notes, territory_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, tipo'

type RespuestaSalidas = {
  data: Record<string, unknown>[] | null
  error: { code?: string; message: string } | null
  count: number | null
}

async function salidasDesde(
  cliente: NonNullable<typeof supabase>,
  desde: string,
): Promise<RespuestaSalidas> {
  const pedir = async (campos: string) =>
    (await cliente
      .from('salidas')
      .select(campos, { count: 'exact' })
      .gte('scheduled_for', desde)
      .order('scheduled_for', { ascending: true })
      .limit(SALIDAS_QUE_SE_TRAEN)) as unknown as RespuestaSalidas

  const res = await pedir(CAMPOS_SALIDA)
  return res.error?.code === '42703' ? pedir(CAMPOS_SALIDA_VIEJOS) : res
}

// Una fila de la base contada como se la contarias a alguien.
//
// El territorio llega de dos maneras y ninguna sobra. territory_id es la
// relacion. territorio_codigo guarda el punto ("61.1"): el decimal es desde
// donde se sale, no otro territorio. Al hermano se le muestra el 61.
function comoSalida(f: Record<string, unknown>, territorios: Territorio[]): Salida {
  const cuando = new Date(f.scheduled_for as string)
  const codigo = ((f.territorio_codigo as string) ?? '').trim()
  const territorio = codigo.match(/^(\d+)/)?.[1] ?? (codigo && codigo !== '-' ? codigo : undefined)
  const porRelacion = territorios.find((t) => t.id === f.territory_id)
  const porCodigo = territorio
    ? territorios.find((t) => t.name === territorio)
    : undefined
  const texto = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s && s !== '-' ? s : undefined
  }

  return {
    id: typeof f.id === 'string' ? f.id : undefined,
    driverId: typeof f.driver_id === 'string' ? f.driver_id : undefined,
    groupId: typeof f.group_id === 'string' ? f.group_id : undefined,
    title: typeof f.title === 'string' ? f.title : undefined,
    notes: typeof f.notes === 'string' ? f.notes : null,
    fecha: cuando.toLocaleDateString('sv-SE'),
    hora: cuando.toTimeString().slice(0, 5),
    puntoCodigo: codigo || undefined,
    lugar: (f.meeting_point_name as string) || '',
    lat: numeroOpcional(f.meeting_point_lat),
    lng: numeroOpcional(f.meeting_point_lng),
    terr: porRelacion?.name ?? territorio,
    // La FK sigue siendo válida aunque todavía no cargó el catálogo.
    terrId: typeof f.territory_id === 'string' && f.territory_id
      ? f.territory_id : porCodigo?.id,
    conductor: texto(f.conductor_texto),
    barrio: texto(f.barrio),
    priorizar: texto(f.priorizar),
    // La columna existe desde la importacion y la pantalla no la leia: dos
    // de las proximas son telefonicas y se mostraban como una salida comun,
    // con un "Cómo llegar" a ninguna parte.
    tipo: (() => {
      const raw = f.tipo
      if (raw === 'telefonica' || raw === 'grupos' || raw === 'asamblea' || raw === 'especial') {
        return raw
      }
      const codigoTipo = codigo.toUpperCase()
      if (codigoTipo === 'SG') return 'grupos'
      if (codigoTipo === 'TEL') return 'telefonica'
      if (codigoTipo === 'AC' || codigoTipo === 'AR') return 'asamblea'
      if (codigoTipo === 'SR' || codigoTipo === 'SS' || codigoTipo === 'ZO') return 'especial'
      if (/salidas de grupos/i.test(String(f.meeting_point_name ?? ''))) return 'grupos'
      return undefined
    })(),
  }
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

type Poligono = { type: 'Polygon'; coordinates: [number, number][][] }
type Linea = { type: 'LineString'; coordinates: [number, number][] }

type Manzana = {
  id: string
  label: string
  lat: number
  lng: number
  geometry_geojson: Poligono | null
  // Solo los trae el historial: el mapa de hoy trabaja con lo vigente.
  geometry_version?: number
  vigente_desde?: string | null
  vigente_hasta?: string | null
}

type Lado = {
  id: string
  manzana_id: string
  orden: number
  geometry_geojson: Linea
  largo_m: number
  geometry_version?: number
  vigente_desde?: string | null
  vigente_hasta?: string | null
}

function numeroOpcional(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

type Salida = {
  id?: string
  driverId?: string
  groupId?: string
  title?: string
  notes?: string | null
  fecha: string
  hora: string
  puntoCodigo?: string
  lugar?: string
  lat?: number
  lng?: number
  barrio?: string
  // El número del territorio (61), nunca el punto (61.1). El decimal es
  // interno: desde dónde se sale. El mapa se abre del territorio.
  terr?: string
  terrId?: string
  conductor?: string
  priorizar?: string
  tipo?: 'telefonica' | 'grupos' | 'asamblea' | 'especial'
}

export function isSyntheticQaOuting(outing: { notes?: unknown }) {
  const notes = typeof outing.notes === 'string' ? outing.notes : ''
  return notes.startsWith('Fixture sintético auditable;')
    || notes.startsWith('Salida sintética QA ')
}

export function showQaFromSearch(search: string) {
  return new URLSearchParams(search).get('qa') === '1'
}

type Territorio = { id: string; name: string }

const hoyISO = () => new Date().toLocaleDateString('sv-SE')

function fechaLarga(iso: string) {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(a, m - 1, d)
  return `${DIAS[f.getDay()]} ${d} de ${MESES[m - 1]}`
}

// "Hoy" y "Mañana" se dicen con esas palabras: nadie mira el numero del dia
// para saber si es hoy.
function comoSeLlamaElDia(iso: string) {
  if (iso === hoyISO()) return 'Hoy'
  const m = new Date()
  m.setDate(m.getDate() + 1)
  if (iso === m.toLocaleDateString('sv-SE')) return 'Mañana'
  return null
}

// Una salida "de hoy" a las 09:30 vista a las 11:46 ya paso. Decirlo es la
// diferencia entre un programa y un horario.
function yaEmpezo(s: Salida) {
  if (s.fecha !== hoyISO()) return false
  const [h, m] = s.hora.split(':').map(Number)
  const ahora = new Date()
  return ahora.getHours() * 60 + ahora.getMinutes() > h * 60 + m
}

function tituloSalida(s: Salida, contexto?: ContextoHermano | null) {
  if (s.tipo === 'telefonica') return 'Predicación telefónica'
  if (s.tipo === 'grupos') {
    return tituloSalidaGrupo({
      tipo: s.tipo,
      lugar: s.lugar,
      tieneGrupo: tieneGrupo(contexto),
      puntoNombre: contexto?.punto_grupo_nombre,
    })
  }
  return s.lugar ?? 'Salida'
}

// Que se recorre ese dia. Lo escribieron muchas manos durante anios y se
// nota: "Manzanas C,D,F", "Priorizar Mza G, H.", "priorizar manzanas A B C",
// "Priorizar Mz. I, F, E (Lateral Sur)", "Manzanas hasta Rio Bamba", "Todo
// menos Mza C". Son 183 formas distintas en 1.790 filas.
//
// Solo se pinta el mapa cuando lo que queda despues de sacar el encabezado
// son letras y nada mas. "Mza H (Departamentos)" no se pinta aunque tenga
// una H: pintar la H sola seria decir que ese dia se recorre la manzana
// entera, y lo que el programa pide es otra cosa. "Todo menos Mza C" tampoco,
// que ademas significa lo contrario de lo que parece. En esos casos se
// muestra la frase, que es lo que un hermano ya sabe leer.
function leerPriorizar(p?: string): { letras: Set<string> | null; frase: string | null } {
  const crudo = (p ?? '').trim().replace(/\s*\.\s*$/, '')
  if (!crudo || /^todo$/i.test(crudo)) return { letras: null, frase: null }

  // El verbo esta escrito de cuatro maneras, dos de ellas con dedazo:
  // "Priorizar", "priorizar", "priorizaar", "Piorizar".
  const sinVerbo = crudo.replace(/^p[a-z]*oriz[a-z]*\s+/i, '')
  const sinEncabezado = sinVerbo.replace(/^(manzanas?|mzas?\.?|mz\.?)\s+/i, '').trim()

  // La "y" de "A, B y C" es la conjuncion, pero la de "X,Y,Z" es una manzana:
  // el territorio 61 tiene 40 y llegan hasta la "an". Las separa el
  // separador, no la letra: pegada a una coma es manzana, entre espacios es
  // conjuncion.
  const partes = sinEncabezado
    .replace(/\s*,?\s+y\s+/gi, ',')
    .split(/[\s,]+/)
    .filter(Boolean)
  if (partes.length && partes.every((x) => /^[a-z]$/i.test(x))) {
    return { letras: new Set(partes.map((x) => x.toLowerCase())), frase: null }
  }

  // "Todo menos Mza C" ya dice que hacer, y ademas dice lo contrario de lo
  // que parece: ponerle "Priorizá" adelante lo da vuelta.
  const frase = /^todo\s+menos\b/i.test(sinVerbo)
    ? sinVerbo.charAt(0).toUpperCase() + sinVerbo.slice(1)
    : `Priorizá ${sinVerbo}`
  return { letras: null, frase }
}

const letrasPrioritarias = (p?: string) => leerPriorizar(p).letras

function enumerar(letras: Set<string>) {
  const l = [...letras].map((x) => x.toUpperCase())
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} y ${l.at(-1)}` : l[0]
}

function leyendaDelMapa(s: Salida) {
  const { letras, frase } = leerPriorizar(s.priorizar)
  if (letras) {
    return { llave: true, texto: `En verde, las manzanas de hoy: ${enumerar(letras)}.` }
  }
  if (frase) return { llave: false, texto: `${frase}.` }
  return { llave: false, texto: 'Se recorre el territorio entero.' }
}

function abrirComoLlegar(s: Salida, modo: ModoLlegar) {
  const url = urlComoLlegar({ modo, lat: s.lat, lng: s.lng })
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

function IconoAuto() {
  return <Icono nombre="auto" tamaño={22} />
}

function IconoBondi() {
  return <Icono nombre="colectivo" tamaño={22} />
}

function BotonesComoLlegar({ salida }: { salida: Salida }) {
  if (!sePuedeLlegar(salida)) return null
  const donde = salida.lugar ?? 'el punto de encuentro'
  return (
    <div className="paresLlegar">
      <p className="paresLlegarTitulo">Cómo llegar</p>
      <button
        className="boton principal"
        onClick={() => abrirComoLlegar(salida, 'driving')}
        aria-label={`Cómo llegar en auto a ${donde}`}
      >
        <IconoAuto />
        En auto
      </button>
      <button
        className="boton alternativa"
        onClick={() => abrirComoLlegar(salida, 'transit')}
        aria-label={`Cómo llegar en colectivo a ${donde}. Abre Google Maps con Red Tulum.`}
      >
        <IconoBondi />
        En colectivo
      </button>
    </div>
  )
}

const anilloDe = (g: Poligono) => g.coordinates[0].map(([x, y]) => [y, x] as [number, number])

// El centro de una manzana, para colgarle la letra.
const centroDe = (anillo: [number, number][]) =>
  anillo.reduce(
    (a, [la, ln]) => [a[0] + la / anillo.length, a[1] + ln / anillo.length],
    [0, 0],
  ) as [number, number]

// Un solo lugar decide los colores de una manzana. Si el mapa vivo y el del
// historial se pintaran distinto, el mismo dato contaria dos historias.
function pinta(hechos: number, total: number) {
  const completa = total > 0 && hechos === total
  const media = hechos > 0 && !completa
  // Rellenos claros: el modo "multiply" los oscurece contra el mapa, asi que
  // un color que ya viene fuerte termina en una mancha donde no se lee nada.
  // Sin recorrer no lleva casi color: el estado que importa es el otro.
  return {
    completa,
    media,
    color: completa ? '#0f6b47' : media ? '#955408' : '#16191d',
    relleno: completa ? '#8fe0b6' : media ? '#ffd79a' : '#e4e8ec',
    opacidad: completa ? 0.9 : media ? 0.9 : 0.75,
  }
}

// La letra de la manzana. El tamanio lo pone la CSS a partir de la escala
// del texto, no el JS: con 30px clavados aca, agrandar el texto dejaba el
// mapa igual de chico. El icono mide cero y la etiqueta se centra sola.
const etiqueta = (texto: string, fondo: string) =>
  L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div class="etiquetaMz" style="background:${fondo}">${texto}</div>`,
  })

// Dibuja las manzanas con un estado dado. Lo usan el mapa de la pestania y
// el del historial; el segundo nunca es interactivo.
function pintarManzanas(
  capa: L.LayerGroup,
  manzanas: Manzana[],
  ladosDe: (mz: Manzana) => Lado[],
  hechos: Set<string>,
  alTocar?: (mz: Manzana) => void,
) {
  for (const mz of manzanas) {
    if (!mz.geometry_geojson) continue
    const anillo = anilloDe(mz.geometry_geojson)
    const propios = ladosDe(mz)
    const n = propios.filter((l) => hechos.has(l.id)).length
    const c = pinta(n, propios.length)
    L.polygon(anillo, {
      color: c.color,
      weight: 2,
      fillColor: c.relleno,
      fillOpacity: c.opacidad,
      interactive: Boolean(alTocar),
    })
      .addTo(capa)
      .on('click', () => alTocar?.(mz))
    L.marker(centroDe(anillo), {
      interactive: false,
      icon: etiqueta(mz.label, c.color),
    }).addTo(capa)
  }
}

// El territorio de una salida: en lima lo que se recorre hoy. Lo usan el mapa
// chico de la tarjeta y el grande; si se dibujaran distinto, el mismo dato
// contaria dos historias.
function pintarSalida(
  capa: L.LayerGroup,
  manzanas: Manzana[],
  priorizar?: string,
  etiquetas: 'todas' | 'marcadas' | 'ninguna' = 'todas',
) {
  const letras = letrasPrioritarias(priorizar)
  for (const mz of manzanas) {
    if (!mz.geometry_geojson) continue
    const anillo = anilloDe(mz.geometry_geojson)
    const marcada = !letras || letras.has(mz.label.toLowerCase())
    L.polygon(anillo, {
      color: marcada ? '#16191d' : '#8d939b',
      weight: marcada ? 2 : 1,
      fillColor: '#cbea5b',
      // La que no es de hoy se queda sin relleno y con el borde fino: en
      // modo "multiply" el blanco no pinta nada, asi que aclararla era
      // imposible; distinguirla oscureciendola habria sido al reves de lo
      // que dice el mapa.
      fillOpacity: marcada ? 0.8 : 0,
      interactive: false,
    }).addTo(capa)
    if (etiquetas === 'todas' || (etiquetas === 'marcadas' && marcada)) {
      L.marker(centroDe(anillo), {
        interactive: false,
        icon: etiqueta(mz.label, marcada ? '#16191d' : '#8d939b'),
      }).addTo(capa)
    }
  }
}

// Cuantas letras entran en el mapa chico. El territorio 61 tiene 40 manzanas
// y en 190 px de alto las etiquetas se pisan hasta tapar las calles: un
// peloton negro donde deberia verse donde queda el barrio.
const ENTRAN_LAS_LETRAS = 8

type Evento = {
  id: string
  lado_id: string
  manzana_id: string
  estado: string
  informado_at: string
  informado_por: string | null
  corrige_evento_id?: string | null
  nota?: string | null
}

const soloDia = (iso: string) => new Date(iso).toLocaleDateString('sv-SE')

// Los lados se guardan sobre el borde real. Se dibujan corridos hacia adentro:
// si no, el lado de esta manzana y el de la de enfrente caerian casi encima y
// el dedo no podria elegir.
function haciaAdentro(punto: [number, number], centro: [number, number]): [number, number] {
  const d = Math.hypot(
    (centro[1] - punto[1]) * Math.cos((punto[0] * Math.PI) / 180) * 111320,
    (centro[0] - punto[0]) * 110540,
  )
  const k = d ? Math.min(9 / d, 0.35) : 0
  return [punto[0] + (centro[0] - punto[0]) * k, punto[1] + (centro[1] - punto[1]) * k]
}

type ReservaPropia = {
  id: string; territory_id: string; assigned_to: string | null; requested_by: string | null
  status: 'solicitada' | 'activa' | 'liberada' | 'rechazada'; nota: string | null
}

export function PredicacionPage() {
  const { profile, contexto, retryAuth } = useAuth()
  const showQA = showQaFromSearch(typeof window === 'undefined' ? '' : window.location.search)

  const [vista, setVista] = useState<'hoy' | 'salidas' | 'territorio'>('hoy')
  // Quien necesita el texto grande lo necesita siempre, no una vez. Antes
  // volvia a 1 en cada recarga y habia que agrandarlo de nuevo.
  const [paso, setPaso] = useState(() => {
    const g = Number(localStorage.getItem(TAMANIO_GUARDADO))
    return g >= 1 && g <= 1.3 ? g : 1
  })
  const [modoMarcar, setModoMarcar] = useState<'manzana' | 'lado'>('manzana')
  // Se entra a marcar a proposito. Antes, un toque al pasar el dedo por el
  // mapa cambiaba el estado de una manzana y se guardaba solo. Mirar tiene
  // que ser lo que pasa cuando no pediste otra cosa.
  const [marcando, setMarcando] = useState(false)
  const [solicitando, setSolicitando] = useState(false)
  const [devolviendo, setDevolviendo] = useState(false)
  const [reservas, setReservas] = useState<ReservaPropia[]>([])
  const [revision, setRevision] = useState(0)

  const [territorios, setTerritorios] = useState<Territorio[]>([])
  const [miTerritorio, setMiTerritorio] = useState<Territorio | null>(null)
  const asignado = reservas.some((r) => r.status === 'activa' && r.assigned_to === profile?.id && r.territory_id === miTerritorio?.id)
  const solicitado = reservas.some((r) => r.status === 'solicitada' && r.territory_id === miTerritorio?.id)
  const [manzanas, setManzanas] = useState<Manzana[]>([])
  // Un territorio que todavia no se dibujo y otro que ya se recorrio entero
  // llegan los dos con cero manzanas por recorrer. Sin esta bandera, "faltan
  // 0" felicitaba a alguien por un territorio que no existe en el mapa.
  const [dibujoListo, setDibujoListo] = useState(false)
  const [lados, setLados] = useState<Lado[]>([])
  const [estadosBase, setEstadosBase] = useState<Record<string, string>>({})
  const cola = useCoverageOutbox(profile?.id)
  const { checkpoint: checkpointCola, acknowledgeSnapshot, enqueue, sync } = cola
  const [estadoElegido, setEstadoElegido] = useState<CoverageInput['estado']>('recorrido')
  const encolando = useRef(false)
  const estados = useMemo(() => {
    const result = { ...estadosBase }
    for (const event of [...cola.confirmed, ...cola.events]) {
      if (event.territory_id === miTerritorio?.id && event.status !== 'error') result[event.lado_id] = event.estado
    }
    return result
  }, [estadosBase, cola.confirmed, cola.events, miTerritorio?.id])
  const hechos = useMemo(() => new Set(Object.keys(estados).filter(id => estados[id] === 'recorrido')), [estados])
  const [salidas, setSalidas] = useState<Salida[]>([])
  const [salidasParaCerrar, setSalidasParaCerrar] = useState<Salida[]>([])
  const [cierreId, setCierreId] = useState('')
  const [errorCierres, setErrorCierres] = useState<string | null>(null)
  const [cargandoCierres, setCargandoCierres] = useState(false)
  const [origenSalidas, setOrigenSalidas] = useState<'base' | 'archivo' | null>(null)
  const [recorte, setRecorte] = useState<{ trajo: number; hay: number } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [filtroSalidas, setFiltroSalidas] = useState<'todas' | 'mias' | 'grupo'>('todas')
  const guardando = cola.sending
  const salidasVisibles = useMemo(() => {
    const base = showQA ? salidas : salidas.filter((salida) => !isSyntheticQaOuting(salida))
    if (filtroSalidas === 'mias' && profile?.driver_id) {
      return base.filter((salida) => salida.driverId === profile.driver_id)
    }
    if (filtroSalidas === 'grupo' && contexto?.group_id) {
      return base.filter((salida) => salidaCorrespondeAlGrupo(salida, contexto.group_id))
    }
    return base
  }, [salidas, showQA, filtroSalidas, profile?.driver_id, contexto?.group_id])
  const salidasParaCerrarVisibles = useMemo(
    () => showQA ? salidasParaCerrar : salidasParaCerrar.filter((salida) => !isSyntheticQaOuting(salida)),
    [salidasParaCerrar, showQA],
  )

  // Solo se marca el territorio propio. Los demas se miran: la cobertura de
  // un territorio ajeno no la informa quien pasa a ver como es.
  const [abierta, setAbierta] = useState<string | null>(null)
  const [hoja, setHoja] = useState<{ salida?: Salida; propio?: boolean } | null>(null)
  const [historial, setHistorial] = useState(false)
  const [hojaGrupo, setHojaGrupo] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const prender = () => setOnline(true)
    const apagar = () => setOnline(false)
    window.addEventListener('online', prender)
    window.addEventListener('offline', apagar)
    return () => {
      window.removeEventListener('online', prender)
      window.removeEventListener('offline', apagar)
    }
  }, [])

  const paneles = panelesHoy(contexto)
  const filtros = filtrosSalidas(contexto)

  // Solo se marca el territorio propio, y solo despues de pedirlo. Mirar es
  // lo que pasa cuando no pediste otra cosa.
  const puedeMarcar =
    asignado && Boolean(miTerritorio) && dibujoListo && !cola.error && !esMiembroPendiente(contexto)
  const editando = puedeMarcar && marcando

  useEffect(() => {
    let live = true
    setSalidasParaCerrar([])
    setCierreId('')
    setErrorCierres(null)
    setCargandoCierres(false)
    if (!supabase || profile?.access_status !== 'active' || !contexto?.puede_informar_salidas) return
    setCargandoCierres(true)
    const client = supabase
    const now = new Date()
    const since = new Date(now)
    since.setDate(since.getDate() - 30)
    void readAllRows<Record<string, unknown>>((from, to) => {
      let query = client.from('salidas').select(CAMPOS_SALIDA)
        .gte('scheduled_for', since.toISOString()).lte('scheduled_for', now.toISOString())
        .order('scheduled_for', { ascending: false }).order('id').range(from, to)
      return query
    }).then(rows => {
      if (live) setSalidasParaCerrar(rows.map(row => comoSalida(row, [])))
    }).catch(() => { if (live) setErrorCierres('No pudimos cargar las salidas para informar su resultado. Tocá Actualizar para reintentar.') })
      .finally(() => { if (live) setCargandoCierres(false) })
    return () => { live = false }
  }, [profile, contexto?.puede_informar_salidas, revision])

  // Recuperar una asignación o cambiar de territorio nunca reactiva por sí
  // solo el modo de escritura que se abrió sobre otro contexto.
  useEffect(() => { setMarcando(false) }, [miTerritorio?.id, asignado, profile?.id])

  // ------------------------------------------------------------ derivados
  const ladosPorManzana = useMemo(() => {
    const m = new Map<string, Lado[]>()
    for (const l of lados) {
      const lista = m.get(l.manzana_id) ?? []
      lista.push(l)
      m.set(l.manzana_id, lista)
    }
    for (const lista of m.values()) lista.sort((a, b) => a.orden - b.orden)
    return m
  }, [lados])

  const ladosDe = useCallback(
    (mz: Manzana) => ladosPorManzana.get(mz.id) ?? [],
    [ladosPorManzana],
  )
  const hechosDe = useCallback(
    (mz: Manzana) => ladosDe(mz).filter((l) => hechos.has(l.id)).length,
    [ladosDe, hechos],
  )

  const avance = useMemo(() => {
    const resumen = coverageSummary(lados, estados)
    const completas = manzanas.filter((m) => ladosDe(m).length > 0 && hechosDe(m) === ladosDe(m).length).length
    const empezadas = manzanas.filter((m) => {
      const h = hechosDe(m)
      return h > 0 && h < ladosDe(m).length
    }).length
    return {
      metros: resumen.totalMeters,
      metrosHechos: resumen.walkedMeters,
      pct: resumen.percent,
      estados: resumen.counts,
      completas,
      empezadas,
      faltan: manzanas.length - completas,
    }
  }, [manzanas, ladosDe, hechosDe, lados, estados])

  // ----------------------------------------------------------- carga
  useEffect(() => {
    let vivo = true
    if (!supabase) {
      setCargando(false)
      setAviso('La app no está conectada a la base.')
      return
    }

    void (async () => {
      try {
      // Esta consulta no tenia filtro ni limite y ordenaba ascendente, el
      // mismo error que en el admin: PostgREST corta en 1000 filas pase lo
      // que pase, asi que devolvia las mil MAS VIEJAS. Medido: llegaban
      // 1.000 salidas de abril de 2024 a mayo de 2025, ninguna futura, y la
      // pantalla decia "No hay salidas cargadas" con 16 proximas en la base.
      // Aca, ademas, el pasado no se pide: quien esta parado en la esquina
      // viene a saber la de hoy. La historia se mira en el Historial.
      const desdeHoy = new Date()
      desdeHoy.setHours(0, 0, 0, 0)

      const [terrRes, resRes, salRes, puntosRes] = await conLimiteDeCarga(Promise.all([
        supabase.from('territorios').select('id, name'),
        readAllRows<ReservaPropia>((from, to) => supabase!
          .from('territorio_personal_reservas')
          .select('id, territory_id, assigned_to, requested_by, status, nota')
          .or(`assigned_to.eq.${profile?.id},requested_by.eq.${profile?.id}`)
          .order('reserved_at', { ascending: false })
          .order('id', { ascending: false })
        .range(from, to)).then((data) => ({ data, error: null })),
        salidasDesde(supabase, desdeHoy.toISOString()),
        supabase.from('puntos_encuentro').select('codigo, nombre, lat, lng').eq('activo', true),
      ]))
      if (!vivo) return
      if (terrRes.error || resRes.error || salRes.error || puntosRes.error) {
        throw terrRes.error ?? resRes.error ?? salRes.error ?? puntosRes.error
      }

      const lista = ((terrRes.data as Territorio[]) ?? []).slice().sort(
        (a, b) => Number(a.name) - Number(b.name) || a.name.localeCompare(b.name),
      )
      setTerritorios(lista)

      const propias = (resRes.data ?? []) as ReservaPropia[]
      setReservas(propias)
      const mio = propias.find((r) => r.status === 'activa' && r.assigned_to === profile?.id)
      setMiTerritorio((actual) => actual ?? lista.find((t) => t.id === mio?.territory_id) ?? null)

      const filas = salRes.data ?? []
      if (filas.length) {
        setOrigenSalidas('base')
        // Una lista recortada en silencio hace creer que eso es todo lo que
        // hay. Solo se dice cuando de verdad quedo algo afuera.
        setRecorte(
          salRes.count && salRes.count > filas.length
            ? { trajo: filas.length, hay: salRes.count }
            : null,
        )
        const puntos = (puntosRes.data ?? []) as PuntoParaLlegar[]
        const convertidas = filas.map((f: Record<string, unknown>) => {
          const salida = comoSalida(f, lista)
          const gps = coordenadasDePuntoCatalogado({
            codigo: salida.puntoCodigo,
            lugar: salida.lugar,
            lat: salida.lat,
            lng: salida.lng,
          }, puntos)
          return gps ? { ...salida, ...gps } : salida
        })
        setSalidas(convertidas)
      } else {
        setSalidas([])
        setOrigenSalidas('base')
      }
      } catch (failure) {
        if (vivo) setAviso(
          failure instanceof Error && failure.message === MENSAJE_CARGA_PROGRAMA_LENTA
            ? 'El programa tardó demasiado en cargar. Revisá la conexión y tocá Actualizar programa.'
            : 'No pudimos actualizar el programa y tus asignaciones. Revisá la conexión y tocá Actualizar programa.',
        )
      } finally {
        if (vivo) setCargando(false)
      }
    })()

    return () => {
      vivo = false
    }
  }, [profile?.id, revision])

  useEffect(() => {
    const actualizar = () => setRevision((value) => value + 1)
    let day = hoyISO()
    const timer = window.setInterval(() => {
      const next = hoyISO()
      if (next !== day) { day = next; actualizar() }
    }, 30_000)
    window.addEventListener('focus', actualizar)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', actualizar)
    }
  }, [])

  // Manzanas, lados y lo ya informado del territorio elegido.
  useEffect(() => {
    let vivo = true
    if (!supabase || !miTerritorio) {
      setManzanas([])
      setLados([])
      setEstadosBase({})
      setDibujoListo(false)
      return
    }
    setDibujoListo(false)

    void (async () => {
      try {
      const checkpoint = checkpointCola()
      const [mzRes, ldRes, cbRes] = await Promise.all([
        manzanasVigentes(supabase, miTerritorio.id),
        readAllRows<Lado>((from,to) => supabase!
          .from('manzana_lados')
          .select('id, manzana_id, orden, geometry_geojson, largo_m, geometry_version')
          .eq('territory_id', miTerritorio.id)
          .is('vigente_hasta', null)
          .order('orden', { ascending: true }).order('id').range(from,to)).then(data=>({data,error:null})),
        readAllRows<{lado_id:string;estado:string}>((from,to) => supabase!
          .from('cobertura_lado_actual')
          .select('lado_id, estado')
          .eq('territory_id', miTerritorio.id).order('lado_id').range(from,to)).then(data=>({data,error:null})),
      ])
      if (!vivo) return
      if (mzRes.error) throw mzRes.error
      setManzanas((mzRes.data as Manzana[]) ?? [])
      setLados((ldRes.data as Lado[]) ?? [])
      setEstadosBase(Object.fromEntries(cbRes.data.map((c)=>[c.lado_id,c.estado])))
      acknowledgeSnapshot(checkpoint)
      setDibujoListo(true)
      } catch { if (vivo) setAviso('No pudimos cargar la cobertura. Tocá Actualizar para volver a intentar.') }
    })()

    return () => {
      vivo = false
    }
  }, [miTerritorio, revision, cola.remoteRevision, checkpointCola, acknowledgeSnapshot])

  // --------------------------------------------------------- marcar
  // La bitácora es de solo agregar: desmarcar no borra el evento anterior,
  // informa uno nuevo que dice "sin_dato". La historia queda.
  const informar = useCallback(
    async (afectados: Lado[]) => {
      if (!editando || !miTerritorio || !profile?.id || !afectados.length || encolando.current) return
      encolando.current = true
      try {
        for (const lado of afectados) {
          if (estados[lado.id] === estadoElegido) continue
          if (!lado.geometry_version) throw new Error('Falta la versión del dibujo. Actualizá antes de marcar.')
          await enqueue({ lado_id: lado.id, manzana_id: lado.manzana_id, territory_id: miTerritorio.id,
            geometry_version: lado.geometry_version, estado: estadoElegido, origen: 'app_hermano', informado_por: profile.id })
        }
        setAviso(null)
      } catch (failure) {
        setAviso(failure instanceof Error ? failure.message : 'No se pudo conservar la marca. Las anteriores siguen pendientes.')
      } finally {
        encolando.current = false
        void sync()
      }
    },
    [editando, miTerritorio, profile?.id, estados, estadoElegido, enqueue, sync],
  )

  const marcarManzana = useCallback(
    (mz: Manzana) => {
      const propios = ladosDe(mz)
      void informar(propios)
    },
    [ladosDe, informar],
  )

  const marcarLado = useCallback(
    (lado: Lado) => void informar([lado]),
    [informar],
  )

  // ----------------------------------------------------------- mapas
  const dibujarPropio = useCallback(
    (capa: L.LayerGroup) => {
      pintarManzanas(
        capa,
        manzanas,
        ladosDe,
        hechos,
        editando && modoMarcar === 'manzana' ? marcarManzana : undefined,
      )

      if (!editando || modoMarcar !== 'lado') return

      for (const mz of manzanas) {
        if (!mz.geometry_geojson) continue
        {
          const centro: [number, number] = [Number(mz.lat), Number(mz.lng)]
          for (const lado of ladosDe(mz)) {
            const linea = lado.geometry_geojson.coordinates.map(([x, y]: [number, number]) =>
              haciaAdentro([y, x], centro),
            )
            const ok = hechos.has(lado.id)
            // Debajo de cada linea va otra invisible y gruesa: el dedo mide
            // bastante mas que la calle.
            L.polyline(linea, { color: '#000', opacity: 0, weight: 26 })
              .addTo(capa)
              .on('click', () => marcarLado(lado))
            L.polyline(linea, {
              color: ok ? '#0f6b47' : '#6a6e77',
              weight: ok ? 7 : 5,
              opacity: ok ? 1 : 0.75,
              interactive: false,
            }).addTo(capa)
          }
        }
      }
    },
    [manzanas, ladosDe, hechos, modoMarcar, editando, marcarManzana, marcarLado],
  )

  const encuadre = useMemo(() => {
    const pts = manzanas.flatMap((m) => (m.geometry_geojson ? anilloDe(m.geometry_geojson) : []))
    return pts.length ? L.latLngBounds(pts) : null
  }, [manzanas])

  // Mapa de la pestaña, siempre a la vista.
  const cajaMapa = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  // El efecto que pinta corre antes que el que crea el mapa, asi que sin
  // esta bandera la capa quedaba vacia hasta el siguiente cambio de estado.
  const [mapaListo, setMapaListo] = useState(false)

  useEffect(() => {
    if (vista !== 'territorio' || !cajaMapa.current || !encuadre) return
    if (!mapa.current) {
      const m = L.map(cajaMapa.current, { zoomAnimation: false })
      m.fitBounds(encuadre.pad(0.08), { animate: false })
      ponerFondo(m)
      capa.current = L.layerGroup().addTo(m)
      mapa.current = m
      setMapaListo(true)
    }
    const m = mapa.current
    // El encuadre se calcula antes de crear el mapa y se rehace cuando la
    // caja ya tiene su tamaño: una pestaña oculta mide cero.
    window.setTimeout(() => {
      m.invalidateSize({ animate: false, pan: false })
      m.fitBounds(encuadre.pad(0.08), { animate: false })
    }, 60)
  }, [vista, encuadre])

  useEffect(() => {
    if (!mapaListo || !capa.current) return
    capa.current.clearLayers()
    dibujarPropio(capa.current)
  }, [dibujarPropio, mapaListo])

  useEffect(
    () => () => {
      mapa.current?.remove()
      mapa.current = null
      capa.current = null
    },
    [],
  )

  // El conmutador de tema del entorno local vive fijo abajo a la derecha y
  // se come la pestania "Mi territorio". Se esconde mientras esta pantalla
  // esta a la vista, porque ese borde es suyo.
  useEffect(() => {
    const boton = document.getElementById('theme-switch')
    if (!boton) return
    const antes = boton.style.display
    boton.style.display = 'none'
    return () => {
      boton.style.display = antes
    }
  }, [])

  const solicitarTerritorio = useCallback(async () => {
    if (!supabase || !miTerritorio || !profile?.id) return
    setSolicitando(true)
    const { error } = await supabase.rpc('solicitar_territorio', { p_territory_id: miTerritorio.id })
    setSolicitando(false)
    if (error) {
      setAviso(
        error.code === '23505'
          ? 'Ya pediste este territorio. Está esperando respuesta.'
          : 'No se pudo enviar el pedido. Probá de nuevo en un rato.',
      )
      return
    }
    setRevision((value) => value + 1)
    setAviso(null)
  }, [miTerritorio, profile?.id])

  const devolverTerritorio = async () => {
    const reserva = reservas.find(r => r.status === 'activa' && r.assigned_to === profile?.id && r.territory_id === miTerritorio?.id)
    if (!supabase || !reserva || devolviendo) return
    if (cola.events.some(event => event.territory_id === reserva.territory_id) || cola.error || encolando.current) {
      setAviso('Antes de devolver el territorio, confirmá las marcas pendientes. Si hay un rechazo, pedí al administrador que lo revise.')
      return
    }
    if (!window.confirm(`¿Devolver el territorio ${miTerritorio?.name}? Su historial se conserva y dejarás de poder marcarlo.`)) return
    setDevolviendo(true)
    setMarcando(false)
    try {
      const { error } = await supabase.rpc('gestionar_reserva', { p_reserva_id: reserva.id, p_accion: 'devolver' })
      if (error) throw error
      setReservas(current => current.map(r => r.id === reserva.id ? { ...r, status: 'liberada' } : r))
      setRevision(value => value + 1)
      setAviso('Territorio devuelto. El historial se conserva; ahora podés consultarlo sin marcar.')
    } catch {
      setAviso('No pudimos confirmar la devolución. Podés reintentar: no se duplica el movimiento.')
    } finally { setDevolviendo(false) }
  }

  const escala = { ['--step' as string]: paso.toFixed(2) } as React.CSSProperties

  // Que no haya manzanas no es un logro: es que nadie lo dibujo todavia.
  const sinDibujo = dibujoListo && manzanas.length === 0

  // ------------------------------------------------------------ render
  const hoy = hoyISO()
  const deHoy = salidasVisibles.filter((s) => s.fecha === hoy)
  const proxima = salidasVisibles.find((s) => s.fecha > hoy)
  const destacada = deHoy.find((s) => !s.tipo && !yaEmpezo(s)) ?? deHoy.find((s) => !s.tipo) ?? proxima
  const otras = deHoy.filter((s) => s !== destacada)
  const quedan = deHoy.filter((s) => !s.tipo && !yaEmpezo(s))
  const h = new Date().getHours()

  const resumenHoy = deHoy.length
    ? !deHoy.some((s) => !s.tipo)
      ? 'Hoy es predicación telefónica.'
      : quedan.length === 1
        ? `Te queda la salida de las ${quedan[0].hora}.`
        : quedan.length > 1
          ? `Hoy quedan ${quedan.length} salidas.`
          : 'Las salidas de hoy ya pasaron.'
    : proxima
      ? `Hoy no hay salida. La próxima es el ${fechaLarga(proxima.fecha)}.`
      : // Sin programa cargado no se dice "no hay salidas", que suena a que
        // la congregación no sale. Se dice que falta cargarlo.
        'Todavía no está cargado el programa de las próximas salidas.'

  return (
    <div className="vh" style={escala}>
      <header className="barra">
        <span className="marca">
          <span className="logo" aria-hidden="true">
            <Icono nombre="territorios" tamaño={21} />
          </span>
          Territorios
        </span>
        <div className="barra-controles">
          <MiCuenta key={profile?.id} compact />
          <button
            className="btnIcono"
            aria-label={paso >= 1.3 ? 'Volver al tamaño normal' : 'Agrandar el texto'}
            onClick={() =>
              setPaso((p) => {
                const n = p >= 1.3 ? 1 : Number((p + 0.15).toFixed(2))
                localStorage.setItem(TAMANIO_GUARDADO, String(n))
                return n
              })
            }
          >
            {/* El signo tiene que decir lo que va a pasar. Con "A−" en el paso
                del medio, el boton mostraba achicar y agrandaba. */}
            {paso >= 1.3 ? 'A−' : 'A+'}
          </button>
        </div>
      </header>

      {/* La region vive siempre, aunque este vacia: un role="status" que
          aparece junto con su texto no lo anuncia, porque no habia nada que
          cambiara. Vacia no ocupa lugar. */}
      <p className="hoja nota" role="status" hidden={!aviso}>
        <Icono nombre="pendiente" tamaño={20} />
        <span>{aviso}</span>
      </p>
      <div className="hoja">
        {cola.error && <p className="nota" role="alert">{cola.error}</p>}
        <p role="status" hidden={!cola.events.length && !cola.sending && !cola.confirmed.length}>
          {cola.sending ? 'Enviando marcas… ' : ''}
          {cola.events.length ? `${cola.events.length} marcas conservadas en este dispositivo, pendientes de confirmar.` : 'Marcas confirmadas por el servidor.'}
        </p>
            {cola.events.length > 0 && <>
          <p className="sub">El mapa puede incluir avance pendiente. No borres los datos del navegador hasta que termine el envío.</p>
          {cola.events.filter(event => event.status === 'error').map(event => <p className="nota" role="alert" key={event.id}>
            Cuadra {event.lado_id.slice(0, 8)}: {event.lastError}
          </p>)}
          <button className="boton secundario" disabled={cola.sending} onClick={() => void cola.retry()}><Icono nombre="rehacer" tamaño={18} />Reintentar marcas pendientes</button>
        </>}
      </div>

      {/* ------------------------------------------------------------ HOY */}
      <section className={vista === 'hoy' ? 'vista activa hoja' : 'vista hoja'}>
        <h1 className="saludo">
          {h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'}
          {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}.` : '.'}
          <span className="sub">{cargando ? 'Cargando…' : resumenHoy}</span>
        </h1>

        {esMiembroPendiente(contexto) ? (
          <p className="nota" role="status">
            Estás en el {contexto?.group_number ? `Grupo ${contexto.group_number}` : 'grupo'} esperando
            que te confirmen. Mientras, podés ver el programa.
          </p>
        ) : null}

        {paneles.includes('sosConductor') && salidasVisibles.some((s) => s.driverId === profile?.driver_id && s.fecha >= hoyISO()) ? (
          <section className="tarjeta lima">
            <p className="rotulo">Sos el conductor</p>
            {salidasVisibles
              .filter((s) => s.driverId === profile?.driver_id && s.fecha >= hoyISO())
              .slice(0, 1)
              .map((s) => (
                <div key={s.id ?? s.hora}>
                  <p className="numeroGrande">{s.hora}</p>
                  <p>{tituloSalida(s, contexto)}</p>
                  {yaEmpezo(s) ? (
                    <button className="boton principal" onClick={() => { setVista('salidas'); setCierreId(s.id ?? '') }}>
                      <Icono nombre="completo" tamaño={18} />
                      Informar resultado
                    </button>
                  ) : null}
                </div>
              ))}
          </section>
        ) : null}

        {paneles.includes('tuGrupoSale') ? (
          <TarjetaGrupoSale contexto={contexto} salidas={salidasVisibles} />
        ) : null}

        {paneles.includes('sinGrupo') ? (
          <section className="panel">
            <h2>Todavía no estás en un grupo</h2>
            <p className="sub">Pedile el código al superintendente y ponelo acá.</p>
            <CampoCodigoGrupo
              ocupado={!online}
              alUnir={async (codigo) => {
                if (!supabase) return 'Todavía no está la conexión.'
                const { error } = await supabase.rpc('unirme_a_grupo', { p_codigo: codigo })
                if (error) {
                  return /ningún grupo|ningun grupo|22023/i.test(error.message)
                    ? 'Ese código no es de ningún grupo. Fijate si lo copiaste bien.'
                    : error.message
                }
                retryAuth()
                return null
              }}
            />
          </section>
        ) : null}

        {paneles.includes('resumenGrupo') ? (
          <section className="panel">
            <h2>Tu grupo</h2>
            <p className="sub">
              {contexto?.group_number ? `Grupo ${contexto.group_number}` : contexto?.group_name} · tocá para
              confirmar hermanos y el punto de encuentro.
            </p>
            <button type="button" className="boton principal" onClick={() => setHojaGrupo(true)}>
              <Icono nombre="grupo" tamaño={18} />
              Abrir mi grupo
            </button>
          </section>
        ) : null}

        {destacada && destacada.tipo !== 'grupos' && (
          <TarjetaDestacada
            salida={destacada}
            contexto={contexto}
            esFutura={!deHoy.length}
            onMapa={() => setHoja({ salida: destacada })}
          />
        )}

        {otras.filter((s) => s.tipo !== 'grupos').length > 0 && (
          <>
            <p className="salidaDia">También hoy</p>
            {otras.filter((s) => s.tipo !== 'grupos').map((s, i) => (
              <FilaSalida
                key={`${s.fecha}-${s.hora}-${i}`}
                salida={s}
                contexto={contexto}
                abierta={abierta === `hoy-${i}`}
                onAbrir={() => setAbierta(abierta === `hoy-${i}` ? null : `hoy-${i}`)}
                onMapa={() => setHoja({ salida: s })}
              />
            ))}
          </>
        )}

        <section className="panel">
          <h2>Tu territorio</h2>
          {miTerritorio && asignado ? (
            <>
              <p className="sub">
                Tenés el <strong>{miTerritorio.name}</strong>.{' '}
                {!dibujoListo ? 'Cargando el mapa…' : sinDibujo
                  ? 'Todavía no está dibujado en el mapa.'
                  : avance.faltan === 0
                    ? 'Ya lo recorriste entero.'
                    : avance.faltan === 1
                      ? 'Te falta 1 manzana.'
                      : `Te faltan ${avance.faltan} manzanas.`}
              </p>
              {!sinDibujo && (
                <>
                  <div className="barraProgreso" style={{ background: 'var(--line)' }}>
                    <i style={{ width: `${avance.pct ?? 0}%`, background: 'var(--lime-deep)' }} />
                  </div>
                  <p className="pieProgreso" style={{ color: 'var(--fg-2)' }}>
                    {avance.completas} de {manzanas.length} recorridas · {avance.pct === null ? 'Sin información suficiente' : `${avance.pct}% de los metros`}
                  </p>
                  <button className="boton principal" style={{ background: 'var(--ink)', color: '#fff' }} onClick={() => setVista('territorio')}>
                    <Icono nombre="personal" tamaño={18} />
                    Ver mi territorio
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="sub">
              Todavía no tenés uno. Podés pedirlo en Mi territorio.
            </p>
          )}
        </section>
      </section>

      {/* -------------------------------------------------------- SALIDAS */}
      <section className={vista === 'salidas' ? 'vista activa hoja' : 'vista hoja'}>
        <div className="salidasEncabezado">
          <h1 className="saludo">
            Salidas
            <span className="sub">
              {cargando
                ? 'Cargando…'
                : origenSalidas === 'archivo'
                  ? 'Del programa que pasan por WhatsApp.'
                  : salidasVisibles.length
                    ? 'De hoy en adelante.'
                    : 'Todavía no hay ninguna cargada de hoy en adelante.'}
            </span>
          </h1>
          <button
            className="boton secundario actualizar-programa"
            type="button"
            aria-label="Actualizar programa"
            aria-controls="lista-salidas"
            title="Actualizar programa"
            onClick={() => setRevision((value) => value + 1)}
          >
            Actualizar programa
          </button>
        </div>
        {recorte && (
          <p className="nota">
            <Icono nombre="pendiente" tamaño={20} />
            <span>
              Se muestran las {recorte.trajo} más próximas de {recorte.hay}.
            </span>
          </p>
        )}
        {(filtros.lasMias || filtros.lasDeMiGrupo) && (
          <div className="filtros-salidas">
            <button
              type="button"
              className={filtroSalidas === 'todas' ? 'boton principal' : 'boton secundario'}
              onClick={() => setFiltroSalidas('todas')}
            >
              Todas
            </button>
            {filtros.lasMias ? (
              <button
                type="button"
                className={filtroSalidas === 'mias' ? 'boton principal' : 'boton secundario'}
                onClick={() => setFiltroSalidas('mias')}
              >
                Las que conduzco
              </button>
            ) : null}
            {filtros.lasDeMiGrupo ? (
              <button
                type="button"
                className={filtroSalidas === 'grupo' ? 'boton principal' : 'boton secundario'}
                onClick={() => setFiltroSalidas('grupo')}
              >
                Las de mi grupo
              </button>
            ) : null}
          </div>
        )}
        <div id="lista-salidas">
          <ListaSalidas
            salidas={salidasVisibles}
            contexto={contexto}
            cargando={cargando}
            abierta={abierta}
            setAbierta={setAbierta}
            onMapa={(s) => setHoja({ salida: s })}
          />
        </div>
        {filtros.resultado && <section className="panel">
          <h2>Resultado de las salidas</h2>
          <p className="sub">Salidas que ya comenzaron en los últimos 30 días. Informar el resultado no marca automáticamente las cuadras.</p>
          {errorCierres && <p className="nota" role="alert">{errorCierres}</p>}
          {cargandoCierres && <p role="status">Cargando salidas para informar…</p>}
          {!cargandoCierres && !errorCierres && salidasParaCerrarVisibles.length === 0 && <p className="sub">No hay salidas disponibles para informar en este período.</p>}
          {salidasParaCerrarVisibles.length > 0 && (
            <ElegirDeLista
              etiqueta="Elegí la salida"
              valor={cierreId}
              vacio="Seleccioná una salida…"
              alElegir={setCierreId}
              opciones={[
                { valor: '', texto: 'Seleccioná una salida…' },
                ...salidasParaCerrarVisibles
                  .filter((s) => s.id && canReportSalida(profile, s.driverId, contexto?.puede_informar_salidas))
                  .map((s) => ({
                    valor: s.id!,
                    texto: `${fechaLarga(s.fecha)} · ${s.hora}`,
                    detalle: s.terr || s.lugar || 'Sin lugar informado',
                  })),
              ]}
            />
          )}
          {salidasParaCerrarVisibles.filter(s => s.id === cierreId && canReportSalida(profile, s.driverId, contexto?.puede_informar_salidas)).map(s =>
            <div key={s.id}>
              <SalidaResultadoForm salidaId={s.id!} canReport={true} canCorrect={Boolean(contexto?.puede_abrir_panel)} />
              {!s.terrId && <p role="status">Esta salida no tiene un territorio vinculado en la base. Podés informar su resultado, pero un administrador debe revisar la vinculación antes de registrar lados recorridos.</p>}
              <SalidaCoverageForm outing={s} queue={cola} />
            </div>)}
        </section>}
      </section>

      {/* ----------------------------------------------------- TERRITORIO */}
      <section className={vista === 'territorio' ? 'vista activa hoja' : 'vista hoja'}>
        {reservas.some((r) => r.status === 'activa' && r.assigned_to === profile?.id) && (
          <ElegirDeLista
            etiqueta="Mis territorios asignados"
            valor={asignado ? miTerritorio?.id ?? '' : ''}
            vacio="Elegí tu territorio…"
            alElegir={(valor) => {
              setMarcando(false)
              setDibujoListo(false)
              setMiTerritorio(territorios.find((t) => t.id === valor) ?? null)
            }}
            opciones={reservas
              .filter((r) => r.status === 'activa' && r.assigned_to === profile?.id)
              .map((r) => ({
                valor: r.territory_id,
                texto: `Territorio ${territorios.find((t) => t.id === r.territory_id)?.name ?? 'sin nombre'}`,
              }))}
          />
        )}
        {reservas.filter((r) => r.status === 'rechazada').map((r) => (
          <p className="nota" key={r.id}>Tu pedido del territorio {territorios.find((t) => t.id === r.territory_id)?.name ?? 'sin nombre'} no fue aprobado: {r.nota || 'Consultá al administrador.'}</p>
        ))}
        <h1 className="saludo">
          {asignado ? 'Mi territorio' : 'Consultar territorio'}
          <span className="sub">
            {!miTerritorio
              ? 'Todavía no tenés uno asignado.'
              : !dibujoListo ? 'Cargando el mapa…' : !asignado ? `Territorio ${miTerritorio.name} · Solo consulta` : sinDibujo
                ? `El territorio ${miTerritorio.name} todavía no está dibujado.`
                : avance.faltan === 0
                  ? `Terminaste el territorio ${miTerritorio.name}.`
                  : `Te faltan ${avance.faltan} manzanas del territorio ${miTerritorio.name}.`}
          </span>
        </h1>

        {!asignado && (
          <section className="panel">
            <h2>Estás mirando, no marcando</h2>
            <p className="sub">
              Este territorio no está asignado a tu cuenta. Podés mirarlo, pero{' '}
              <strong>solo mirarlo</strong>: para marcar lo que recorriste tiene que ser tuyo.
            </p>
            <ElegirTerritorio
              etiqueta="Mirar el territorio"
              valorId={miTerritorio?.id ?? null}
              territorios={territorios.map((t) => ({
                id: t.id,
                name: t.name,
                marca: reservas.some((r) => r.status === 'activa' && r.assigned_to === profile?.id && r.territory_id === t.id)
                  ? 'tuyo'
                  : reservas.some((r) => r.status === 'solicitada' && r.territory_id === t.id)
                    ? 'pedido'
                    : reservas.some((r) => r.status === 'activa' && r.territory_id === t.id)
                      ? 'reservado'
                      : null,
              }))}
              alElegir={(id) => {
                setMarcando(false)
                setDibujoListo(false)
                setMiTerritorio(territorios.find((t) => t.id === id) ?? null)
              }}
            />
            {miTerritorio &&
              (solicitado ? (
                <p className="nota" style={{ marginTop: 16 }}>
                  <Icono nombre="completo" tamaño={20} />
                  <span>
                    Pediste el territorio {miTerritorio.name}. Cuando el superintendente de tu grupo
                    o el siervo de territorios lo confirme, lo vas a ver acá.
                  </span>
                </p>
              ) : esMiembroPendiente(contexto) ? (
                <p className="nota" style={{ marginTop: 16 }}>
                  Cuando te confirmen en el grupo vas a poder pedirlo.
                </p>
              ) : reservas.some((r) => r.status === 'activa' && r.territory_id === miTerritorio.id && r.assigned_to !== profile?.id) ? (
                <p className="nota" style={{ marginTop: 16 }}>
                  Lo tiene otra persona.
                </p>
              ) : (
                <button
                  className="boton principal"
                  disabled={solicitando || !puedePedirTerritorio(contexto)}
                  onClick={() => void solicitarTerritorio()}
                >
                  <Icono nombre="reservar" tamaño={18} />
                  {solicitando ? 'Enviando…' : `Pedir este territorio`}
                </button>
              ))}
          </section>
        )}

        {miTerritorio && sinDibujo && (
          <div className="vacio">
            <span className="marcoVacio" aria-hidden="true">
              <Icono nombre="territorios" tamaño={28} />
            </span>
            <h2>El territorio {miTerritorio.name} todavía no está en el mapa</h2>
            <p>
              Nadie dibujó sus manzanas todavía, así que no hay nada que marcar ni que mirar.
              Avisale al hermano que arma los mapas.
            </p>
          </div>
        )}

        {miTerritorio && !sinDibujo && (
          <>
            <section className={asignado ? 'tarjeta' : 'tarjeta consulta'}>
              <p className="rotulo">{asignado ? 'Tu territorio' : 'Solo consulta'}</p>
              <p className="numeroGrande">{miTerritorio.name}</p>
              {asignado ? (
                <>
                  <div className="cifras">
                    <div>
                      <span>Manzanas</span>
                      <strong>{manzanas.length}</strong>
                    </div>
                    <div>
                      <span>Recorridas</span>
                      <strong>{avance.completas}</strong>
                    </div>
                    <div>
                      <span>Te faltan</span>
                      <strong>{avance.faltan}</strong>
                    </div>
                  </div>
                  <div className="barraProgreso">
                    <i style={{ width: `${avance.pct ?? 0}%` }} />
                  </div>
                  <p className="pieProgreso">
                    {avance.completas} de {manzanas.length} recorridas
                    {avance.empezadas ? ` · ${avance.empezadas} empezada${avance.empezadas > 1 ? 's' : ''}` : ''} ·{' '}
                    {avance.pct === null ? 'Sin información suficiente' : `${avance.pct}% de los metros`}{guardando ? ' · guardando…' : ''}
                  </p>
                  <p className="sub">Cuadras: {avance.estados.sin_dato} sin dato · {avance.estados.no_accesible} no accesibles · {avance.estados.revisitar} para revisitar.</p>
                </>
              ) : avance.pct !== null ? (
                <p className="sub">Así está hoy: {avance.completas} de {manzanas.length} manzanas recorridas.</p>
              ) : null}
              <button className="boton principal" onClick={() => setHoja({ propio: true })}>
                <Icono nombre="territorios" tamaño={18} />
                Abrir el mapa en grande
              </button>
              {puedeMarcar && (
                <button
                  className={marcando ? 'boton principal' : 'boton secundario'}
                  onClick={() => {
                    if (marcando && cola.events.length) setAviso('Saliste del modo marcar. Las marcas pendientes siguen guardadas en este dispositivo.')
                    setMarcando((v) => !v)
                  }}
                >
                  <Icono nombre={marcando ? 'completo' : 'marcar'} tamaño={18} />
                  {marcando ? 'Listo, terminé de marcar' : 'Marcar lo que recorrí'}
                </button>
              )}
              {asignado ? (
                <button className="boton secundario" onClick={() => setHistorial(true)}>
                  <Icono nombre="historial" tamaño={18} />
                  Historial
                </button>
              ) : null}
              {asignado && <button className="boton secundario" disabled={devolviendo || cola.sending} onClick={() => void devolverTerritorio()}>
                <Icono nombre="mover" tamaño={18} />
                {devolviendo ? 'Devolviendo…' : 'Devolver territorio'}
              </button>}
            </section>

            <section className="panel">
              <h2>Dónde queda</h2>
              <p className="sub">
                {editando ? (
                  <>
                    Tocá una manzana para marcarla, o pasá a <strong>Por cuadra</strong> si hiciste
                    una sola calle.
                  </>
                ) : puedeMarcar ? (
                  <>
                    Las verdes ya las recorriste. Para cambiar algo, tocá{' '}
                    <strong>Marcar lo que recorrí</strong>.
                  </>
                ) : (
                  <>Las verdes tienen recorrido informado. Este territorio es de mirar.</>
                )}
              </p>
              {editando && (
                <label>Estado que vas a informar
                  <ElegirDeLista
                    etiqueta="Estado que vas a informar"
                    valor={estadoElegido}
                    alElegir={(valor) => setEstadoElegido(valor as CoverageInput['estado'])}
                    opciones={[
                      { valor: 'recorrido', texto: 'Recorrido' },
                      { valor: 'no_accesible', texto: 'No accesible' },
                      { valor: 'revisitar', texto: 'Para revisitar' },
                      { valor: 'sin_dato', texto: 'Sin dato (quitar la marca actual)' },
                    ]}
                  />
                </label>
              )}
              {editando && (
                <div className="modos" role="group" aria-label="Cómo marcar">
                  {(['manzana', 'lado'] as const).map((k) => (
                    <button
                      key={k}
                      className="modo"
                      aria-pressed={modoMarcar === k}
                      onClick={() => setModoMarcar(k)}
                    >
                      {k === 'manzana' ? 'Manzana entera' : 'Por cuadra'}
                    </button>
                  ))}
                </div>
              )}
              <div id="mapa" ref={cajaMapa} />
              {/* En el mapa el estado lo lleva el color y nada mas. Abajo va
                  dicho con palabras, que es la regla 3. */}
              <div className="leyenda">
                <span>
                  <i className="punto ok" aria-hidden="true" /> Recorrida
                </span>
                <span>
                  <i className="punto media" aria-hidden="true" /> Empezada
                </span>
                <span>
                  <i className="punto" aria-hidden="true" /> Te falta
                </span>
              </div>
            </section>

            <section className="panel">
              <h2>{puedeMarcar ? 'Tus manzanas' : 'Las manzanas'}</h2>
              <p className="sub">
                {editando
                  ? 'Elegí el estado y tocá la manzana o cuadra. Repetir el mismo estado no desmarca; para quitarlo elegí “Sin dato”.'
                  : puedeMarcar
                    ? 'Para cambiar algo, tocá “Marcar lo que recorrí” arriba.'
                    : 'Así está este territorio hoy.'}
              </p>
              <div className="rejilla">
                {manzanas.map((mz) => {
                  const total = ladosDe(mz).length
                  const n = hechosDe(mz)
                  const completa = total > 0 && n === total
                  const media = n > 0 && !completa
                  return (
                    <button
                      key={mz.id}
                      className={`manzana${completa ? ' hecha' : ''}${media ? ' media' : ''}`}
                      aria-pressed={completa}
                      disabled={!editando}
                      onClick={() => marcarManzana(mz)}
                    >
                      {mz.label}
                      <small>{completa ? <><Icono nombre="completo" tamaño={15} /> hecha</> : media ? `${n} de ${total} cuadras` : 'te falta'}</small>
                    </button>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </section>

      {/* ------------------------------------------------------- pestañas */}
      <nav className="pestanias" aria-label="Secciones">
        {([
          ['hoy', 'Hoy', 'inicio'],
          ['salidas', 'Salidas', 'salidas'],
          ['territorio', 'Mi territorio', 'personal'],
        ] as const).map(([id, texto, icono]) => (
          <button
            key={id}
            onClick={() => {
              setVista(id)
              window.scrollTo(0, 0)
            }}
            {...(vista === id ? { 'aria-current': 'page' as const } : {})}
          >
            <Icono nombre={icono} tamaño={24} className="pestaniaIcono" />
            <span>{texto}</span>
            <i className="marcaActiva" />
          </button>
        ))}
      </nav>

      {historial && miTerritorio && (
        <HojaHistorial territorio={miTerritorio} cola={cola} onCerrar={() => setHistorial(false)} />
      )}
      {contexto?.es_super_de_grupo ? (
        <HojaMiGrupo
          contexto={contexto}
          abierto={hojaGrupo}
          onCerrar={() => setHojaGrupo(false)}
          onCambio={() => retryAuth()}
        />
      ) : null}

      {hoja && (
        <HojaMapa
          salida={hoja.salida}
          propio={hoja.propio}
          editable={editando}
          modoMarcar={modoMarcar}
          setModoMarcar={setModoMarcar}
          territorio={miTerritorio}
          manzanas={manzanas}
          dibujarPropio={dibujarPropio}
          onCerrar={() => setHoja(null)}
        />
      )}
    </div>
  )
}

// =====================================================================
function ChipsDeSalida({ salida }: { salida: Salida }) {
  if (salida.tipo === 'telefonica') return <span className="marca-chip tel">☎ Por teléfono</span>
  if (salida.tipo === 'grupos') return <span className="marca-chip tel"><Icono nombre="grupo" tamaño={17} /> Cada grupo por su lado</span>
  // El mismo criterio que usa el mapa. Con dos lecturas distintas, la misma
  // salida decia una cosa en el chip y pintaba otra abajo.
  const { letras: mz, frase } = leerPriorizar(salida.priorizar)
  const letras = mz
    ? `Priorizá ${mz.size > 1 ? 'las manzanas' : 'la manzana'} ${enumerar(mz)}`
    : frase
  return (
    <>
      {salida.terr && (
        <span className="marca-chip terr">
          <b>Territorio</b> {salida.terr}
        </span>
      )}
      {letras && (
        <span className="marca-chip priorizar">
          <b aria-hidden="true">★</b>
          <span>{letras}</span>
        </span>
      )}
    </>
  )
}

// El mapa chico del territorio de la salida. Estaba en el prototipo y se
// perdio en la mudanza a la app: quedaba solo el boton, y ver donde queda
// pasaba a ser una decision en vez de un vistazo.
//
// No se arrastra ni se le hace zoom. Adentro de una pagina que scrollea, un
// mapa que agarra el dedo es una trampa: se toca y se abre grande, que es lo
// que la persona queria hacer. El control accesible es el boton de abajo,
// asi que este no se anuncia dos veces.
function MapaMini({ salida, onAbrir }: { salida: Salida; onAbrir: () => void }) {
  const caja = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<L.Map | null>(null)
  const [formas, setFormas] = useState<Manzana[] | null>(null)

  useEffect(() => {
    if (!supabase || !salida.terrId) return
    let vivo = true
    void (async () => {
      const { data } = await manzanasVigentes(supabase, salida.terrId!)
      if (vivo) setFormas((data as Manzana[]) ?? [])
    })()
    return () => {
      vivo = false
    }
  }, [salida.terrId])

  useEffect(() => {
    if (!caja.current || !formas?.length || mapa.current) return
    const pts = formas.flatMap((m) => (m.geometry_geojson ? anilloDe(m.geometry_geojson) : []))
    if (!pts.length) return

    const m = L.map(caja.current, {
      zoomAnimation: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
    })
    ponerFondo(m)
    const capa = L.layerGroup().addTo(m)
    const b = L.latLngBounds(pts)
    m.fitBounds(b.pad(0.12), { animate: false })
    // Las letras van solo cuando hay manzanas priorizadas: ahi sirven para
    // ver cuales son las verdes. Si se recorre el territorio entero no
    // distinguen nada y solo tapan las calles, que es lo unico que este mapa
    // tiene para decir.
    const letras = letrasPrioritarias(salida.priorizar)
    const rotuladas = letras ? formas.filter((f) => letras.has(f.label.toLowerCase())) : []
    pintarSalida(
      capa,
      formas,
      salida.priorizar,
      rotuladas.length > 0 && rotuladas.length <= ENTRAN_LAS_LETRAS ? 'marcadas' : 'ninguna',
    )
    mapa.current = m
    window.setTimeout(() => {
      m.invalidateSize({ animate: false, pan: false })
      m.fitBounds(b.pad(0.12), { animate: false })
    }, 60)
  }, [formas, salida.priorizar])

  useEffect(
    () => () => {
      mapa.current?.remove()
      mapa.current = null
    },
    [],
  )

  if (!salida.terrId || (formas && !formas.length)) return null

  const leyenda = leyendaDelMapa(salida)
  return (
    <>
      <div className="mapaMini" ref={caja} onClick={onAbrir} aria-hidden="true" />
      <p className="mapaPie">
        {leyenda.llave ? (
          <span className="llave" aria-hidden="true" />
        ) : (
          <Icono nombre="territorios" tamaño={20} />
        )}
        <span>{leyenda.texto}</span>
      </p>
    </>
  )
}

function TarjetaGrupoSale({
  contexto,
  salidas,
}: {
  contexto: ContextoHermano | null
  salidas: Salida[]
}) {
  const hoy = hoyISO()
  const salida =
    salidas.find((s) => salidaCorrespondeAlGrupo(s, contexto?.group_id) && s.groupId === contexto?.group_id && s.fecha >= hoy) ??
    salidas.find((s) => salidaCorrespondeAlGrupo(s, contexto?.group_id) && !s.groupId && s.fecha >= hoy) ??
    salidas.find((s) => salidaCorrespondeAlGrupo(s, contexto?.group_id))
  const punto = contexto?.punto_grupo_nombre
  const conGps = contexto?.punto_grupo_lat != null && contexto.punto_grupo_lng != null
  const grupo = contexto?.group_number ? `Grupo ${contexto.group_number}` : contexto?.group_name
  const salidaPunto: Salida = {
    fecha: salida?.fecha ?? hoy,
    hora: salida?.hora ?? '',
    lat: contexto?.punto_grupo_lat ?? undefined,
    lng: contexto?.punto_grupo_lng ?? undefined,
    lugar: punto ?? undefined,
  }
  return (
    <section className="tarjeta">
      <p className="rotulo">Tu grupo sale</p>
      <p className="numeroGrande">
        <span className="numeroHora">{salida?.hora ?? '—'}</span>{' '}
        <small>{salida ? comoSeLlamaElDia(salida.fecha) ?? fechaLarga(salida.fecha) : 'cuando lo carguen'}</small>
      </p>
      {punto ? (
        <p>
          {punto}
          {grupo ? ` · ${grupo}` : ''}
        </p>
      ) : (
        <p className="sub">Tu grupo todavía no cargó dónde se junta. Preguntale al superintendente. Cuando lo cargue, acá aparecerán las indicaciones en auto y colectivo.</p>
      )}
      {punto && !conGps ? <p className="sub">El punto no tiene ubicación todavía.</p> : null}
      {conGps ? <BotonesComoLlegar salida={salidaPunto} /> : null}
    </section>
  )
}

function TarjetaDestacada({
  salida,
  contexto,
  esFutura,
  onMapa,
}: {
  salida: Salida
  contexto?: ContextoHermano | null
  esFutura: boolean
  onMapa: () => void
}) {
  const apodo = comoSeLlamaElDia(salida.fecha) ?? fechaLarga(salida.fecha)
  return (
    <section className="tarjeta">
      <p className="rotulo">{esFutura ? 'La próxima salida' : 'La salida de hoy'}</p>
      <p className="numeroGrande">
        <span className="numeroHora">{salida.hora}</span> <small>{apodo}</small>
      </p>
      <div className="frase">
        <span className="marco" aria-hidden="true">
          <Icono nombre="punto" tamaño={24} />
        </span>
        <span>
          <strong>{tituloSalida(salida, contexto)}</strong>
          {/* Sin barrio ni conductor decia "San Juan", que es donde vive todo
              el mundo que abre esto: un renglon que no informa nada. */}
          {(salida.barrio || salida.conductor) && (
            <small>
              {[salida.barrio, salida.conductor && `Conduce ${salida.conductor}`]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </span>
      </div>
      <div className="marcas">
        <ChipsDeSalida salida={salida} />
      </div>
      <MapaMini salida={salida} onAbrir={onMapa} />
      <BotonesComoLlegar salida={salida} />
      {/* Sin numero extra: el chip ya dice el territorio y el mapa es el
          mismo. Dos numeros distintos para la misma cosa se leen como un
          error. */}
      {salida.terrId && (
        <button className="boton chico" onClick={onMapa}>
          <Icono nombre="territorios" tamaño={18} />
          Ver el mapa del territorio
        </button>
      )}
    </section>
  )
}

function FilaSalida({
  salida,
  contexto,
  abierta,
  onAbrir,
  onMapa,
}: {
  salida: Salida
  contexto?: ContextoHermano | null
  abierta: boolean
  onAbrir: () => void
  onMapa: () => void
}) {
  const paso = yaEmpezo(salida)
  return (
    <div className="salidaBloque">
      <button
        className={`salida${salida.fecha === hoyISO() ? ' esHoy' : ''}${paso ? ' pasada' : ''}`}
        {...(salida.lugar ? { 'aria-expanded': abierta } : {})}
        onClick={salida.lugar ? onAbrir : undefined}
        style={salida.lugar ? undefined : { cursor: 'default' }}
      >
        <span className="cuando">
          {salida.hora}
          {paso && <span className="yaPaso" style={{ display: 'block' }}>ya pasó</span>}
        </span>
        <span className="donde">
          <strong>{tituloSalida(salida, contexto)}</strong>
          {salida.barrio && <span>{salida.barrio}</span>}
          {salida.conductor && <span>Conduce {salida.conductor}</span>}
          <div className="marcas">
            <ChipsDeSalida salida={salida} />
          </div>
        </span>
        {salida.lugar && (
          <span className="flecha" aria-hidden="true">
            <Icono nombre="chevron-abajo" tamaño={18} />
          </span>
        )}
      </button>
      {abierta && salida.lugar && (
        <div className="salidaDetalle">
          <MapaMini salida={salida} onAbrir={onMapa} />
          <BotonesComoLlegar salida={salida} />
          {salida.terrId && (
            <button className="boton chico" onClick={onMapa}>
              <Icono nombre="territorios" tamaño={18} />
              Ver el mapa del territorio
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ListaSalidas({
  salidas,
  contexto,
  cargando,
  abierta,
  setAbierta,
  onMapa,
}: {
  salidas: Salida[]
  contexto?: ContextoHermano | null
  cargando: boolean
  abierta: string | null
  setAbierta: (v: string | null) => void
  onMapa: (s: Salida) => void
}) {
  const hoy = hoyISO()
  const futuras = salidas.filter((s) => s.fecha >= hoy)
  const lista = futuras.length ? futuras : salidas
  let dia: string | null = null

  // Una pantalla en blanco parece rota. Si no hay nada que mostrar, se dice
  // que no lo hay y de quien depende que aparezca.
  if (!cargando && !salidas.length) {
    return (
      <div className="vacio">
        <span className="marcoVacio" aria-hidden="true">
          <Icono nombre="salidas" tamaño={28} />
        </span>
        <h2>Todavía no hay salidas</h2>
        <p>
          Cuando el hermano encargado cargue el programa, las vas a ver acá con la hora y el
          lugar.
        </p>
      </div>
    )
  }

  return (
    <>
      {!futuras.length && salidas.length > 0 && (
        <p className="nota">
          <Icono nombre="pendiente" tamaño={20} />
          <span>Estas salidas ya pasaron. Cuando llegue el programa nuevo lo vas a ver acá.</span>
        </p>
      )}
      {lista.map((s, i) => {
        const cabecera = s.fecha !== dia ? s.fecha : null
        dia = s.fecha
        const apodo = cabecera ? comoSeLlamaElDia(cabecera) : null
        return (
          <div key={`${s.fecha}-${s.hora}-${i}`}>
            {cabecera && (
              <p className={`salidaDia${apodo === 'Hoy' ? ' esHoy' : ''}`}>
                {apodo ?? fechaLarga(cabecera)}
                {apodo && <small>{fechaLarga(cabecera)}</small>}
              </p>
            )}
            <FilaSalida
              salida={s}
              contexto={contexto}
              abierta={abierta === `lista-${i}`}
              onAbrir={() => setAbierta(abierta === `lista-${i}` ? null : `lista-${i}`)}
              onMapa={() => onMapa(s)}
            />
          </div>
        )
      })}
    </>
  )
}

/**
 * HISTORIAL
 *
 * No hace falta guardar "como estaba el territorio el 15 de agosto": la
 * bitacora tiene cada hecho con su fecha, asi que el estado de un dia se
 * calcula quedandose con el ultimo hecho de cada lado hasta el final de
 * ese dia. Eso es lo que compra una tabla de solo agregar.
 *
 * Nadie edita esto, ni un admin: update y delete estan revocados a nivel
 * de privilegio. Corregir es agregar un hecho nuevo que apunta al viejo,
 * y la correccion queda a la vista. Es mas fuerte que "solo los admin
 * pueden editar": asi nadie puede hacer desaparecer que algo se informo.
 */
function HojaHistorial({
  territorio,
  cola,
  onCerrar,
}: {
  territorio: Territorio
  cola: ReturnType<typeof useCoverageOutbox>
  onCerrar: () => void
}) {
  const {profile}=useAuth()
  const canCorrect=profile?.role==='admin'&&profile.access_status==='active'
  const [correcting,setCorrecting]=useState<string|null>(null)
  const [correctionNotice,setCorrectionNotice]=useState<string|null>(null)
  // El historial NO usa el dibujo vigente: usa TODO el dibujo, incluido
  // el que se retiro. Un territorio redibujado deja sus manzanas viejas
  // marcadas con vigente_hasta, y los eventos siguen apuntando ahi. Con
  // el filtro de vigencia, el dia que se informo sobre el dibujo anterior
  // aparecia vacio: los hechos estaban en la base y la pantalla no los
  // sabia dibujar. El pasado se mira con la forma que tenia entonces.
  const [manzanas, setManzanas] = useState<Manzana[]>([])
  const [lados, setLados] = useState<Lado[]>([])
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  const [dia, setDia] = useState<string | null>(null)
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [instante, setInstante] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCerrarRef = useRef(onCerrar)
  onCerrarRef.current = onCerrar
  const cerrarRef = useRef<HTMLButtonElement | null>(null)
  const caja = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!supabase) return
    let vivo = true
    void (async () => {
      try {
      const [mzRes, ldRes] = await Promise.all([
        readAllRows<Manzana>((from,to) => supabase!
          .from('territorio_manzanas')
          .select('id, label, lat, lng, geometry_geojson, geometry_version, vigente_desde, vigente_hasta')
          .eq('territory_id', territorio.id)
          .order('label', { ascending: true }).order('id').range(from,to)),
        readAllRows<Lado>((from,to) => supabase!
          .from('manzana_lados')
          .select('id, manzana_id, orden, geometry_geojson, largo_m, geometry_version, vigente_desde, vigente_hasta')
          .eq('territory_id', territorio.id)
          .order('orden', { ascending: true }).order('id').range(from,to)),
      ])
      if (!vivo) return
      setManzanas(mzRes)
      setLados(ldRes)
      } catch { if (vivo) setHistoryError('No pudimos cargar los dibujos históricos. Cerrá el historial y volvé a intentar.') }
    })()
    return () => {
      vivo = false
    }
  }, [territorio.id])


  useEffect(() => {
    if (!supabase) return
    let vivo = true
    void (async () => {
      try {
      const filas = await readAllRows<Evento>((from,to) => supabase!
        .from('cobertura_eventos')
        .select('id, lado_id, manzana_id, estado, informado_at, informado_por, corrige_evento_id, nota')
        .eq('territory_id', territorio.id)
        .order('informado_at', { ascending: true }).order('id').range(from,to))
      if (!vivo) return
      setEventos(filas)
      const dias = [...new Set(filas.map((e) => soloDia(e.informado_at)))]
      setDia(dias[dias.length - 1] ?? null)

      // Los nombres pueden no venir: un hermano solo puede leer su propio
      // perfil. Lo que no llega se muestra como "un hermano", que es la
      // verdad, en vez de inventar un nombre.
      const ids = [...new Set(filas.map((e) => e.informado_por).filter(Boolean))] as string[]
      if (ids.length) {
        const { data: perfiles } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        if (vivo) {
          setNombres(
            Object.fromEntries(
              ((perfiles as { id: string; full_name: string | null }[]) ?? []).map((p) => [
                p.id,
                p.full_name ?? 'un hermano',
              ]),
            ),
          )
        }
      }
      } catch { if (vivo) setHistoryError('No pudimos cargar los movimientos. Cerrá el historial y volvé a intentar.') }
    })()
    return () => {
      vivo = false
    }
  }, [territorio.id, cola.remoteRevision])

  const dias = useMemo(
    () => [...new Set((eventos ?? []).map((e) => soloDia(e.informado_at)))],
    [eventos],
  )
  const indice = dia ? dias.indexOf(dia) : -1
  const corte = instante && soloDia(instante) === dia ? instante
    : dia ? new Date(`${dia}T23:59:59.999`).toISOString() : ''

  // El estado al cierre de un dia: el ultimo hecho de cada lado hasta ahi.
  const hechosAl = useMemo(() => {
    return new Set([...latestEventsAt(eventos ?? [], corte).values()].filter((e) => e.estado === 'recorrido').map((e) => e.lado_id))
  }, [eventos, corte])

  const delDia = useMemo(
    () => (eventos ?? []).filter((e) => dia && soloDia(e.informado_at) === dia),
    [eventos, dia],
  )

  const manzanasDelDia = useMemo(
    () => manzanas.filter((m) => validAt(m, corte)),
    [manzanas, corte],
  )

  const ladosDe = useCallback(
    (mz: Manzana) => lados.filter((l) => l.manzana_id === mz.id && validAt(l, corte)),
    [lados, corte],
  )

  useEffect(() => {
    capa.current?.clearLayers()
    if (!caja.current || !manzanasDelDia.length) return
    const pts = manzanasDelDia.flatMap((m) => (m.geometry_geojson ? anilloDe(m.geometry_geojson) : []))
    if (!pts.length) return
    const b = L.latLngBounds(pts)
    if (!mapa.current) {
      const m = L.map(caja.current, { zoomAnimation: false })
      m.fitBounds(b.pad(0.08), { animate: false })
      ponerFondo(m)
      capa.current = L.layerGroup().addTo(m)
      mapa.current = m
      window.setTimeout(() => {
        m.invalidateSize({ animate: false, pan: false })
        m.fitBounds(b.pad(0.08), { animate: false })
      }, 60)
    }
    capa.current!.clearLayers()
    pintarManzanas(capa.current!, manzanasDelDia, ladosDe, hechosAl)
  }, [manzanasDelDia, ladosDe, hechosAl])

  useEffect(() => {
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrarRef.current()
      if (e.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', esc)
    // El foco entra a la ventana y vuelve de donde vino. Sin esto, cerrar
    // dejaba el foco en el fondo y el teclado seguia en otra pantalla.
    const veniaDe = document.activeElement as HTMLElement | null
    cerrarRef.current?.focus()
    return () => {
      document.body.style.overflow = overflowAnterior
      window.removeEventListener('keydown', esc)
      veniaDe?.focus?.()
      mapa.current?.remove()
      mapa.current = null
    }
  }, [])

  // Lo que paso ese dia se cuenta por LADO, no por evento: marcar, desmarcar
  // y volver a marcar la misma calle son tres hechos en la bitacora y un solo
  // lado recorrido. Vale el ultimo hecho del dia para cada lado.
  const cierreDelDia = useMemo(() => {
    const m = new Map<string, Evento>()
    for (const e of delDia) m.set(e.lado_id, e)
    return [...m.values()]
  }, [delDia])

  // Cada manzana tocada ese dia, con cuantas cuadras se hicieron y como
  // quedo AL CIERRE: una manzana puede tener dos cuadras de hoy y dos de
  // la semana pasada, y esta hecha igual.
  const porManzana = useMemo(() => {
    const m = new Map<
      string,
      { letra: string; cuadras: number; total: number; completa: boolean; quien: Set<string> }
    >()
    for (const e of cierreDelDia) {
      if (e.estado !== 'recorrido') continue
      const mz = manzanasDelDia.find((x) => x.id === e.manzana_id)
      if (!mz) continue
      const suyas = ladosDe(mz)
      const fila =
        m.get(mz.id) ?? {
          letra: mz.label,
          cuadras: 0,
          total: suyas.length,
          completa: suyas.length > 0 && suyas.every((l) => hechosAl.has(l.id)),
          quien: new Set<string>(),
        }
      fila.cuadras++
      fila.quien.add(e.informado_por ? (nombres[e.informado_por] ?? 'un hermano') : 'alguien')
      m.set(mz.id, fila)
    }
    return [...m.values()].sort((a, b) => a.letra.localeCompare(b.letra))
  }, [cierreDelDia, manzanasDelDia, ladosDe, hechosAl, nombres])

  const deshechos = cierreDelDia.filter((e) => e.estado !== 'recorrido').length

  // El resumen se cuenta en manzanas, que es como se habla del territorio.
  // Una manzana sin cuadras cargadas no se cuenta como hecha ni como
  // empezada: no hay con que decirlo.
  const alCierre = useMemo(() => {
    let completas = 0
    let empezadas = 0
    for (const mz of manzanasDelDia) {
      const suyas = ladosDe(mz)
      if (!suyas.length) continue
      const n = suyas.filter((l) => hechosAl.has(l.id)).length
      if (n === suyas.length) completas++
      else if (n > 0) empezadas++
    }
    return { completas, empezadas }
  }, [manzanasDelDia, ladosDe, hechosAl])

  return (
    <div ref={dialogRef} className="sobre" role="dialog" aria-modal="true" aria-label={`Historial del territorio ${territorio.name}`}>
      {correctionNotice?<p role="status">{correctionNotice}</p>:null}
      {cola.events.some(e=>e.origen==='correccion'&&e.territory_id===territorio.id)?<div role="status">
        <p>Hay correcciones pendientes o con error. Todavía no forman parte del historial confirmado.</p>
        <button className="boton secundario" disabled={cola.sending} onClick={()=>void cola.retry()}>
          <Icono nombre="rehacer" tamaño={18} />
          Reintentar envíos
        </button>
      </div>:null}
      {cola.error?<p role="alert">{cola.error}</p>:null}
      <div className="sobreBarra">
        <button ref={cerrarRef} className="btnIcono" aria-label="Cerrar el historial" onClick={onCerrar}>
          <Icono nombre="cerrar" tamaño={20} />
        </button>
        <h2>
          Historial
          <small>Territorio {territorio.name}</small>
        </h2>
      </div>

      {historyError ? <p className="sobrePie" role="alert">{historyError}</p> : eventos === null ? (
        <p className="sobrePie">
          <Icono nombre="pendiente" tamaño={20} />
          <span>Cargando…</span>
        </p>
      ) : !dias.length ? (
        <p className="sobrePie">
          <Icono nombre="historial" tamaño={20} />
          <span>Todavía no hay nada informado en este territorio.</span>
        </p>
      ) : (
        <>
          <div className="histBarra">
            <button
              className="btnIcono"
              aria-label="Día anterior"
              disabled={indice <= 0}
              onClick={() => { setInstante(null); setDia(dias[indice - 1]) }}
            >
              <Icono nombre="anterior" tamaño={22} />
            </button>
            <span className="histDia">
              <strong>{comoSeLlamaElDia(dia!) ?? fechaLarga(dia!)}</strong>
              <small>
                {indice + 1} de {dias.length} día{dias.length > 1 ? 's' : ''} con movimiento
              </small>
            </span>
            <button
              className="btnIcono"
              aria-label="Día siguiente"
              disabled={indice >= dias.length - 1}
              onClick={() => { setInstante(null); setDia(dias[indice + 1]) }}
            >
              <Icono nombre="siguiente" tamaño={22} />
            </button>
          </div>

          <div className="sobreCuerpo">
            {!manzanasDelDia.length && <p className="nota">No hay un dibujo con vigencia comprobada en este momento.</p>}
            <div className="mapaGrande" ref={caja} />
          </div>

          <div className="histPie">
            <p className="histResumen">
              <strong>
                {alCierre.completas} de {manzanasDelDia.length} manzanas
              </strong>{' '}
              hechas {instante ? 'en el momento elegido' : 'al cierre de ese día'}
              {alCierre.empezadas > 0 &&
                (alCierre.empezadas === 1
                  ? ', y 1 empezada.'
                  : `, y ${alCierre.empezadas} empezadas.`)}
              {alCierre.empezadas === 0 && '.'}
            </p>
            {porManzana.length === 0 && deshechos === 0 ? (
              <p className="histNada">Ese día no se marcó nada.</p>
            ) : (
              <ul className="histLista">
                {porManzana.map((f) => (
                  <li key={f.letra}>
                    <b>{f.letra}</b>
                    <span>
                      {f.completa
                        ? 'se hizo completo'
                        : `se hicieron ${f.cuadras} de ${f.total} cuadras`}{' '}
                      · {[...f.quien].join(', ')}
                    </span>
                  </li>
                ))}
                {deshechos > 0 && (
                  <li className="histDeshecho">
                    <b><Icono nombre="deshacer" tamaño={18} /></b>
                    <span>
                      {deshechos === 1
                        ? '1 cuadra que se había marcado y quedó sin recorrer'
                        : `${deshechos} cuadras que se habían marcado y quedaron sin recorrer`}
                    </span>
                  </li>
                )}
              </ul>
            )}
          </div>
          <details className="histPie">
            <summary>Ver los {delDia.length} movimientos del día</summary>
            <button className="boton secundario" onClick={() => setInstante(null)}>
              <Icono nombre="historial" tamaño={18} />
              Ver el cierre del día
            </button>
            <ol>{delDia.map((e) => (
              <li key={e.id}>
                {e.corrige_evento_id && <strong>Corrección · </strong>}
                {new Date(e.informado_at).toLocaleTimeString('es-AR')} · Manzana {manzanas.find((m) => m.id === e.manzana_id)?.label ?? 'sin rótulo'} · {e.estado === 'recorrido' ? 'Recorrido' : e.estado === 'no_accesible' ? 'No accesible' : e.estado === 'revisitar' ? 'Revisitar' : 'Sin dato'} · {e.informado_por ? nombres[e.informado_por] ?? 'un hermano' : 'sin autor disponible'}
                {e.nota && <p>{e.nota}</p>}
                <button className="boton secundario" onClick={() => setInstante(e.informado_at)}>
                  <Icono nombre="territorios" tamaño={18} />
                  Ver el mapa en ese momento
                </button>
                {canCorrect&&correcting!==e.id?<button className="boton secundario"
                  disabled={cola.events.some(item=>item.corrige_evento_id===e.id)}
                  onClick={()=>setCorrecting(e.id)}>
                  <Icono nombre="dibujar" tamaño={18} />
                  Corregir esta marca
                </button>:null}
                {canCorrect&&correcting===e.id?<CoverageCorrectionForm onCancel={()=>setCorrecting(null)}
                  disabled={!!cola.error} onSubmit={async(state,note)=>{
                    if(!profile)throw Error('Falta la sesión.')
                    const side=lados.find(item=>item.id===e.lado_id)
                    if(!side?.geometry_version)throw Error('No se pudo cargar la versión original del lado.')
                    if(cola.events.some(item=>item.corrige_evento_id===e.id))throw Error('Esta marca ya tiene una corrección pendiente.')
                    const input=prepareCoverageCorrection(profile,e,{...side,geometry_version:side.geometry_version},territorio.id,state,note)
                    await cola.enqueue(input)
                    setCorrecting(null)
                    setCorrectionNotice('Corrección conservada en este dispositivo. Se incorpora al historial cuando el servidor la confirme.')
                    void cola.sync()
                  }}/>:null}
              </li>
            ))}</ol>
          </details>
        </>
      )}
    </div>
  )
}

// El mapa a pantalla completa, compartido por los dos casos: el territorio
// de una salida (mirar) y el propio (marcar).
function HojaMapa({
  salida,
  propio,
  editable,
  modoMarcar,
  setModoMarcar,
  territorio,
  manzanas,
  dibujarPropio,
  onCerrar,
}: {
  salida?: Salida
  propio?: boolean
  editable?: boolean
  modoMarcar: 'manzana' | 'lado'
  setModoMarcar: (v: 'manzana' | 'lado') => void
  territorio: Territorio | null
  manzanas: Manzana[]
  dibujarPropio: (capa: L.LayerGroup) => void
  onCerrar: () => void
}) {
  const cerrarRef = useRef<HTMLButtonElement | null>(null)
  const caja = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  const [formas, setFormas] = useState<Manzana[]>(propio ? manzanas : [])

  // Para una salida, las manzanas son las de ESE territorio, que puede no
  // ser el propio.
  useEffect(() => {
    if (propio || !salida?.terrId || !supabase) return
    let vivo = true
    void (async () => {
      const { data } = await manzanasVigentes(supabase, salida.terrId!)
      if (vivo) setFormas((data as Manzana[]) ?? [])
    })()
    return () => {
      vivo = false
    }
  }, [propio, salida?.terrId])

  useEffect(() => {
    if (propio) setFormas(manzanas)
  }, [propio, manzanas])

  useEffect(() => {
    if (!caja.current || !formas.length) return
    const pts = formas.flatMap((m) => (m.geometry_geojson ? anilloDe(m.geometry_geojson) : []))
    if (!pts.length) return
    const b = L.latLngBounds(pts)
    if (!mapa.current) {
      const m = L.map(caja.current, { zoomAnimation: false })
      m.fitBounds(b.pad(0.08), { animate: false })
      ponerFondo(m)
      capa.current = L.layerGroup().addTo(m)
      mapa.current = m
      window.setTimeout(() => {
        m.invalidateSize({ animate: false, pan: false })
        m.fitBounds(b.pad(0.08), { animate: false })
      }, 60)
    }
    const c = capa.current!
    c.clearLayers()
    if (propio) {
      dibujarPropio(c)
      return
    }
    pintarSalida(c, formas, salida?.priorizar)
  }, [formas, propio, salida?.priorizar, dibujarPropio])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    const veniaDe = document.activeElement as HTMLElement | null
    cerrarRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', esc)
      veniaDe?.focus?.()
      mapa.current?.remove()
      mapa.current = null
    }
  }, [onCerrar])

  // El pie decia "Tocá una manzana" tambien en modo cuadra, donde tocar la
  // manzana no hace nada. Dice lo que el dedo puede hacer ahora.
  const leyenda = propio
    ? {
        llave: true,
        texto: !editable
          ? 'En verde, lo que ya se recorrió.'
          : modoMarcar === 'manzana'
            ? 'Las verdes ya las recorriste. Tocá una manzana para marcarla entera.'
            : 'Las verdes ya las recorriste. Tocá una cuadra para marcarla.',
      }
    : salida
      ? leyendaDelMapa(salida)
      : { llave: false, texto: '' }

  return (
    <div
      className="sobre"
      role="dialog"
      aria-modal="true"
      aria-label={`Mapa del territorio ${propio ? territorio?.name : salida?.terr}`}
    >
      <div className="sobreBarra">
        <button ref={cerrarRef} className="btnIcono" aria-label="Cerrar el mapa" onClick={onCerrar}>
          <Icono nombre="cerrar" tamaño={20} />
        </button>
        <h2>
          Territorio {propio ? territorio?.name : salida?.terr}
          {propio ? <small>El tuyo</small> : salida?.lugar ? <small>Se sale de {salida.lugar}</small> : null}
        </h2>
      </div>
      {/* Elegir entre manzana y cuadra vivia solo en el panel de atras: para
          cambiar de modo habia que cerrar el mapa, cambiarlo y volver a
          abrirlo, justo donde se marca de verdad. */}
      {propio && editable && (
        <div id="sobreModos">
          <div className="modos" role="group" aria-label="Cómo marcar">
            {(['manzana', 'lado'] as const).map((k) => (
              <button
                key={k}
                className="modo"
                aria-pressed={modoMarcar === k}
                onClick={() => setModoMarcar(k)}
              >
                {k === 'manzana' ? 'Manzana entera' : 'Por cuadra'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sobreCuerpo">
        <div className="mapaGrande" ref={caja} />
      </div>
      <p className="sobrePie">
        {leyenda.llave ? (
          <span className={propio ? 'llave hecha' : 'llave'} aria-hidden="true" />
        ) : (
          <Icono nombre="territorios" tamaño={20} />
        )}
        <span>{leyenda.texto}</span>
      </p>
    </div>
  )
}
