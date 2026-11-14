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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import L from 'leaflet'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { readAllRows } from '../lib/readAllRows'
import { latestEventsAt, validAt } from '../lib/coverageHistory'
import { coverageSummary } from '../lib/coverageSummary'
import { useCoverageOutbox } from '../lib/useCoverageOutbox'
import { MENSAJE_FALTA_HABILITAR_ADMIN, type CoverageInput } from '../lib/coverageOutbox'
import { avisoMarcandoComoAdmin, conOrigenAdmin, esAdminQueMarca, marcaComoAdmin, territorioDeLaDireccion } from '../lib/marcaComoAdmin'
import {
  DIAS_PARA_INFORMAR, avisosDeRechazo, botonDeTamanio, cerrarRechazo, cuandoDeLaSalida, desdeHaceDias, estadoDeInforme,
  hora24, leerRechazosCerrados, nombreDeTamanio, quienConduce, resumenDeSoloTipos, rotuloDeLaSalida, rotuloFaltan,
  salidasSinInformar, siguienteTamanio, tamanioGuardado, textoFaltan, type ResultadoDeSalida,
} from '../lib/vistaHermanoSalidas'
import { canMarkSalidaNotHeld, canReportSalida } from '../lib/salidaPermissions'
import { crearPdfSalida, descargarPdf } from '../lib/salidaPdf'
import { InformePredicacionFlow, type InformePredicacionAction } from '../components/InformePredicacionFlow'
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
import { SimboloTerritorios } from '../components/SimboloTerritorios'
import { AvisoDeshacer } from '../components/AvisoDeshacer'
import { MarcasPendientes } from '../components/MarcasPendientes'
import { AvisoDeCopia, EstadoMapaSinSenal } from '../components/MapaSinSenal'
import {
  almacenDelTelefono,
  guardarAsignaciones,
  guardarCopiaDeMapa,
  leerAsignacionesGuardadas,
  leerCopiaDeMapa,
} from '../lib/almacenSinSenal'
import { VERSION_COPIA, pareceFaltaDeRed, type CausaDeCopia } from '../lib/copiaDeMapa'
import {
  DURACION_DESHACER_MS,
  DURACION_DESHECHA_MS,
  cambiosParaMarcar,
  entradasDeMarca,
  entradasParaDeshacer,
  textoDeMarca,
  type Alcance,
  type MarcaReciente,
} from '../lib/deshacerMarca'
import { textoDeEnvio, useModoDeEnvio } from '../lib/marcasPendientes'
import { bloquearFondo, enfocarSinMover } from '../lib/vistaHermanoFondo'
import { usePantallaEncendida } from '../lib/pantallaEncendida'
import { useMapaSinSenal } from '../lib/useMapaSinSenal'
import '../styles/vista-hermano.css'
import '../styles/vista-hermano-calle.css'
import '../styles/vista-hermano-marcado.css'
import { resumirManzana, avanceDeManzanas, textoDeCuadras, type ResumenDeManzana } from '../lib/estadoManzana'
import { elegirManzana, elegirCuadra } from '../lib/elegirCuadra'
import { describirCuadra, motivoHumano, agruparRechazadas } from '../lib/marcasRechazadas'

// Los tres mapas de la pantalla se arman igual.
//
// El nombre de la calle viene pintado adentro de la misma imagen que las
// cuadras, asi que un relleno opaco lo tacha, y parado en la esquina saber
// en que calle estas es la mitad de lo que se le pide a un mapa. La capa de
// manzanas se pinta en modo "multiply": el color se multiplica contra lo que
// hay debajo en vez de reemplazarlo, y lo oscuro de abajo -las lineas de las
// calles y sus nombres- atraviesa el color entero.
// Opciones comunes de los mapas con los que se interactúa: zoom hasta poder
// distinguir una cuadra de la de enfrente (las teselas se agrandan después
// del 19) y rueda un poco más ágil para el mouse.
const OPCIONES_MAPA: L.MapOptions = {
  zoomAnimation: false,
  maxZoom: 21,
  zoomControl: false,
  wheelPxPerZoomLevel: 70,
  // Sin esto el encuadre baja al zoom entero de abajo y el territorio queda
  // chico, en la mitad del ancho.
  zoomSnap: 0.25,
}

// Encuadrar al territorio con poco margen, en píxeles y no en proporción.
const ENCUADRE: L.FitBoundsOptions = { padding: [10, 10], animate: false }

// Lo que se puede informar al marcar. «Sin dato» quita la marca actual; eso va
// como detalle, para que el texto del botón sea corto y no se corte.
const ESTADOS_A_INFORMAR = [
  { valor: 'recorrido', texto: 'Recorrida' },
  { valor: 'no_accesible', texto: 'No accesible' },
  { valor: 'revisitar', texto: 'Para revisitar' },
  { valor: 'sin_dato', texto: 'Sin dato', detalle: 'Quita la marca actual' },
]

function ponerZoom(m: L.Map) {
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Acercar el mapa', zoomOutTitle: 'Alejar el mapa' }).addTo(m)
}

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

// Avisos de carga: se retiran solos cuando la recarga sale bien (antes
// quedaban en pantalla aunque ya estuviera todo al día).
const AVISO_PROGRAMA_LENTO = 'El programa tardó demasiado en cargar. Revisá la conexión y tocá Actualizar programa.'
const AVISO_PROGRAMA_FALLO = 'No pudimos actualizar el programa y tus asignaciones. Revisá la conexión y tocá Actualizar programa.'
const AVISO_COBERTURA_FALLO = 'No pudimos cargar la cobertura. Tocá Actualizar para volver a intentar.'
const sinAvisoDeCarga = (visto: string | null, ...retirar: string[]) => (visto && retirar.includes(visto) ? null : visto)

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
const mananaISO = () => {
  const m = new Date()
  m.setDate(m.getDate() + 1)
  return m.toLocaleDateString('sv-SE')
}

function nombreDeEstado(estado: string) {
  return estado === 'recorrido' ? 'Recorrida' : estado === 'no_accesible' ? 'No accesible' : estado === 'revisitar' ? 'Para revisitar' : 'Sin dato'
}

function textoCuadras(n: number) {
  return n === 1 ? '1 cuadra' : `${n} cuadras`
}

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

function sePuedeInformarAhora(s: Salida) {
  const scheduled = new Date(`${s.fecha}T${s.hora}:00`)
  return !Number.isNaN(scheduled.getTime()) && scheduled.getTime() <= Date.now()
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

function BotonPdfSalida({
  salida,
  contexto,
}: {
  salida: Salida
  contexto?: ContextoHermano | null
}) {
  const [preparando, setPreparando] = useState(false)
  const [fallo, setFallo] = useState(false)

  const descargar = async () => {
    setPreparando(true)
    setFallo(false)
    try {
      descargarPdf(
        await crearPdfSalida({
          title: salida.title || tituloSalida(salida, contexto),
          scheduledFor: `${salida.fecha}T${salida.hora}:00`,
          territoryName: salida.terr ? `Territorio ${salida.terr}` : tituloSalida(salida, contexto),
          driverName: salida.conductor,
          groupName: contexto?.group_number
            ? `Grupo ${contexto.group_number}`
            : contexto?.group_name,
          meetingPointName: salida.lugar,
          meetingCoords:
            salida.lat !== undefined && salida.lng !== undefined
              ? [salida.lng, salida.lat]
              : null,
          neighborhood: salida.barrio,
          priority: salida.priorizar,
          notes: salida.notes,
        }),
      )
    } catch {
      setFallo(true)
    } finally {
      setPreparando(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="boton secundario boton-pdf-salida"
        onClick={() => void descargar()}
        disabled={preparando}
      >
        <Icono nombre="descargar" tamaño={18} />
        {preparando ? 'Preparando PDF…' : 'Descargar PDF de la salida'}
      </button>
      {fallo ? (
        <p className="nota" role="alert">
          No se pudo preparar el PDF. Probá de nuevo.
        </p>
      ) : null}
    </>
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
function pinta(r: ResumenDeManzana) {
  const completa = r.tipo === 'completa'
  const media = r.tipo === 'media'
  // «No accesible» y «Para revisitar» llevan borde cortado y un signo en la
  // letra además del color: el color solo no alcanza.
  if (r.tipo === 'aparte') {
    const rev = r.aparte === 'revisitar'
    return {
      color: rev ? '#1d4f8f' : '#8a2b2b',
      relleno: rev ? '#b9d4f5' : '#f1c2c2',
      opacidad: 0.85,
      guiones: rev ? '8 5' : '2 6',
      signo: rev ? ' ↻' : ' ✕',
    }
  }
  // Rellenos claros: el modo "multiply" los oscurece contra el mapa, asi que
  // un color que ya viene fuerte termina en una mancha donde no se lee nada.
  // Sin recorrer no lleva casi color: el estado que importa es el otro.
  return {
    color: completa ? '#0f6b47' : media ? '#955408' : '#16191d',
    relleno: completa ? '#8fe0b6' : media ? '#ffd79a' : '#e4e8ec',
    opacidad: completa ? 0.9 : media ? 0.9 : 0.75,
    guiones: undefined as string | undefined,
    signo: '',
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
  estados: Record<string, string>,
) {
  // Tocar el mapa lo resuelve un solo manejador del mapa (elige la manzana o
  // cuadra más cercana al toque), así que acá nada se toca.
  for (const mz of manzanas) {
    if (!mz.geometry_geojson) continue
    const anillo = anilloDe(mz.geometry_geojson)
    const c = pinta(resumirManzana(ladosDe(mz).map((l) => l.id), estados))
    L.polygon(anillo, {
      color: c.color,
      weight: 2,
      dashArray: c.guiones,
      fillColor: c.relleno,
      fillOpacity: c.opacidad,
      interactive: false,
    }).addTo(capa)
    L.marker(centroDe(anillo), {
      interactive: false,
      icon: etiqueta(`${mz.label}${c.signo}`, c.color),
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

// Cuánto se espera al mapa del territorio antes de usar la copia guardada en
// el teléfono. Con una barra de señal la consulta puede no fallar nunca y
// tampoco volver: sin límite, la pantalla se quedaba en "Cargando el mapa…".
const LIMITE_CARGA_MAPA_MS = 12_000

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
    try { return tamanioGuardado(localStorage.getItem(TAMANIO_GUARDADO)) } catch { return 1 }
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
  // Un administrador de territorios puede abrir y marcar uno que no es suyo con
  // /predicacion?territorio=<id>. Para el resto el parámetro no hace nada.
  const territorioPedido = useMemo(
    () => territorioDeLaDireccion(typeof window === 'undefined' ? '' : window.location.search),
    [],
  )
  const comoAdmin = marcaComoAdmin({ perfil: profile, territorioPedido, territorioAbierto: miTerritorio?.id, esPropio: asignado })
  const puedeTrabajar = asignado || comoAdmin
  // Lo que los efectos de carga leen al terminar sin tener que volver a correr
  // cada vez que cambia: si cambiara `asignado`, se volvería a pedir el mapa.
  const asignadoRef = useRef(false)
  asignadoRef.current = asignado
  const perfilIdRef = useRef<string | undefined>(undefined)
  perfilIdRef.current = profile?.id
  // Qué territorio ya tiene su dibujo en pantalla. Mientras se vuelve a pedir
  // el mismo, el mapa sigue disponible para marcar: antes cada confirmación
  // del servidor lo apagaba hasta que terminaba la consulta, y con poca señal
  // eso son segundos con el dedo sin respuesta.
  const territorioCargado = useRef<string | null>(null)
  // Cuando el mapa sale de la copia del teléfono y no de la base.
  const [desdeCopia, setDesdeCopia] = useState<{ territorioId: string; guardadoEl: string; causa: CausaDeCopia } | null>(null)
  // La última marca, para "Deshacer".
  const [reciente, setReciente] = useState<MarcaReciente | null>(null)
  const numeroDeMarca = useRef(0)
  // Guardar el mapa para usar sin señal arranca cuando abre su territorio, no
  // al abrir la app: quien viene por la salida de hoy no necesita bajar el mapa.
  const [territorioAbierto, setTerritorioAbierto] = useState(false)
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
  const [salidas, setSalidas] = useState<Salida[]>([])
  const [salidasPrevias, setSalidasPrevias] = useState<Salida[]>([])
  const [resultadosSalidas, setResultadosSalidas] = useState<Map<string, ResultadoDeSalida>>(new Map())
  const [nombresInformantes, setNombresInformantes] = useState<Record<string, string>>({})
  const [resultadosLeidos, setResultadosLeidos] = useState(false)
  const [rechazosCerrados, setRechazosCerrados] = useState<Set<string>>(() => new Set())
  const [origenSalidas, setOrigenSalidas] = useState<'base' | 'archivo' | null>(null)
  const [recorte, setRecorte] = useState<{ trajo: number; hay: number } | null>(null)
  const [cargando, setCargando] = useState(true)
  // El territorio cuyo mapa no se pudo traer ni de la base ni de la copia.
  const [mapaFallo, setMapaFallo] = useState<string | null>(null)
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

  // Solo se marca el territorio propio. Los demas se miran: la cobertura de
  // un territorio ajeno no la informa quien pasa a ver como es.
  const [abierta, setAbierta] = useState<string | null>(null)
  const [hoja, setHoja] = useState<{ salida?: Salida; propio?: boolean } | null>(null)
  const [informe, setInforme] = useState<{ salida: Salida; action: InformePredicacionAction } | null>(null)
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
    puedeTrabajar && Boolean(miTerritorio) && dibujoListo && !cola.error && !esMiembroPendiente(contexto)
  const editando = puedeMarcar && marcando

  // Recuperar una asignación o cambiar de territorio nunca reactiva por sí
  // solo el modo de escritura que se abrió sobre otro contexto.
  useEffect(() => { setMarcando(false) }, [miTerritorio?.id, asignado, comoAdmin, profile?.id])

  // La pantalla no se apaga mientras el mapa propio está a la vista en modo
  // marcar. (El mapa grande solo se abre desde esta misma pestaña.)
  usePantallaEncendida(editando && vista === 'territorio')

  useEffect(() => { if (vista === 'territorio') setTerritorioAbierto(true) }, [vista])

  // El mapa de la copia vale solo para el territorio que se guardó.
  const copiaVisible = desdeCopia && desdeCopia.territorioId === miTerritorio?.id ? desdeCopia : null

  // Guardar las teselas para usar sin señal. Si el mapa está saliendo de la
  // copia es que no hay red: no hay nada que bajar.
  const mapaSinSenal = useMapaSinSenal({
    activo: asignado && territorioAbierto && dibujoListo && !copiaVisible && manzanas.length > 0,
    userId: profile?.id,
    territorioId: miTerritorio?.id,
    manzanas,
  })

  // Marcas que esperan señal, con "Todo enviado" cuando se vacía la cola.
  // Las rechazadas para siempre van en su propio panel; acá solo las que
  // siguen en camino, y «sin enviar» es la que ya falló y espera reintento.
  const enCaminoLista = cola.events.filter((event) => event.status !== 'error')
  const marcasEnCola = enCaminoLista.length
  const marcasConError = enCaminoLista.some((event) => event.lastError)
  const modoDeEnvio = useModoDeEnvio(marcasEnCola)

  // Deshacer dura ocho segundos; la confirmación, unos pocos. No hay aviso si
  // ya no se puede marcar.
  useEffect(() => {
    if (!reciente) return
    const timer = window.setTimeout(
      () => setReciente(null),
      reciente.fase === 'reciente' ? DURACION_DESHACER_MS : DURACION_DESHECHA_MS,
    )
    return () => window.clearTimeout(timer)
  }, [reciente])
  useEffect(() => { if (!puedeMarcar) setReciente(null) }, [puedeMarcar])

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
  // Cómo está cada manzana: «No accesible» y «Para revisitar» cuentan como
  // resueltas (no como «te falta»), pero se ven aparte.
  const resumenDe = useCallback(
    (mz: Manzana) => resumirManzana(ladosDe(mz).map((l) => l.id), estados),
    [ladosDe, estados],
  )

  const avance = useMemo(() => {
    const resumen = coverageSummary(lados, estados)
    const { completas, aparte, empezadas, faltan } = avanceDeManzanas(manzanas.map(resumenDe))
    return {
      metros: resumen.totalMeters,
      metrosHechos: resumen.walkedMeters,
      pct: resumen.percent,
      estados: resumen.counts,
      completas,
      aparte,
      empezadas,
      faltan,
    }
  }, [manzanas, resumenDe, lados, estados])

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

      // Lo que se asignó queda guardado en el teléfono: si la próxima vez que
      // se abra no hay señal, el territorio propio se puede abrir igual.
      if (profile?.id) {
        const activas = propias.filter((r) => r.status === 'activa' && r.assigned_to === profile.id)
        void guardarAsignaciones(almacenDelTelefono(), {
          version: VERSION_COPIA,
          userId: profile.id,
          guardadoEl: new Date().toISOString(),
          reservas: activas,
          territorios: lista.filter((t) => activas.some((r) => r.territory_id === t.id)),
        })
      }

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
      setAviso((visto) => sinAvisoDeCarga(visto, AVISO_PROGRAMA_LENTO, AVISO_PROGRAMA_FALLO))
      } catch (failure) {
        if (vivo) setAviso(
          failure instanceof Error && failure.message === MENSAJE_CARGA_PROGRAMA_LENTA
            ? AVISO_PROGRAMA_LENTO
            : AVISO_PROGRAMA_FALLO,
        )
        // Sin señal, el territorio propio se abre con lo último que se guardó.
        const guardadas = vivo && profile?.id
          ? await leerAsignacionesGuardadas<ReservaPropia, Territorio>(almacenDelTelefono(), profile.id)
          : null
        if (vivo && guardadas?.reservas.length) {
          setTerritorios((actual) => (actual.length ? actual : guardadas.territorios))
          setReservas((actual) => (actual.length ? actual : guardadas.reservas))
          setMiTerritorio((actual) =>
            actual ?? guardadas.territorios.find((t) => t.id === guardadas.reservas[0].territory_id) ?? null,
          )
        }
      } finally {
        if (vivo) setCargando(false)
      }
    })()

    return () => {
      vivo = false
    }
  }, [profile?.id, revision])

  // /predicacion?territorio=<id>: solo un administrador de territorios abre y
  // marca un territorio que no es suyo. Para el resto no pasa nada.
  useEffect(() => {
    let almacen: Storage | null = null
    try { almacen = window.localStorage } catch { /* sin almacenamiento */ }
    setRechazosCerrados(leerRechazosCerrados(almacen, profile?.id))
  }, [profile?.id])
  const territorioAplicado = useRef(false)
  useEffect(() => {
    if (territorioAplicado.current || !territorioPedido || !esAdminQueMarca(profile)) return
    const pedido = territorios.find((t) => t.id.toLowerCase() === territorioPedido)
    if (!pedido) return
    territorioAplicado.current = true
    setMiTerritorio(pedido)
    setVista('territorio')
  }, [territorioPedido, territorios, profile])

  // Las salidas de los últimos días que le tocaron al conductor, y qué informes
  // hay de ellas y de las de hoy (quién informó). Si algo no se puede leer, no
  // se dice «sin informar»: no se sabe.
  useEffect(() => {
    if (!supabase || !profile?.id) return
    let vivo = true
    void (async () => {
      try {
        const hoy0 = desdeHaceDias(new Date(), 0)
        let previas: Salida[] = []
        if (profile.driver_id) {
          const res = await supabase
            .from('salidas')
            .select(CAMPOS_SALIDA)
            .eq('driver_id', profile.driver_id)
            .gte('scheduled_for', desdeHaceDias(new Date(), DIAS_PARA_INFORMAR).toISOString())
            .lt('scheduled_for', hoy0.toISOString())
            .order('scheduled_for', { ascending: false })
            .limit(60)
          if (res.error) throw res.error
          previas = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((f) => comoSalida(f, territorios))
        }
        const hoy = hoyISO()
        const ids = [...new Set([
          ...previas.map((s) => s.id),
          ...salidas.filter((s) => s.fecha <= hoy).map((s) => s.id),
        ].filter((x): x is string => Boolean(x)))]
        const mapa = new Map<string, ResultadoDeSalida>()
        if (ids.length) {
          const r = await supabase
            .from('salida_resultado_actual')
            .select('salida_id, estado, informado_por')
            .in('salida_id', ids)
          if (r.error) throw r.error
          for (const fila of (r.data ?? []) as ResultadoDeSalida[]) mapa.set(fila.salida_id, fila)
        }
        const quienes = [...new Set([...mapa.values()].map((x) => x.informado_por).filter((x): x is string => Boolean(x)))]
        const nombres: Record<string, string> = {}
        if (quienes.length) {
          const { data: perfiles } = await supabase.from('profiles').select('id, full_name').in('id', quienes)
          for (const f of (perfiles ?? []) as { id: string; full_name: string | null }[]) if (f.full_name) nombres[f.id] = f.full_name
        }
        if (!vivo) return
        setSalidasPrevias(previas)
        setResultadosSalidas(mapa)
        setNombresInformantes(nombres)
        setResultadosLeidos(true)
      } catch {
        if (vivo) { setResultadosLeidos(false); setSalidasPrevias([]) }
      }
    })()
    return () => { vivo = false }
  }, [profile?.id, profile?.driver_id, territorios, salidas, revision])

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
      territorioCargado.current = null
      setManzanas([])
      setLados([])
      setEstadosBase({})
      setDibujoListo(false)
      return
    }
    // Volver a pedir el mismo territorio no apaga el mapa que ya está a la vista.
    if (territorioCargado.current !== miTerritorio.id) setDibujoListo(false)
    setMapaFallo(null)

    void (async () => {
      try {
      const checkpoint = checkpointCola()
      // Sin conexión no hay nada que esperar: se pasa directo a la copia.
      if (!navigator.onLine) throw new Error('Sin conexión')
      const [mzRes, ldRes, cbRes] = await conLimiteDeCarga(Promise.all([
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
      ]), LIMITE_CARGA_MAPA_MS)
      if (!vivo) return
      if (mzRes.error) throw mzRes.error
      const manzanasNuevas = (mzRes.data as Manzana[]) ?? []
      const ladosNuevos = (ldRes.data as Lado[]) ?? []
      const estadosNuevos: Record<string, string> = Object.fromEntries(cbRes.data.map((c)=>[c.lado_id,c.estado]))
      setManzanas(manzanasNuevas)
      setLados(ladosNuevos)
      setEstadosBase(estadosNuevos)
      setDesdeCopia(null)
      acknowledgeSnapshot(checkpoint)
      territorioCargado.current = miTerritorio.id
      setMapaFallo(null)
      setAviso((visto) => sinAvisoDeCarga(visto, AVISO_COBERTURA_FALLO))
      setDibujoListo(true)
      // Lo que acaba de llegar queda en el teléfono, con la fecha, para poder
      // abrir el mapa sin señal. Solo el territorio propio: el de consulta no.
      if (asignadoRef.current && perfilIdRef.current) {
        void guardarCopiaDeMapa(almacenDelTelefono(), {
          version: VERSION_COPIA,
          userId: perfilIdRef.current,
          territorioId: miTerritorio.id,
          territorioNombre: miTerritorio.name,
          guardadoEl: new Date().toISOString(),
          manzanas: manzanasNuevas,
          lados: ladosNuevos,
          estados: estadosNuevos,
        })
      }
      } catch (falla) {
        if (!vivo) return
        // Una recarga que falla con conexión (por ejemplo, justo mientras se
        // guarda una marca) no cambia lo que ya se ve: antes caía a la copia y
        // decía «Sin señal» con la señal bien. Sin conexión sí se usa la copia.
        if (navigator.onLine && territorioCargado.current === miTerritorio.id) return
        const idPerfil = perfilIdRef.current
        const copia = idPerfil
          ? await leerCopiaDeMapa<Manzana, Lado>(almacenDelTelefono(), idPerfil, miTerritorio.id)
          : null
        if (!vivo) return
        if (copia) {
          // El avance que se marcó sin señal sigue en la cola y se le suma encima.
          setManzanas(copia.manzanas)
          setLados(copia.lados)
          setEstadosBase(copia.estados)
          setDesdeCopia({
            territorioId: miTerritorio.id,
            guardadoEl: copia.guardadoEl,
            causa: !navigator.onLine && pareceFaltaDeRed(falla, false) ? 'red' : 'otra',
          })
          territorioCargado.current = miTerritorio.id
          setMapaFallo(null)
          setDibujoListo(true)
        } else {
          setAviso(AVISO_COBERTURA_FALLO)
          setMapaFallo(miTerritorio.id)
        }
      }
    })()

    return () => {
      vivo = false
    }
  }, [miTerritorio, revision, cola.remoteRevision, checkpointCola, acknowledgeSnapshot])

  // --------------------------------------------------------- marcar
  // La bitácora es de solo agregar: desmarcar no borra el evento anterior,
  // informa uno nuevo que dice "sin_dato". La historia queda.
  const informar = useCallback(
    async (afectados: Lado[], alcance: Alcance) => {
      if (!editando || !miTerritorio || !profile?.id || !afectados.length || encolando.current) return
      encolando.current = true
      try {
        // Se revisan todas antes de encolar la primera: una cuadra sin versión
        // de dibujo no deja la manzana a medio marcar.
        const cambios = cambiosParaMarcar(afectados, estadoElegido, estados)
        for (const entrada of conOrigenAdmin(entradasDeMarca(cambios, estadoElegido, miTerritorio.id, profile.id), comoAdmin)) {
          await enqueue(entrada)
        }
        setAviso(null)
        // Un toque de más se arregla en el momento: "Marcaste ... · Deshacer".
        if (cambios.length) {
          setReciente({ id: ++numeroDeMarca.current, texto: textoDeMarca(estadoElegido, alcance), cambios, fase: 'reciente' })
        }
      } catch (failure) {
        setAviso(failure instanceof Error ? failure.message : 'No se pudo conservar la marca. Las anteriores siguen pendientes.')
      } finally {
        encolando.current = false
        void sync()
      }
    },
    [editando, miTerritorio, profile?.id, estados, estadoElegido, enqueue, sync, comoAdmin],
  )

  // Deshacer es otro evento por cada cuadra que la marca cambió, devolviéndola
  // al estado que tenía (casi siempre "sin dato", igual que al desmarcar). No
  // se borra nada: la bitácora es de solo agregar.
  const deshacerUltima = useCallback(async () => {
    if (reciente?.fase !== 'reciente' || !puedeMarcar || !miTerritorio || !profile?.id || encolando.current) return
    encolando.current = true
    try {
      for (const entrada of conOrigenAdmin(entradasParaDeshacer(reciente.cambios, miTerritorio.id, profile.id), comoAdmin)) {
        await enqueue(entrada)
      }
      setAviso(null)
      setReciente({ ...reciente, fase: 'deshecha' })
    } catch (failure) {
      setAviso(failure instanceof Error ? failure.message : 'No se pudo deshacer la marca. Probá de nuevo.')
    } finally {
      encolando.current = false
      void sync()
    }
  }, [reciente, puedeMarcar, miTerritorio, profile?.id, enqueue, sync, comoAdmin])

  const marcarManzana = useCallback(
    (mz: Manzana) => {
      const propios = ladosDe(mz)
      void informar(propios, { tipo: 'manzana', etiqueta: mz.label })
    },
    [ladosDe, informar],
  )

  const marcarLado = useCallback(
    (lado: Lado) => void informar(
      [lado],
      {
        tipo: 'cuadra',
        numero: lado.orden + 1,
        etiqueta: manzanas.find((mz) => mz.id === lado.manzana_id)?.label ?? '',
      },
    ),
    [informar, manzanas],
  )

  // ----------------------------------------------------------- mapas
  const dibujarPropio = useCallback(
    (capa: L.LayerGroup) => {
      pintarManzanas(capa, manzanas, ladosDe, estados)

      // En «Por cuadra» y marcando se ven todas las cuadras. En «Manzana
      // entera» (o mirando) igual se ven las que tienen una marca: antes
      // desaparecían y una cuadra no accesible dentro de una manzana quedaba
      // invisible.
      const todas = editando && modoMarcar === 'lado'

      for (const mz of manzanas) {
        if (!mz.geometry_geojson) continue
        const centro: [number, number] = [Number(mz.lat), Number(mz.lng)]
        for (const lado of ladosDe(mz)) {
          const linea = lado.geometry_geojson.coordinates.map(([x, y]: [number, number]) =>
            haciaAdentro([y, x], centro),
          )
          const estado = estados[lado.id]
          if (!todas && (!estado || estado === 'sin_dato')) continue
          const ok = estado === 'recorrido'
          // Además del color, la trama: raya cortada para «No accesible» y
          // larga para «Para revisitar».
          const color = ok ? '#0f6b47' : estado === 'no_accesible' ? '#8a2b2b' : estado === 'revisitar' ? '#1d4f8f' : '#6a6e77'
          const guiones = estado === 'no_accesible' ? '2 7' : estado === 'revisitar' ? '12 7' : undefined
          // Elegir la cuadra lo hace el manejador del mapa, con la más cercana al toque.
          L.polyline(linea, {
            color,
            weight: ok || guiones ? 7 : 5,
            opacity: ok || guiones ? 1 : 0.75,
            dashArray: guiones,
            interactive: false,
          }).addTo(capa)
        }
      }
    },
    [manzanas, ladosDe, estados, modoMarcar, editando],
  )

  // Un toque en el mapa elige la manzana o la cuadra MÁS CERCANA, aunque haya
  // caído en la calle de al lado: la zona de toque era una franja de 26 px y
  // con el mouse o el dedo era fácil errarle. La calcula en píxeles de pantalla.
  const resolverToque = useCallback(
    (mapaVivo: L.Map, punto: L.Point) => {
      if (!editando) return
      const proyectar = (la: number, ln: number) => {
        const q = mapaVivo.latLngToContainerPoint([la, ln])
        return { x: q.x, y: q.y }
      }
      const p = { x: punto.x, y: punto.y }
      if (modoMarcar === 'manzana') {
        const mz = elegirManzana(
          p,
          manzanas.filter((m) => m.geometry_geojson).map((m) => ({
            item: m,
            anillo: anilloDe(m.geometry_geojson!).map(([la, ln]) => proyectar(la, ln)),
          })),
        )
        if (mz) marcarManzana(mz)
        return
      }
      const candidatas: Array<{ item: Lado; linea: Array<{ x: number; y: number }> }> = []
      for (const mz of manzanas) {
        if (!mz.geometry_geojson) continue
        const centro: [number, number] = [Number(mz.lat), Number(mz.lng)]
        for (const lado of ladosDe(mz)) {
          candidatas.push({
            item: lado,
            linea: lado.geometry_geojson.coordinates.map(([x, y]: [number, number]) => {
              const [la, ln] = haciaAdentro([y, x], centro)
              return proyectar(la, ln)
            }),
          })
        }
      }
      const lado = elegirCuadra(p, candidatas)
      if (lado) marcarLado(lado)
    },
    [editando, modoMarcar, manzanas, ladosDe, marcarManzana, marcarLado],
  )
  // Los mapas se arman una vez; siempre llaman a la versión de este render.
  const toqueRef = useRef(resolverToque)
  toqueRef.current = resolverToque
  const alTocarMapa = useCallback((m: L.Map, p: L.Point) => toqueRef.current(m, p), [])

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
      const m = L.map(cajaMapa.current, { ...OPCIONES_MAPA, scrollWheelZoom: false })
      m.fitBounds(encuadre, ENCUADRE)
      ponerFondo(m)
      ponerZoom(m)
      m.on('click', (e: L.LeafletMouseEvent) => alTocarMapa(m, e.containerPoint))
      capa.current = L.layerGroup().addTo(m)
      mapa.current = m
      setMapaListo(true)
    }
    const m = mapa.current
    // El encuadre se calcula antes de crear el mapa y se rehace cuando la
    // caja ya tiene su tamaño: una pestaña oculta mide cero.
    window.setTimeout(() => {
      m.invalidateSize({ animate: false, pan: false })
      m.fitBounds(encuadre, ENCUADRE)
    }, 60)
  }, [vista, encuadre, alTocarMapa])

  // Al cerrar el mapa grande (o volver a esta pestaña) el mapa chico se
  // rehace: sin esto quedaba sin fondo y con las letras amontonadas hasta
  // cambiar de pestaña, porque Leaflet no se entera de que la caja cambió de
  // tamaño detrás de la pantalla completa.
  useEffect(() => {
    if (hoja || vista !== 'territorio' || !encuadre) return
    const m = mapa.current
    if (!m) return
    const rehacer = () => {
      if (mapa.current !== m) return
      m.invalidateSize({ animate: false, pan: false })
      m.fitBounds(encuadre, ENCUADRE)
    }
    const timers = [0, 150, 500].map((ms) => window.setTimeout(rehacer, ms))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [hoja, vista, encuadre])

  // Y si la caja cambia de tamaño por cualquier otra cosa (girar el teléfono,
  // aparecer el teclado), el mapa se entera.
  useEffect(() => {
    const m = mapa.current
    const caja = cajaMapa.current
    if (!m || !caja || !mapaListo || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (mapa.current === m) m.invalidateSize({ animate: false, pan: false }) })
    ro.observe(caja)
    return () => ro.disconnect()
  }, [mapaListo, vista])

  // Marcando se puede acercar con la rueda (en la computadora) y el doble clic
  // no acerca: dos clics seguidos eran un doble toque, no un zoom. Sin marcar,
  // la rueda sigue siendo para desplazar la página.
  useEffect(() => {
    const m = mapa.current
    if (!m || !mapaListo) return
    if (editando) { m.scrollWheelZoom.enable(); m.doubleClickZoom.disable() }
    else { m.scrollWheelZoom.disable(); m.doubleClickZoom.enable() }
    m.getContainer().classList.toggle('mapaMarcando', editando)
  }, [editando, mapaListo])

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

  // Marcas rechazadas para siempre: no cuentan como «pendientes».
  const rechazadas = cola.events.filter((event) => event.status === 'error')
  const enCamino = cola.events.length - rechazadas.length

  const devolverTerritorio = async () => {
    const reserva = reservas.find(r => r.status === 'activa' && r.assigned_to === profile?.id && r.territory_id === miTerritorio?.id)
    if (!supabase || !reserva || devolviendo) return
    if (cola.events.some(event => event.territory_id === reserva.territory_id && event.status !== 'error') || cola.error || encolando.current) {
      setAviso('Antes de devolver el territorio, esperá a que se envíen las marcas pendientes.')
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
  const manana = mananaISO()
  const miDriverId = profile?.driver_id ?? null
  const informadas = new Set([...resultadosSalidas.values()].filter((r) => r.estado !== 'sin_dato').map((r) => r.salida_id))
  const sinInformar = salidasSinInformar(
    showQA ? salidasPrevias : salidasPrevias.filter((s) => !isSyntheticQaOuting(s)),
    informadas, miDriverId, hoy,
  )
  const informeDe = (s: Salida) => {
    const e = estadoDeInforme(s.id, resultadosSalidas, nombresInformantes, resultadosLeidos)
    // «Sin informar» de una salida que todavía no empezó no dice nada.
    return e && (e.informada || sePuedeInformarAhora(s)) ? e : null
  }
  const rechazosAMostrar = avisosDeRechazo(reservas, profile?.id, rechazosCerrados)

  const resumenHoy = deHoy.length
    ? !deHoy.some((s) => !s.tipo)
      ? resumenDeSoloTipos(deHoy)
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

  // Los tres avisos de abajo. Son siempre los mismos y se muestran en la
  // pagina o dentro del mapa grande, segun cual este a la vista. El estado
  // vive aca arriba, asi que cambiarlos de lugar no los reinicia.
  const enMapa = vista === 'territorio' || Boolean(hoja)
  // Un solo aviso por vez. Prioridad: Deshacer > enviando > sin señal.
  const hayDeshacer = enMapa && Boolean(reciente)
  const hayEnvio = !hayDeshacer && Boolean(textoDeEnvio(modoDeEnvio, { cantidad: marcasEnCola, conError: marcasConError, enLinea: online }))
  const avisosCalle = (
    <>
      <AvisoDeCopia copia={enMapa && !hayDeshacer && !hayEnvio ? copiaVisible : null} />
      <MarcasPendientes
        modo={hayDeshacer ? 'oculto' : modoDeEnvio}
        cantidad={marcasEnCola}
        conError={marcasConError}
        enLinea={online}
        onReintentar={() => void cola.retry()}
      />
      <AvisoDeshacer marca={enMapa ? reciente : null} onDeshacer={() => void deshacerUltima()} />
    </>
  )

  return (
    <div className="vh" style={escala} data-texto={nombreDeTamanio(paso)}>
      <header className="barra">
        <span className="marca">
          <SimboloTerritorios tamaño={36} />
          Territorios
        </span>
        <div className="barra-controles">
          <MiCuenta key={profile?.id} compact />
          <button
            className="btnIcono btnTamanio"
            aria-label={botonDeTamanio(paso).etiqueta}
            onClick={() =>
              setPaso((p) => {
                const n = siguienteTamanio(p)
                try { localStorage.setItem(TAMANIO_GUARDADO, String(n)) } catch { /* sin almacenamiento */ }
                return n
              })
            }
          >
            {/* Siempre dice «Letra» y, abajo, cómo está ahora. */}
            <span>{botonDeTamanio(paso).texto}</span>
            <small>{botonDeTamanio(paso).nivel}</small>
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
      <div className="hoja" hidden={!cola.error && !cola.events.length && !cola.sending}>
        {cola.error && <p className="nota" role="alert">{cola.error}</p>}
        {(enCamino > 0 || cola.sending) && (
          <p role="status">
            {cola.sending ? 'Enviando marcas… ' : ''}
            {enCamino > 0 && `${enCamino === 1 ? '1 marca guardada' : `${enCamino} marcas guardadas`} en este dispositivo, esperando enviarse. Se reintentan solas.`}
          </p>
        )}
        {/* Las que el servidor rechazó no se arreglan esperando: se pueden
            descartar. Van plegadas y por manzana para no empujar la pantalla. */}
        {rechazadas.length > 0 && (
          <details className="rechazadas">
            <summary>
              <Icono nombre="error" tamaño={22} />
              {rechazadas.length === 1 ? '1 marca que no se pudo enviar' : `${rechazadas.length} marcas que no se pudieron enviar`}
            </summary>
            <div className="rechazadasCuerpo">
              <p className="sub">El servidor no las aceptó. Podés intentar de nuevo o descartarlas; las demás marcas siguen su camino.</p>
              {agruparRechazadas(rechazadas, manzanas).map((g) => (
                <div className="grupoRechazado" key={g.clave}>
                  <h3>{g.titulo}</h3>
                  {rechazadas.filter((e) => g.ids.includes(e.id)).map((e) => (
                    <p className="marcaRechazada" key={e.id}>
                      <span>
                        {describirCuadra(e, manzanas, lados)}. {e.origen === 'admin' && e.lastError === MENSAJE_FALTA_HABILITAR_ADMIN ? e.lastError : motivoHumano(e.lastError)}
                      </span>
                      <button type="button" className="botonChico" onClick={() => void cola.discard([e.id])}>Descartar</button>
                    </p>
                  ))}
                </div>
              ))}
              <div className="botonesRechazadas">
                <button className="boton secundario" disabled={cola.sending} onClick={() => void cola.retry()}>
                  <Icono nombre="reintentar" tamaño={18} />Intentar de nuevo
                </button>
                <button
                  className="boton secundario"
                  onClick={() => {
                    if (window.confirm(`¿Descartar ${rechazadas.length === 1 ? 'esta marca' : `estas ${rechazadas.length} marcas`}? No se envían y el mapa vuelve a como lo tiene el servidor.`)) void cola.discard()
                  }}
                >
                  Descartar todas
                </button>
              </div>
            </div>
          </details>
        )}
        {enCamino > 0 && <p className="sub">El mapa puede incluir avance pendiente. No borres los datos del navegador hasta que termine el envío.</p>}
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

        {sinInformar.length > 0 && canReportSalida(profile, miDriverId, contexto?.puede_informar_salidas) ? (
          <section className="panel sinInformar" aria-label="Te quedó sin informar">
            <h2>Te quedó sin informar</h2>
            <p className="sub">
              {sinInformar.length === 1 ? 'Una salida de estos días no tiene informe.' : `${sinInformar.length} salidas de estos días no tienen informe.`}
            </p>
            {sinInformar.map((s) => (
              <div className="salidaSinInformar" key={s.id}>
                <p>
                  <strong>{cuandoDeLaSalida(comoSeLlamaElDia(s.fecha) ?? fechaLarga(s.fecha), s.hora)}</strong>
                  <span>{tituloSalida(s, contexto)}</span>
                </p>
                <button className="boton principal" onClick={() => setInforme({ salida: s, action: sinMapaLaSalida(s) ? 'resultado' : 'recorrido' })}>
                  <Icono nombre="completo" tamaño={18} />
                  {sinMapaLaSalida(s) ? 'Informar cómo salió' : 'Informar predicación'}
                </button>
                {!sinMapaLaSalida(s) ? (
                  <button className="boton secundario" onClick={() => setInforme({ salida: s, action: 'resultado' })}>
                    Informar solo el resultado
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {paneles.includes('sosConductor') && salidasVisibles.some((s) => s.driverId === profile?.driver_id && s.fecha >= hoyISO()) ? (
          <section className="tarjeta lima">
            <p className="rotulo">Sos el conductor</p>
            {salidasVisibles
              .filter((s) => s.driverId === profile?.driver_id && s.fecha >= hoyISO())
              .slice(0, 1)
              .map((s) => (
                <div key={s.id ?? s.hora}>
                  <p className="numeroGrande">{s.hora} <small>{comoSeLlamaElDia(s.fecha) ?? fechaLarga(s.fecha)}</small></p>
                  <p>{tituloSalida(s, contexto)}</p>
                  <EstadoInforme dato={informeDe(s)} />
                  {yaEmpezo(s) && s.id ? (
                    <>
                      <button className="boton principal" onClick={() => setInforme({ salida: s, action: sinMapaLaSalida(s) ? 'resultado' : 'recorrido' })}>
                        <Icono nombre="completo" tamaño={18} />
                        {sinMapaLaSalida(s) ? 'Informar cómo salió' : 'Informar predicación'}
                      </button>
                      {!sinMapaLaSalida(s) ? (
                        <button className="boton secundario" onClick={() => setInforme({ salida: s, action: 'resultado' })}>
                          Informar solo el resultado
                        </button>
                      ) : null}
                    </>
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
            rotulo={rotuloDeLaSalida(destacada.fecha, hoy, manana)}
            miDriverId={miDriverId}
            informe={informeDe(destacada)}
            onMapa={() => setHoja({ salida: destacada })}
            onInformar={(action) => setInforme({ salida: destacada, action })}
            puedeInformar={Boolean(destacada.id) && canReportSalida(profile, destacada.driverId, contexto?.puede_informar_salidas)}
            puedeMarcarNoRealizada={canMarkSalidaNotHeld(profile, destacada.driverId, contexto?.puede_abrir_panel)}
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
                miDriverId={miDriverId}
                informe={informeDe(s)}
                abierta={abierta === `hoy-${i}`}
                onAbrir={() => setAbierta(abierta === `hoy-${i}` ? null : `hoy-${i}`)}
                onMapa={() => setHoja({ salida: s })}
                onInformar={(action) => setInforme({ salida: s, action })}
                puedeInformar={Boolean(s.id) && canReportSalida(profile, s.driverId, contexto?.puede_informar_salidas)}
                puedeMarcarNoRealizada={canMarkSalidaNotHeld(profile, s.driverId, contexto?.puede_abrir_panel)}
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
                      ? `${textoFaltan(1)}.`
                      : `${textoFaltan(avance.faltan)}.`}
              </p>
              {!sinDibujo && (
                <>
                  <div className="barraProgreso sobreClaro">
                    <i style={{ width: `${avance.pct ?? 0}%` }} />
                  </div>
                  <p className="pieProgreso sobreClaro">
                    {avance.completas} de {manzanas.length} recorridas · {avance.pct === null ? 'Sin información suficiente' : `${avance.pct}% de los metros`}
                  </p>
                  <button className="boton principal tinta" onClick={() => setVista('territorio')}>
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
                Mis salidas
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
            miDriverId={miDriverId}
            informeDe={informeDe}
            abierta={abierta}
            setAbierta={setAbierta}
            onMapa={(s) => setHoja({ salida: s })}
            onInformar={(s, action) => setInforme({ salida: s, action })}
            puedeInformar={(s) => Boolean(s.id) && canReportSalida(profile, s.driverId, contexto?.puede_informar_salidas)}
            puedeMarcarNoRealizada={(s) => canMarkSalidaNotHeld(profile, s.driverId, contexto?.puede_abrir_panel)}
          />
        </div>
      </section>

      {/* ----------------------------------------------------- TERRITORIO */}
      <section className={vista === 'territorio' ? 'vista activa hoja' : 'vista hoja'}>
        {(comoAdmin || reservas.some((r) => r.status === 'activa' && r.assigned_to === profile?.id)) && (
          <ElegirDeLista
            etiqueta="Mis territorios asignados"
            valor={asignado || comoAdmin ? miTerritorio?.id ?? '' : ''}
            vacio="Elegí tu territorio…"
            alElegir={(valor) => {
              // No se apaga el dibujo acá: si se elige el mismo territorio no hay
              // nada que recargar y quedaría «Cargando el mapa…» para siempre.
              // El efecto de carga ya lo apaga cuando de verdad cambia.
              setMarcando(false)
              setMiTerritorio(territorios.find((t) => t.id === valor) ?? null)
            }}
            opciones={[
              // Como administrador el territorio abierto (?territorio=) puede no
              // ser de los asignados: va primero, para que el selector diga
              // cuál se está viendo y no «Elegí tu territorio…».
              ...(comoAdmin && miTerritorio && !reservas.some((r) => r.status === 'activa' && r.assigned_to === profile?.id && r.territory_id === miTerritorio.id)
                ? [{ valor: miTerritorio.id, texto: `Territorio ${miTerritorio.name}`, detalle: 'Lo abriste como administrador' }]
                : []),
              ...reservas
                .filter((r) => r.status === 'activa' && r.assigned_to === profile?.id)
                .map((r) => ({
                  valor: r.territory_id,
                  texto: `Territorio ${territorios.find((t) => t.id === r.territory_id)?.name ?? 'sin nombre'}`,
                })),
            ]}
          />
        )}
        {rechazosAMostrar.map((r) => (
          <div className="nota notaCerrable" key={r.id} role="status">
            <span>Tu pedido del territorio {territorios.find((t) => t.id === r.territory_id)?.name ?? 'sin nombre'} no fue aprobado: {r.nota || 'Consultá al administrador.'}</span>
            <button
              type="button"
              className="botonChico"
              onClick={() => {
                let almacen: Storage | null = null
                try { almacen = window.localStorage } catch { /* sin almacenamiento */ }
                setRechazosCerrados(cerrarRechazo(almacen, profile?.id, r.id))
              }}
            >
              <Icono nombre="cerrar" tamaño={18} />
              Cerrar aviso
            </button>
          </div>
        ))}
        {comoAdmin && miTerritorio && (
          <p className="nota avisoAdmin" role="status">
            <Icono nombre="marcar" tamaño={22} />
            <span>{avisoMarcandoComoAdmin(miTerritorio.name)}. Tus marcas quedan a nombre de tu cuenta de administrador.</span>
          </p>
        )}
        <h1 className="saludo">
          {asignado ? 'Mi territorio' : comoAdmin ? 'Marcar como administrador' : 'Consultar territorio'}
          <span className="sub">
            {!miTerritorio
              ? 'Todavía no tenés uno asignado.'
              : !dibujoListo ? (mapaFallo === miTerritorio.id ? 'No pudimos cargar el mapa.' : 'Cargando el mapa…') : !puedeTrabajar ? `Territorio ${miTerritorio.name} · Solo consulta` : sinDibujo
                ? `El territorio ${miTerritorio.name} todavía no está dibujado.`
                : avance.faltan === 0
                  ? `Terminaste el territorio ${miTerritorio.name}.`
                  : `${textoFaltan(avance.faltan)} del territorio ${miTerritorio.name}.`}
          </span>
        </h1>
        {miTerritorio && !dibujoListo && mapaFallo === miTerritorio.id && (
          <button
            className="boton principal"
            onClick={() => { setMapaFallo(null); setRevision((value) => value + 1) }}
          >
            <Icono nombre="reintentar" tamaño={18} />
            Volver a intentar
          </button>
        )}

        {!puedeTrabajar && (
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
            <section className={puedeTrabajar ? 'tarjeta' : 'tarjeta consulta'}>
              <p className="rotulo">{asignado ? 'Tu territorio' : comoAdmin ? 'Marcás como administrador' : 'Solo consulta'}</p>
              <p className="numeroGrande">{miTerritorio.name}</p>
              {puedeTrabajar ? (
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
                      <span>{rotuloFaltan(avance.faltan)}</span>
                      <strong>{avance.faltan}</strong>
                    </div>
                  </div>
                  <div className="barraProgreso">
                    <i style={{ width: `${avance.pct ?? 0}%` }} />
                  </div>
                  <p className="pieProgreso">
                    {avance.completas} de {manzanas.length} recorridas
                    {avance.empezadas ? ` · ${avance.empezadas} empezada${avance.empezadas > 1 ? 's' : ''}` : ''}
                    {avance.aparte ? ` · ${avance.aparte} con cuadras aparte` : ''} ·{' '}
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
                  className={marcando ? 'boton botonListo' : 'boton botonMarcar'}
                  onClick={() => {
                    if (marcando && cola.events.length) setAviso('Saliste del modo marcar. Las marcas pendientes siguen guardadas en este dispositivo.')
                    setMarcando((v) => !v)
                  }}
                >
                  <Icono nombre={marcando ? 'completo' : 'marcar'} tamaño={18} />
                  {marcando ? 'Listo, terminé de marcar' : 'Empezar a marcar lo que recorrí'}
                </button>
              )}
              {editando && (
                <p className="avisoMarcando" role="status">
                  <Icono nombre="marcar" tamaño={22} />
                  <span>Estás marcando: cada toque en el mapa se guarda. Cuando termines, apretá «Listo».</span>
                </p>
              )}
              {puedeTrabajar ? (
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
                    <strong>Empezar a marcar lo que recorrí</strong>.
                  </>
                ) : (
                  <>Las verdes tienen recorrido informado. Este territorio es de mirar.</>
                )}
              </p>
              {editando && (
                <div className="selectorEstado">
                  <ElegirDeLista
                    etiqueta="Estado que vas a informar"
                    valor={estadoElegido}
                    alElegir={(valor) => setEstadoElegido(valor as CoverageInput['estado'])}
                    opciones={ESTADOS_A_INFORMAR}
                  />
                </div>
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
              {/* Cómo va el guardado del mapa para usar sin señal. Solo en el
                  territorio propio: el de consulta no se guarda. */}
              {asignado && (
                <EstadoMapaSinSenal estado={mapaSinSenal.estado} onReintentar={mapaSinSenal.reintentar} />
              )}
              <div id="mapa" ref={cajaMapa} />
              {/* En el mapa el estado lo lleva el color y nada mas. Abajo va
                  dicho con palabras, que es la regla 3. */}
              <div className="leyenda">
                <span>
                  <i className="punto ok" aria-hidden="true" /> Recorrida (todas sus cuadras)
                </span>
                <span>
                  <i className="punto media" aria-hidden="true" /> Empezada (faltan cuadras)
                </span>
                <span>
                  <i className="punto" aria-hidden="true" /> Te falta
                </span>
                <span>
                  <i className="punto aparteRev" aria-hidden="true" /> <b className="glifo" aria-hidden="true">↻</b> Para revisitar
                </span>
                <span>
                  <i className="punto aparteNo" aria-hidden="true" /> <b className="glifo" aria-hidden="true">✕</b> No accesible
                </span>
              </div>
            </section>

            <section className="panel">
              <h2>{puedeMarcar ? 'Tus manzanas' : 'Las manzanas'}</h2>
              <p className="sub">
                {editando
                  ? 'Elegí el estado y tocá la manzana o cuadra. Repetir el mismo estado no desmarca; para quitarlo elegí “Sin dato”.'
                  : puedeMarcar
                    ? 'Para cambiar algo, tocá “Empezar a marcar lo que recorrí” arriba.'
                    : 'Así está este territorio hoy.'}
              </p>
              <div className="rejilla">
                {manzanas.map((mz) => {
                  const r = resumenDe(mz)
                  const completa = r.tipo === 'completa'
                  const media = r.tipo === 'media'
                  const aparte = r.tipo === 'aparte'
                  return (
                    <button
                      key={mz.id}
                      className={`manzana${completa ? ' hecha' : ''}${media ? ' media' : ''}${aparte ? ` aparte ${r.aparte === 'revisitar' ? 'revisitar' : 'noaccesible'}` : ''}`}
                      aria-pressed={completa}
                      disabled={!editando}
                      onClick={() => marcarManzana(mz)}
                    >
                      {mz.label}
                      <small>{completa
                        ? <><Icono nombre="completo" tamaño={15} /> hecha</>
                        : aparte
                          ? <>{r.aparte === 'revisitar' ? '↻ ' : '✕ '}{textoDeCuadras(r)}</>
                          : media ? textoDeCuadras(r) : 'te falta'}</small>
                    </button>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </section>

      {/* Avisos de la calle: sin señal, marcas pendientes y deshacer. Con el
          mapa grande abierto viven adentro de él; con otra hoja abierta no
          se muestran para no pisar sus botones. */}
      {!hoja && !historial && !informe && !hojaGrupo && (
        <div className="avisosCalle">{avisosCalle}</div>
      )}

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
          estadoElegido={estadoElegido}
          setEstadoElegido={setEstadoElegido}
          territorio={miTerritorio}
          manzanas={manzanas}
          dibujarPropio={dibujarPropio}
          alTocar={alTocarMapa}
          avisos={avisosCalle}
          onCerrar={() => setHoja(null)}
        />
      )}
      {informe && (
        <InformePredicacionFlow
          outing={informe.salida}
          action={informe.action}
          queue={cola}
          canCorrect={Boolean(contexto?.puede_abrir_panel)}
          yaInformada={Boolean(informe.salida.id && informadas.has(informe.salida.id))}
          onClose={() => setInforme(null)}
        />
      )}
    </div>
  )
}

// =====================================================================
function ChipsDeSalida({ salida }: { salida: Salida }) {
  if (salida.tipo === 'telefonica') return <span className="marca-chip tel"><Icono nombre="telefono" tamaño={17} /> Por teléfono</span>
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
          <b>Territorio</b> <span className="terrNombre">{salida.terr}</span>
        </span>
      )}
      {letras && (
        <span className="marca-chip priorizar">
          <Icono nombre="priorizar" tamaño={20} />
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
    m.fitBounds(b, ENCUADRE)
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
      m.fitBounds(b, ENCUADRE)
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
  const lugarSalida = salida?.lugar?.trim()
  const punto = lugarSalida || contexto?.punto_grupo_nombre || ''
  const usaLugarDeLaSalida = Boolean(lugarSalida)
  const lat = usaLugarDeLaSalida ? salida?.lat : contexto?.punto_grupo_lat ?? undefined
  const lng = usaLugarDeLaSalida ? salida?.lng : contexto?.punto_grupo_lng ?? undefined
  const grupo = contexto?.group_number ? `Grupo ${contexto.group_number}` : contexto?.group_name
  const salidaPunto: Salida = {
    fecha: salida?.fecha ?? hoy,
    hora: salida?.hora ?? '',
    lat,
    lng,
    lugar: punto || undefined,
  }
  return (
    <section className="tarjeta">
      <p className="rotulo">Tu grupo sale</p>
      {salida ? (
        <p className="numeroGrande">
          <span className="numeroHora">{salida.hora}</span>{' '}
          <small>{comoSeLlamaElDia(salida.fecha) ?? fechaLarga(salida.fecha)}</small>
        </p>
      ) : (
        <p className="numeroGrande sinSalida">
          <small>Tu grupo todavía no tiene salida cargada</small>
        </p>
      )}
      {punto ? (
        <p>
          {punto}
          {grupo ? ` · ${grupo}` : ''}
        </p>
      ) : (
        <p className="sub">El lugar se avisa en el grupo. Puede ser una casa, una esquina o Zoom.</p>
      )}
      <BotonesComoLlegar salida={salidaPunto} />
    </section>
  )
}

// Una salida por teléfono o sin territorio no tiene mapa que marcar: solo se
// informa cómo salió.
function sinMapaLaSalida(s: Salida) {
  return !s.terrId || s.tipo === 'telefonica'
}

function AccionesConduccion({
  onInformar,
  puedeMarcarNoRealizada,
  sinMapa,
}: {
  onInformar: (action: InformePredicacionAction) => void
  puedeMarcarNoRealizada: boolean
  sinMapa: boolean
}) {
  return <section className="acciones-conduccion" aria-label="Conducción">
    <h3>Conducción</h3>
    {sinMapa ? (
      <button type="button" className="boton principal" onClick={() => onInformar('resultado')}>
        <Icono nombre="marcar" tamaño={20} />Informar cómo salió
      </button>
    ) : (
      <>
        <button type="button" className="boton principal" onClick={() => onInformar('recorrido')}>
          <Icono nombre="marcar" tamaño={20} />Informar predicación
        </button>
        <div className="acciones-conduccion-rapidas">
          <button type="button" className="boton secundario" onClick={() => onInformar('completo')}>
            <Icono nombre="completo" tamaño={18} />Territorio completo
          </button>
          <button type="button" className="boton secundario" onClick={() => onInformar('resultado')}>
            <Icono nombre="marcar" tamaño={18} />Informar solo el resultado
          </button>
        </div>
      </>
    )}
    {puedeMarcarNoRealizada ? <div className="acciones-conduccion-rapidas">
      <button type="button" className="boton secundario" onClick={() => onInformar('no_realizada')}>
        <Icono nombre="cerrar" tamaño={18} />No se realizó
      </button>
    </div> : null}
  </section>
}

// «Conducís vos»: con texto y con ícono, no solo con color.
function ChipsDeConduccion({ salida, miDriverId }: { salida: Salida; miDriverId: string | null }) {
  if (!quienConduce(salida, miDriverId).esMia) return null
  return (
    <span className="marca-chip mia">
      <Icono nombre="conductor" tamaño={20} /> Conducís vos
    </span>
  )
}

// Si la salida ya tiene informe y de quién; si pasó la hora y no lo tiene, lo dice.
function EstadoInforme({ dato }: { dato: { informada: boolean; texto: string } | null }) {
  if (!dato) return null
  return (
    <p className={`estadoInforme ${dato.informada ? 'informada' : 'sinInformar'}`}>
      <Icono nombre={dato.informada ? 'completo' : 'pendiente'} tamaño={20} />
      <span>{dato.texto}</span>
    </p>
  )
}

function TarjetaDestacada({
  salida,
  contexto,
  rotulo,
  miDriverId,
  informe,
  onMapa,
  onInformar,
  puedeInformar,
  puedeMarcarNoRealizada,
}: {
  salida: Salida
  contexto?: ContextoHermano | null
  rotulo: string
  miDriverId: string | null
  informe: { informada: boolean; texto: string } | null
  onMapa: () => void
  onInformar: (action: InformePredicacionAction) => void
  puedeInformar: boolean
  puedeMarcarNoRealizada: boolean
}) {
  const apodo = comoSeLlamaElDia(salida.fecha) ?? fechaLarga(salida.fecha)
  return (
    <section className="tarjeta">
      <p className="rotulo">{yaEmpezo(salida) ? `${rotulo} · ya pasó` : rotulo}</p>
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
          {(salida.barrio || quienConduce(salida, miDriverId).texto) && (
            <small>
              {[salida.barrio, quienConduce(salida, miDriverId).texto]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </span>
      </div>
      <div className="marcas">
        <ChipsDeSalida salida={salida} />
        <ChipsDeConduccion salida={salida} miDriverId={miDriverId} />
      </div>
      <EstadoInforme dato={informe} />
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
      <BotonPdfSalida salida={salida} contexto={contexto} />
      {sePuedeInformarAhora(salida) && puedeInformar ? (
        <AccionesConduccion onInformar={onInformar} puedeMarcarNoRealizada={puedeMarcarNoRealizada} sinMapa={sinMapaLaSalida(salida)} />
      ) : null}
    </section>
  )
}

function FilaSalida({
  salida,
  contexto,
  miDriverId,
  informe,
  abierta,
  onAbrir,
  onMapa,
  onInformar,
  puedeInformar,
  puedeMarcarNoRealizada,
}: {
  salida: Salida
  contexto?: ContextoHermano | null
  miDriverId: string | null
  informe: { informada: boolean; texto: string } | null
  abierta: boolean
  onAbrir: () => void
  onMapa: () => void
  onInformar: (action: InformePredicacionAction) => void
  puedeInformar: boolean
  puedeMarcarNoRealizada: boolean
}) {
  const paso = yaEmpezo(salida)
  const puedeAbrir = Boolean(salida.lugar || (sePuedeInformarAhora(salida) && puedeInformar))
  return (
    <div className="salidaBloque">
      <button
        className={`salida${salida.fecha === hoyISO() ? ' esHoy' : ''}${paso ? ' pasada' : ''}${quienConduce(salida, miDriverId).esMia ? ' esMia' : ''}`}
        {...(puedeAbrir ? { 'aria-expanded': abierta } : {})}
        onClick={puedeAbrir ? onAbrir : undefined}
        style={puedeAbrir ? undefined : { cursor: 'default' }}
      >
        <span className="cuando">
          {salida.hora}
          {paso && <span className="yaPaso">ya pasó</span>}
        </span>
        <span className="donde">
          <strong>{tituloSalida(salida, contexto)}</strong>
          {salida.barrio && <span>{salida.barrio}</span>}
          {!quienConduce(salida, miDriverId).esMia && salida.conductor && <span>Conduce {salida.conductor}</span>}
          <div className="marcas">
            <ChipsDeSalida salida={salida} />
            <ChipsDeConduccion salida={salida} miDriverId={miDriverId} />
          </div>
          <EstadoInforme dato={informe} />
        </span>
        {puedeAbrir && (
          <span className="flecha" aria-hidden="true">
            <Icono nombre="chevron-abajo" tamaño={18} />
          </span>
        )}
      </button>
      {abierta && puedeAbrir && (
        <div className="salidaDetalle">
          {salida.terrId ? <MapaMini salida={salida} onAbrir={onMapa} /> : null}
          {salida.lugar ? <BotonesComoLlegar salida={salida} /> : null}
          {salida.terrId && (
            <button className="boton chico" onClick={onMapa}>
              <Icono nombre="territorios" tamaño={18} />
              Ver el mapa del territorio
            </button>
          )}
          <BotonPdfSalida salida={salida} contexto={contexto} />
          {sePuedeInformarAhora(salida) && puedeInformar ? (
            <AccionesConduccion onInformar={onInformar} puedeMarcarNoRealizada={puedeMarcarNoRealizada} sinMapa={sinMapaLaSalida(salida)} />
          ) : null}
        </div>
      )}
    </div>
  )
}

function ListaSalidas({
  salidas,
  contexto,
  cargando,
  miDriverId,
  informeDe,
  abierta,
  setAbierta,
  onMapa,
  onInformar,
  puedeInformar,
  puedeMarcarNoRealizada,
}: {
  salidas: Salida[]
  contexto?: ContextoHermano | null
  cargando: boolean
  miDriverId: string | null
  informeDe: (s: Salida) => { informada: boolean; texto: string } | null
  abierta: string | null
  setAbierta: (v: string | null) => void
  onMapa: (s: Salida) => void
  onInformar: (s: Salida, action: InformePredicacionAction) => void
  puedeInformar: (s: Salida) => boolean
  puedeMarcarNoRealizada: (s: Salida) => boolean
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
              miDriverId={miDriverId}
              informe={informeDe(s)}
              abierta={abierta === `lista-${i}`}
              onAbrir={() => setAbierta(abierta === `lista-${i}` ? null : `lista-${i}`)}
              onMapa={() => onMapa(s)}
              onInformar={(action) => onInformar(s, action)}
              puedeInformar={puedeInformar(s)}
              puedeMarcarNoRealizada={puedeMarcarNoRealizada(s)}
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

  const estadosAl = useMemo(
    () => Object.fromEntries([...latestEventsAt(eventos ?? [], corte).values()].map((e) => [e.lado_id, e.estado])),
    [eventos, corte],
  )

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
      const m = L.map(caja.current, OPCIONES_MAPA)
      m.fitBounds(b, ENCUADRE)
      ponerFondo(m)
      ponerZoom(m)
      capa.current = L.layerGroup().addTo(m)
      mapa.current = m
      window.setTimeout(() => {
        m.invalidateSize({ animate: false, pan: false })
        m.fitBounds(b, ENCUADRE)
      }, 60)
    }
    capa.current!.clearLayers()
    pintarManzanas(capa.current!, manzanasDelDia, ladosDe, estadosAl)
  }, [manzanasDelDia, ladosDe, estadosAl])

  useEffect(() => {
    const soltarFondo = bloquearFondo()
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
    enfocarSinMover(cerrarRef.current)
    return () => {
      soltarFondo()
      window.removeEventListener('keydown', esc)
      enfocarSinMover(veniaDe)
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

  // Los movimientos del día, agrupados por momento (al minuto), manzana,
  // estado y quién: marcar 4 cuadras de una manzana de una vez es un
  // movimiento, no cuatro filas.
  const movimientosAgrupados = useMemo(() => {
    const m = new Map<string, {
      clave: string; hora: string; letra: string; estado: string; quien: string; correccion: boolean
      eventos: Evento[]; notas: string[]; ultimoAt: string
    }>()
    for (const e of delDia) {
      const hora = hora24(e.informado_at)
      const letra = (manzanas.find((x) => x.id === e.manzana_id)?.label ?? 'sin rótulo').toUpperCase()
      const estado = nombreDeEstado(e.estado)
      const quien = e.informado_por ? nombres[e.informado_por] ?? 'un hermano' : 'sin autor disponible'
      const correccion = Boolean(e.corrige_evento_id)
      const clave = [hora, e.manzana_id, e.estado, e.informado_por ?? '', correccion].join('|')
      const g = m.get(clave) ?? { clave, hora, letra, estado, quien, correccion, eventos: [], notas: [], ultimoAt: e.informado_at }
      g.eventos.push(e)
      if (e.nota && !g.notas.includes(e.nota)) g.notas.push(e.nota)
      if (e.informado_at > g.ultimoAt) g.ultimoAt = e.informado_at
      m.set(clave, g)
    }
    return [...m.values()]
  }, [delDia, manzanas, nombres])

  // Lo que quedó al cierre del día en cada cuadra que no está «recorrida»,
  // dicho por separado: no es lo mismo «no accesible» que «se quitó la marca».
  const cierresSinRecorrer = useMemo(() => {
    const cuenta = { no_accesible: 0, revisitar: 0, sin_dato: 0 }
    for (const e of cierreDelDia) {
      if (e.estado === 'no_accesible') cuenta.no_accesible++
      else if (e.estado === 'revisitar') cuenta.revisitar++
      else if (e.estado !== 'recorrido') cuenta.sin_dato++
    }
    return cuenta
  }, [cierreDelDia])
  const deshechos = cierresSinRecorrer.no_accesible + cierresSinRecorrer.revisitar + cierresSinRecorrer.sin_dato

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
          <Icono nombre="reintentar" tamaño={18} />
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
                {cierresSinRecorrer.no_accesible > 0 && (
                  <li className="histDeshecho">
                    <b>✕</b>
                    <span>{textoCuadras(cierresSinRecorrer.no_accesible)} marcada{cierresSinRecorrer.no_accesible === 1 ? '' : 's'} como no accesible{cierresSinRecorrer.no_accesible === 1 ? '' : 's'}</span>
                  </li>
                )}
                {cierresSinRecorrer.revisitar > 0 && (
                  <li className="histDeshecho">
                    <b>↻</b>
                    <span>{textoCuadras(cierresSinRecorrer.revisitar)} para revisitar</span>
                  </li>
                )}
                {cierresSinRecorrer.sin_dato > 0 && (
                  <li className="histDeshecho">
                    <b><Icono nombre="deshacer" tamaño={18} /></b>
                    <span>{textoCuadras(cierresSinRecorrer.sin_dato)} a las que se les quitó la marca ese día</span>
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
            <ol className="histMovimientos">{movimientosAgrupados.map((g) => (
              <li key={g.clave}>
                <p className="histMovimiento">
                  {g.correccion && <strong>Corrección · </strong>}
                  {g.hora} · <strong>Manzana {g.letra}</strong> · {g.eventos.length === 1 ? '1 cuadra' : `${g.eventos.length} cuadras`} · {g.estado} · {g.quien}
                </p>
                {g.notas.map((nota) => <p key={nota} className="histNota">{nota}</p>)}
                <button type="button" className="botonChico histVerMapa" onClick={() => setInstante(g.ultimoAt)}>
                  <Icono nombre="territorios" tamaño={18} />
                  Ver el mapa a esa hora
                </button>
                {canCorrect ? <details className="histCorregir">
                  <summary>Corregir una cuadra de este grupo</summary>
                  {g.eventos.map((e, i) => <div key={e.id} className="histCorregirFila">
                    <span>Cuadra {i + 1} de {g.eventos.length}</span>
                    {correcting!==e.id?<button className="boton secundario"
                      disabled={cola.events.some(item=>item.corrige_evento_id===e.id)}
                      onClick={()=>setCorrecting(e.id)}>
                      <Icono nombre="dibujar" tamaño={18} />
                      Corregir esta marca
                    </button>:null}
                    {correcting===e.id?<CoverageCorrectionForm onCancel={()=>setCorrecting(null)}
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
                  </div>)}
                </details> : null}
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
  estadoElegido,
  setEstadoElegido,
  territorio,
  manzanas,
  dibujarPropio,
  alTocar,
  avisos,
  onCerrar,
}: {
  salida?: Salida
  propio?: boolean
  editable?: boolean
  modoMarcar: 'manzana' | 'lado'
  setModoMarcar: (v: 'manzana' | 'lado') => void
  estadoElegido?: CoverageInput['estado']
  setEstadoElegido?: (v: CoverageInput['estado']) => void
  territorio: Territorio | null
  manzanas: Manzana[]
  dibujarPropio: (capa: L.LayerGroup) => void
  /** Un toque en el mapa (para elegir la manzana o cuadra más cercana). Debe ser estable. */
  alTocar?: (m: L.Map, p: L.Point) => void
  /** Avisos de la calle (marcas pendientes, deshacer), pegados al borde de abajo del mapa. */
  avisos?: ReactNode
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

  // El mapa se arma UNA vez. Antes este efecto dependía de `dibujarPropio` y
  // `onCerrar`, funciones que se crean de nuevo en cada render: cada marca
  // desarmaba el mapa y volvía el zoom al territorio entero. Ahora solo se
  // vuelven a pintar las capas; el encuadre es solo de la primera vez.
  const onCerrarRef = useRef(onCerrar)
  onCerrarRef.current = onCerrar
  const alTocarRef = useRef(alTocar)
  alTocarRef.current = alTocar

  useEffect(() => {
    if (!caja.current || !formas.length) return
    const pts = formas.flatMap((m) => (m.geometry_geojson ? anilloDe(m.geometry_geojson) : []))
    if (!pts.length) return
    const b = L.latLngBounds(pts)
    if (!mapa.current) {
      const m = L.map(caja.current, OPCIONES_MAPA)
      m.fitBounds(b, ENCUADRE)
      ponerFondo(m)
      ponerZoom(m)
      m.on('click', (e: L.LeafletMouseEvent) => alTocarRef.current?.(m, e.containerPoint))
      capa.current = L.layerGroup().addTo(m)
      mapa.current = m
      window.setTimeout(() => {
        if (mapa.current !== m) return
        m.invalidateSize({ animate: false, pan: false })
        m.fitBounds(b, ENCUADRE)
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

  // La caja puede no tener su tamaño final cuando se crea el mapa. Mientras
  // la persona no lo tocó (el primer segundo), cada cambio de tamaño vuelve a
  // encuadrar al territorio entero con poco margen.
  useEffect(() => {
    const m = mapa.current
    const caja_ = caja.current
    if (!m || !caja_ || !formas.length || typeof ResizeObserver === 'undefined') return
    const pts = formas.flatMap((f) => (f.geometry_geojson ? anilloDe(f.geometry_geojson) : []))
    if (!pts.length) return
    const b = L.latLngBounds(pts)
    const desde = Date.now()
    const ro = new ResizeObserver(() => {
      if (mapa.current !== m) return
      m.invalidateSize({ animate: false, pan: false })
      if (Date.now() - desde < 1200) m.fitBounds(b, ENCUADRE)
    })
    ro.observe(caja_)
    return () => ro.disconnect()
  }, [formas])

  // Marcando, el doble clic no acerca (dos clics seguidos son un doble toque).
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const marcando = Boolean(propio && editable)
    if (marcando) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable()
    m.getContainer().classList.toggle('mapaMarcando', marcando)
  }, [propio, editable, formas])

  useEffect(() => {
    const soltarFondo = bloquearFondo()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrarRef.current()
    window.addEventListener('keydown', esc)
    const veniaDe = document.activeElement as HTMLElement | null
    enfocarSinMover(cerrarRef.current)
    return () => {
      soltarFondo()
      window.removeEventListener('keydown', esc)
      enfocarSinMover(veniaDe)
      mapa.current?.remove()
      mapa.current = null
    }
  }, [])

  // El pie decia "Tocá una manzana" tambien en modo cuadra, donde tocar la
  // manzana no hace nada. Dice lo que el dedo puede hacer ahora.
  const leyenda = propio
    ? {
        llave: true,
        texto: !editable
          ? 'En verde, lo que ya se recorrió.'
          : modoMarcar === 'manzana'
            ? 'Las verdes ya las recorriste. Tocá una manzana para marcarla entera. Para acercar, usá + y − o la rueda del mouse.'
            : 'Las verdes ya las recorriste. Tocá cerca de una cuadra para marcarla. Para acercar, usá + y − o la rueda del mouse.',
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
          {/* Qué se está marcando, dicho con palabras, y cómo cambiarlo sin
              volver a la pantalla de atrás. Plegado: una línea de 56 px. */}
          <details className="marcandoAhora">
            <summary>
              <Icono nombre="marcar" tamaño={20} />
              <span>
                Marcando: <strong>{ESTADOS_A_INFORMAR.find((e) => e.valor === estadoElegido)?.texto ?? 'Recorrida'}</strong>
                {' · '}
                <strong>{modoMarcar === 'manzana' ? 'Manzana entera' : 'Por cuadra'}</strong>
              </span>
              <span className="marcandoCambiar">Cambiar</span>
            </summary>
            {setEstadoElegido && (
              <div className="modos estadosMapa" role="group" aria-label="Qué marcar">
                {ESTADOS_A_INFORMAR.map((e) => (
                  <button
                    key={e.valor}
                    type="button"
                    className="modo"
                    aria-pressed={estadoElegido === e.valor}
                    onClick={() => setEstadoElegido(e.valor as CoverageInput['estado'])}
                  >
                    {e.texto}
                  </button>
                ))}
              </div>
            )}
            <div className="modos" role="group" aria-label="Cómo marcar">
              {(['manzana', 'lado'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="modo"
                  aria-pressed={modoMarcar === k}
                  onClick={() => setModoMarcar(k)}
                >
                  {k === 'manzana' ? 'Manzana entera' : 'Por cuadra'}
                </button>
              ))}
            </div>
            {estadoElegido === 'sin_dato' && <p className="marcandoAyuda">Sin dato quita la marca que tenga la cuadra o la manzana.</p>}
          </details>
        </div>
      )}
      <div className="sobreCuerpo">
        <div className="mapaGrande" ref={caja} />
        {propio && avisos && <div className="avisosCalle enMapa">{avisos}</div>}
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
