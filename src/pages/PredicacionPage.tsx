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
import '../styles/vista-hermano.css'

const TESELAS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

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
}

type Lado = {
  id: string
  manzana_id: string
  orden: number
  geometry_geojson: Linea
  largo_m: number
}

type Salida = {
  fecha: string
  hora: string
  lugar?: string
  barrio?: string
  terr?: string
  conductor?: string
  priorizar?: string
  tipo?: 'telefonica' | 'grupos'
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

function tituloSalida(s: Salida) {
  if (s.tipo === 'telefonica') return 'Predicación telefónica'
  if (s.tipo === 'grupos') return 'Salidas de grupos'
  return s.lugar ?? 'Salida'
}

// "A,D,E" se puede pintar en el mapa. "hasta Rio Bamba" no: eso es una calle
// y no la tenemos. Cuando no se puede, se dice con palabras.
function letrasPrioritarias(p?: string) {
  if (!p || p === 'todo') return null
  if (!/^[A-Za-z](\s*,\s*[A-Za-z])*$/.test(p)) return null
  return new Set(p.split(',').map((x) => x.trim().toLowerCase()))
}

function leyendaDelMapa(s: Salida) {
  const letras = letrasPrioritarias(s.priorizar)
  if (letras) {
    return { llave: true, texto: `En verde, las manzanas de hoy: ${s.priorizar!.split(',').join(', ')}.` }
  }
  if (!s.priorizar || s.priorizar === 'todo') {
    return { llave: false, texto: 'Se recorre el territorio entero.' }
  }
  return { llave: false, texto: `Priorizá ${s.priorizar.replace(/^Manzanas /, 'las manzanas ')}.` }
}

function comoLlegar(s: Salida) {
  window.open(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.lugar}, San Juan, Argentina`)}`,
    '_blank',
  )
}

const anilloDe = (g: Poligono) => g.coordinates[0].map(([x, y]) => [y, x] as [number, number])

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

// Sin acentos y en minusculas: "Mateo Luna" y "mateo luna" son la misma
// persona. Es un emparejado por texto y es fragil; ver la nota de abajo.
const normalizar = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export function PredicacionPage() {
  const { profile } = useAuth()

  const [vista, setVista] = useState<'hoy' | 'salidas' | 'territorio'>('hoy')
  const [paso, setPaso] = useState(1)
  const [modoMarcar, setModoMarcar] = useState<'manzana' | 'lado'>('manzana')

  const [territorios, setTerritorios] = useState<Territorio[]>([])
  const [miTerritorio, setMiTerritorio] = useState<Territorio | null>(null)
  const [asignado, setAsignado] = useState(false)
  const [manzanas, setManzanas] = useState<Manzana[]>([])
  const [lados, setLados] = useState<Lado[]>([])
  const [hechos, setHechos] = useState<Set<string>>(new Set())
  const [salidas, setSalidas] = useState<Salida[]>([])
  const [origenSalidas, setOrigenSalidas] = useState<'base' | 'archivo' | null>(null)
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const [abierta, setAbierta] = useState<string | null>(null)
  const [hoja, setHoja] = useState<{ salida?: Salida; propio?: boolean } | null>(null)

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
    let total = 0
    let ok = 0
    for (const mz of manzanas) {
      for (const l of ladosDe(mz)) {
        total += Number(l.largo_m)
        if (hechos.has(l.id)) ok += Number(l.largo_m)
      }
    }
    const completas = manzanas.filter((m) => ladosDe(m).length > 0 && hechosDe(m) === ladosDe(m).length).length
    const empezadas = manzanas.filter((m) => {
      const h = hechosDe(m)
      return h > 0 && h < ladosDe(m).length
    }).length
    return {
      metros: total,
      metrosHechos: ok,
      pct: total ? Math.round((ok / total) * 100) : 0,
      completas,
      empezadas,
      faltan: manzanas.length - completas,
    }
  }, [manzanas, ladosDe, hechosDe, hechos])

  // ----------------------------------------------------------- carga
  useEffect(() => {
    let vivo = true
    if (!supabase) {
      setCargando(false)
      setAviso('La app no está conectada a la base.')
      return
    }

    void (async () => {
      const [terrRes, resRes, salRes] = await Promise.all([
        supabase.from('territorios').select('id, name'),
        supabase
          .from('territorio_personal_reservas')
          .select('territory_id, reserved_for')
          .eq('status', 'activa'),
        supabase
          .from('salidas')
          .select('id, title, territory_id, driver_id, meeting_point_name, scheduled_for, notes')
          .order('scheduled_for', { ascending: true }),
      ])
      if (!vivo) return

      const lista = ((terrRes.data as Territorio[]) ?? []).slice().sort(
        (a, b) => Number(a.name) - Number(b.name) || a.name.localeCompare(b.name),
      )
      setTerritorios(lista)

      // El territorio personal se busca por NOMBRE, porque reserved_for es
      // texto libre y no una referencia a la persona. Es el mismo problema
      // que las 55 variantes de conductor del Excel, adentro del sistema
      // nuevo. Mientras siga siendo texto, esto puede no encontrar a nadie.
      const mio = (resRes.data ?? []).find(
        (r: { reserved_for: string }) =>
          profile?.full_name && normalizar(r.reserved_for) === normalizar(profile.full_name),
      ) as { territory_id: string } | undefined

      if (mio) {
        setMiTerritorio(lista.find((t) => t.id === mio.territory_id) ?? null)
        setAsignado(true)
      }

      const filas = salRes.data ?? []
      if (filas.length) {
        setOrigenSalidas('base')
        setSalidas(
          filas.map((f: Record<string, unknown>) => {
            const cuando = new Date(f.scheduled_for as string)
            return {
              fecha: cuando.toLocaleDateString('sv-SE'),
              hora: cuando.toTimeString().slice(0, 5),
              lugar: (f.meeting_point_name as string) || (f.title as string),
              terr: lista.find((t) => t.id === f.territory_id)?.name,
            }
          }),
        )
      } else {
        // La tabla salidas está vacía: el programa vive todavía en el PDF
        // que pasan por WhatsApp. Se lee de ahí y se dice de dónde salió.
        const r = await fetch('/datos/salidas.json').catch(() => null)
        const d = r && r.ok ? await r.json() : null
        if (!vivo) return
        if (d?.salidas) {
          setSalidas(d.salidas as Salida[])
          setOrigenSalidas('archivo')
        }
      }
      setCargando(false)
    })()

    return () => {
      vivo = false
    }
  }, [profile?.full_name])

  // Manzanas, lados y lo ya informado del territorio elegido.
  useEffect(() => {
    let vivo = true
    if (!supabase || !miTerritorio) {
      setManzanas([])
      setLados([])
      setHechos(new Set())
      return
    }

    void (async () => {
      const [mzRes, ldRes, cbRes] = await Promise.all([
        supabase
          .from('territorio_manzanas')
          .select('id, label, lat, lng, geometry_geojson')
          .eq('territory_id', miTerritorio.id)
          .order('label', { ascending: true }),
        supabase
          .from('manzana_lados')
          .select('id, manzana_id, orden, geometry_geojson, largo_m')
          .eq('territory_id', miTerritorio.id)
          .is('vigente_hasta', null)
          .order('orden', { ascending: true }),
        supabase
          .from('cobertura_lado_actual')
          .select('lado_id, estado')
          .eq('territory_id', miTerritorio.id),
      ])
      if (!vivo) return
      setManzanas((mzRes.data as Manzana[]) ?? [])
      setLados((ldRes.data as Lado[]) ?? [])
      setHechos(
        new Set(
          ((cbRes.data as { lado_id: string; estado: string }[]) ?? [])
            .filter((c) => c.estado === 'recorrido')
            .map((c) => c.lado_id),
        ),
      )
    })()

    return () => {
      vivo = false
    }
  }, [miTerritorio])

  // --------------------------------------------------------- marcar
  // La bitácora es de solo agregar: desmarcar no borra el evento anterior,
  // informa uno nuevo que dice "sin_dato". La historia queda.
  const informar = useCallback(
    async (afectados: Lado[], recorrido: boolean) => {
      if (!supabase || !miTerritorio || !profile?.id || !afectados.length) return
      const previos = new Set(hechos)
      setHechos((antes) => {
        const n = new Set(antes)
        for (const l of afectados) {
          if (recorrido) n.add(l.id)
          else n.delete(l.id)
        }
        return n
      })
      setGuardando(true)
      const { error } = await supabase.from('cobertura_eventos').insert(
        afectados.map((l) => ({
          lado_id: l.id,
          manzana_id: l.manzana_id,
          territory_id: miTerritorio.id,
          estado: recorrido ? 'recorrido' : 'sin_dato',
          origen: 'app_hermano',
          informado_por: profile.id,
        })),
      )
      setGuardando(false)
      if (error) {
        // Si no se guardó, la pantalla no puede decir que sí.
        setHechos(previos)
        setAviso('No se pudo guardar. Fijate la señal y probá de nuevo.')
      } else {
        setAviso(null)
      }
    },
    [miTerritorio, profile?.id, hechos],
  )

  const marcarManzana = useCallback(
    (mz: Manzana) => {
      const propios = ladosDe(mz)
      const completa = propios.length > 0 && hechosDe(mz) === propios.length
      // Tocar la manzana entera es todo o nada: si algo estaba hecho, se
      // completa; recién tocándola de nuevo se borra.
      void informar(completa ? propios : propios.filter((l) => !hechos.has(l.id)), !completa)
    },
    [ladosDe, hechosDe, hechos, informar],
  )

  const marcarLado = useCallback(
    (lado: Lado) => void informar([lado], !hechos.has(lado.id)),
    [hechos, informar],
  )

  // ----------------------------------------------------------- mapas
  const dibujarPropio = useCallback(
    (capa: L.LayerGroup, conLetras: boolean) => {
      for (const mz of manzanas) {
        if (!mz.geometry_geojson) continue
        const anillo = anilloDe(mz.geometry_geojson)
        const propios = ladosDe(mz)
        const n = hechosDe(mz)
        const completa = propios.length > 0 && n === propios.length
        const media = n > 0 && !completa
        const color = completa ? '#0f6b47' : media ? '#955408' : '#16191d'

        L.polygon(anillo, {
          color,
          weight: 2,
          fillColor: completa ? '#59c48f' : media ? '#f0c987' : '#cbd0d6',
          fillOpacity: completa ? 0.55 : media ? 0.45 : 0.3,
          interactive: modoMarcar === 'manzana',
        })
          .addTo(capa)
          .on('click', () => modoMarcar === 'manzana' && marcarManzana(mz))

        if (modoMarcar === 'lado') {
          const centro: [number, number] = [Number(mz.lat), Number(mz.lng)]
          for (const lado of propios) {
            const linea = lado.geometry_geojson.coordinates.map(
              ([x, y]) => haciaAdentro([y, x], centro),
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

        if (!conLetras) continue
        const c = anillo.reduce(
          (a, [la, ln]) => [a[0] + la / anillo.length, a[1] + ln / anillo.length],
          [0, 0],
        ) as [number, number]
        L.marker(c, {
          interactive: false,
          icon: L.divIcon({
            className: '',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            html: `<div class="etiquetaMz" style="width:30px;height:30px;background:${color}">${mz.label}</div>`,
          }),
        }).addTo(capa)
      }
    },
    [manzanas, ladosDe, hechosDe, hechos, modoMarcar, marcarManzana, marcarLado],
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
      const m = L.map(cajaMapa.current, { attributionControl: false, zoomAnimation: false })
      m.fitBounds(encuadre.pad(0.08), { animate: false })
      L.tileLayer(TESELAS, { maxZoom: 19 }).addTo(m)
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
    dibujarPropio(capa.current, true)
  }, [dibujarPropio, mapaListo])

  useEffect(
    () => () => {
      mapa.current?.remove()
      mapa.current = null
      capa.current = null
    },
    [],
  )

  const escala = { ['--step' as string]: paso.toFixed(2) } as React.CSSProperties

  // ------------------------------------------------------------ render
  const hoy = hoyISO()
  const deHoy = salidas.filter((s) => s.fecha === hoy)
  const proxima = salidas.find((s) => s.fecha > hoy)
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
      : 'No hay salidas cargadas.'

  return (
    <div className="vh" style={escala}>
      <header className="barra">
        <span className="marca">
          <span className="logo" aria-hidden="true">
            ◆
          </span>
          Territorios
        </span>
        <button
          className="btnIcono"
          aria-label="Agrandar el texto"
          onClick={() => setPaso((p) => (p >= 1.3 ? 1 : p + 0.15))}
        >
          {paso > 1 ? 'A−' : 'A+'}
        </button>
      </header>

      {aviso && (
        <p className="hoja nota" role="status">
          <span aria-hidden="true">◆</span>
          <span>{aviso}</span>
        </p>
      )}

      {/* ------------------------------------------------------------ HOY */}
      <section className={vista === 'hoy' ? 'vista activa hoja' : 'vista hoja'}>
        <h1 className="saludo">
          {h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'}
          {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}.` : '.'}
          <span className="sub">{cargando ? 'Cargando…' : resumenHoy}</span>
        </h1>

        {destacada && (
          <TarjetaDestacada
            salida={destacada}
            esFutura={!deHoy.length}
            onMapa={() => setHoja({ salida: destacada })}
          />
        )}

        {otras.length > 0 && (
          <>
            <p className="salidaDia">También hoy</p>
            {otras.map((s, i) => (
              <FilaSalida
                key={`${s.fecha}-${s.hora}-${i}`}
                salida={s}
                abierta={abierta === `hoy-${i}`}
                onAbrir={() => setAbierta(abierta === `hoy-${i}` ? null : `hoy-${i}`)}
                onMapa={() => setHoja({ salida: s })}
              />
            ))}
          </>
        )}

        <section className="panel">
          <h2>Tu territorio</h2>
          {miTerritorio ? (
            <>
              <p className="sub">
                Tenés el <strong>{miTerritorio.name}</strong>.{' '}
                {avance.faltan === 0
                  ? 'Ya lo recorriste entero.'
                  : avance.faltan === 1
                    ? 'Te falta 1 manzana.'
                    : `Te faltan ${avance.faltan} manzanas.`}
              </p>
              <div className="barraProgreso" style={{ background: 'var(--line)' }}>
                <i style={{ width: `${avance.pct}%`, background: 'var(--lime-deep)' }} />
              </div>
              <p className="pieProgreso" style={{ color: 'var(--fg-2)' }}>
                {avance.completas} de {manzanas.length} recorridas · {avance.pct}%
              </p>
              <button className="boton principal" style={{ background: 'var(--ink)', color: '#fff' }} onClick={() => setVista('territorio')}>
                Ver mi territorio →
              </button>
            </>
          ) : (
            <p className="sub">
              Todavía no tenés uno asignado. Cuando el siervo de tu grupo te dé uno, lo vas a ver acá.
            </p>
          )}
        </section>
      </section>

      {/* -------------------------------------------------------- SALIDAS */}
      <section className={vista === 'salidas' ? 'vista activa hoja' : 'vista hoja'}>
        <h1 className="saludo">
          Salidas
          <span className="sub">
            {origenSalidas === 'archivo'
              ? 'Del programa que pasan por WhatsApp.'
              : origenSalidas === 'base'
                ? 'Cargadas en el sistema.'
                : 'Cargando…'}
          </span>
        </h1>
        <ListaSalidas
          salidas={salidas}
          abierta={abierta}
          setAbierta={setAbierta}
          onMapa={(s) => setHoja({ salida: s })}
        />
      </section>

      {/* ----------------------------------------------------- TERRITORIO */}
      <section className={vista === 'territorio' ? 'vista activa hoja' : 'vista hoja'}>
        <h1 className="saludo">
          Mi territorio
          <span className="sub">
            {!miTerritorio
              ? 'Todavía no tenés uno asignado.'
              : avance.faltan === 0
                ? `Terminaste el territorio ${miTerritorio.name}.`
                : `Te faltan ${avance.faltan} manzanas del territorio ${miTerritorio.name}.`}
          </span>
        </h1>

        {!asignado && (
          <section className="panel">
            <h2>Sin territorio asignado</h2>
            <p className="sub">
              No figura ninguna reserva a tu nombre. Mientras tanto podés mirar cualquier territorio.
            </p>
            <label className="sub" htmlFor="elegirTerr">
              Mirar el territorio
            </label>
            <select
              id="elegirTerr"
              className="boton chico"
              value={miTerritorio?.id ?? ''}
              onChange={(e) =>
                setMiTerritorio(territorios.find((t) => t.id === e.target.value) ?? null)
              }
            >
              <option value="">Elegí uno…</option>
              {territorios.map((t) => (
                <option key={t.id} value={t.id}>
                  Territorio {t.name}
                </option>
              ))}
            </select>
          </section>
        )}

        {miTerritorio && (
          <>
            <section className="tarjeta">
              <p className="rotulo">Tu territorio</p>
              <p className="numeroGrande">{miTerritorio.name}</p>
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
                <i style={{ width: `${avance.pct}%` }} />
              </div>
              <p className="pieProgreso">
                {avance.completas} de {manzanas.length} recorridas
                {avance.empezadas ? ` · ${avance.empezadas} empezada${avance.empezadas > 1 ? 's' : ''}` : ''} ·{' '}
                {avance.pct}%{guardando ? ' · guardando…' : ''}
              </p>
              <button className="boton principal" onClick={() => setHoja({ propio: true })}>
                Abrir el mapa en grande →
              </button>
            </section>

            <section className="panel">
              <h2>Dónde queda</h2>
              <p className="sub">
                Las verdes ya las recorriste. Tocá una manzana para marcarla, o pasá a{' '}
                <strong>Por lado</strong> si hiciste una sola calle.
              </p>
              <div className="modos" role="group" aria-label="Cómo marcar">
                {(['manzana', 'lado'] as const).map((k) => (
                  <button
                    key={k}
                    className={modoMarcar === k ? 'modo activo' : 'modo'}
                    aria-pressed={modoMarcar === k}
                    onClick={() => setModoMarcar(k)}
                  >
                    {k === 'manzana' ? 'Manzana entera' : 'Por lado'}
                  </button>
                ))}
              </div>
              <div id="mapa" ref={cajaMapa} />
            </section>

            <section className="panel">
              <h2>Tus manzanas</h2>
              <p className="sub">Tocá una cuando la termines. Si te equivocás, tocala de nuevo.</p>
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
                      onClick={() => marcarManzana(mz)}
                    >
                      {mz.label}
                      <small>{completa ? '✓ hecha' : media ? `${n} de ${total} lados` : 'te falta'}</small>
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
          ['hoy', 'Hoy'],
          ['salidas', 'Salidas'],
          ['territorio', 'Mi territorio'],
        ] as const).map(([id, texto]) => (
          <button
            key={id}
            onClick={() => {
              setVista(id)
              window.scrollTo(0, 0)
            }}
            {...(vista === id ? { 'aria-current': 'page' as const } : {})}
          >
            {texto}
            <i className="marcaActiva" />
          </button>
        ))}
      </nav>

      {hoja && (
        <HojaMapa
          salida={hoja.salida}
          propio={hoja.propio}
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
  if (salida.tipo === 'grupos') return <span className="marca-chip tel">◆ Cada grupo por su lado</span>
  const letras = salida.priorizar && salida.priorizar !== 'todo'
    ? /^[A-Za-z](,[A-Za-z])*$/.test(salida.priorizar)
      ? `Priorizá las manzanas ${salida.priorizar.split(',').join(', ')}`
      : `Priorizá ${salida.priorizar.replace(/^Manzanas /, 'las manzanas ')}`
    : null
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

function TarjetaDestacada({
  salida,
  esFutura,
  onMapa,
}: {
  salida: Salida
  esFutura: boolean
  onMapa: () => void
}) {
  const apodo = comoSeLlamaElDia(salida.fecha) ?? fechaLarga(salida.fecha)
  return (
    <section className="tarjeta">
      <p className="rotulo">{esFutura ? 'La próxima salida' : 'La salida de hoy'}</p>
      <p className="numeroGrande">
        {salida.hora} <small>{apodo}</small>
      </p>
      <div className="frase">
        <span className="marco" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.6" />
          </svg>
        </span>
        <span>
          <strong>{tituloSalida(salida)}</strong>
          <small>
            {salida.barrio ?? 'San Juan'}
            {salida.conductor ? ` · Conduce ${salida.conductor}` : ''}
          </small>
        </span>
      </div>
      <div className="marcas">
        <ChipsDeSalida salida={salida} />
      </div>
      {salida.lugar && (
        <button className="boton principal" onClick={() => comoLlegar(salida)}>
          Cómo llegar →
        </button>
      )}
      {salida.terr && (
        <button className="boton chico" onClick={onMapa}>
          Ver el mapa del territorio {salida.terr}
        </button>
      )}
    </section>
  )
}

function FilaSalida({
  salida,
  abierta,
  onAbrir,
  onMapa,
}: {
  salida: Salida
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
          <strong>{tituloSalida(salida)}</strong>
          {salida.barrio && <span>{salida.barrio}</span>}
          {salida.conductor && <span>Conduce {salida.conductor}</span>}
          <div className="marcas">
            <ChipsDeSalida salida={salida} />
          </div>
        </span>
        {salida.lugar && (
          <span className="flecha" aria-hidden="true">
            ⌄
          </span>
        )}
      </button>
      {abierta && salida.lugar && (
        <div className="salidaDetalle">
          <button className="boton principal" onClick={() => comoLlegar(salida)}>
            Cómo llegar →
          </button>
          {salida.terr && (
            <button className="boton chico" onClick={onMapa}>
              Ver el mapa del territorio {salida.terr}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ListaSalidas({
  salidas,
  abierta,
  setAbierta,
  onMapa,
}: {
  salidas: Salida[]
  abierta: string | null
  setAbierta: (v: string | null) => void
  onMapa: (s: Salida) => void
}) {
  const hoy = hoyISO()
  const futuras = salidas.filter((s) => s.fecha >= hoy)
  const lista = futuras.length ? futuras : salidas
  let dia: string | null = null

  return (
    <>
      {!futuras.length && salidas.length > 0 && (
        <p className="nota">
          <span aria-hidden="true">◆</span>
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

// El mapa a pantalla completa, compartido por los dos casos: el territorio
// de una salida (mirar) y el propio (marcar).
function HojaMapa({
  salida,
  propio,
  territorio,
  manzanas,
  dibujarPropio,
  onCerrar,
}: {
  salida?: Salida
  propio?: boolean
  territorio: Territorio | null
  manzanas: Manzana[]
  dibujarPropio: (capa: L.LayerGroup, conLetras: boolean) => void
  onCerrar: () => void
}) {
  const caja = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  const [formas, setFormas] = useState<Manzana[]>(propio ? manzanas : [])

  // Para una salida, las manzanas son las de ESE territorio, que puede no
  // ser el propio.
  useEffect(() => {
    if (propio || !salida?.terr || !supabase) return
    let vivo = true
    void (async () => {
      const { data: terr } = await supabase
        .from('territorios')
        .select('id')
        .eq('name', salida.terr!)
        .limit(1)
      const id = (terr as { id: string }[] | null)?.[0]?.id
      if (!id) return
      const { data } = await supabase
        .from('territorio_manzanas')
        .select('id, label, lat, lng, geometry_geojson')
        .eq('territory_id', id)
      if (vivo) setFormas((data as Manzana[]) ?? [])
    })()
    return () => {
      vivo = false
    }
  }, [propio, salida?.terr])

  useEffect(() => {
    if (propio) setFormas(manzanas)
  }, [propio, manzanas])

  useEffect(() => {
    if (!caja.current || !formas.length) return
    const pts = formas.flatMap((m) => (m.geometry_geojson ? anilloDe(m.geometry_geojson) : []))
    if (!pts.length) return
    const b = L.latLngBounds(pts)
    if (!mapa.current) {
      const m = L.map(caja.current, { attributionControl: false, zoomAnimation: false })
      m.fitBounds(b.pad(0.08), { animate: false })
      L.tileLayer(TESELAS, { maxZoom: 19 }).addTo(m)
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
      dibujarPropio(c, true)
      return
    }
    const letras = letrasPrioritarias(salida?.priorizar)
    for (const mz of formas) {
      if (!mz.geometry_geojson) continue
      const anillo = anilloDe(mz.geometry_geojson)
      const marcada = !letras || letras.has(mz.label.toLowerCase())
      L.polygon(anillo, {
        color: marcada ? '#16191d' : '#8d939b',
        weight: marcada ? 2 : 1,
        fillColor: marcada ? '#cbea5b' : '#ffffff',
        fillOpacity: marcada ? 0.72 : 0.35,
        interactive: false,
      }).addTo(c)
      const centro = anillo.reduce(
        (a, [la, ln]) => [a[0] + la / anillo.length, a[1] + ln / anillo.length],
        [0, 0],
      ) as [number, number]
      L.marker(centro, {
        interactive: false,
        icon: L.divIcon({
          className: '',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          html: `<div class="etiquetaMz" style="width:30px;height:30px;background:${marcada ? '#16191d' : '#8d939b'}">${mz.label}</div>`,
        }),
      }).addTo(c)
    }
  }, [formas, propio, salida?.priorizar, dibujarPropio])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', esc)
      mapa.current?.remove()
      mapa.current = null
    }
  }, [onCerrar])

  const leyenda = propio
    ? { llave: true, texto: 'Las verdes ya las recorriste. Tocá una manzana para marcarla.' }
    : salida
      ? leyendaDelMapa(salida)
      : { llave: false, texto: '' }

  return (
    <div className="sobre">
      <div className="sobreBarra">
        <button className="btnIcono" aria-label="Cerrar el mapa" onClick={onCerrar}>
          ✕
        </button>
        <h2>
          Territorio {propio ? territorio?.name : salida?.terr}
          {propio ? <small>El tuyo</small> : salida?.lugar ? <small>Se sale de {salida.lugar}</small> : null}
        </h2>
      </div>
      <div className="sobreCuerpo">
        <div id="mapaTerr" ref={caja} />
      </div>
      <p className="sobrePie">
        {leyenda.llave ? (
          <span className={propio ? 'llave hecha' : 'llave'} aria-hidden="true" />
        ) : (
          <span aria-hidden="true">◆</span>
        )}
        <span>{leyenda.texto}</span>
      </p>
    </div>
  )
}
