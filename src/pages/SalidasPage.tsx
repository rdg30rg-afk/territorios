import { useEffect, useMemo, useState } from 'react'
import { MeetingPointPickerMap } from '../components/MeetingPointPickerMap'
import { useAuth } from '../context/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

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

type OutingRecord = {
  id: string
  title: string
  territory_id: string | null
  driver_id: string | null
  group_id: string | null
  meeting_point_name: string
  meeting_point_lat: number
  meeting_point_lng: number
  scheduled_for: string
  notes: string | null
}

type ScheduleFilter = 'todos' | 'hoy' | 'proximas' | 'pasadas'
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
  driverId: string
  territoryId: string
  meetingCoords: [number, number] | null
  mapOpen: boolean
}

type SalidasPageProps = {
  groupServiceMode?: boolean
}

const dayFormatter = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
})

const shortDateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
})

const PHONE_TITLE = 'PREDICACION TELEFONICA'
const MORNING_HOURS = buildQuarterHourRange(9, 0, 10, 30)
const AFTERNOON_HOURS = buildQuarterHourRange(15, 30, 19, 0)
const PHONE_DAYS = new Set([1, 2, 3, 5])

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

    if (normalizedTurns.length > 0) {
      result[String(numericDay)] = Array.from(new Set(normalizedTurns))
    }

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

  if (detailedTurns) {
    return !slotTurn || detailedTurns.includes(slotTurn)
  }

  const matchesDay = availability.days.length === 0 || availability.days.includes(slotDay)
  const matchesTurn =
    !slotTurn ||
    availability.turns.length === 0 ||
    availability.turns.includes(slotTurn)

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

function getNextMonday(fromDate: Date) {
  const nextMonday = new Date(fromDate)
  nextMonday.setHours(0, 0, 0, 0)
  const currentDay = nextMonday.getDay()
  const daysUntilNextMonday = currentDay === 1 ? 0 : (8 - currentDay) % 7
  nextMonday.setDate(nextMonday.getDate() + daysUntilNextMonday)

  if (nextMonday.getTime() <= fromDate.getTime() && currentDay !== 1) {
    return nextMonday
  }

  if (currentDay === 1 && fromDate.getHours() > 0) {
    return nextMonday
  }

  return nextMonday
}

function buildPlannerSlots() {
  const monday = getNextMonday(new Date())
  const slots: PlannerSlot[] = []

  for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
    const currentDate = new Date(monday)
    currentDate.setDate(monday.getDate() + dayIndex)

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
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [territories, setTerritories] = useState<TerritoryRecord[]>([])
  const [outings, setOutings] = useState<OutingRecord[]>([])
  const [selectedOutingId, setSelectedOutingId] = useState<string | null>(null)
  const [editingOutingId, setEditingOutingId] = useState<string | null>(null)
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null)
  const [activePlannerRowKey, setActivePlannerRowKey] = useState<string | null>(null)
  const [plannerDrafts, setPlannerDrafts] = useState<Record<string, PlannerDraft>>({})
  const [lastSuggestedTitle, setLastSuggestedTitle] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [territoryId, setTerritoryId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [meetingPointName, setMeetingPointName] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [notes, setNotes] = useState('')
  const [meetingCoords, setMeetingCoords] = useState<[number, number] | null>(null)
  const [territoryFilter, setTerritoryFilter] = useState('todos')
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const canManageGeneralOutings = profile?.role === 'admin'
  const plannerSlots = useMemo(() => buildPlannerSlots(), [])
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
            periodLabel: 'Manana',
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
        { data: outingsData, error: outingsError },
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
          .from('salidas')
          .select(
            'id, title, territory_id, driver_id, group_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, notes',
          )
          .order('scheduled_for', { ascending: true }),
      ])

      if (!isMounted) {
        return
      }

      const loadError =
        driversError?.message ||
        groupsError?.message ||
        territoriesError?.message ||
        outingsError?.message

      if (loadError) {
        setError(loadError)
        setDrivers([])
        setGroups([])
        setTerritories([])
        setOutings([])
      } else {
        setError(null)
        setDrivers((driversData as DriverRecord[]) ?? [])
        setGroups((groupsData as GroupRecord[]) ?? [])
        setTerritories((territoriesData as TerritoryRecord[]) ?? [])
        setOutings((outingsData as OutingRecord[]) ?? [])
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
    const availableDrivers = activeDrivers.filter((driver) =>
      isDriverAvailableForSlot(driver, slot),
    )

    return availableDrivers.length > 0 ? availableDrivers : activeDrivers
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
  const lockedGroupId = isGroupServiceDelegate ? currentServiceGroup?.id ?? '' : groupId
  const canManageOutings =
    canManageGeneralOutings || (groupServiceMode && serviceGroupAssignments.length > 0)
  const plannerStartLabel = plannerSlotsByDay[0]?.dayLabel ?? 'el proximo lunes'

  const outingDetails = useMemo(
    () =>
      outings.map((outing) => {
        const selectedGroup = groups.find((group) => group.id === outing.group_id)

        return {
          ...outing,
          territoryName:
            territories.find((territory) => territory.id === outing.territory_id)
              ?.name ?? 'Sin territorio',
          driverName:
            drivers.find((driver) => driver.id === outing.driver_id)?.full_name ??
            'Sin conductor',
          groupName: selectedGroup ? getGroupLabel(selectedGroup) : 'Sin grupo',
          scheduleStatus: getOutingScheduleStatus(outing.scheduled_for),
        }
      }),
    [drivers, groups, outings, territories],
  )

  const visibleOutingDetails = useMemo(
    () =>
      groupServiceMode && !canManageGeneralOutings
        ? outingDetails.filter((outing) => outing.group_id === lockedGroupId)
        : outingDetails,
    [canManageGeneralOutings, groupServiceMode, lockedGroupId, outingDetails],
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
        outing.notes ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [scheduleFilter, searchTerm, territoryFilter, visibleOutingDetails])

  const selectedOuting = useMemo(
    () => visibleOutingDetails.find((outing) => outing.id === selectedOutingId) ?? null,
    [selectedOutingId, visibleOutingDetails],
  )

  const outingsWithGroup = visibleOutingDetails.filter((outing) => outing.group_id).length
  const scheduledTodayCount = visibleOutingDetails.filter(
    (outing) => outing.scheduleStatus.label === 'Hoy',
  ).length
  const upcomingCount = visibleOutingDetails.filter(
    (outing) => outing.scheduleStatus.label === 'Proxima',
  ).length

  const resetForm = () => {
    setEditingOutingId(null)
    setSelectedSlotKey(null)
    setLastSuggestedTitle(null)
    setTitle('')
    setTerritoryId('')
    setDriverId('')
    setGroupId(isGroupServiceDelegate ? currentServiceGroup?.id ?? '' : '')
    setMeetingPointName('')
    setScheduledFor('')
    setNotes('')
    setMeetingCoords(null)
  }

  const handleUseTerritoryCenter = () => {
    if (!selectedFormTerritory || !selectedTerritoryCenter) {
      return
    }

    setMeetingCoords(selectedTerritoryCenter)

    if (!meetingPointName.trim()) {
      setMeetingPointName(`Encuentro ${selectedFormTerritory.name}`)
    }

    setMessage(`Punto sugerido cargado en el centro de ${selectedFormTerritory.name}.`)
    setError(null)
  }

  const handleSelectPlannerSlot = (slot: PlannerSlot) => {
    setSelectedSlotKey(slot.key)
    setScheduledFor(slot.scheduledForValue)
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

  const handleSelectPlannerRowSlot = (row: PlannerRow, slotKey: string) => {
    const slot = row.slots.find((item) => item.key === slotKey)

    if (!slot) {
      return
    }

    updatePlannerDraft(row, (draft) => ({
      ...draft,
      enabled: true,
      slotKey: slot.key,
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
    setSelectedOutingId(outing.id)
    setEditingOutingId(outing.id)
    setTitle(outing.title)
    setTerritoryId(outing.territory_id ?? '')
    setDriverId(outing.driver_id ?? '')
    setGroupId(outing.group_id ?? '')
    setMeetingPointName(outing.meeting_point_name)
    setScheduledFor(new Date(outing.scheduled_for).toISOString().slice(0, 16))
    setNotes(outing.notes ?? '')
    setMeetingCoords([outing.meeting_point_lng, outing.meeting_point_lat])
    setLastSuggestedTitle(null)
    setError(null)
    setMessage(null)
  }

  const handleDelete = async (outing: OutingRecord) => {
    if (!client || !canManageOutings) {
      return
    }

    const confirmed = window.confirm(`Se eliminara la salida "${outing.title}".`)

    if (!confirmed) {
      return
    }

    setError(null)
    setMessage(null)

    const { error: deleteError } = await client
      .from('salidas')
      .delete()
      .eq('id', outing.id)

    if (deleteError) {
      setError(deleteError.message)
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
        'Completa titulo, territorio, conductor, direccion, horario y GPS antes de descargar el PDF.',
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
    await buildDraftPdf(
      outing.title,
      new Date(outing.scheduled_for).toISOString().slice(0, 16),
      outing.territoryName,
      outing.driverName,
      outing.groupName,
      outing.meeting_point_name,
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
      setError('Primero debes configurar Supabase.')
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

    if (
      !title.trim() ||
      !territoryId ||
      !meetingPointName.trim() ||
      !scheduledFor ||
      !driverId
    ) {
      setError(
        'Completa titulo, territorio, conductor, punto de encuentro y horario.',
      )
      return
    }

    if (groupServiceMode && !lockedGroupId) {
      setError('Selecciona el grupo de servicio antes de guardar la salida.')
      return
    }

    if (!meetingCoords) {
      setError('Debes marcar el punto de encuentro en el mapa.')
      return
    }

    const reservedByGroup = reservedTerritoriesByOtherGroups.get(territoryId)

    if (reservedByGroup) {
      setError(`El territorio ya esta reservado por ${reservedByGroup}.`)
      return
    }

    setIsSaving(true)

    const payload = {
      title: title.trim(),
      territory_id: territoryId,
      driver_id: driverId,
      group_id: lockedGroupId || null,
      meeting_point_name: meetingPointName.trim(),
      meeting_point_lat: Number(meetingCoords[1].toFixed(6)),
      meeting_point_lng: Number(meetingCoords[0].toFixed(6)),
      scheduled_for: new Date(scheduledFor).toISOString(),
      notes: notes.trim() || null,
    }

    const query = editingOutingId
      ? client.from('salidas').update(payload).eq('id', editingOutingId)
      : client.from('salidas').insert(payload)

    const { data, error: saveError } = await query
      .select(
        'id, title, territory_id, driver_id, group_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, notes',
      )
      .single()

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    setOutings((current) =>
      [...current.filter((item) => item.id !== (data as OutingRecord).id), data as OutingRecord]
        .sort(
          (left, right) =>
            new Date(left.scheduled_for).getTime() -
            new Date(right.scheduled_for).getTime(),
        ),
    )
    setSelectedOutingId((data as OutingRecord).id)
    setMessage(
      editingOutingId
        ? 'Salida actualizada correctamente.'
        : 'Salida guardada correctamente.',
    )
    resetForm()
    setIsSaving(false)
  }

  const handleSavePlannerDrafts = async () => {
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Primero debes configurar Supabase.')
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
      setError('Tilda al menos una salida para guardar.')
      return
    }

    const incompleteDraft = enabledDrafts.find(
      ({ draft, slot, territory, driver }) =>
        !slot ||
        !territory ||
        !driver ||
        !draft.meetingPointName.trim() ||
        !draft.meetingCoords,
    )

    if (incompleteDraft) {
      setError('Cada salida tildada debe tener direccion, conductor, horario, territorio y GPS.')
      return
    }

    if (groupServiceMode && !lockedGroupId) {
      setError('Selecciona el grupo de servicio antes de guardar las salidas.')
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

    const payload = enabledDrafts.map(({ draft, slot, territory }) => ({
      title:
        slot?.kind === 'phone'
          ? PHONE_TITLE
          : `${territory?.name ?? 'Salida'} ${slot?.dayShort ?? ''} ${slot?.timeLabel ?? ''}`.trim(),
      territory_id: territory?.id ?? null,
      driver_id: draft.driverId,
      group_id: lockedGroupId || null,
      meeting_point_name: draft.meetingPointName.trim(),
      meeting_point_lat: Number(draft.meetingCoords?.[1].toFixed(6)),
      meeting_point_lng: Number(draft.meetingCoords?.[0].toFixed(6)),
      scheduled_for: new Date(slot?.scheduledForValue ?? '').toISOString(),
      notes: notes.trim() || null,
    }))

    const { data, error: saveError } = await client
      .from('salidas')
      .insert(payload)
      .select(
        'id, title, territory_id, driver_id, group_id, meeting_point_name, meeting_point_lat, meeting_point_lng, scheduled_for, notes',
      )

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    const savedOutings = ((data as OutingRecord[] | null) ?? []).sort(
      (left, right) =>
        new Date(left.scheduled_for).getTime() - new Date(right.scheduled_for).getTime(),
    )

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
    setMessage(`${savedOutings.length} salidas guardadas correctamente.`)
    setIsSaving(false)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{groupServiceMode ? 'Modulo 6' : 'Modulo 4'}</p>
          <h2>{groupServiceMode ? 'Salidas Grupo de Servicio' : 'Salidas'}</h2>
          <p className="lead">
            {groupServiceMode
              ? 'Planificador para que cada grupo reserve territorios sin pisarse con otros grupos.'
              : 'Planificador operativo para 2 semanas, con horarios por franja, predicacion telefonica y ficha PDF de cada salida.'}
          </p>
        </div>
      </section>

      <div className="module-console">
        <section className="module-hero">
          <div className="module-hero-copy">
            <p className="eyebrow">Planificador quincenal</p>
            <h3>
              {isGroupServiceDelegate && currentServiceGroup
                ? `${getGroupLabel(currentServiceGroup)} - agenda de servicio`
                : `Agenda desde ${plannerStartLabel} por 2 semanas`}
            </h3>
            <p>
              {canManageOutings
                ? 'Elige un slot del calendario, completa territorio, conductor y GPS, y descarga la ficha en PDF cuando quede lista.'
                : groupServiceMode
                  ? 'Tu usuario debe estar asociado como superintendente o auxiliar en Grupos para el Servicio.'
                  : 'Puedes consultar la agenda de salidas. La planificacion queda reservada para administradores.'}
            </p>
          </div>

          <div className="module-hero-stats">
            <article className="module-stat-card">
              <span>Total salidas</span>
              <strong>{visibleOutingDetails.length}</strong>
              <small>{groupServiceMode ? 'Del grupo' : 'Agenda acumulada'}</small>
            </article>
            <article className="module-stat-card">
              <span>Hoy</span>
              <strong>{scheduledTodayCount}</strong>
              <small>Programadas hoy</small>
            </article>
            <article className="module-stat-card">
              <span>Con grupo</span>
              <strong>{outingsWithGroup}</strong>
              <small>Asignadas</small>
            </article>
            <article className="module-stat-card">
              <span>Proximas</span>
              <strong>{upcomingCount}</strong>
              <small>Fuera de hoy</small>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">Agenda base</p>
              <h3>Salidas por dia y horario</h3>
            </div>
            <div className="module-registry-actions">
              <div className="territory-count-pill">
                <strong>{plannerSlotsByDay.length}</strong>
                <span>dias</span>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={handleSavePlannerDrafts}
                disabled={!canManageOutings || isSaving}
              >
                {isSaving ? 'Guardando...' : 'Guardar tildadas'}
              </button>
            </div>
          </div>

          <div className="outing-schedule-shell">
            <div className="outing-schedule-grid outing-schedule-head">
              <span>Tildar</span>
              <span>Dia</span>
              <span>Fecha</span>
              <span>Turno</span>
              <span>Direccion</span>
              <span>Conductor</span>
              <span>Horario</span>
              <span>Territorio</span>
              <span>Mapa</span>
              <span>Tipo</span>
            </div>

            <div className="outing-schedule-body">
              {plannerRows.map((row) => {
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
                      <input
                        value={draft?.meetingPointName ?? ''}
                        onChange={(event) =>
                          handlePlannerDraftFieldChange(row, {
                            meetingPointName: event.target.value,
                          })
                        }
                        placeholder="Direccion de salida"
                        disabled={!canManageOutings}
                      />
                      <select
                        value={draft?.driverId ?? ''}
                        onChange={(event) =>
                          handlePlannerDraftFieldChange(row, {
                            driverId: event.target.value,
                          })
                        }
                        disabled={!canManageOutings}
                      >
                        <option value="">Conductor</option>
                        {availableRowDrivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.full_name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedRowSlot?.key ?? ''}
                        onChange={(event) =>
                          handleSelectPlannerRowSlot(row, event.target.value)
                        }
                        disabled={!canManageOutings || row.slots.length === 0}
                      >
                        <option value="">Elegir horario</option>
                        {row.slots.map((slot) => (
                          <option key={slot.key} value={slot.key}>
                            {slot.timeLabel}
                          </option>
                        ))}
                      </select>
                      <select
                        value={draft?.territoryId ?? ''}
                        onChange={(event) =>
                          handlePlannerDraftFieldChange(row, {
                            territoryId: event.target.value,
                            meetingCoords: null,
                            mapOpen: Boolean(event.target.value),
                          })
                        }
                        disabled={!canManageOutings}
                      >
                        <option value="">Territorio</option>
                        {territories.map((territory) => {
                          const reservedByGroup = reservedTerritoriesByOtherGroups.get(
                            territory.id,
                          )

                          return (
                            <option
                              key={territory.id}
                              value={territory.id}
                              disabled={Boolean(reservedByGroup)}
                            >
                              {reservedByGroup
                                ? `${territory.name} - reservado por ${reservedByGroup}`
                                : territory.name}
                            </option>
                          )
                        })}
                      </select>
                      <button
                        type="button"
                        className="secondary-button outing-map-toggle"
                        onClick={() => handleTogglePlannerMap(row)}
                        disabled={!canManageOutings || !selectedRowTerritory}
                      >
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

                    {draft?.mapOpen && selectedRowTerritory ? (
                      <div className="outing-row-map">
                        <div className="map-picker-head">
                          <strong>{selectedRowTerritory.name}</strong>
                          <span>
                            {draft.meetingCoords
                              ? `${draft.meetingCoords[1].toFixed(6)}, ${draft.meetingCoords[0].toFixed(6)}`
                              : 'Marca el punto de referencia dentro del territorio'}
                          </span>
                        </div>
                        <MeetingPointPickerMap
                          markerPosition={draft.meetingCoords}
                          territoryGeometry={selectedRowTerritory.polygon_geojson ?? null}
                          onPick={(coords) =>
                            handlePlannerDraftFieldChange(row, {
                              meetingCoords: coords,
                              mapOpen: true,
                            })
                          }
                          zoom={14}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">Agenda guardada</p>
              <h3>Salidas programadas</h3>
            </div>

            <div className="module-registry-actions">
              <label className="module-search-field">
                <span className="sr-only">Buscar salidas</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por salida, territorio, conductor o punto"
                />
              </label>

              <label className="inline-filter">
                Territorio
                <select
                  value={territoryFilter}
                  onChange={(event) => setTerritoryFilter(event.target.value)}
                >
                  <option value="todos">Todos</option>
                  {territories.map((territory) => {
                    const reservedByGroup = reservedTerritoriesByOtherGroups.get(
                      territory.id,
                    )

                    return (
                      <option
                        key={territory.id}
                        value={territory.id}
                        disabled={Boolean(reservedByGroup)}
                      >
                        {reservedByGroup
                          ? `${territory.name} - reservado por ${reservedByGroup}`
                          : territory.name}
                      </option>
                    )
                  })}
                </select>
              </label>

              <label className="inline-filter">
                Agenda
                <select
                  value={scheduleFilter}
                  onChange={(event) =>
                    setScheduleFilter(event.target.value as ScheduleFilter)
                  }
                >
                  <option value="todos">Todas</option>
                  <option value="hoy">Hoy</option>
                  <option value="proximas">Proximas</option>
                  <option value="pasadas">Pasadas</option>
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="status-card">Cargando salidas...</div>
          ) : filteredOutings.length === 0 ? (
            <div className="status-card">
              {isSupabaseConfigured
                ? 'No hay salidas para el filtro seleccionado.'
                : 'Cuando conectes Supabase, aqui apareceran las salidas.'}
            </div>
          ) : (
            <div className="module-table-shell">
              <div className="module-table module-table-head module-table-head-wide">
                <span>Salida</span>
                <span>Territorio</span>
                <span>Conductor</span>
                <span>Horario</span>
                <span>Acciones</span>
              </div>

              <div className="module-table-body">
                {filteredOutings.map((outing) => (
                  <button
                    key={outing.id}
                    type="button"
                    className={
                      selectedOutingId === outing.id
                        ? 'module-table module-table-row module-table-row-wide module-table-row-button active'
                        : 'module-table module-table-row module-table-row-wide module-table-row-button'
                    }
                    onClick={() => setSelectedOutingId(outing.id)}
                  >
                    <strong>{outing.title}</strong>
                    <span>{outing.territoryName}</span>
                    <span>
                      {outing.driverName}
                      <span className={`status-pill status-${outing.scheduleStatus.key}`}>
                        {outing.scheduleStatus.label}
                      </span>
                    </span>
                    <span>{formatLocalDate(outing.scheduled_for)}</span>
                    <span className="module-table-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDownloadSavedPdf(outing)
                        }}
                      >
                        PDF
                      </button>
                      {canManageOutings ? (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              startEditing(outing)
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDelete(outing)
                            }}
                          >
                            Eliminar
                          </button>
                        </>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="two-column-grid module-form-grid">
          <article className="panel">
            <p className="eyebrow">{editingOutingId ? 'Edicion' : 'Planificacion'}</p>
            <h3>{editingOutingId ? 'Editar salida' : 'Nueva salida'}</h3>
            <p>
              Tilda un horario en la grilla, completa direccion, territorio,
              conductor y GPS, y descarga el PDF cuando quede lista.
            </p>

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
                Territorio
                <select
                  value={territoryId}
                  onChange={(event) => setTerritoryId(event.target.value)}
                  disabled={!canManageOutings}
                >
                  <option value="">Seleccionar territorio</option>
                  {territories.map((territory) => (
                    <option key={territory.id} value={territory.id}>
                      {territory.name}
                    </option>
                  ))}
                </select>
              </label>

              {selectedFormTerritory ? (
                <div className="module-detail-card">
                  <span>Territorio seleccionado</span>
                  <strong>{selectedFormTerritory.name}</strong>
                  <p>
                    {selectedFormTerritory.description ||
                      'Sin referencia breve cargada para este territorio.'}
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleUseTerritoryCenter}
                    disabled={!canManageOutings || !selectedTerritoryCenter}
                  >
                    Usar centro del territorio
                  </button>
                </div>
              ) : null}

              <label>
                Direccion de la salida / punto de encuentro
                <input
                  value={meetingPointName}
                  onChange={(event) => setMeetingPointName(event.target.value)}
                  placeholder="Ej. Plaza 25 de Mayo"
                  disabled={!canManageOutings}
                />
              </label>

              <label>
                Conductor
                <select
                  value={driverId}
                  onChange={(event) => setDriverId(event.target.value)}
                  disabled={!canManageOutings}
                >
                  <option value="">Seleccionar conductor</option>
                  {getAvailableDriversForSlot(selectedPlannerSlot).map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Grupo
                <select
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  disabled={!canManageOutings || isGroupServiceDelegate}
                >
                  <option value="">
                    {isGroupServiceDelegate ? 'Sin grupo asociado' : 'Sin grupo asignado'}
                  </option>
                  {(isGroupServiceDelegate ? serviceGroupAssignments : selectableGroups).map((group) => (
                    <option key={group.id} value={group.id}>
                      {getGroupLabel(group)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Dia y horario elegidos
                <input
                  value={scheduledFor ? formatLocalDate(new Date(scheduledFor).toISOString()) : ''}
                  placeholder="Selecciona un slot en la grilla"
                  disabled
                />
              </label>

              <label>
                Observaciones
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
                  <strong>Ubicacion geolocalizada</strong>
                  <span>
                    {meetingCoords
                      ? `${meetingCoords[1].toFixed(6)}, ${meetingCoords[0].toFixed(6)}`
                      : 'Haz clic sobre el mapa para fijar el punto'}
                  </span>
                </div>
                <MeetingPointPickerMap
                  markerPosition={meetingCoords}
                  territoryGeometry={selectedFormTerritory?.polygon_geojson ?? null}
                  onPick={(coords) => {
                    if (canManageOutings) {
                      setMeetingCoords(coords)
                    }
                  }}
                />
              </div>

              {error ? <div className="form-feedback error">{error}</div> : null}
              {message ? <div className="form-feedback success">{message}</div> : null}

              <button
                type="button"
                className="secondary-button full-width"
                onClick={handleDownloadDraftPdf}
                disabled={!canManageOutings}
              >
                Descargar PDF
              </button>

              {editingOutingId ? (
                <button
                  type="button"
                  className="secondary-button full-width"
                  onClick={resetForm}
                  disabled={isSaving}
                >
                  Cancelar edicion
                </button>
              ) : null}

              <button
                type="submit"
                className="primary-button full-width"
                disabled={!canManageOutings || isSaving}
              >
                {isSaving
                  ? 'Guardando...'
                  : editingOutingId
                    ? 'Actualizar salida'
                    : 'Guardar salida'}
              </button>
            </form>
          </article>

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
                  <strong>{selectedOuting.meeting_point_name}</strong>
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
                    {selectedOuting.meeting_point_lat}, {selectedOuting.meeting_point_lng}
                  </strong>
                </article>
                <article className="module-detail-card">
                  <span>Observaciones</span>
                  <strong>{selectedOuting.notes || 'Sin observaciones'}</strong>
                </article>
                <div className="map-picker-panel">
                  <div className="map-picker-head">
                    <strong>Vista previa del punto</strong>
                    <span>Referencia visual del lugar de encuentro cargado.</span>
                  </div>
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
                </div>
                <a
                  href={`https://www.google.com/maps?q=${selectedOuting.meeting_point_lat},${selectedOuting.meeting_point_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="map-link"
                >
                  Abrir punto en Google Maps
                </a>
              </div>
            ) : (
              <div className="module-guidance-list">
                <div className="module-guidance-item">
                  <strong>1. Tilda el horario</strong>
                  <span>Empieza por la grilla de 2 semanas y elige un slot.</span>
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
