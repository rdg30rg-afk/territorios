import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Falta } from '../components/Falta'
import { Vacio } from '../components/Vacio'
import { SalidaResultadoForm } from '../components/SalidaResultadoForm'
import { Icono } from '../components/Icono'
import '../styles/importacion.css'
import { Desplegable } from '../components/Desplegable'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/useAuth'
import { decirElError } from '../lib/decirElError'
import {
  aClaveFecha,
  claveFechaLocal,
  contarDiasInclusive,
  crearEstadoPrograma,
  deClaveFecha,
  fraseDelRango,
  hayDiasPasados,
  PRESETS_PROGRAMA,
  rangoPorPreset,
  repetirPrimeraSemana,
  semanasDelRango,
  validarRango,
  type PresetPrograma,
} from '../lib/programaRango'
import { BuscadorPunto } from '../components/BuscadorPunto'
import { saleSinConductor, textoConductor, textoPuntoSalida, textoTerritorio } from '../lib/salidaEtiquetas'
import { agruparPorDia, etiquetaDelDia, partirAgenda } from '../lib/agendaPorDia'
import { supabase } from '../lib/supabase'
import '../styles/agenda-salidas.css'

const MeetingPointPickerMap = lazy(() =>
  import('../components/MeetingPointPickerMap').then((module) => ({
    default: module.MeetingPointPickerMap,
  })),
)

function MapFallback() {
  return <div className="status-card">Cargando mapa...</div>
}

type DriverRecord = {
  id: string
  full_name: string
  status: 'activo' | 'pendiente' | 'inactivo'
  availability: DriverAvailability | null
}

type DriverAvailabilityTurn = 'manana' | 'tarde' | 'telefonica'

type DriverAvailability = {
  days: number[]
  turns: DriverAvailabilityTurn[]
  byDay?: Record<string, DriverAvailabilityTurn[]>
}

type GroupRecord = {
  id: string
  group_name: string
  group_number: number | null
  driver_id: string | null
  manager_name: string
  manager_role: 'superintendente' | 'siervo' | 'auxiliar'
}

type TerritoryRecord = {
  id: string
  name: string
  description: string | null
  polygon_geojson: GeoJSON.Polygon | null
}

type MeetingPointRecord = {
  id: string
  nombre: string
  barrio: string | null
  lat: number | null
  lng: number | null
  maps_url: string | null
  territory_id: string | null
  activo: boolean
  codigo?: string | null
  orden?: number | null
  tipo?: 'territorial' | 'especial' | null
}

type OutingProvenance = {
  id: string
  salida_id: string
  importacion_id: string
  registro_id: string
  application_id: string
  source_sha256: string
  parser_version: string
  source_sheet: string
  source_row: number
  source_range: string | null
  source_conductor_text: string | null
  source_conductor_alias_id: string | null
  source_priorizar: string | null
  source_narrative: Record<string, unknown>
  source_status: boolean | null
  source_resolution_status: string | null
}

type OutingRecord = {
  id: string
  title: string
  territory_id: string | null
  driver_id: string | null
  group_id: string | null
  meeting_point_name: string | null
  meeting_point_lat: number | null
  meeting_point_lng: number | null
  meeting_point_id: string | null
  scheduled_for: string
  notes: string | null
  tipo: 'telefonica' | 'grupos' | 'asamblea' | 'especial' | null
  origen: 'app' | 'excel'
  registro_id: string | null
  conductor_texto?: string | null
  territorio_codigo?: string | null
  barrio?: string | null
  provenance?: OutingProvenance | null
}

type PersonalTerritoryReservation = {
  id: string
  territory_id: string
  reserved_for: string
  status: 'activa' | 'liberada'
  reserved_at: string
}

type ScheduleFilter = 'todos' | 'hoy' | 'proximas' | 'pasadas' | 'sin-conductor'
type PlannerSlotKind = 'territorial' | 'phone'

type PlannerSlot = {
  key: string
  dateKey: string
  dayLabel: string
  dayShort: string
  timeLabel: string
  scheduledForValue: string
  period: 'manana' | 'tarde'
  kind: PlannerSlotKind
  titleSuggestion: string
}

type PlannerRow = {
  key: string
  dayLabel: string
  dateLabel: string
  periodLabel: string
  typeLabel: string
  slots: PlannerSlot[]
}

type PlannerDraft = {
  enabled: boolean
  slotKey: string
  meetingPointName: string
  meetingPointId: string
  driverId: string
  territoryId: string
  meetingCoords: [number, number] | null
  mapOpen: boolean
}

type GpsPendiente = {
  id: string
  codigo: string
  lat: number
  lng: number
}

function gpsNuevoDelPunto(
  punto: MeetingPointRecord | undefined,
  coords: [number, number] | null,
): GpsPendiente | null {
  if (!punto || !coords) return null
  if (punto.lat != null && punto.lng != null) return null
  return {
    id: punto.id,
    codigo: (punto.codigo ?? '').trim() || punto.nombre,
    lat: Number(coords[1].toFixed(6)),
    lng: Number(coords[0].toFixed(6)),
  }
}

type SalidasPageProps = {
  groupServiceMode?: boolean
}

// Cuantas salidas se traen. El tope duro de PostgREST es 1000; mil filas en
// pantalla eran 14.783 nodos y 132.000 px de alto. Con 300 entran las
// proximas y varios meses hacia atras, y la pagina sigue siendo usable.
const SALIDAS_QUE_SE_TRAEN = 300
const SALIDAS_POR_PAGINA = 25
const CAMPOS_SALIDA =
  'id, title, territory_id, driver_id, group_id, meeting_point_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, notes, tipo, origen, registro_id, conductor_texto, territorio_codigo, barrio'
const CAMPOS_SALIDA_VIEJOS =
  'id, title, territory_id, driver_id, group_id, meeting_point_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, notes, tipo, origen, registro_id'
const SALIDAS_RPC_FIELDS = CAMPOS_SALIDA_VIEJOS

function mensajeErrorSalidas(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return decirElError({ message: error.message }, fallback)
  }

  if (error && typeof error === 'object') {
    return decirElError(
      error as { message?: string; code?: string; details?: string },
      fallback,
    )
  }

  return fallback
}

const dayFormatter = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
})

// El rotulo del planificador ("Lunes 07-09") sirve como encabezado de una
// columna, pero dentro de una frase se lee como un registro. Para la bajada
// va la fecha dicha como se dice en voz alta: "lunes 7 de septiembre".
const shortDateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
})

const PHONE_TITLE = 'PREDICACION TELEFONICA'
const MORNING_HOURS = buildQuarterHourRange(9, 0, 10, 30)
const AFTERNOON_HOURS = buildQuarterHourRange(15, 30, 19, 0)
const PHONE_DAYS = new Set([1, 2, 3, 5])

function esSalidaHistorica(
  outing: Pick<OutingRecord, 'origen' | 'registro_id'>,
): boolean {
  return outing.origen === 'excel' || Boolean(outing.registro_id)
}

function normalizeDriverAvailability(value: unknown): DriverAvailability {
  if (!value || typeof value !== 'object') {
    return {
      days: [],
      turns: [],
    }
  }

  const availability = value as Partial<DriverAvailability>
  const days = Array.isArray(availability.days)
    ? availability.days.filter(
        (day): day is number =>
          typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6,
      )
    : []
  const turns = Array.isArray(availability.turns)
    ? availability.turns.filter(
        (turn): turn is DriverAvailabilityTurn =>
          turn === 'manana' || turn === 'tarde' || turn === 'telefonica',
      )
    : []
  const byDay = Object.entries(availability.byDay ?? {}).reduce<
    Record<string, DriverAvailabilityTurn[]>
  >((result, [day, dayTurns]) => {
    const numericDay = Number(day)

    if (
      !Number.isInteger(numericDay) ||
      numericDay < 0 ||
      numericDay > 6 ||
      !Array.isArray(dayTurns)
    ) {
      return result
    }

    const normalizedTurns = dayTurns.filter(
      (turn): turn is DriverAvailabilityTurn =>
        turn === 'manana' || turn === 'tarde' || turn === 'telefonica',
    )

    result[String(numericDay)] = Array.from(new Set(normalizedTurns))

    return result
  }, {})

  return {
    days: Array.from(new Set(days)),
    turns: Array.from(new Set(turns)),
    byDay,
  }
}

function getSlotTurn(slot: PlannerSlot | null): DriverAvailabilityTurn | null {
  if (!slot) {
    return null
  }

  if (slot.kind === 'phone') {
    return 'telefonica'
  }

  return slot.period
}

function isDriverAvailableForSlot(driver: DriverRecord, slot: PlannerSlot | null) {
  if (driver.status !== 'activo') {
    return false
  }

  if (!slot) {
    return true
  }

  const availability = normalizeDriverAvailability(driver.availability)
  const slotDate = new Date(slot.scheduledForValue)
  const slotDay = slotDate.getDay()
  const slotTurn = getSlotTurn(slot)
  const detailedTurns = availability.byDay?.[String(slotDay)]

  if (!slotTurn) {
    return false
  }

  if (detailedTurns) {
    return detailedTurns.includes(slotTurn)
  }

  const matchesDay = availability.days.includes(slotDay)
  const matchesTurn = availability.turns.includes(slotTurn)

  return matchesDay && matchesTurn
}

function buildQuarterHourRange(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
) {
  const values: string[] = []
  const cursor = new Date(2026, 7, 24, startHour, startMinute, 0, 0)
  const end = new Date(2026, 7, 24, endHour, endMinute, 0, 0)

  while (cursor.getTime() <= end.getTime()) {
    values.push(
      `${String(cursor.getHours()).padStart(2, '0')}:${String(cursor.getMinutes()).padStart(2, '0')}`,
    )
    cursor.setMinutes(cursor.getMinutes() + 15)
  }

  return values
}

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

// Dentro de un dia la fecha ya la dice el encabezado del grupo: en la
// tarjeta alcanza la hora.
const horaCorta = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' })

function formatLocalTime(value: string) {
  const fecha = new Date(value)
  return Number.isFinite(fecha.getTime()) ? horaCorta.format(fecha) : 'Sin hora'
}

function formatDateForPlanner(date: Date) {
  const label = dayFormatter.format(date)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatShortPlannerDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return shortDateFormatter.format(date).replace('.', '')
}

function toDateTimeLocalValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-') +
    'T' +
    [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
    ].join(':')
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function getOutingScheduleStatus(value: string) {
  const scheduledDate = new Date(value)
  const now = new Date()

  if (isSameLocalDay(scheduledDate, now)) {
    return {
      key: 'pendiente' as const,
      label: 'Hoy',
    }
  }

  if (scheduledDate.getTime() > now.getTime()) {
    return {
      key: 'activo' as const,
      label: 'Proxima',
    }
  }

  return {
    key: 'inactivo' as const,
    label: 'Pasada',
  }
}

function getGroupLabel(group: GroupRecord) {
  return group.group_number ? `Grupo ${group.group_number}` : group.group_name
}

function getGroupSelectionKey(group: GroupRecord) {
  return group.group_number ? `number-${group.group_number}` : `legacy-${group.group_name}`
}

function buildPlannerSlots(desde: Date, hasta: Date) {
  const slots: PlannerSlot[] = []
  const start = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate())
  const end = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const currentDate = new Date(start)
    currentDate.setDate(start.getDate() + dayIndex)

    const dayLabel = formatDateForPlanner(currentDate)
    const dayShort = dayLabel.split(',')[0]
    const dateKey = toDateTimeLocalValue(currentDate).slice(0, 10)

    MORNING_HOURS.forEach((timeLabel) => {
      const [hour, minute] = timeLabel.split(':').map(Number)
      const slotDate = new Date(currentDate)
      slotDate.setHours(hour, minute, 0, 0)

      slots.push({
        key: `${dateKey}-territorial-${timeLabel}`,
        dateKey,
        dayLabel,
        dayShort,
        timeLabel,
        scheduledForValue: toDateTimeLocalValue(slotDate),
        period: 'manana',
        kind: 'territorial',
        titleSuggestion: `Salida ${dayShort} ${timeLabel}`,
      })
    })

    AFTERNOON_HOURS.forEach((timeLabel) => {
      const [hour, minute] = timeLabel.split(':').map(Number)
      const slotDate = new Date(currentDate)
      slotDate.setHours(hour, minute, 0, 0)

      slots.push({
        key: `${dateKey}-territorial-${timeLabel}`,
        dateKey,
        dayLabel,
        dayShort,
        timeLabel,
        scheduledForValue: toDateTimeLocalValue(slotDate),
        period: 'tarde',
        kind: 'territorial',
        titleSuggestion: `Salida ${dayShort} ${timeLabel}`,
      })

      if (PHONE_DAYS.has(currentDate.getDay())) {
        slots.push({
          key: `${dateKey}-phone-${timeLabel}`,
          dateKey,
          dayLabel,
          dayShort,
          timeLabel,
          scheduledForValue: toDateTimeLocalValue(slotDate),
          period: 'tarde',
          kind: 'phone',
          titleSuggestion: PHONE_TITLE,
        })
      }
    })
  }

  return slots
}

export function SalidasPage({ groupServiceMode = false }: SalidasPageProps = {}) {
  const { profile } = useAuth()
  const client = supabase
  const [searchParams] = useSearchParams()
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [territories, setTerritories] = useState<TerritoryRecord[]>([])
  const [meetingPoints, setMeetingPoints] = useState<MeetingPointRecord[]>([])
  const [outings, setOutings] = useState<OutingRecord[]>([])
  // Cuantas hay en la base, no cuantas se trajeron: sin esto la pantalla no
  // puede decir que esta mostrando una parte, y una lista recortada en
  // silencio es una lista que miente.
  const [cuantasSalidasHay, setCuantasSalidasHay] = useState<number | null>(null)
  const [personalReservations, setPersonalReservations] = useState<
    PersonalTerritoryReservation[]
  >([])
  const [selectedOutingId, setSelectedOutingId] = useState<string | null>(null)
  const [editingOutingId, setEditingOutingId] = useState<string | null>(null)
  const [resultadoOutingId, setResultadoOutingId] = useState<string | null>(null)
  // El formulario vive en una ventana encima. Medido: abajo de la tabla
  // quedaba a 41.614 px de la ventana -- cuarenta y dos pantallas.
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null)
  const [activePlannerRowKey, setActivePlannerRowKey] = useState<string | null>(null)
  const [plannerDrafts, setPlannerDrafts] = useState<Record<string, PlannerDraft>>({})
  const [lastSuggestedTitle, setLastSuggestedTitle] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [territoryId, setTerritoryId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [meetingPointName, setMeetingPointName] = useState('')
  const [meetingPointId, setMeetingPointId] = useState<string | null>(null)
  const [scheduledFor, setScheduledFor] = useState('')
  const [notes, setNotes] = useState('')
  const [meetingCoords, setMeetingCoords] = useState<[number, number] | null>(null)
  const [territoryFilter, setTerritoryFilter] = useState('todos')
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('todos')
  const [grupoConsulta, setGrupoConsulta] = useState('todos')
  // La procedencia del Excel se traia entera al entrar: dos consultas de mil
  // filas y dieciseis columnas, la espera mas larga de la pantalla, para
  // llenar una ficha que se abre de a una. Ahora se pide por salida y se
  // guarda; null cacheado significa "esta no tiene".
  const [procedencias, setProcedencias] = useState<Map<string, OutingProvenance | null>>(
    () => new Map(),
  )
  const [pagina, setPagina] = useState(0)
  const [armarPrograma, setArmarPrograma] = useState(false)
  const [programa, setPrograma] = useState(() => crearEstadoPrograma())
  const [diaVisitaSuper, setDiaVisitaSuper] = useState('')
  const planificadorRef = useRef<HTMLElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [gpsPendientes, setGpsPendientes] = useState<GpsPendiente[]>([])

  const canManageGeneralOutings = profile?.role === 'admin'
  const salidasWriteScope =
    groupServiceMode && !canManageGeneralOutings ? 'grupo' : 'general'
  const plannerSlots = useMemo(
    () => buildPlannerSlots(deClaveFecha(programa.desde), deClaveFecha(programa.hasta)),
    [programa.desde, programa.hasta],
  )
  const plannerSlotsByDay = useMemo(() => {
    const grouped = new Map<string, PlannerSlot[]>()

    plannerSlots.forEach((slot) => {
      const current = grouped.get(slot.dateKey) ?? []
      current.push(slot)
      grouped.set(slot.dateKey, current)
    })

    return Array.from(grouped.entries()).map(([dateKey, slots]) => ({
      dateKey,
      dayLabel: slots[0]?.dayLabel ?? dateKey,
      morningSlots: slots.filter(
        (slot) => slot.period === 'manana' && slot.kind === 'territorial',
      ),
      afternoonSlots: slots.filter(
        (slot) => slot.period === 'tarde' && slot.kind === 'territorial',
      ),
      phoneSlots: slots.filter((slot) => slot.kind === 'phone'),
    }))
  }, [plannerSlots])

  const plannerRows = useMemo<PlannerRow[]>(
    () =>
      plannerSlotsByDay.flatMap((day) => {
        const rows: PlannerRow[] = [
          {
            key: `${day.dateKey}-manana`,
            dayLabel: day.dayLabel.split(',')[0] ?? day.dayLabel,
            dateLabel: formatShortPlannerDate(day.dateKey),
            periodLabel: 'Mañana',
            typeLabel: 'Salida territorial',
            slots: day.morningSlots,
          },
          {
            key: `${day.dateKey}-tarde`,
            dayLabel: day.dayLabel.split(',')[0] ?? day.dayLabel,
            dateLabel: formatShortPlannerDate(day.dateKey),
            periodLabel: 'Tarde',
            typeLabel: 'Salida territorial',
            slots: day.afternoonSlots,
          },
        ]

        if (day.phoneSlots.length > 0) {
          rows.push({
            key: `${day.dateKey}-telefonica`,
            dayLabel: day.dayLabel.split(',')[0] ?? day.dayLabel,
            dateLabel: formatShortPlannerDate(day.dateKey),
            periodLabel: 'Tarde',
            typeLabel: PHONE_TITLE,
            slots: day.phoneSlots,
          })
        }

        return rows
      }),
    [plannerSlotsByDay],
  )

  const selectedPlannerSlot = useMemo(
    () => plannerSlots.find((slot) => slot.key === selectedSlotKey) ?? null,
    [plannerSlots, selectedSlotKey],
  )

  const selectedFormTerritory = useMemo(
    () => territories.find((territory) => territory.id === territoryId) ?? null,
    [territories, territoryId],
  )

  const selectedTerritoryCenter = useMemo(() => {
    const ring = selectedFormTerritory?.polygon_geojson?.coordinates?.[0] ?? []
    if (ring.length === 0) {
      return null
    }

    const points =
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring

    const totals = points.reduce(
      (accumulator, [lng, lat]) => ({
        lng: accumulator.lng + lng,
        lat: accumulator.lat + lat,
      }),
      { lng: 0, lat: 0 },
    )

    return [totals.lng / points.length, totals.lat / points.length] as [number, number]
  }, [selectedFormTerritory])

  useEffect(() => {
    if (!client) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadData = async () => {
      setIsLoading(true)

      const [
        { data: driversData, error: driversError },
        { data: groupsData, error: groupsError },
        { data: territoriesData, error: territoriesError },
        { data: meetingPointsData, error: meetingPointsError },
        { data: outingsData, error: outingsError },
        { count: totalDeSalidas },
        { data: personalReservationsData, error: personalReservationsError },
      ] = await Promise.all([
        client
          .from('conductores')
          .select('id, full_name, status, availability')
          .order('full_name', { ascending: true }),
        client
          .from('grupos_servicio')
          .select('id, group_name, group_number, driver_id, manager_name, manager_role')
          .order('group_number', { ascending: true, nullsFirst: false })
          .order('group_name', { ascending: true }),
        client
          .from('territorios')
          .select('id, name, description, polygon_geojson')
          .order('name', { ascending: true }),
        client
          .from('puntos_encuentro')
          .select('id, nombre, barrio, lat, lng, maps_url, territory_id, activo, codigo, orden, tipo')
          .order('codigo', { ascending: true }),
        // Esta consulta no tenia filtro ni limite y ordenaba ascendente.
        // PostgREST corta en 1000 filas pase lo que pase, asi que devolvia
        // las MIL MAS VIEJAS y se comia el cupo entero: medido en el
        // navegador, las 1000 filas que llegaban a la pantalla decian
        // "Pasada" -- ni una sola salida futura. La pantalla que existe
        // para decir cuando y donde se sale no mostraba ninguna.
        // Descendente y acotada: entran siempre las proximas y el pasado
        // reciente. El total real se pide aparte para poder decirlo.
        client
          .from('salidas')
          .select(CAMPOS_SALIDA)
          .order('scheduled_for', { ascending: false })
          .limit(SALIDAS_QUE_SE_TRAEN),
        client.from('salidas').select('id', { count: 'exact', head: true }),
        client
          .from('territorio_personal_reservas')
          .select('id, territory_id, reserved_for, status, reserved_at')
          .eq('status', 'activa')
          .order('reserved_at', { ascending: false }),
      ])

      const faltaColumna =
        Boolean(outingsError?.message) &&
        /conductor_texto|territorio_codigo|column/i.test(outingsError?.message ?? '')

      const [outingsResueltas, outingsErrorFinal] = faltaColumna
        ? await (async () => {
            const { data, error } = await client
              .from('salidas')
              .select(CAMPOS_SALIDA_VIEJOS)
              .order('scheduled_for', { ascending: false })
              .limit(SALIDAS_QUE_SE_TRAEN)
            return [data, error] as const
          })()
        : [outingsData, outingsError]

      if (!isMounted) {
        return
      }

      const loadError =
        driversError?.message ||
        groupsError?.message ||
        territoriesError?.message ||
        meetingPointsError?.message ||
        outingsErrorFinal?.message ||
        personalReservationsError?.message

      if (loadError) {
        setError(loadError)
        setDrivers([])
        setGroups([])
        setTerritories([])
        setMeetingPoints([])
        setOutings([])
        setPersonalReservations([])
      } else {
        setError(null)
        setDrivers((driversData as DriverRecord[]) ?? [])
        setGroups((groupsData as GroupRecord[]) ?? [])
        setTerritories((territoriesData as TerritoryRecord[]) ?? [])
        setMeetingPoints((meetingPointsData as MeetingPointRecord[]) ?? [])
        setOutings((outingsResueltas as OutingRecord[]) ?? [])
        setCuantasSalidasHay(totalDeSalidas ?? null)
        setPersonalReservations(
          (personalReservationsData as PersonalTerritoryReservation[]) ?? [],
        )
      }

      setIsLoading(false)
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [client])

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.status === 'activo'),
    [drivers],
  )

  const getAvailableDriversForSlot = (slot: PlannerSlot | null) => {
    return activeDrivers.filter((driver) =>
      isDriverAvailableForSlot(driver, slot),
    )
  }

  const selectableGroups = useMemo(() => {
    const uniqueGroups = new Map<string, GroupRecord>()

    groups.forEach((group) => {
      const key = getGroupSelectionKey(group)
      const existingGroup = uniqueGroups.get(key)

      if (!existingGroup || existingGroup.manager_role === 'auxiliar') {
        uniqueGroups.set(key, group)
      }
    })

    return Array.from(uniqueGroups.values())
  }, [groups])

  const serviceGroupAssignments = useMemo(
    () =>
      groups.filter(
        (group) =>
          group.driver_id === profile?.driver_id &&
          (group.manager_role === 'superintendente' ||
            group.manager_role === 'auxiliar'),
      ),
    [groups, profile?.driver_id],
  )
  const currentServiceGroup = serviceGroupAssignments[0] ?? null
  const isGroupServiceDelegate = groupServiceMode && !canManageGeneralOutings
  const selectedAdminGroupId = grupoConsulta === 'todos' ? '' : grupoConsulta
  const lockedGroupId = isGroupServiceDelegate
    ? currentServiceGroup?.id ?? ''
    : groupServiceMode
      ? groupId || selectedAdminGroupId
      : groupId
  const canManageOutings =
    canManageGeneralOutings || (groupServiceMode && serviceGroupAssignments.length > 0)
  const rangoDesdeFecha = deClaveFecha(programa.desde)
  const rangoHastaFecha = deClaveFecha(programa.hasta)
  const diasDelPrograma = contarDiasInclusive(rangoDesdeFecha, rangoHastaFecha)
  const frasePrograma = fraseDelRango(rangoDesdeFecha, rangoHastaFecha)
  const tildadasDelPrograma = Object.values(plannerDrafts).filter((draft) => draft.enabled)
  const semanasPrograma = useMemo(
    () => semanasDelRango(rangoDesdeFecha, rangoHastaFecha),
    [programa.desde, programa.hasta],
  )
  const salidasYaEnRango = useMemo(() => {
    const porDia = new Map<string, number>()
    outings.forEach((outing) => {
      const clave = claveFechaLocal(outing.scheduled_for)
      if (clave < programa.desde || clave > programa.hasta) return
      porDia.set(clave, (porDia.get(clave) ?? 0) + 1)
    })
    return porDia
  }, [outings, programa.desde, programa.hasta])
  const filasPorSemana = useMemo(
    () =>
      semanasPrograma.map((semana) => ({
        ...semana,
        filas: plannerRows.filter((row) => {
          const fecha = row.key.slice(0, 10)
          return fecha >= semana.desdeClave && fecha <= semana.hastaClave
        }),
        yaHay: Array.from(salidasYaEnRango.entries()).reduce((total, [clave, cuantas]) => {
          if (clave < semana.desdeClave || clave > semana.hastaClave) return total
          return total + cuantas
        }, 0),
      })),
    [plannerRows, salidasYaEnRango, semanasPrograma],
  )

  const outingDetails = useMemo(
    () =>
      outings.map((outing) => {
        const selectedGroup = groups.find((group) => group.id === outing.group_id)

        return {
          ...outing,
          territoryName: textoTerritorio({
            territory_id: outing.territory_id,
            territorio_codigo: outing.territorio_codigo,
            territoryName:
              territories.find((territory) => territory.id === outing.territory_id)
                ?.name ?? null,
          }),
          driverName: textoConductor({
            driver_id: outing.driver_id,
            conductor_texto: outing.conductor_texto,
            driverName:
              drivers.find((driver) => driver.id === outing.driver_id)?.full_name ??
              null,
          }),
          groupName: selectedGroup ? getGroupLabel(selectedGroup) : 'Sin grupo',
          scheduleStatus: getOutingScheduleStatus(outing.scheduled_for),
          provenance: procedencias.get(outing.id) ?? null,
        }
      }),
    [drivers, groups, outings, procedencias, territories],
  )

  const visibleOutingDetails = useMemo(
    () => {
      const base =
        groupServiceMode && !canManageGeneralOutings
          ? outingDetails.filter((outing) => outing.group_id === lockedGroupId)
          : outingDetails
      if (
        groupServiceMode &&
        canManageGeneralOutings &&
        grupoConsulta !== 'todos'
      ) {
        return base.filter((outing) => outing.group_id === grupoConsulta)
      }
      return base
    },
    [
      canManageGeneralOutings,
      groupServiceMode,
      grupoConsulta,
      lockedGroupId,
      outingDetails,
    ],
  )

  const reservedTerritoriesByOtherGroups = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const reservations = new Map<string, string>()

    if (!groupServiceMode || !lockedGroupId) {
      return reservations
    }

    outingDetails.forEach((outing) => {
      if (
        outing.territory_id &&
        outing.group_id &&
        outing.group_id !== lockedGroupId &&
        new Date(outing.scheduled_for).getTime() >= today.getTime()
      ) {
        reservations.set(outing.territory_id, outing.groupName)
      }
    })

    return reservations
  }, [groupServiceMode, lockedGroupId, outingDetails])

  const reservedTerritoriesByPersonalUse = useMemo(() => {
    const reservations = new Map<string, string>()

    personalReservations.forEach((reservation) => {
      reservations.set(reservation.territory_id, reservation.reserved_for)
    })

    return reservations
  }, [personalReservations])

  useEffect(() => {
    if (isGroupServiceDelegate && currentServiceGroup?.id && groupId !== currentServiceGroup.id) {
      setGroupId(currentServiceGroup.id)
    }
  }, [currentServiceGroup?.id, groupId, isGroupServiceDelegate])

  const filteredOutings = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    const now = new Date()

    return visibleOutingDetails.filter((outing) => {
      const matchesTerritory =
        territoryFilter === 'todos' ? true : outing.territory_id === territoryFilter

      if (!matchesTerritory) {
        return false
      }

      const scheduledDate = new Date(outing.scheduled_for)
      const matchesSchedule =
        scheduleFilter === 'todos'
          ? true
          : scheduleFilter === 'sin-conductor'
            ? saleSinConductor(outing) &&
              (outing.scheduleStatus.label === 'Hoy' ||
                outing.scheduleStatus.label === 'Proxima')
          : scheduleFilter === 'hoy'
            ? isSameLocalDay(scheduledDate, now)
            : scheduleFilter === 'proximas'
              ? scheduledDate.getTime() > now.getTime() && !isSameLocalDay(scheduledDate, now)
              : scheduledDate.getTime() < now.getTime() && !isSameLocalDay(scheduledDate, now)

      if (!matchesSchedule) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const haystack = [
        outing.title,
        outing.territoryName,
        outing.driverName,
        outing.groupName,
        outing.meeting_point_name,
        outing.conductor_texto ?? '',
        outing.territorio_codigo ?? '',
        outing.notes ?? '',
        // La procedencia del Excel ya no se busca: se carga al abrir la
        // ficha, y buscar en un campo que solo tienen las salidas que
        // alguien miro antes da resultados que cambian sin motivo. El texto
        // de conductor del Excel vive igual en conductor_texto, mas arriba.
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [scheduleFilter, searchTerm, territoryFilter, visibleOutingDetails])

  useEffect(() => {
    setPagina(0)
  }, [scheduleFilter, searchTerm, territoryFilter, grupoConsulta])

  useEffect(() => {
    if (searchParams.get('agenda') === 'sin-conductor') {
      setScheduleFilter('sin-conductor')
    }
  }, [searchParams])

  useEffect(() => {
    if (!armarPrograma) return
    planificadorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [armarPrograma])

  useEffect(() => {
    setPlannerDrafts((current) => {
      const vigentes = new Set(plannerRows.map((row) => row.key))
      let cambia = false
      const next: Record<string, PlannerDraft> = {}
      for (const [key, draft] of Object.entries(current)) {
        if (vigentes.has(key)) {
          next[key] = draft
        } else {
          cambia = true
        }
      }
      return cambia ? next : current
    })
  }, [plannerRows])

  // La agenda abre en lo que viene. Lo anterior existe y se dice cuanto hay,
  // pero se trae a pedido: son 25 tarjetas por tanda y nadie entra a esta
  // pantalla para leer el mes pasado.
  const { proximas, anteriores } = useMemo(
    () => partirAgenda(filteredOutings),
    [filteredOutings],
  )
  // Si no hay nada por delante -filtro "Pasadas", o una congregacion que no
  // programo todavia- lo anterior se muestra de entrada: si no, la pantalla
  // abria vacia con un boton para ver lo unico que hay.
  const anterioresAMostrar =
    (proximas.length === 0 ? pagina + 1 : pagina) * SALIDAS_POR_PAGINA
  const diasProximas = useMemo(() => agruparPorDia(proximas), [proximas])
  const diasAnteriores = useMemo(
    () => agruparPorDia(anteriores.slice(0, anterioresAMostrar)),
    [anteriores, anterioresAMostrar],
  )
  const anterioresQueFaltan = Math.max(0, anteriores.length - anterioresAMostrar)
  const filtrosActivos = territoryFilter !== 'todos' || scheduleFilter !== 'todos'

  const selectedOuting = useMemo(
    () => visibleOutingDetails.find((outing) => outing.id === selectedOutingId) ?? null,
    [selectedOutingId, visibleOutingDetails],
  )

  // Desde outingDetails y no desde outings, para que la procedencia que se
  // trae a pedido tambien llegue al formulario de "Completar".
  const editingOuting = useMemo(
    () => outingDetails.find((outing) => outing.id === editingOutingId) ?? null,
    [editingOutingId, outingDetails],
  )
  const resultadoOuting = useMemo(
    () => outings.find((outing) => outing.id === resultadoOutingId) ?? null,
    [outings, resultadoOutingId],
  )

  // Solo las salidas que alguien esta mirando de verdad.
  useEffect(() => {
    const client = supabase
    if (!client) return
    const pedir = [selectedOutingId, editingOutingId].filter(
      (id): id is string => Boolean(id) && !procedencias.has(id as string),
    )
    if (pedir.length === 0) return

    let vivo = true
    void client
      .from('salida_importacion_procedencia')
      .select(
        'id, salida_id, importacion_id, registro_id, application_id, source_sha256, parser_version, source_sheet, source_row, source_range, source_conductor_text, source_conductor_alias_id, source_priorizar, source_narrative, source_status, source_resolution_status',
      )
      .in('salida_id', pedir)
      .then(({ data }) => {
        if (!vivo) return
        const encontradas = new Map(
          ((data as OutingProvenance[]) ?? []).map((fila) => [fila.salida_id, fila]),
        )
        setProcedencias((previas) => {
          const siguiente = new Map(previas)
          // Se cachea tambien la ausencia: sin esto, una salida cargada a
          // mano vuelve a preguntar cada vez que se la toca.
          for (const id of pedir) siguiente.set(id, encontradas.get(id) ?? null)
          return siguiente
        })
      })

    return () => { vivo = false }
  }, [editingOutingId, procedencias, selectedOutingId])
  const editingHistorical = Boolean(editingOuting && esSalidaHistorica(editingOuting))
  const canReportSelectedResult = Boolean(
    resultadoOuting &&
      (canManageGeneralOutings ||
        (profile?.driver_id && resultadoOuting.driver_id === profile.driver_id)),
  )
  const canCorrectSelectedResult = canManageGeneralOutings

  // Antes se mostraban cuatro cifras: total, hoy, con grupo y proximas. La
  // unica que pedia hacer algo era "con grupo", y dicha al reves: lo que
  // hay que resolver no son las que ya tienen, son las que no. Una salida
  // que ya paso sin conductor no se arregla, asi que solo cuentan las que
  // todavia no ocurrieron.
  const proximasSinConductor = visibleOutingDetails.filter(
    (outing) =>
      saleSinConductor(outing) &&
      (outing.scheduleStatus.label === 'Hoy' || outing.scheduleStatus.label === 'Proxima'),
  ).length

  const cerrarFormulario = () => {
    setFormularioAbierto(false)
    setResultadoOutingId(null)
    resetForm()
    setError(null)
  }

  const abrirNueva = () => {
    setResultadoOutingId(null)
    resetForm()
    setError(null)
    setMessage(null)
    setFormularioAbierto(true)
  }

  const resetForm = () => {
    setEditingOutingId(null)
    setSelectedSlotKey(null)
    setLastSuggestedTitle(null)
    setTitle('')
    setTerritoryId('')
    setDriverId('')
    setGroupId(isGroupServiceDelegate ? currentServiceGroup?.id ?? '' : '')
    setMeetingPointName('')
    setMeetingPointId(null)
    setScheduledFor('')
    setNotes('')
    setMeetingCoords(null)
  }

  const handleUseTerritoryCenter = () => {
    if (editingHistorical) {
      setError('Una salida histórica no toma coordenadas sugeridas: elegí un punto o marcá uno en el mapa.')
      return
    }

    if (!selectedFormTerritory || !selectedTerritoryCenter) {
      return
    }

    setMeetingPointId(null)
    setMeetingCoords(selectedTerritoryCenter)

    if (!meetingPointName.trim()) {
      setMeetingPointName(`Encuentro ${selectedFormTerritory.name}`)
    }

    setMessage(`Punto sugerido cargado en el centro de ${selectedFormTerritory.name}.`)
    setError(null)
  }

  const handleSelectPlannerSlot = (slot: PlannerSlot) => {
    // Elegir un horario en la grilla es empezar a cargar una salida, asi
    // que abre el formulario con ese horario ya puesto.
    setFormularioAbierto(true)
    setSelectedSlotKey(slot.key)
    setScheduledFor(slot.scheduledForValue)
    setDriverId((currentDriverId) => {
      const currentDriver = activeDrivers.find((driver) => driver.id === currentDriverId)

      return currentDriver && isDriverAvailableForSlot(currentDriver, slot)
        ? currentDriverId
        : ''
    })
    setError(null)
    setMessage(
      slot.kind === 'phone'
        ? `Slot elegido: ${PHONE_TITLE} ${slot.dayLabel} ${slot.timeLabel}.`
        : `Slot elegido: ${slot.dayLabel} ${slot.timeLabel}.`,
    )

    const shouldReplaceTitle =
      !title.trim() ||
      title === lastSuggestedTitle ||
      title === PHONE_TITLE ||
      title.startsWith('Salida ')

    if (shouldReplaceTitle) {
      setTitle(slot.titleSuggestion)
      setLastSuggestedTitle(slot.titleSuggestion)
    }
  }

  const handleClearPlannerSlot = () => {
    setSelectedSlotKey(null)
    setScheduledFor('')
    setError(null)
    setMessage(null)

    if (title === lastSuggestedTitle || title === PHONE_TITLE || title.startsWith('Salida ')) {
      setTitle('')
      setLastSuggestedTitle(null)
    }
  }

  const updatePlannerDraft = (
    row: PlannerRow,
    updater: (draft: PlannerDraft) => PlannerDraft,
  ) => {
    const fallbackSlot = row.slots[0]

    if (!fallbackSlot) {
      return
    }

    setPlannerDrafts((current) => {
      const currentDraft = current[row.key] ?? {
        enabled: false,
        slotKey: fallbackSlot.key,
        meetingPointName: '',
        meetingPointId: '',
        driverId: '',
        territoryId: '',
        meetingCoords: null,
        mapOpen: false,
      }

      return {
        ...current,
        [row.key]: updater(currentDraft),
      }
    })
  }

  const persistirGpsEnPunto = async (gps: GpsPendiente) => {
    if (!client) {
      setError('Todavía no está configurada la conexión con la base.')
      return
    }

    const { error: saveError } = await client
      .from('puntos_encuentro')
      .update({
        lat: gps.lat,
        lng: gps.lng,
        gps_origen: 'manual',
      })
      .eq('id', gps.id)

    if (saveError) {
      setError(`No se pudo guardar el GPS del punto ${gps.codigo}.`)
      return
    }

    setMeetingPoints((actuales) =>
      actuales.map((punto) =>
        punto.id === gps.id ? { ...punto, lat: gps.lat, lng: gps.lng } : punto,
      ),
    )
    setGpsPendientes((actuales) => actuales.filter((punto) => punto.id !== gps.id))
    setMessage(`GPS guardado en el punto ${gps.codigo}.`)
  }

  const handleSelectPlannerRowSlot = (row: PlannerRow, slotKey: string) => {
    const slot = row.slots.find((item) => item.key === slotKey)

    if (!slot) {
      return
    }

    updatePlannerDraft(row, (draft) => ({
      ...draft,
      enabled: true,
      slotKey: slot.key,
      driverId: activeDrivers.some(
        (driver) =>
          driver.id === draft.driverId && isDriverAvailableForSlot(driver, slot),
      )
        ? draft.driverId
        : '',
    }))
    setActivePlannerRowKey(row.key)
    handleSelectPlannerSlot(slot)
  }

  const handleTogglePlannerRow = (row: PlannerRow, checked: boolean) => {
    if (checked) {
      const preferredSlot =
        row.slots.find((slot) => slot.key === plannerDrafts[row.key]?.slotKey) ??
        row.slots[0]

      if (preferredSlot) {
        handleSelectPlannerRowSlot(row, preferredSlot.key)
      }

      return
    }

    updatePlannerDraft(row, (draft) => ({
      ...draft,
      enabled: false,
      mapOpen: false,
    }))

    if (activePlannerRowKey === row.key) {
      setActivePlannerRowKey(null)
    }

    if (row.slots.some((slot) => slot.key === selectedSlotKey)) {
      handleClearPlannerSlot()
    }
  }

  const handlePlannerDraftFieldChange = (
    row: PlannerRow,
    changes: Partial<PlannerDraft>,
  ) => {
    updatePlannerDraft(row, (draft) => ({
      ...draft,
      enabled: true,
      ...changes,
    }))
    setActivePlannerRowKey(row.key)
  }

  const handleTogglePlannerMap = (row: PlannerRow) => {
    updatePlannerDraft(row, (draft) => ({
      ...draft,
      enabled: true,
      mapOpen: !draft.mapOpen,
    }))
    setActivePlannerRowKey(row.key)
  }

  useEffect(() => {
    if (!scheduledFor) {
      return
    }

    const matchingSlot = plannerSlots.find((slot) => {
      if (slot.scheduledForValue !== scheduledFor) {
        return false
      }

      if (slot.kind === 'phone') {
        return title.toUpperCase() === PHONE_TITLE
      }

      return title.toUpperCase() !== PHONE_TITLE
    })

    if (matchingSlot) {
      setSelectedSlotKey(matchingSlot.key)
    }
  }, [plannerSlots, scheduledFor, title])

  const startEditing = (outing: OutingRecord) => {
    setFormularioAbierto(true)
    setResultadoOutingId(null)
    setSelectedOutingId(outing.id)
    setEditingOutingId(outing.id)
    setTitle(outing.title)
    setTerritoryId(outing.territory_id ?? '')
    setDriverId(outing.driver_id ?? '')
    setGroupId(outing.group_id ?? '')
    setMeetingPointName(outing.meeting_point_name ?? '')
    setMeetingPointId(outing.meeting_point_id ?? null)
    setScheduledFor(new Date(outing.scheduled_for).toISOString().slice(0, 16))
    // La procedencia ya vive en su tabla inmutable. notes queda disponible
    // solamente para observaciones humanas.
    setNotes(outing.notes ?? '')
    setMeetingCoords(
      outing.meeting_point_lng !== null && outing.meeting_point_lat !== null
        ? [outing.meeting_point_lng, outing.meeting_point_lat]
        : null,
    )
    setLastSuggestedTitle(null)
    setError(null)
    setMessage(null)
  }

  const openResultFor = (outing: OutingRecord) => {
    setSelectedOutingId(outing.id)
    setResultadoOutingId(outing.id)
    setFormularioAbierto(true)
    setError(null)
    setMessage(null)
  }

  const handleDelete = async (outing: OutingRecord) => {
    if (!client || !canManageOutings) {
      return
    }

    if (esSalidaHistorica(outing)) {
      setError('Las salidas históricas no se borran; se corrigen o completan de forma auditable.')
      return
    }

    const confirmed = window.confirm(`Se eliminara la salida "${outing.title}".`)

    if (!confirmed) {
      return
    }

    setError(null)
    setMessage(null)

    setIsSaving(true)
    try {
      const { error: deleteError } = await client.rpc('borrar_salida', {
        p_scope: salidasWriteScope,
        p_salida_id: outing.id,
      })

      if (deleteError) {
        setError(deleteError.code === '23503'
          ? 'Esta salida tiene registros relacionados y no puede borrarse. Conservá su historial y registrá una corrección o cancelación.'
          : mensajeErrorSalidas(deleteError, 'No se pudo eliminar la salida.'))
        return
      }

      setOutings((current) => current.filter((item) => item.id !== outing.id))
      if (selectedOutingId === outing.id) {
        setSelectedOutingId(null)
      }
      if (editingOutingId === outing.id) {
        resetForm()
      }
      setMessage('Salida eliminada correctamente.')
    } catch (caught) {
      setError(mensajeErrorSalidas(caught, 'No se pudo eliminar la salida.'))
    } finally {
      setIsSaving(false)
    }
  }

  const buildDraftPdf = async (
    pdfTitle: string,
    pdfScheduledFor: string,
    pdfTerritoryName: string,
    pdfDriverName: string,
    pdfGroupName: string,
    pdfMeetingPointName: string,
    pdfMeetingCoords: [number, number],
    pdfNotes: string,
  ) => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    let cursorY = 18

    doc.setFontSize(18)
    doc.text('Ficha de salida', 14, cursorY)
    cursorY += 10

    doc.setFontSize(11)
    doc.text(`Titulo: ${pdfTitle}`, 14, cursorY)
    cursorY += 8
    doc.text(`Fecha y hora: ${formatLocalDate(new Date(pdfScheduledFor).toISOString())}`, 14, cursorY)
    cursorY += 8
    doc.text(`Territorio: ${pdfTerritoryName}`, 14, cursorY)
    cursorY += 8
    doc.text(`Conductor: ${pdfDriverName}`, 14, cursorY)
    cursorY += 8
    doc.text(`Grupo: ${pdfGroupName}`, 14, cursorY)
    cursorY += 8
    doc.text(`Direccion / encuentro: ${pdfMeetingPointName}`, 14, cursorY)
    cursorY += 8
    doc.text(
      `GPS: ${pdfMeetingCoords[1].toFixed(6)}, ${pdfMeetingCoords[0].toFixed(6)}`,
      14,
      cursorY,
    )
    cursorY += 8

    const mapsUrl = `https://www.google.com/maps?q=${pdfMeetingCoords[1]},${pdfMeetingCoords[0]}`
    doc.textWithLink('Abrir punto en Google Maps', 14, cursorY, { url: mapsUrl })
    cursorY += 10

    doc.setFontSize(12)
    doc.text('Observaciones', 14, cursorY)
    cursorY += 6
    doc.setFontSize(11)
    doc.splitTextToSize(pdfNotes || 'Sin observaciones', 165).forEach((line: string) => {
      doc.text(line, 14, cursorY)
      cursorY += 6
    })

    doc.save(
      `salida-${new Date(pdfScheduledFor).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.pdf`,
    )
  }

  const handleDownloadDraftPdf = async () => {
    const driverName =
      drivers.find((driver) => driver.id === driverId)?.full_name ?? 'Sin conductor'
    const groupName =
      groups.find((group) => group.id === lockedGroupId)?.group_name ?? 'Sin grupo'
    const territoryName = selectedFormTerritory?.name ?? 'Sin territorio'

    if (
      !title.trim() ||
      !territoryId ||
      !driverId ||
      !meetingPointName.trim() ||
      !scheduledFor ||
      !meetingCoords
    ) {
      setError(
        'Para el PDF falta completar título, territorio, conductor, dirección, horario y el punto en el mapa.',
      )
      return
    }

    await buildDraftPdf(
      title.trim(),
      scheduledFor,
      territoryName,
      driverName,
      groupName,
      meetingPointName.trim(),
      meetingCoords,
      notes.trim(),
    )
    setMessage('PDF de la salida descargado correctamente.')
    setError(null)
  }

  const handleDownloadSavedPdf = async (outing: (typeof outingDetails)[number]) => {
    if (outing.meeting_point_lat === null || outing.meeting_point_lng === null) {
      setError('Esta salida histórica no tiene coordenadas; no se puede generar el PDF todavía.')
      return
    }
    await buildDraftPdf(
      outing.title,
      new Date(outing.scheduled_for).toISOString().slice(0, 16),
      outing.territoryName,
      outing.driverName,
      outing.groupName,
      outing.meeting_point_name ?? 'Punto histórico sin geolocalizar',
      [outing.meeting_point_lng, outing.meeting_point_lat],
      outing.notes ?? '',
    )
    setMessage('PDF de la salida descargado correctamente.')
    setError(null)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Todavía no está configurada la conexión con la base.')
      return
    }

    if (!canManageOutings) {
      setError(
        groupServiceMode
          ? 'Solo superintendentes o auxiliares asociados a un grupo pueden crear estas salidas.'
          : 'Solo un administrador puede crear salidas.',
      )
      return
    }

    const existingOuting = editingOutingId
      ? outings.find((outing) => outing.id === editingOutingId) ?? null
      : null
    const historicalEdit = Boolean(existingOuting && esSalidaHistorica(existingOuting))
    const effectiveTitle = title.trim() || existingOuting?.title || ''
    const effectiveTerritoryId = historicalEdit
      ? territoryId || existingOuting?.territory_id || ''
      : territoryId
    const effectiveDriverId = historicalEdit
      ? driverId || existingOuting?.driver_id || ''
      : driverId
    const effectiveGroupId = historicalEdit
      ? groupId || existingOuting?.group_id || null
      : lockedGroupId || null
    const effectiveScheduledFor = historicalEdit
      ? existingOuting?.scheduled_for || ''
      : scheduledFor
    const selectedMeetingPoint = meetingPointId
      ? meetingPoints.find((point) => point.id === meetingPointId) ?? null
      : null
    const effectiveMeetingCoords: [number, number] | null =
      meetingCoords ??
      (selectedMeetingPoint &&
      selectedMeetingPoint.lat !== null &&
      selectedMeetingPoint.lng !== null
        ? [selectedMeetingPoint.lng, selectedMeetingPoint.lat]
        : existingOuting &&
            existingOuting.meeting_point_lat !== null &&
            existingOuting.meeting_point_lng !== null
          ? [existingOuting.meeting_point_lng, existingOuting.meeting_point_lat]
          : null)
    const enteredMeetingPointName = meetingPointName.trim()
    const storedMeetingPointName = existingOuting?.meeting_point_name?.trim() ?? ''
    const coordinatesChanged = Boolean(
      historicalEdit &&
        existingOuting &&
        meetingCoords &&
        (existingOuting.meeting_point_lat === null ||
          existingOuting.meeting_point_lng === null ||
          meetingCoords[1] !== existingOuting.meeting_point_lat ||
          meetingCoords[0] !== existingOuting.meeting_point_lng),
    )
    const pointDetailsChanged = Boolean(
      historicalEdit &&
        existingOuting &&
        ((enteredMeetingPointName !== '' &&
          enteredMeetingPointName !== storedMeetingPointName) ||
          coordinatesChanged ||
          (meetingPointId !== null && meetingPointId !== existingOuting.meeting_point_id)),
    )
    const effectiveMeetingPointId = historicalEdit
      ? pointDetailsChanged
        ? meetingPointId
        : existingOuting?.meeting_point_id ?? null
      : meetingPointId
    const effectiveMeetingPointName =
      enteredMeetingPointName || existingOuting?.meeting_point_name || null
    const effectiveNotes = historicalEdit
      ? notes.trim() || existingOuting?.notes || null
      : notes.trim() || null

    const esTelefonica = title.toUpperCase() === PHONE_TITLE

    if (historicalEdit) {
      if (!effectiveTitle || !effectiveScheduledFor) {
        setError('La salida histórica necesita conservar al menos su título y su horario.')
        return
      }
    } else if (
      !title.trim() ||
      !scheduledFor ||
      !driverId ||
      (!esTelefonica && !meetingPointName.trim()) ||
      (!esTelefonica && !territoryId && !meetingPointId)
    ) {
      setError(
        esTelefonica
          ? 'Faltan datos: título, conductor y horario.'
          : 'Faltan datos: título, conductor, punto de encuentro y horario.',
      )
      return
    }

    if (!historicalEdit && groupServiceMode && !lockedGroupId) {
      setError('Elegí el grupo de servicio antes de guardar la salida.')
      return
    }

    if (!historicalEdit && !esTelefonica && !effectiveMeetingCoords) {
      setError('Falta marcar en el mapa dónde se juntan.')
      return
    }

    const reservedByGroup = effectiveTerritoryId
      ? reservedTerritoriesByOtherGroups.get(effectiveTerritoryId)
      : null

    if (reservedByGroup) {
      setError(`El territorio ya esta reservado por ${reservedByGroup}.`)
      return
    }

    const reservedForPersonalUse = effectiveTerritoryId
      ? reservedTerritoriesByPersonalUse.get(effectiveTerritoryId)
      : null

    if (reservedForPersonalUse) {
      setError(`El territorio esta reservado personalmente para ${reservedForPersonalUse}.`)
      return
    }

    const outingBeingEditedId = editingOutingId
    setIsSaving(true)

    try {
      const payload = {
        title: effectiveTitle,
        territory_id: effectiveTerritoryId || null,
        driver_id: effectiveDriverId || null,
        group_id: effectiveGroupId,
        meeting_point_id: effectiveMeetingPointId,
        meeting_point_name: effectiveMeetingPointName,
        meeting_point_lat: effectiveMeetingCoords
          ? Number(effectiveMeetingCoords[1].toFixed(6))
          : null,
        meeting_point_lng: effectiveMeetingCoords
          ? Number(effectiveMeetingCoords[0].toFixed(6))
          : null,
        // En una salida histórica se manda el instante almacenado, nunca el
        // valor local del input. La fecha y la hora forman parte de la fuente.
        scheduled_for: historicalEdit
          ? existingOuting!.scheduled_for
          : new Date(effectiveScheduledFor).toISOString(),
        notes: effectiveNotes,
      }

      const { data, error: saveError } = outingBeingEditedId
        ? await client
            .rpc('editar_salida', {
              p_scope: salidasWriteScope,
              p_salida_id: outingBeingEditedId,
              p_title: payload.title,
              p_territory_id: payload.territory_id,
              p_driver_id: payload.driver_id,
              p_group_id: payload.group_id,
              p_meeting_point_id: payload.meeting_point_id,
              p_meeting_point_name: payload.meeting_point_name,
              p_meeting_point_lat: payload.meeting_point_lat,
              p_meeting_point_lng: payload.meeting_point_lng,
              p_scheduled_for: payload.scheduled_for,
              p_notes: payload.notes,
            })
            .select(SALIDAS_RPC_FIELDS)
            .single()
        : await client
            .rpc('crear_salida', {
              p_scope: salidasWriteScope,
              p_title: payload.title,
              p_territory_id: payload.territory_id,
              p_driver_id: payload.driver_id,
              p_group_id: payload.group_id,
              p_meeting_point_id: payload.meeting_point_id,
              p_meeting_point_name: payload.meeting_point_name,
              p_meeting_point_lat: payload.meeting_point_lat,
              p_meeting_point_lng: payload.meeting_point_lng,
              p_scheduled_for: payload.scheduled_for,
              p_notes: payload.notes,
            })
            .select(SALIDAS_RPC_FIELDS)
            .single()

      if (saveError || !data) {
        setError(mensajeErrorSalidas(saveError, 'No se pudo guardar la salida.'))
        return
      }

      const savedOuting: OutingRecord = {
        ...(data as OutingRecord),
        provenance: existingOuting?.provenance ?? null,
      }
      setOutings((current) =>
        [...current.filter((item) => item.id !== savedOuting.id), savedOuting].sort(
          (left, right) =>
            new Date(left.scheduled_for).getTime() -
            new Date(right.scheduled_for).getTime(),
        ),
      )
      setSelectedOutingId(savedOuting.id)
      const gpsPendiente = gpsNuevoDelPunto(
        meetingPoints.find((punto) => punto.id === effectiveMeetingPointId),
        effectiveMeetingCoords,
      )
      setGpsPendientes(gpsPendiente ? [gpsPendiente] : [])
      setMessage(
        outingBeingEditedId
          ? gpsPendiente
            ? `Salida actualizada. ¿Guardar este GPS en el punto ${gpsPendiente.codigo}?`
            : 'Salida actualizada correctamente.'
          : gpsPendiente
            ? `Salida guardada. ¿Guardar este GPS en el punto ${gpsPendiente.codigo}?`
            : 'Salida guardada correctamente.',
      )
      resetForm()
      setFormularioAbierto(false)
    } catch (caught) {
      setError(mensajeErrorSalidas(caught, 'No se pudo guardar la salida.'))
    } finally {
      setIsSaving(false)
    }
  }

  const confirmarSiSePierdenTildadas = (desde: string, hasta: string) => {
    const fuera = Object.entries(plannerDrafts).filter(
      ([key, draft]) =>
        draft.enabled && (key.slice(0, 10) < desde || key.slice(0, 10) > hasta),
    )
    if (fuera.length === 0) return true
    return window.confirm(
      fuera.length === 1
        ? 'Hay una salida tildada fuera de esas fechas. Se saca de este armado; la agenda no se toca.'
        : `Hay ${fuera.length} salidas tildadas fuera de esas fechas. Se sacan de este armado; la agenda no se toca.`,
    )
  }

  const aplicarRango = (desde: string, hasta: string, preset: PresetPrograma) => {
    const errorRango = validarRango(deClaveFecha(desde), deClaveFecha(hasta))
    if (errorRango) {
      setError(errorRango)
      return false
    }
    if (!confirmarSiSePierdenTildadas(desde, hasta)) return false
    setError(null)
    setPrograma({ preset, desde, hasta })
    return true
  }

  const aplicarPreset = (preset: Exclude<PresetPrograma, 'personalizado'>) => {
    let visitaClave = ''
    if (preset === 'semana-del-super') {
      const yaEsSemanaCompleta =
        rangoDesdeFecha.getDay() === 1 &&
        rangoHastaFecha.getDay() === 0 &&
        diasDelPrograma === 7
      visitaClave =
        diaVisitaSuper ||
        (yaEsSemanaCompleta
          ? programa.desde
          : aClaveFecha(
              (() => {
                const proxima = rangoPorPreset('proxima-semana', new Date())
                return 'error' in proxima ? rangoDesdeFecha : proxima.desde
              })(),
            ))
      setDiaVisitaSuper(visitaClave)
    }
    const rango = rangoPorPreset(
      preset,
      new Date(),
      visitaClave ? deClaveFecha(visitaClave) : null,
    )
    if ('error' in rango) {
      setError(rango.error)
      setPrograma((actual) => ({ ...actual, preset }))
      return
    }
    aplicarRango(aClaveFecha(rango.desde), aClaveFecha(rango.hasta), preset)
  }

  const alCambiarDiaVisita = (clave: string) => {
    setDiaVisitaSuper(clave)
    if (!clave) return
    const rango = rangoPorPreset('semana-del-super', new Date(), deClaveFecha(clave))
    if ('error' in rango) {
      setError(rango.error)
      return
    }
    aplicarRango(aClaveFecha(rango.desde), aClaveFecha(rango.hasta), 'semana-del-super')
  }

  const alCambiarFecha = (campo: 'desde' | 'hasta', clave: string) => {
    if (!clave) return
    aplicarRango(
      campo === 'desde' ? clave : programa.desde,
      campo === 'hasta' ? clave : programa.hasta,
      'personalizado',
    )
  }

  const repetirSemanaEnElResto = () => {
    const primera = semanasPrograma[0]
    if (!primera || semanasPrograma.length < 2) return

    const tildadasPrimera = Object.entries(plannerDrafts).filter(([key, draft]) => {
      if (!draft.enabled) return false
      const fecha = key.slice(0, 10)
      return fecha >= primera.desdeClave && fecha <= primera.hastaClave
    })

    if (tildadasPrimera.length === 0) {
      setError('Tildá al menos un horario en la primera semana para poder copiarlo.')
      return
    }

    const hayDespues = Object.entries(plannerDrafts).some(([key, draft]) => {
      if (!draft.enabled) return false
      return key.slice(0, 10) > primera.hastaClave
    })

    if (
      hayDespues &&
      !window.confirm(
        'Se copian los horarios de la primera semana en las demás. Lo que ya tildaste ahí se reemplaza.',
      )
    ) {
      return
    }

    setPlannerDrafts((current) =>
      repetirPrimeraSemana({
        desdeClave: programa.desde,
        hastaClave: programa.hasta,
        rowKeysExistentes: plannerRows.map((row) => row.key),
        drafts: current,
      }),
    )
    setError(null)
    setMessage('Se copió la primera semana en el resto del período. Revisá y guardá.')
  }

  const handleSavePlannerDrafts = async () => {
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Todavía no está configurada la conexión con la base.')
      return
    }

    if (!canManageOutings) {
      setError(
        groupServiceMode
          ? 'Solo superintendentes o auxiliares asociados a un grupo pueden crear estas salidas.'
          : 'Solo un administrador puede crear salidas.',
      )
      return
    }

    const enabledDrafts = Object.entries(plannerDrafts)
      .filter(([, draft]) => draft.enabled)
      .map(([rowKey, draft]) => {
        const row = plannerRows.find((item) => item.key === rowKey)
        const slot = plannerSlots.find((item) => item.key === draft.slotKey)
        const territory = territories.find((item) => item.id === draft.territoryId)
        const driver = drivers.find((item) => item.id === draft.driverId)

        return {
          row,
          slot,
          territory,
          driver,
          draft,
        }
      })

    if (enabledDrafts.length === 0) {
      setError('Tildá al menos una salida para poder guardar.')
      return
    }

    const incompleteDraft = enabledDrafts.find(
      ({ draft, slot, territory, driver }) => {
        if (!slot || !driver) return true
        if (slot.kind === 'phone') return false
        return (
          !draft.meetingPointName.trim() ||
          !draft.meetingCoords ||
          (!territory && !draft.meetingPointId)
        )
      },
    )

    if (incompleteDraft) {
      setError('Cada salida tildada debe tener direccion, conductor, horario, territorio y GPS.')
      return
    }

    if (groupServiceMode && !lockedGroupId) {
      setError('Elegí el grupo de servicio antes de guardar las salidas.')
      return
    }

    const blockedDraft = enabledDrafts.find(({ draft }) =>
      reservedTerritoriesByOtherGroups.has(draft.territoryId),
    )

    if (blockedDraft) {
      const reservedByGroup = reservedTerritoriesByOtherGroups.get(
        blockedDraft.draft.territoryId,
      )
      setError(`Hay un territorio reservado por ${reservedByGroup}. Cambialo antes de guardar.`)
      return
    }

    const personalBlockedDraft = enabledDrafts.find(({ draft }) =>
      reservedTerritoriesByPersonalUse.has(draft.territoryId),
    )

    if (personalBlockedDraft) {
      const reservedFor = reservedTerritoriesByPersonalUse.get(
        personalBlockedDraft.draft.territoryId,
      )
      setError(
        `Hay un territorio reservado personalmente para ${reservedFor}. Cambialo antes de guardar.`,
      )
      return
    }

    const duplicatedTerritory = enabledDrafts.find(({ draft }, index) =>
      enabledDrafts.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && candidate.draft.territoryId === draft.territoryId,
      ),
    )

    if (groupServiceMode && duplicatedTerritory) {
      setError('No repitas el mismo territorio dentro de las salidas tildadas.')
      return
    }

    setIsSaving(true)

    try {
      const payload = enabledDrafts.map(({ draft, slot, territory }) => ({
        title:
          slot?.kind === 'phone'
            ? PHONE_TITLE
            : `${territory?.name ?? 'Salida'} ${slot?.dayShort ?? ''} ${slot?.timeLabel ?? ''}`.trim(),
        territory_id: territory?.id ?? null,
        driver_id: draft.driverId,
        group_id: lockedGroupId || null,
        meeting_point_id: draft.meetingPointId || null,
        meeting_point_name: draft.meetingPointName.trim(),
        meeting_point_lat: Number(draft.meetingCoords?.[1].toFixed(6)),
        meeting_point_lng: Number(draft.meetingCoords?.[0].toFixed(6)),
        scheduled_for: new Date(slot?.scheduledForValue ?? '').toISOString(),
        notes: notes.trim() || null,
      }))

      const { data, error: saveError } = await client
        .rpc('crear_salidas_lote', {
          p_scope: salidasWriteScope,
          p_salidas: payload,
        })
        .select(SALIDAS_RPC_FIELDS)

      if (saveError) {
        setError(mensajeErrorSalidas(saveError, 'No se pudieron guardar las salidas.'))
        return
      }

      const savedOutings = ((data as OutingRecord[] | null) ?? []).sort(
        (left, right) =>
          new Date(left.scheduled_for).getTime() - new Date(right.scheduled_for).getTime(),
      )

      if (savedOutings.length !== payload.length) {
        setError('El servidor no confirmó todas las salidas; no se actualizó la agenda local.')
        return
      }

      setOutings((current) =>
        [...current, ...savedOutings].sort(
          (left, right) =>
            new Date(left.scheduled_for).getTime() - new Date(right.scheduled_for).getTime(),
        ),
      )
      setPlannerDrafts((current) => {
        const nextDrafts = { ...current }
        enabledDrafts.forEach(({ row }) => {
          if (row) {
            delete nextDrafts[row.key]
          }
        })
        return nextDrafts
      })
      setSelectedOutingId(savedOutings.at(-1)?.id ?? null)
      setActivePlannerRowKey(null)
      handleClearPlannerSlot()
      const pendientes = enabledDrafts
        .map(({ draft }) =>
          gpsNuevoDelPunto(
            meetingPoints.find((punto) => punto.id === draft.meetingPointId),
            draft.meetingCoords,
          ),
        )
        .filter((punto): punto is GpsPendiente => punto !== null)
      setGpsPendientes(pendientes)
      setMessage(
        pendientes.length === 1
          ? `${savedOutings.length} salidas guardadas. ¿Guardar este GPS en el punto ${pendientes[0].codigo}?`
          : pendientes.length > 1
            ? `${savedOutings.length} salidas guardadas. Hay puntos sin GPS en el catálogo.`
            : `${savedOutings.length} salidas guardadas correctamente.`,
      )
    } catch (caught) {
      setError(mensajeErrorSalidas(caught, 'No se pudieron guardar las salidas.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h2>{groupServiceMode ? 'Salidas del grupo' : 'Salidas'}</h2>
          <p className="lead">
            {groupServiceMode
              ? isGroupServiceDelegate
                ? `Las salidas de ${currentServiceGroup ? getGroupLabel(currentServiceGroup) : 'tu grupo'}, sin pisarse con los demás.`
                : 'Las salidas de cada grupo, y los territorios que reserva.'
              : 'Dónde y a qué hora se sale, y quién conduce.'}
          </p>
        </div>
      </section>

      <div className="module-console">
        <Falta
          cuantos={proximasSinConductor}
          uno="Una salida no tiene conductor"
          varios="{n} salidas no tienen conductor"
          detalle="Están programadas y todavía nadie las lleva."
        />

        {groupServiceMode && canManageGeneralOutings ? (
          <label className="inline-filter">
            Grupo
            <Desplegable
              etiqueta="Grupo"
              valor={grupoConsulta}
              alElegir={(valor) => {
                setGrupoConsulta(valor)
                setGroupId(valor === 'todos' ? '' : valor)
              }}
              opciones={[
                { valor: 'todos', texto: 'Todos los grupos' },
                ...selectableGroups.map((group) => ({
                  valor: group.id,
                  texto: getGroupLabel(group),
                })),
              ]}
            />
          </label>
        ) : null}

        {armarPrograma ? (
        <section
          ref={planificadorRef}
          className="panel salidas-planificador"
          aria-label="Armar el programa de salidas"
        >
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">
                {programa.preset === 'semana-del-super'
                  ? 'Semana del super'
                  : 'Armar programa'}
              </p>
              <h3>
                {programa.preset === 'semana-del-super'
                  ? 'Visita del superintendente de circuito'
                  : 'Salidas por día y horario'}
              </h3>
              <p className="table-hint">
                Tildá los horarios, completá conductor y territorio, y guardá.
                Cuando termines, volvé a la agenda.
              </p>
            </div>
            <div className="module-registry-actions">
              <div className="territory-count-pill">
                <strong>{plannerSlotsByDay.length}</strong>
                <span>{plannerSlotsByDay.length === 1 ? 'día' : 'días'}</span>
              </div>
              {tildadasDelPrograma.length > 0 ? (
                <div className="territory-count-pill">
                  <strong>{tildadasDelPrograma.length}</strong>
                  <span>{tildadasDelPrograma.length === 1 ? 'tildada' : 'tildadas'}</span>
                </div>
              ) : null}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setArmarPrograma(false)}
              >
                <Icono nombre="anterior" tamaño={18} />
                Volver a la agenda
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleSavePlannerDrafts}
                disabled={!canManageOutings || isSaving}
              >
                <Icono nombre="guardar" tamaño={18} />
                {isSaving ? 'Guardando...' : 'Guardar tildadas'}
              </button>
            </div>
          </div>

          <div className="programa-periodo">
            <p className="eyebrow">Período</p>
            <div
              className="programa-periodo-opciones"
              role="group"
              aria-label="Período del programa"
            >
              {PRESETS_PROGRAMA.map((opcion) => (
                <button
                  key={opcion.id}
                  type="button"
                  aria-pressed={programa.preset === opcion.id}
                  className={
                    programa.preset === opcion.id
                      ? 'programa-periodo-opcion activa'
                      : 'programa-periodo-opcion'
                  }
                  onClick={() => aplicarPreset(opcion.id)}
                >
                  {opcion.etiqueta}
                </button>
              ))}
            </div>
            <div className="programa-periodo-fechas">
              <label className="inline-filter">
                Desde
                <input
                  type="date"
                  value={programa.desde}
                  onChange={(event) => alCambiarFecha('desde', event.target.value)}
                />
              </label>
              <label className="inline-filter">
                Hasta
                <input
                  type="date"
                  value={programa.hasta}
                  onChange={(event) => alCambiarFecha('hasta', event.target.value)}
                />
              </label>
              {programa.preset === 'semana-del-super' ? (
                <label className="inline-filter">
                  Un día de la visita
                  <input
                    type="date"
                    value={diaVisitaSuper}
                    onChange={(event) => alCambiarDiaVisita(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <p className="programa-periodo-resumen">
              {diasDelPrograma === 1
                ? `Un día: ${frasePrograma}.`
                : `${diasDelPrograma} días, ${frasePrograma}.`}
              {tildadasDelPrograma.length === 1
                ? ' 1 tildada para guardar.'
                : tildadasDelPrograma.length > 1
                  ? ` ${tildadasDelPrograma.length} tildadas para guardar.`
                  : ''}
            </p>
            {error ? <div className="form-feedback error">{error}</div> : null}
            {message ? <div className="form-feedback success">{message}</div> : null}
            {gpsPendientes.length > 0 ? (
              <div className="programa-gps-pendientes">
                {gpsPendientes.map((gps) => (
                  <button
                    key={gps.id}
                    type="button"
                    className="secondary-button"
                    onClick={() => void persistirGpsEnPunto(gps)}
                  >
                    <Icono nombre="guardar" tamaño={18} />
                    Guardar este GPS en el punto {gps.codigo}
                  </button>
                ))}
              </div>
            ) : null}
            {programa.preset === 'semana-del-super' ? (
              <p className="table-hint">
                Se arma el lunes a domingo de esa visita. Elegí cualquier día de
                esa semana.
              </p>
            ) : null}
            {programa.preset === 'este-mes' && diasDelPrograma <= 7 ? (
              <p className="table-hint">
                Quedan pocos días de este mes. Si querés el siguiente, tocá
                Próximo mes.
              </p>
            ) : null}
            {hayDiasPasados(rangoDesdeFecha, new Date()) ? (
              <p className="table-hint">
                Incluye días que ya pasaron. Si no hace falta cargarlos, adelantá
                el desde.
              </p>
            ) : null}
            {semanasPrograma.length >= 2 ? (
              <button
                type="button"
                className="secondary-button"
                  onClick={repetirSemanaEnElResto}
                >
                <Icono nombre="rehacer" tamaño={18} />
                Repetir la primera semana en las demás
              </button>
            ) : null}
          </div>

          <div className="outing-schedule-shell">
            <div className="outing-schedule-grid outing-schedule-head">
              <span>Tildar</span>
              <span>Dia</span>
              <span>Fecha</span>
              <span>Turno</span>
              <span>Punto de encuentro</span>
              <span>Conductor</span>
              <span>Horario</span>
              <span>Mapa</span>
              <span>Tipo</span>
            </div>

            <div className="outing-schedule-body">
              {filasPorSemana.map((semana) => (
                <div key={semana.clave} className="programa-semana">
                  <div className="programa-semana-rotulo">
                    <strong>{semana.rotulo}</strong>
                    {semana.yaHay > 0 ? (
                      <span>
                        {semana.yaHay === 1
                          ? 'Ya hay 1 en la agenda'
                          : `Ya hay ${semana.yaHay} en la agenda`}
                      </span>
                    ) : null}
                  </div>
                  <div className="programa-semana-filas">
              {semana.filas.map((row) => {
                const draft = plannerDrafts[row.key]
                const selectedRowSlot = row.slots.find(
                  (slot) => slot.key === draft?.slotKey,
                ) ?? null
                const availableRowDrivers = getAvailableDriversForSlot(selectedRowSlot)
                const selectedRowTerritory =
                  territories.find((territory) => territory.id === draft?.territoryId) ??
                  null
                const isRowEnabled = Boolean(draft?.enabled)

                return (
                  <div key={row.key} className="outing-schedule-entry">
                    <div
                      className={
                        isRowEnabled
                          ? 'outing-schedule-grid outing-schedule-row active'
                          : 'outing-schedule-grid outing-schedule-row'
                      }
                    >
                      <label className="outing-check">
                        <input
                          type="checkbox"
                          checked={isRowEnabled}
                          onChange={(event) =>
                            handleTogglePlannerRow(row, event.target.checked)
                          }
                          disabled={!canManageOutings || row.slots.length === 0}
                        />
                        <span>{isRowEnabled ? 'Si' : 'No'}</span>
                      </label>

                      <strong>{row.dayLabel}</strong>
                      <span>{row.dateLabel}</span>
                      <span>{row.periodLabel}</span>
                      <div className="outing-punto-cell">
                        <BuscadorPunto
                          puntos={meetingPoints}
                          valorId={draft?.meetingPointId || null}
                          textoLibre={draft?.meetingPointName ?? ''}
                          deshabilitado={!canManageOutings}
                          alElegir={(punto, texto) =>
                            handlePlannerDraftFieldChange(row, {
                              meetingPointId: punto?.id ?? '',
                              meetingPointName: punto?.nombre ?? texto,
                              territoryId: punto?.territory_id ?? draft?.territoryId ?? '',
                              meetingCoords:
                                punto?.lat != null && punto?.lng != null
                                  ? [punto.lng, punto.lat]
                                  : punto
                                    ? null
                                    : draft?.meetingCoords ?? null,
                              mapOpen: Boolean(punto && (punto.lat == null || punto.lng == null)),
                            })
                          }
                        />
                        {draft?.enabled && !draft.meetingPointId && draft.meetingPointName.trim() ? (
                          <p className="table-hint">Punto nuevo, sin código. Marcá el GPS en el mapa.</p>
                        ) : null}
                      </div>
                      <Desplegable
                        etiqueta="Conductor"
                        valor={draft?.driverId ?? ''}
                        deshabilitado={!canManageOutings}
                        alElegir={(valor) =>
                          handlePlannerDraftFieldChange(row, { driverId: valor })
                        }
                        opciones={[
                          { valor: '', texto: 'Conductor' },
                          ...(selectedRowSlot && availableRowDrivers.length === 0
                            ? [
                                {
                                  valor: '',
                                  texto: 'No hay conductores disponibles',
                                  deshabilitada: true,
                                },
                              ]
                            : []),
                          ...availableRowDrivers.map((driver) => ({
                            valor: driver.id,
                            texto: driver.full_name,
                          })),
                        ]}
                      />
                      <Desplegable
                        etiqueta="Elegir horario"
                        valor={selectedRowSlot?.key ?? ''}
                        deshabilitado={!canManageOutings || row.slots.length === 0}
                        alElegir={(valor) => handleSelectPlannerRowSlot(row, valor)}
                        opciones={[
                          { valor: '', texto: 'Elegir horario' },
                          ...row.slots.map((slot) => ({
                            valor: slot.key,
                            texto: slot.timeLabel,
                          })),
                        ]}
                      />
                      <button
                        type="button"
                        className="secondary-button outing-map-toggle"
                        onClick={() => handleTogglePlannerMap(row)}
                        disabled={!canManageOutings}
                      >
                        <Icono nombre="punto" tamaño={18} />
                        {draft?.meetingCoords ? 'GPS listo' : 'Abrir mapa'}
                      </button>
                      <span
                        className={
                          row.typeLabel === PHONE_TITLE
                            ? 'outing-type-pill phone'
                            : 'outing-type-pill'
                        }
                      >
                        {row.typeLabel}
                      </span>
                    </div>

                    {draft?.mapOpen ? (
                      <div className="outing-row-map">
                        <div className="map-picker-head">
                          <strong>
                            {selectedRowTerritory?.name ??
                              draft.meetingPointName ??
                              'Punto de encuentro'}
                          </strong>
                          <span>
                            {draft.meetingCoords
                              ? `${draft.meetingCoords[1].toFixed(6)}, ${draft.meetingCoords[0].toFixed(6)}`
                              : 'Marcá en el mapa dónde se juntan'}
                          </span>
                          {gpsNuevoDelPunto(
                            meetingPoints.find((punto) => punto.id === draft.meetingPointId),
                            draft.meetingCoords,
                          ) ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                const pendiente = gpsNuevoDelPunto(
                                  meetingPoints.find(
                                    (punto) => punto.id === draft.meetingPointId,
                                  ),
                                  draft.meetingCoords,
                                )
                                if (pendiente) void persistirGpsEnPunto(pendiente)
                              }}
                            >
                              <Icono nombre="guardar" tamaño={18} />
                              Guardar este GPS en el punto{' '}
                              {meetingPoints.find((punto) => punto.id === draft.meetingPointId)
                                ?.codigo ?? draft.meetingPointName}
                            </button>
                          ) : null}
                        </div>
                        <Suspense fallback={<MapFallback />}>
                          <MeetingPointPickerMap
                            markerPosition={draft.meetingCoords}
                            territoryGeometry={selectedRowTerritory?.polygon_geojson ?? null}
                            onPick={(coords) =>
                              handlePlannerDraftFieldChange(row, {
                                meetingCoords: coords,
                                mapOpen: true,
                              })
                            }
                            zoom={14}
                          />
                        </Suspense>
                      </div>
                    ) : null}
                  </div>
                )
              })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        ) : null}

        {!armarPrograma ? (
        <section className="panel module-registry-panel salidas-agenda">
          <div className="agenda-encabezado">
            <div className="agenda-titulo">
              <p className="eyebrow">Agenda guardada</p>
              <h3>Salidas programadas</h3>
              {/* Si hay mas de las que se trajeron, se dice. Una lista
                  recortada en silencio hace creer que eso es todo lo que
                  hay, y despues nadie entiende por que "falta" una salida.
                  Pero se dice con un numero: el parrafo de tres renglones
                  que habia aca explicaba el recorte en el lugar donde se
                  busca una salida. */}
              {cuantasSalidasHay !== null && cuantasSalidasHay > outings.length ? (
                <p
                  className="table-hint"
                  title={`Se traen las ${outings.length} más recientes. Las más viejas quedan en el historial de cada territorio.`}
                >
                  {outings.length} de {cuantasSalidasHay.toLocaleString('es-AR')} · las más recientes
                </p>
              ) : null}
            </div>

            <div className="agenda-controles">
              <label className="module-search-field">
                <span className="sr-only">Buscar salidas</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar salida, territorio, conductor o punto"
                />
              </label>

              {/* Los dos filtros viven plegados: estaban siempre abiertos y
                  ocupaban el mismo lugar que las acciones, aunque casi
                  siempre dicen "Todos" y "Todas". */}
              <details className="agenda-filtros">
                <summary className="secondary-button">
                  Filtros
                  {filtrosActivos ? <span className="agenda-filtros-marca" aria-hidden="true" /> : null}
                  <span className="sr-only">{filtrosActivos ? ' (hay filtros puestos)' : ''}</span>
                </summary>
                <div className="agenda-filtros-caja">
                  <label className="inline-filter">
                    Territorio
                    <Desplegable
                      etiqueta="Territorio"
                      valor={territoryFilter}
                      alElegir={setTerritoryFilter}
                      opciones={[
                        { valor: 'todos', texto: 'Todos' },
                        ...territories.map((territory) => {
                          const reservadoPorGrupo = reservedTerritoriesByOtherGroups.get(
                            territory.id,
                          )
                          const reservadoPersonal = reservedTerritoriesByPersonalUse.get(
                            territory.id,
                          )

                          return {
                            valor: territory.id,
                            texto: reservadoPorGrupo
                              ? `${territory.name} — reservado por ${reservadoPorGrupo}`
                              : reservadoPersonal
                                ? `${territory.name} — reservado para ${reservadoPersonal}`
                                : territory.name,
                          }
                        }),
                      ]}
                    />
                  </label>

                  <label className="inline-filter">
                    Agenda
                    <Desplegable
                      etiqueta="Agenda"
                      valor={scheduleFilter}
                      alElegir={(valor) => setScheduleFilter(valor as ScheduleFilter)}
                      opciones={[
                        { valor: 'todos', texto: 'Todas' },
                        { valor: 'hoy', texto: 'Hoy' },
                        { valor: 'proximas', texto: 'Próximas' },
                        { valor: 'pasadas', texto: 'Pasadas' },
                        { valor: 'sin-conductor', texto: 'Sin conductor' },
                      ]}
                    />
                  </label>

                  {filtrosActivos ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setTerritoryFilter('todos')
                        setScheduleFilter('todos')
                      }}
                    >
                      <Icono nombre="cerrar" tamaño={17} />
                      Quitar los filtros
                    </button>
                  ) : null}
                </div>
              </details>

              {canManageOutings ? (
                <button type="button" className="secondary-button" onClick={abrirNueva}>
                  <Icono nombre="salidas" tamaño={18} />
                  Nueva salida
                </button>
              ) : null}
              {/* Un solo boton principal en la pantalla: armar el programa es
                  lo que se viene a hacer aca. */}
              {canManageOutings ? (
                <button
                  type="button"
                  className="primary-button"
                  aria-expanded={armarPrograma}
                  onClick={() => setArmarPrograma(true)}
                >
                  <Icono nombre="salidas" tamaño={18} />
                  Armar programa
                </button>
              ) : null}
            </div>
          </div>

          {error ? <div className="form-feedback error">{error}</div> : null}
          {message ? <div className="form-feedback success">{message}</div> : null}
          {gpsPendientes.length > 0 ? (
            <div className="programa-gps-pendientes">
              {gpsPendientes.map((gps) => (
                <button
                  key={gps.id}
                  type="button"
                  className="secondary-button"
                  onClick={() => void persistirGpsEnPunto(gps)}
                >
                  <Icono nombre="guardar" tamaño={18} />
                  Guardar este GPS en el punto {gps.codigo}
                </button>
              ))}
            </div>
          ) : null}

          {isLoading ? (
            <div className="agenda-esqueleto" role="status">
              <span className="sr-only">Cargando salidas…</span>
              <i /><i /><i /><i />
            </div>
          ) : filteredOutings.length === 0 ? (
            <Vacio
              hay={visibleOutingDetails.length}
              sinNada="Todavía no hay ninguna salida cargada."
              comoEmpezar={'Tocá "Nueva salida" o "Armar programa" para cargar horarios.'}
              filtrados="Ninguna salida coincide con lo que buscás."
            />
          ) : (
            <div className="agenda-lista">
              {[
                ...diasProximas.map((dia) => ({ ...dia, pasado: false })),
                ...diasAnteriores.map((dia) => ({ ...dia, pasado: true })),
              ].map((dia) => (
                <section key={`${dia.pasado ? 'ant' : 'prox'}-${dia.clave}`} className="agenda-dia">
                  <h4 className={dia.pasado ? 'agenda-dia-titulo pasado' : 'agenda-dia-titulo'}>
                    {etiquetaDelDia(dia.clave)}
                    <small>
                      {dia.salidas.length} {dia.salidas.length === 1 ? 'salida' : 'salidas'}
                    </small>
                  </h4>

                  {dia.salidas.map((outing) => {
                    const historica = esSalidaHistorica(outing)
                    // Por hora y no por dia: a las 11 de la manana, lo que
                    // queda por hacer con la salida de las 9:30 de hoy es
                    // informar como fue, no editarla.
                    const yaPaso = new Date(outing.scheduled_for).getTime() < Date.now()
                    const faltaConductor = saleSinConductor(outing)
                    return (
                      /* Div y no boton: adentro viven las acciones. El
                         titulo de la salida es el control que recibe el foco
                         de teclado. */
                      <div
                        key={outing.id}
                        className={
                          selectedOutingId === outing.id
                            ? 'agenda-salida activa'
                            : 'agenda-salida'
                        }
                        onClick={() => setSelectedOutingId(outing.id)}
                      >
                        <span className="agenda-hora">
                          {formatLocalTime(outing.scheduled_for)}
                        </span>

                        <span className="agenda-donde">
                          <button
                            type="button"
                            className="fila-nombre"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedOutingId(outing.id)
                            }}
                          >
                            {outing.title}
                          </button>
                          {/* Punto, conductor y estado en un renglon que se
                              parte solo si no entra: eran tres lineas
                              apiladas y la tarjeta media cuatro. */}
                          <span className="agenda-linea">
                            <span>
                              {textoPuntoSalida({
                                codigo: outing.territorio_codigo,
                                nombre: outing.meeting_point_name ?? outing.territoryName,
                              })}
                            </span>
                            <span>{outing.driverName}</span>
                            {groupServiceMode ? <span>{outing.groupName}</span> : null}
                            {/* Un solo distintivo por tarjeta. "Historica ·
                                Excel" y "Historica · no se borra" decian dos
                                veces lo mismo al lado del estado, y en una
                                lista de veinte salidas eran sesenta
                                pastillas. La procedencia esta en la ficha. */}
                            <span className={`status-pill status-${outing.scheduleStatus.key}`}>
                              {outing.scheduleStatus.label}
                            </span>
                          </span>
                        </span>

                        <span className="agenda-acciones">
                          {/* Una sola accion a la vista, y es la que falta:
                              si ya paso, informar como fue; si viene y no
                              tiene quien la lleve, poner conductor; si no,
                              editarla. El resto vive en el menu. */}
                          {yaPaso || !canManageOutings ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                openResultFor(outing)
                              }}
                            >
                              <Icono nombre="completo" tamaño={18} />
                              Resultado
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                startEditing(outing)
                              }}
                            >
                              <Icono
                                nombre={faltaConductor ? 'conductor' : historica ? 'guardar' : 'dibujar'}
                                tamaño={18}
                              />
                              {faltaConductor
                                ? 'Asignar conductor'
                                : historica
                                  ? 'Completar'
                                  : 'Editar'}
                            </button>
                          )}

                          <details
                            className="agenda-mas"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <summary aria-label={`Más acciones de ${outing.title}`}>
                              <Icono nombre="menu" tamaño={20} />
                            </summary>
                            <div className="agenda-mas-caja">
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => handleDownloadSavedPdf(outing)}
                              >
                                <Icono nombre="descargar" tamaño={18} />
                                Descargar PDF
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => openResultFor(outing)}
                              >
                                <Icono nombre="completo" tamaño={18} />
                                Resultado
                              </button>
                              {canManageOutings ? (
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => startEditing(outing)}
                                >
                                  <Icono nombre={historica ? 'guardar' : 'dibujar'} tamaño={18} />
                                  {historica ? 'Completar' : 'Editar'}
                                </button>
                              ) : null}
                              {canManageOutings ? (
                                historica ? (
                                  <p className="agenda-mas-nota">
                                    Viene del Excel: no se borra.
                                  </p>
                                ) : (
                                  <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() => void handleDelete(outing)}
                                  >
                                    <Icono nombre="eliminar" tamaño={18} />
                                    Eliminar
                                  </button>
                                )
                              ) : null}
                            </div>
                          </details>
                        </span>
                      </div>
                    )
                  })}
                </section>
              ))}

              {/* Lo anterior existe y se dice cuanto hay, pero no se pinta
                  hasta que alguien lo pide. */}
              {anterioresQueFaltan > 0 ? (
                <button
                  type="button"
                  className="secondary-button agenda-ver-mas"
                  onClick={() => setPagina((p) => p + 1)}
                >
                  <Icono nombre="anterior" tamaño={18} />
                  {anterioresAMostrar === 0
                    ? `Ver anteriores (${anteriores.length})`
                    : `Ver ${Math.min(SALIDAS_POR_PAGINA, anterioresQueFaltan)} anteriores más (quedan ${anterioresQueFaltan})`}
                </button>
              ) : null}
            </div>
          )}

        </section>
        ) : null}

        <Modal
          abierto={formularioAbierto}
          alCerrar={cerrarFormulario}
          titulo={
            resultadoOutingId
              ? 'Resultado de la salida'
              : editingOutingId
              ? editingHistorical
                ? 'Completar salida histórica'
                : 'Editar salida'
              : 'Nueva salida'
          }
          bajada={
            resultadoOutingId
              ? 'Informá qué ocurrió. Corregir un resultado agrega un evento nuevo y no modifica el anterior.'
              : editingHistorical
              ? 'Completá lo que tengas. Lo demás queda como está; fecha, hora y procedencia se conservan.'
              : 'Dirección, territorio, conductor y punto de encuentro.'
          }
        >
          {resultadoOuting ? (
            <SalidaResultadoForm
              key={resultadoOuting.id}
              salidaId={resultadoOuting.id}
              canReport={canReportSelectedResult}
              canCorrect={canCorrectSelectedResult}
            />
          ) : (
          <form className="form-stack" onSubmit={handleSubmit}>
              {selectedPlannerSlot ? (
                <div className="module-detail-card">
                  <span>Slot elegido</span>
                  <strong>
                    {selectedPlannerSlot.dayLabel} - {selectedPlannerSlot.timeLabel}
                  </strong>
                  <p>
                    {selectedPlannerSlot.kind === 'phone'
                      ? PHONE_TITLE
                      : 'Salida territorial regular'}
                  </p>
                </div>
              ) : null}

              <label>
                Titulo
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ej. Salida Martes 09:15"
                  disabled={!canManageOutings}
                />
              </label>

              <label>
                Territorio{editingHistorical ? ' (opcional por ahora)' : ''}
                <Desplegable
                  etiqueta="Elegir territorio"
                  valor={territoryId}
                  alElegir={setTerritoryId}
                  deshabilitado={!canManageOutings}
                  opciones={[
                    { valor: '', texto: 'Elegir territorio' },
                          ...territories.map((territory) => {
                            const reservadoPorGrupo = reservedTerritoriesByOtherGroups.get(
                              territory.id,
                            )
                            const reservadoPersonal = reservedTerritoriesByPersonalUse.get(
                              territory.id,
                            )

                            return {
                              valor: territory.id,
                              deshabilitada: Boolean(reservadoPorGrupo || reservadoPersonal),
                              texto: reservadoPorGrupo
                                ? `${territory.name} - reservado por ${reservadoPorGrupo}`
                                : reservadoPersonal
                                  ? `${territory.name} - reservado para ${reservadoPersonal}`
                                  : territory.name,
                            }
                          }),
                  ]}
                />
              </label>

              {selectedFormTerritory ? (
                <div className="module-detail-card">
                  <span>Territorio seleccionado</span>
                  <strong>{selectedFormTerritory.name}</strong>
                  <p>
                    {selectedFormTerritory.description ||
                      'Sin referencia breve cargada para este territorio.'}
                  </p>
                  {editingHistorical ? (
                    <p className="history-form-hint">
                      El centro no se completa solo: elegí un punto guardado o marcá
                      el lugar exacto en el mapa cuando tengas esa evidencia.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUseTerritoryCenter}
                      disabled={!canManageOutings || !selectedTerritoryCenter}
                    >
                      Usar centro del territorio
                    </button>
                  )}
                </div>
              ) : null}

              <label>
                Punto de encuentro
                {editingHistorical ? ' (podés completarlo después)' : ''}
                <BuscadorPunto
                  puntos={meetingPoints}
                  valorId={meetingPointId}
                  textoLibre={meetingPointName}
                  deshabilitado={!canManageOutings}
                  alElegir={(punto, texto) => {
                    setMeetingPointId(punto?.id ?? null)
                    setMeetingPointName(punto?.nombre ?? texto)
                    if (punto?.territory_id) {
                      setTerritoryId(punto.territory_id)
                    }
                    setMeetingCoords(
                      punto?.lat != null && punto?.lng != null
                        ? [punto.lng, punto.lat]
                        : punto
                          ? null
                          : meetingCoords,
                    )
                  }}
                />
                <small className="form-help">
                  Escribí 61,1 o una esquina. Si no coincide, se guarda como
                  dirección nueva.
                </small>
              </label>

              <label>
                Conductor{editingHistorical ? ' (opcional por ahora)' : ''}
                <Desplegable
                  etiqueta="Elegir conductor"
                  valor={driverId}
                  alElegir={setDriverId}
                  deshabilitado={!canManageOutings}
                  opciones={[
                    { valor: '', texto: 'Elegir conductor' },
                    ...(selectedPlannerSlot &&
                    getAvailableDriversForSlot(selectedPlannerSlot).length === 0
                      ? [
                          {
                            valor: '',
                            texto: 'No hay conductores disponibles',
                            deshabilitada: true,
                          },
                        ]
                      : []),
                    ...getAvailableDriversForSlot(selectedPlannerSlot).map((driver) => ({
                      valor: driver.id,
                      texto: driver.full_name,
                    })),
                  ]}
                />
              </label>

              <label>
                Grupo{editingHistorical ? ' (opcional por ahora)' : ''}
                <Desplegable
                  etiqueta="Grupo"
                  valor={groupId}
                  alElegir={setGroupId}
                  deshabilitado={!canManageOutings || isGroupServiceDelegate}
                  opciones={[
                    {
                      valor: '',
                      texto: isGroupServiceDelegate
                        ? 'Sin grupo asociado'
                        : 'Sin grupo asignado',
                    },
                    ...(isGroupServiceDelegate
                      ? serviceGroupAssignments
                      : selectableGroups
                    ).map((group) => ({ valor: group.id, texto: getGroupLabel(group) })),
                  ]}
                />
              </label>

              <label>
                {editingHistorical ? 'Día y horario conservados' : 'Día y horario elegidos'}
                <input
                  value={scheduledFor ? formatLocalDate(new Date(scheduledFor).toISOString()) : ''}
                  placeholder="Elegí un horario en la grilla de arriba"
                  disabled
                />
              </label>

              {editingHistorical ? (
                <div className="module-detail-card history-provenance-card">
                  <span>Procedencia histórica · solo lectura</span>
                  {editingOuting?.provenance ? (
                    <>
                      <strong>
                        {editingOuting.provenance.source_sheet}, fila{' '}
                        {editingOuting.provenance.source_row}
                      </strong>
                      <ul className="del-excel">
                        <li>
                          Alias escrito en la fuente:{' '}
                          <strong>
                            {editingOuting.provenance.source_conductor_text ?? 'Sin dato'}
                          </strong>
                          {editingOuting.provenance.source_conductor_alias_id
                            ? ' · coincide con un alias guardado.'
                            : ' · no se asigna un conductor automáticamente.'}
                        </li>
                        <li>
                          Priorizar:{' '}
                          <strong>{editingOuting.provenance.source_priorizar ?? 'Sin dato'}</strong>
                        </li>
                        <li>
                          Casilla de fuente:{' '}
                          <strong>
                            {editingOuting.provenance.source_status === null
                              ? 'Sin dato'
                              : editingOuting.provenance.source_status
                                ? 'tildada'
                                : 'sin tildar'}
                          </strong>
                          {' · Resolución: '}
                          <strong>
                            {editingOuting.provenance.source_resolution_status ?? 'Sin dato'}
                          </strong>
                        </li>
                        {Object.entries(editingOuting.provenance.source_narrative).map(
                          ([key, value]) => (
                            <li key={key}>
                              {key.replace(/[:.]+$/, '')}:{' '}
                              <strong>
                                {value === null || value === undefined
                                  ? 'Sin dato'
                                  : typeof value === 'string'
                                    ? value
                                    : JSON.stringify(value)}
                              </strong>
                            </li>
                          ),
                        )}
                      </ul>
                      <p className="del-excel-nota">
                        La fuente no se edita. Lo que completes en la ficha queda como
                        dato operativo; la procedencia y la fecha original permanecen.
                      </p>
                    </>
                  ) : (
                    <p className="del-excel-nota">
                      Esta salida está marcada como histórica, pero todavía no se pudo
                      cargar su detalle de procedencia. No se va a inventar ningún dato.
                    </p>
                  )}
                </div>
              ) : null}

              <label>
                {editingHistorical
                  ? 'Observaciones humanas (no cambia la procedencia)'
                  : 'Observaciones'}
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Indicaciones adicionales"
                  rows={4}
                  disabled={!canManageOutings}
                />
              </label>

              <div className="map-picker-panel">
                <div className="map-picker-head">
                  <strong>Punto de encuentro en el mapa</strong>
                  <span>
                    {meetingCoords
                      ? `${meetingCoords[1].toFixed(6)}, ${meetingCoords[0].toFixed(6)}`
                      : 'Tocá el mapa para marcar dónde se juntan'}
                  </span>
                  {gpsNuevoDelPunto(
                    meetingPoints.find((punto) => punto.id === meetingPointId),
                    meetingCoords,
                  ) ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        const pendiente = gpsNuevoDelPunto(
                          meetingPoints.find((punto) => punto.id === meetingPointId),
                          meetingCoords,
                        )
                        if (pendiente) void persistirGpsEnPunto(pendiente)
                      }}
                    >
                      <Icono nombre="guardar" tamaño={18} />
                      Guardar este GPS en el punto{' '}
                      {meetingPoints.find((punto) => punto.id === meetingPointId)?.codigo ??
                        meetingPointName}
                    </button>
                  ) : null}
                </div>
                <Suspense fallback={<MapFallback />}>
                  <MeetingPointPickerMap
                    markerPosition={meetingCoords}
                    territoryGeometry={selectedFormTerritory?.polygon_geojson ?? null}
                    onPick={(coords) => {
                      if (canManageOutings) {
                        setMeetingCoords(coords)
                      }
                    }}
                  />
                </Suspense>
              </div>

              {error ? <div className="form-feedback error">{error}</div> : null}
              {message ? <div className="form-feedback success">{message}</div> : null}
              {gpsPendientes.length > 0 ? (
                <div className="programa-gps-pendientes">
                  {gpsPendientes.map((gps) => (
                    <button
                      key={gps.id}
                      type="button"
                      className="secondary-button"
                      onClick={() => void persistirGpsEnPunto(gps)}
                    >
                      Guardar este GPS en el punto {gps.codigo}
                    </button>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="secondary-button full-width"
                onClick={handleDownloadDraftPdf}
                disabled={!canManageOutings}
              >
                <Icono nombre="descargar" tamaño={18} />
                Descargar PDF
              </button>

              <button
                type="button"
                className="secondary-button full-width"
                onClick={cerrarFormulario}
                disabled={isSaving}
              >
                <Icono nombre="cerrar" tamaño={18} />
                Cancelar
              </button>

              <button
                type="submit"
                className="primary-button full-width"
                disabled={!canManageOutings || isSaving}
              >
                <Icono nombre="guardar" tamaño={18} />
                {isSaving
                  ? 'Guardando...'
                  : editingOutingId
                    ? 'Actualizar salida'
                    : 'Guardar salida'}
              </button>
          </form>
          )}
        </Modal>

        <section className="two-column-grid module-form-grid salidas-detalle">
          <article className="panel">
            <p className="eyebrow">
              {selectedOuting ? 'Detalle operativo' : 'Referencia rapida'}
            </p>
            <h3>
              {selectedOuting ? selectedOuting.title : 'Como usar el planificador'}
            </h3>

            {selectedOuting ? (
              <div className="module-detail-list">
                <article className="module-detail-card">
                  <span>Territorio</span>
                  <strong>{selectedOuting.territoryName}</strong>
                </article>
                <article className="module-detail-card">
                  <span>Conductor</span>
                  <strong>{selectedOuting.driverName}</strong>
                </article>
                <article className="module-detail-card">
                  <span>Grupo</span>
                  <strong>{selectedOuting.groupName}</strong>
                </article>
                <article className="module-detail-card">
                  <span>Punto de encuentro</span>
                  <strong>
                    {textoPuntoSalida({
                      codigo: selectedOuting.territorio_codigo,
                      nombre: selectedOuting.meeting_point_name,
                    })}
                  </strong>
                </article>
                <article className="module-detail-card">
                  <span>Horario</span>
                  <strong>{formatLocalDate(selectedOuting.scheduled_for)}</strong>
                </article>
                <article className="module-detail-card">
                  <span>Estado de agenda</span>
                  <strong>{selectedOuting.scheduleStatus.label}</strong>
                </article>
                <article className="module-detail-card">
                  <span>Coordenadas</span>
                  <strong>
                    {selectedOuting.meeting_point_lat !== null &&
                    selectedOuting.meeting_point_lng !== null
                      ? `${selectedOuting.meeting_point_lat}, ${selectedOuting.meeting_point_lng}`
                      : 'Sin geolocalizar'}
                  </strong>
                </article>
                <article className="module-detail-card">
                  <span>Observaciones</span>
                  <strong>{selectedOuting.notes || 'Sin observaciones'}</strong>
                </article>
                {selectedOuting.provenance ? (
                  <article className="module-detail-card history-provenance-card">
                    <span>Procedencia histórica · solo lectura</span>
                    <strong>
                      {selectedOuting.provenance.source_sheet}, fila{' '}
                      {selectedOuting.provenance.source_row}
                    </strong>
                    <p>
                      Alias fuente:{' '}
                      <strong>
                        {selectedOuting.provenance.source_conductor_text ?? 'Sin dato'}
                      </strong>
                      {selectedOuting.provenance.source_conductor_alias_id
                        ? ' · alias relacionado'
                        : ' · sin asignación automática'}
                    </p>
                    <p>
                      La fecha, hora y fuente original se conservan. Esta salida no se
                      puede borrar.
                    </p>
                  </article>
                ) : null}
                {selectedOuting.meeting_point_lat !== null &&
                selectedOuting.meeting_point_lng !== null ? (
                  <>
                <div className="map-picker-panel">
                  <div className="map-picker-head">
                    <strong>Vista previa del punto</strong>
                    <span>Referencia visual del lugar de encuentro cargado.</span>
                  </div>
                  <Suspense fallback={<MapFallback />}>
                    <MeetingPointPickerMap
                      markerPosition={[
                        selectedOuting.meeting_point_lng,
                        selectedOuting.meeting_point_lat,
                      ]}
                      territoryGeometry={
                        territories.find(
                          (territory) => territory.id === selectedOuting.territory_id,
                        )?.polygon_geojson ?? null
                      }
                      readOnly
                      zoom={14}
                    />
                  </Suspense>
                </div>
                <a
                  href={`https://www.google.com/maps?q=${selectedOuting.meeting_point_lat},${selectedOuting.meeting_point_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="map-link"
                >
                  Abrir punto en Google Maps
                </a>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="module-guidance-list">
                <div className="module-guidance-item">
                  <strong>1. Tilda el horario</strong>
                  <span>Elegí el período, tildá un horario y completá la fila.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>2. Completa la ficha</strong>
                  <span>Agrega territorio, conductor, direccion y GPS.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>3. Descarga el PDF</strong>
                  <span>La ficha queda lista antes o despues de guardar la salida.</span>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </div>
  )
}
