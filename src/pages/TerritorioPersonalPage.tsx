import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Desplegable } from '../components/Desplegable'
import { Falta } from '../components/Falta'
import { Vacio } from '../components/Vacio'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/useAuth'
import { decirElError } from '../lib/decirElError'
import { rotuloTerritorio } from '../lib/salidaEtiquetas'
import { supabase } from '../lib/supabase'

type ReservationStatus = 'solicitada' | 'activa' | 'liberada' | 'rechazada'

type TerritoryRecord = {
  id: string
  name: string
}

type ProfileRecord = {
  id: string
  full_name: string | null
  access_status: 'active' | 'pending' | 'inactive'
}

type PersonalTerritoryReservation = {
  id: string
  territory_id: string
  reserved_for: string
  status: ReservationStatus
  assigned_to: string | null
  requested_by: string | null
  requested_at: string | null
  decided_by: string | null
  decided_at: string | null
  nota: string | null
  reserved_at: string | null
  released_at: string | null
}

type ReservationMovement = {
  id: string
  reserva_id: string
  estado_anterior: string | null
  estado_nuevo: string
  actor_id: string
  assigned_to: string | null
  nota: string | null
  created_at: string
}

type GroupMembership = {
  profile_id: string
  grupos_servicio:
    | { group_number: number | null; group_name: string | null }
    | Array<{ group_number: number | null; group_name: string | null }>
    | null
}

type QueryError = {
  message?: string
  code?: string
  details?: string
}

type PageQuery<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: QueryError | null }>

type LoadedPersonalData = {
  territories: TerritoryRecord[]
  profiles: ProfileRecord[]
  reservations: PersonalTerritoryReservation[]
  movements: ReservationMovement[]
  memberships: GroupMembership[]
  error: QueryError | null
}

type ReservationAction = 'aprobar' | 'rechazar' | 'devolver' | 'vincular'

const PAGE_SIZE = 1000
const ONE_MONTH_IN_MS = 30 * 24 * 60 * 60 * 1000

const statusLabels: Record<ReservationStatus, string> = {
  solicitada: 'Solicitada',
  activa: 'Activa',
  liberada: 'Liberada',
  rechazada: 'Rechazada',
}

/**
 * PostgREST devuelve como máximo su límite configurado por respuesta. Leer
 * por rangos evita que la bandeja quede truncada cuando el historial supera
 * 1.000 filas y, además, deja un orden estable para cada consulta.
 */
async function readAllPages<T>(query: PageQuery<T>) {
  const rows: T[] = []

  for (let page = 0; ; page += 1) {
    const response = await query(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (response.error) {
      return { rows: [], error: response.error }
    }

    const pageRows = response.data ?? []
    rows.push(...pageRows)

    if (pageRows.length < PAGE_SIZE) {
      return { rows, error: null }
    }
  }
}

async function loadPersonalData(
  client: NonNullable<typeof supabase>,
): Promise<LoadedPersonalData> {
  const territories = readAllPages<TerritoryRecord>((from, to) =>
    client
      .from('territorios')
      .select('id, name')
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const profiles = readAllPages<ProfileRecord>((from, to) =>
    client
      .from('profiles')
      .select('id, full_name, access_status')
      .eq('access_status', 'active')
      .order('full_name', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const reservations = readAllPages<PersonalTerritoryReservation>((from, to) =>
    client
      .from('territorio_personal_reservas')
      .select(
        'id, territory_id, reserved_for, status, assigned_to, requested_by, requested_at, decided_by, decided_at, nota, reserved_at, released_at',
      )
      .order('requested_at', { ascending: false, nullsFirst: false })
      .order('reserved_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to),
  )

  const movements = readAllPages<ReservationMovement>((from, to) =>
    client
      .from('reserva_movimientos')
      .select(
        'id, reserva_id, estado_anterior, estado_nuevo, actor_id, assigned_to, nota, created_at',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )

  const memberships = readAllPages<GroupMembership>((from, to) =>
    client
      .from('grupo_miembros')
      .select('profile_id, grupos_servicio(group_number, group_name)')
      .is('hasta', null)
      .range(from, to),
  )

  const [territoriesData, profilesData, reservationsData, movementsData, membershipsData] = await Promise.all([
    territories,
    profiles,
    reservations,
    movements,
    memberships,
  ])

  return {
    territories: territoriesData.rows,
    profiles: profilesData.rows,
    reservations: reservationsData.rows,
    movements: movementsData.rows,
    memberships: membershipsData.rows,
    error:
      territoriesData.error ??
      profilesData.error ??
      reservationsData.error ??
      movementsData.error ??
      membershipsData.error,
  }
}

function normalizedSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function profileName(profile: ProfileRecord | undefined) {
  const name = profile?.full_name?.trim()
  return name || 'Sin nombre cargado'
}

function profileOptionText(
  profile: ProfileRecord,
  profiles: ProfileRecord[],
) {
  const name = profileName(profile)
  const homonimos = profiles.filter((item) => profileName(item) === name).length > 1
  if (!homonimos) return name
  return `${name} · ${profile.id.slice(0, 8)}`
}

function profileDisplay(id: string | null, profilesById: Map<string, ProfileRecord>) {
  if (!id) {
    return 'Sin persona vinculada'
  }

  const profile = profilesById.get(id)
  return profile ? profileName(profile) : 'Cuenta no disponible'
}

function formatDate(value: string | null) {
  if (!value) return 'Sin fecha'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible'

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatDateTime(value: string | null) {
  if (!value) return 'Sin fecha'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible'

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getReservedDays(reservedAt: string | null) {
  if (!reservedAt) return null

  const timestamp = new Date(reservedAt).getTime()
  if (Number.isNaN(timestamp)) return null

  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)))
}

function isMonthOld(reservedAt: string | null) {
  if (!reservedAt) return false

  const timestamp = new Date(reservedAt).getTime()
  return !Number.isNaN(timestamp) && Date.now() - timestamp >= ONE_MONTH_IN_MS
}

function statusClass(status: string) {
  if (status === 'activa') return 'status-activo'
  if (status === 'solicitada') return 'status-pendiente'
  return 'status-inactivo'
}

function statusText(status: string) {
  return status in statusLabels
    ? statusLabels[status as ReservationStatus]
    : status || 'Sin estado'
}

function reservationTimestamp(reservation: PersonalTerritoryReservation) {
  return new Date(
    reservation.requested_at ?? reservation.reserved_at ?? reservation.released_at ?? 0,
  ).getTime()
}

function movementText(movement: ReservationMovement) {
  if (!movement.estado_anterior && movement.estado_nuevo === 'solicitada') {
    return 'Solicitud creada'
  }
  if (movement.estado_anterior === 'solicitada' && movement.estado_nuevo === 'activa') {
    return 'Solicitud aprobada'
  }
  if (movement.estado_anterior === 'solicitada' && movement.estado_nuevo === 'rechazada') {
    return 'Solicitud rechazada'
  }
  if (movement.estado_anterior === 'activa' && movement.estado_nuevo === 'liberada') {
    return 'Territorio devuelto'
  }
  if (movement.estado_anterior === 'activa' && movement.estado_nuevo === 'activa') {
    return 'Persona vinculada'
  }
  return `${statusText(movement.estado_anterior ?? 'inicio')} → ${statusText(
    movement.estado_nuevo,
  )}`
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return decirElError({ message: error.message }, fallback)
  }

  if (error && typeof error === 'object') {
    return decirElError(error as QueryError, fallback)
  }

  return fallback
}

export function TerritorioPersonalPage() {
  const { profile } = useAuth()
  const client = supabase
  const canManagePersonalTerritories = profile?.role === 'admin'
  const isMounted = useRef(false)

  const [territories, setTerritories] = useState<TerritoryRecord[]>([])
  const [profiles, setProfiles] = useState<ProfileRecord[]>([])
  const [reservations, setReservations] = useState<PersonalTerritoryReservation[]>([])
  const [movements, setMovements] = useState<ReservationMovement[]>([])
  const [memberships, setMemberships] = useState<GroupMembership[]>([])
  const [manualTerritoryId, setManualTerritoryId] = useState('')
  const [manualAssignedTo, setManualAssignedTo] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [beneficiaryByReservation, setBeneficiaryByReservation] = useState<
    Record<string, string>
  >({})
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<'pendientes' | 'activos' | 'historial'>('pendientes')
  const [assignmentOpen, setAssignmentOpen] = useState(false)

  useEffect(() => {
    isMounted.current = true

    return () => {
      isMounted.current = false
    }
  }, [])

  const reloadData = useCallback(
    async (showLoading = false) => {
      if (!client) {
        if (isMounted.current) {
          setError('Falta conectar la base para gestionar territorios personales.')
          setIsLoading(false)
        }
        return false
      }

      if (!canManagePersonalTerritories) {
        if (isMounted.current) setIsLoading(false)
        return false
      }

      if (showLoading) setIsLoading(true)

      try {
        const loaded = await loadPersonalData(client)
        if (!isMounted.current) return false

        if (loaded.error) {
          setError(errorMessage(loaded.error, 'No se pudo cargar Territorio Personal.'))
          setTerritories([])
          setProfiles([])
          setReservations([])
          setMovements([])
          setMemberships([])
          setIsLoading(false)
          return false
        }

        const activeProfiles = loaded.profiles.filter(
          (item) => item.access_status === 'active',
        )
        const activeProfileIds = new Set(activeProfiles.map((item) => item.id))
        const defaults: Record<string, string> = {}

        loaded.reservations
          .filter((item) => item.status === 'solicitada')
          .forEach((item) => {
            defaults[item.id] =
              item.requested_by && activeProfileIds.has(item.requested_by)
                ? item.requested_by
                : ''
          })

        setTerritories(loaded.territories)
        setProfiles(activeProfiles)
        setReservations(loaded.reservations)
        setMovements(loaded.movements)
        setMemberships(loaded.memberships)
        setBeneficiaryByReservation(defaults)
        setDecisionNotes({})
        setError(null)
        setIsLoading(false)
        return true
      } catch (caught) {
        if (!isMounted.current) return false

        setError(errorMessage(caught, 'No se pudo cargar Territorio Personal.'))
        setTerritories([])
        setProfiles([])
        setReservations([])
        setMovements([])
        setMemberships([])
        setIsLoading(false)
        return false
      }
    },
    [canManagePersonalTerritories, client],
  )

  useEffect(() => {
    if (!canManagePersonalTerritories) {
      setIsLoading(false)
      return
    }

    void reloadData(true)
  }, [canManagePersonalTerritories, reloadData])

  const activeProfiles = useMemo(
    () => profiles.filter((item) => item.access_status === 'active'),
    [profiles],
  )

  const profilesById = useMemo(
    () => new Map(activeProfiles.map((item) => [item.id, item])),
    [activeProfiles],
  )

  const groupsByProfile = useMemo(() => {
    const result = new Map<string, string>()
    memberships.forEach((membership) => {
      const group = Array.isArray(membership.grupos_servicio)
        ? membership.grupos_servicio[0]
        : membership.grupos_servicio
      if (!group) return
      result.set(
        membership.profile_id,
        group.group_number ? `Grupo ${group.group_number}` : group.group_name || 'Grupo sin nombre',
      )
    })
    return result
  }, [memberships])

  const activeProfileIds = useMemo(
    () => new Set(activeProfiles.map((item) => item.id)),
    [activeProfiles],
  )

  const territoriesById = useMemo(
    () => new Map(territories.map((item) => [item.id, item])),
    [territories],
  )

  const reservationsById = useMemo(
    () => new Map(reservations.map((item) => [item.id, item])),
    [reservations],
  )

  const activeReservations = useMemo(
    () =>
      reservations
        .filter((item) => item.status === 'activa')
        .sort((a, b) => reservationTimestamp(b) - reservationTimestamp(a)),
    [reservations],
  )

  const pendingReservations = useMemo(
    () =>
      reservations
        .filter((item) => item.status === 'solicitada')
        .sort((a, b) => reservationTimestamp(b) - reservationTimestamp(a)),
    [reservations],
  )

  const legacyActiveReservations = useMemo(
    () => activeReservations.filter((item) => !item.assigned_to),
    [activeReservations],
  )

  const overdueReservations = useMemo(
    () => activeReservations.filter((item) => isMonthOld(item.reserved_at)),
    [activeReservations],
  )

  const activeReservationsByTerritory = useMemo(() => {
    const map = new Map<string, PersonalTerritoryReservation>()

    activeReservations.forEach((reservation) => {
      map.set(reservation.territory_id, reservation)
    })

    return map
  }, [activeReservations])

  const query = normalizedSearch(searchTerm)

  const matchesReservation = useCallback(
    (reservation: PersonalTerritoryReservation) => {
      if (!query) return true

      const territoryName = territoriesById.get(reservation.territory_id)?.name ?? ''
      const requesterName = profileDisplay(reservation.requested_by, profilesById)
      const beneficiaryName = profileDisplay(reservation.assigned_to, profilesById)

      return normalizedSearch(
        [
          territoryName,
          reservation.reserved_for,
          requesterName,
          beneficiaryName,
          reservation.id,
        ].join(' '),
      ).includes(query)
    },
    [profilesById, query, territoriesById],
  )

  const filteredPendingReservations = useMemo(
    () => pendingReservations.filter(matchesReservation),
    [matchesReservation, pendingReservations],
  )

  const filteredActiveReservations = useMemo(
    () => activeReservations.filter(matchesReservation),
    [activeReservations, matchesReservation],
  )

  const filteredMovements = useMemo(() => {
    return movements.filter((movement) => {
      if (!query) return true

      const reservation = reservationsById.get(movement.reserva_id)
      const territoryName = reservation
        ? territoriesById.get(reservation.territory_id)?.name ?? ''
        : ''
      const actorName = profileDisplay(movement.actor_id, profilesById)
      const beneficiaryName = profileDisplay(movement.assigned_to, profilesById)
      const originalText = reservation?.reserved_for ?? ''

      return normalizedSearch(
        [
          territoryName,
          originalText,
          actorName,
          beneficiaryName,
          movement.estado_anterior ?? '',
          movement.estado_nuevo,
          movement.nota ?? '',
          movement.reserva_id,
        ].join(' '),
      ).includes(query)
    })
  }, [movements, profilesById, query, reservationsById, territoriesById])

  const territoryOptions = useMemo(
    () => [
      { valor: '', texto: 'Elegir territorio' },
      ...territories.map((territory) => {
        const reservation = activeReservationsByTerritory.get(territory.id)
        const activeText = reservation
          ? reservation.assigned_to
            ? ` — activo para ${profileDisplay(reservation.assigned_to, profilesById)}`
            : ' — activo, beneficiario pendiente de vincular'
          : ''

        return {
          valor: territory.id,
          texto: `${territory.name}${activeText}`,
          deshabilitada: Boolean(reservation),
        }
      }),
    ],
    [activeReservationsByTerritory, profilesById, territories],
  )

  const profileOptions = useMemo(
    () => [
      { valor: '', texto: 'Elegir perfil activo' },
      ...activeProfiles.map((item) => ({
        valor: item.id,
        texto: profileOptionText(item, activeProfiles),
      })),
    ],
    [activeProfiles],
  )

  const setReservationBeneficiary = (reservationId: string, value: string) => {
    setBeneficiaryByReservation((current) => ({ ...current, [reservationId]: value }))
  }

  const setReservationNote = (reservationId: string, value: string) => {
    setDecisionNotes((current) => ({ ...current, [reservationId]: value }))
  }

  const actionSuccessMessage = (action: ReservationAction) => {
    if (action === 'aprobar') return 'Solicitud aprobada y territorio asignado.'
    if (action === 'rechazar') return 'Solicitud rechazada y motivo guardado.'
    if (action === 'vincular') return 'Persona vinculada a la reserva legacy.'
    return 'Territorio devuelto y movimiento guardado en el historial.'
  }

  const actionErrorMessage = (action: ReservationAction) => {
    if (action === 'aprobar') return 'No se pudo aprobar la solicitud.'
    if (action === 'rechazar') return 'No se pudo rechazar la solicitud.'
    if (action === 'vincular') return 'No se pudo vincular la persona.'
    return 'No se pudo devolver el territorio.'
  }

  const handleReservationAction = async (
    reservation: PersonalTerritoryReservation,
    action: Exclude<ReservationAction, 'vincular'>,
  ) => {
    if (!client || !canManagePersonalTerritories || isSaving) return

    const note = decisionNotes[reservation.id]?.trim() ?? ''
    let assignedTo: string | null = null

    if (action === 'aprobar') {
      const selected = beneficiaryByReservation[reservation.id] ?? ''
      assignedTo = selected || reservation.requested_by

      if (!assignedTo || !activeProfileIds.has(assignedTo)) {
        setError(
          'Elegí un perfil activo como beneficiario. No se puede aprobar por el nombre escrito en la solicitud.',
        )
        setMessage(null)
        return
      }
    }

    if (action === 'rechazar' && note.length < 2) {
      setError('Escribí el motivo del rechazo antes de resolver la solicitud.')
      setMessage(null)
      return
    }

    if (action === 'rechazar') {
      const quien = profileDisplay(reservation.requested_by, profilesById)
      if (
        !window.confirm(
          `¿Rechazás el pedido de ${quien}? Esta decisión queda en el historial.`,
        )
      ) {
        return
      }
    }

    if (action === 'devolver') {
      const quien = profileDisplay(reservation.assigned_to, profilesById)
      if (
        !window.confirm(
          `¿Devolvés el territorio de ${quien}? Deja de estar reservado a su nombre.`,
        )
      ) {
        return
      }
    }

    if (note.length > 2000) {
      setError('La nota no puede superar los 2.000 caracteres.')
      setMessage(null)
      return
    }

    setError(null)
    setMessage(null)
    setIsSaving(true)

    try {
      const { error: actionError } = await client.rpc('gestionar_reserva', {
        p_reserva_id: reservation.id,
        p_accion: action,
        p_assigned_to: assignedTo,
        p_nota: note || null,
      })

      if (actionError) {
        setError(errorMessage(actionError, actionErrorMessage(action)))
        return
      }

      const refreshed = await reloadData()
      setMessage(
        refreshed
          ? actionSuccessMessage(action)
          : `${actionSuccessMessage(action)} La lista no pudo actualizarse; volvé a cargarla.`,
      )
    } catch (caught) {
      setError(errorMessage(caught, actionErrorMessage(action)))
    } finally {
      setIsSaving(false)
    }
  }

  const handleLinkLegacy = async (reservation: PersonalTerritoryReservation) => {
    if (
      !client ||
      !canManagePersonalTerritories ||
      isSaving ||
      reservation.status !== 'activa' ||
      reservation.assigned_to
    ) {
      return
    }

    const assignedTo = beneficiaryByReservation[reservation.id] ?? ''
    const note = decisionNotes[reservation.id]?.trim() ?? ''

    if (!assignedTo || !activeProfileIds.has(assignedTo)) {
      setError('Elegí un perfil activo para vincular esta reserva antigua.')
      setMessage(null)
      return
    }

    if (note.length > 2000) {
      setError('La nota no puede superar los 2.000 caracteres.')
      setMessage(null)
      return
    }

    setError(null)
    setMessage(null)
    setIsSaving(true)

    try {
      const { error: actionError } = await client.rpc('gestionar_reserva', {
        p_reserva_id: reservation.id,
        p_accion: 'vincular',
        p_assigned_to: assignedTo,
        p_nota: note || null,
      })

      if (actionError) {
        setError(errorMessage(actionError, actionErrorMessage('vincular')))
        return
      }

      const refreshed = await reloadData()
      setMessage(
        refreshed
          ? actionSuccessMessage('vincular')
          : `${actionSuccessMessage('vincular')} La lista no pudo actualizarse; volvé a cargarla.`,
      )
    } catch (caught) {
      setError(errorMessage(caught, actionErrorMessage('vincular')))
    } finally {
      setIsSaving(false)
    }
  }

  const handleManualAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!client || !canManagePersonalTerritories || isSaving) return

    const selectedTerritory = territoriesById.get(manualTerritoryId)
    const activeReservation = activeReservationsByTerritory.get(manualTerritoryId)
    const note = manualNote.trim()

    if (!selectedTerritory || !manualAssignedTo) {
      setError('Elegí un territorio y un perfil activo para crear la asignación.')
      setMessage(null)
      return
    }

    if (activeReservation) {
      setError('Ese territorio ya tiene una reserva activa. Actualizá la lista antes de elegir otro.')
      setMessage(null)
      return
    }

    if (!activeProfileIds.has(manualAssignedTo)) {
      setError('Elegí un perfil que esté activo en el sistema.')
      setMessage(null)
      return
    }

    if (note.length > 2000) {
      setError('La nota no puede superar los 2.000 caracteres.')
      setMessage(null)
      return
    }

    setError(null)
    setMessage(null)
    setIsSaving(true)

    try {
      const { error: actionError } = await client.rpc('asignar_territorio', {
        p_territory_id: selectedTerritory.id,
        p_assigned_to: manualAssignedTo,
        p_nota: note || null,
      })

      if (actionError) {
        setError(errorMessage(actionError, 'No se pudo crear la asignación manual.'))
        return
      }

      setManualTerritoryId('')
      setManualAssignedTo('')
      setManualNote('')
      setAssignmentOpen(false)

      const refreshed = await reloadData()
      setMessage(
        refreshed
          ? 'Asignación manual creada y registrada en el historial.'
          : 'Asignación manual creada. La lista no pudo actualizarse; volvé a cargarla.',
      )
    } catch (caught) {
      setError(errorMessage(caught, 'No se pudo crear la asignación manual.'))
    } finally {
      setIsSaving(false)
    }
  }

  if (!canManagePersonalTerritories) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <p className="eyebrow">Administración</p>
            <h2>Territorio Personal</h2>
            <p className="lead">
              Las solicitudes y asignaciones personales se resuelven desde el panel administrativo.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="status-card">
            <strong>Solo un administrador puede gestionar reservas personales.</strong>
            <span>Tu acceso no habilita decisiones, devoluciones ni asignaciones.</span>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Administración</p>
          <h2>Territorio Personal</h2>
          <p className="lead">
            Resolvé solicitudes, asigná territorios y conservá cada decisión. El beneficiario siempre se
            elige por un perfil activo, nunca por coincidencia de nombres.
          </p>
        </div>
      </section>

      <div className="module-console">
        {error ? (
          <div className="form-feedback error" role="alert">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="form-feedback success" role="status">
            {message}
          </div>
        ) : null}

        <Falta
          cuantos={pendingReservations.length}
          uno="Un pedido de territorio espera tu decisión"
          varios="{n} pedidos de territorio esperan tu decisión"
          detalle="Elegí un perfil activo antes de aprobar; para rechazar, dejá el motivo."
        />

        <div className="module-table-actions personal-tabs" role="tablist" aria-label="Territorios personales">
          <button type="button" className="secondary-button" role="tab" aria-selected={view === 'pendientes'} onClick={() => setView('pendientes')}>Pendientes ({pendingReservations.length})</button>
          <button type="button" className="secondary-button" role="tab" aria-selected={view === 'activos'} onClick={() => setView('activos')}>Activos ({activeReservations.length})</button>
          <button type="button" className="secondary-button" role="tab" aria-selected={view === 'historial'} onClick={() => setView('historial')}>Historial</button>
        </div>

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">Buscar</p>
              <h3>Solicitudes, asignaciones e historial</h3>
            </div>
            <label className="module-search-field">
              <span className="sr-only">Buscar en territorios personales</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Territorio, persona o nota"
              />
            </label>
          </div>
        </section>

        {isLoading ? (
          <div className="status-card">Cargando territorios, perfiles y movimientos...</div>
        ) : (
          <>
            <section className="panel module-registry-panel" hidden={view !== 'pendientes'}>
              <div className="module-registry-toolbar">
                <div>
                  <p className="eyebrow">Bandeja</p>
                  <h3>Solicitudes pendientes</h3>
                </div>
                <span className="status-pill status-pendiente">
                  {pendingReservations.length} pendientes
                </span>
              </div>

              {filteredPendingReservations.length === 0 ? (
                <Vacio
                  hay={pendingReservations.length}
                  sinNada="No hay solicitudes pendientes."
                  comoEmpezar="Cuando alguien pida un territorio, va a aparecer acá para resolverlo."
                  filtrados="Ninguna solicitud coincide con la búsqueda."
                />
              ) : (
                <div className="personal-reservation-list">
                  {filteredPendingReservations.map((reservation) => {
                    const territoryName =
                      rotuloTerritorio(territoriesById.get(reservation.territory_id)?.name)
                    const requestedByName = profileDisplay(reservation.requested_by, profilesById)
                    const selectedBeneficiary =
                      beneficiaryByReservation[reservation.id] ??
                      (reservation.requested_by && activeProfileIds.has(reservation.requested_by)
                        ? reservation.requested_by
                        : '')
                    const requestedProfileIsNotActive =
                      Boolean(reservation.requested_by) &&
                      !activeProfileIds.has(reservation.requested_by ?? '')

                    return (
                      <article key={reservation.id} className="personal-reservation-card">
                        <div>
                          <span className="status-pill status-pendiente">Solicitud pendiente</span>
                          <strong>{territoryName}</strong>
                          {reservation.reserved_for && reservation.reserved_for !== requestedByName ? (
                            <p>Nombre escrito en el pedido: {reservation.reserved_for}</p>
                          ) : null}
                          <small>
                            Solicitó: {requestedByName} · Pedido el{' '}
                            {formatDateTime(reservation.requested_at)}
                          </small>
                          <small>
                            Grupo: {reservation.requested_by ? groupsByProfile.get(reservation.requested_by) ?? 'Sin grupo' : 'Sin solicitante vinculado'}
                          </small>

                          {requestedProfileIsNotActive ? (
                            <div className="form-feedback error">
                              El solicitante no tiene un perfil activo disponible. Elegí el beneficiario
                              manualmente; no se va a asociar por el texto conservado.
                            </div>
                          ) : null}
                          {!reservation.requested_by ? (
                            <div className="form-feedback error">
                              Esta solicitud no tiene solicitante vinculado. Requiere revisión manual.
                            </div>
                          ) : null}

                          <div className="form-stack">
                            <label>
                              Beneficiario confirmado
                              <Desplegable
                                etiqueta="Elegir perfil activo"
                                valor={selectedBeneficiary}
                                alElegir={(value) =>
                                  setReservationBeneficiary(reservation.id, value)
                                }
                                deshabilitado={isSaving || activeProfiles.length === 0}
                                opciones={profileOptions}
                              />
                            </label>

                            <label>
                              Nota de decisión
                              <textarea
                                value={decisionNotes[reservation.id] ?? ''}
                                onChange={(event) =>
                                  setReservationNote(reservation.id, event.target.value)
                                }
                                placeholder="Obligatoria si rechazás; opcional si aprobás"
                                maxLength={2000}
                                rows={3}
                                disabled={isSaving}
                              />
                            </label>

                            <div className="module-table-actions">
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => void handleReservationAction(reservation, 'aprobar')}
                                disabled={isSaving}
                              >
                                {isSaving ? 'Procesando...' : 'Aprobar'}
                              </button>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() => void handleReservationAction(reservation, 'rechazar')}
                                disabled={isSaving}
                              >
                                {isSaving ? 'Procesando...' : 'Rechazar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            {legacyActiveReservations.length > 0 ? (
              <section className="panel personal-alert-panel" hidden={view !== 'activos'}>
                <p className="eyebrow">Revisión manual</p>
                <h3>
                  {legacyActiveReservations.length === 1
                    ? 'Hay una reserva activa antigua sin persona vinculada.'
                    : `Hay ${legacyActiveReservations.length} reservas activas antiguas sin persona vinculada.`}
                </h3>
                <p>
                  No se intentó emparejar el texto original de la solicitud con ningún nombre. Elegí “Vincular persona”
                  en la fila correspondiente para dejar una decisión auditable.
                </p>
              </section>
            ) : null}

            {overdueReservations.length > 0 ? (
              <section className="panel personal-alert-panel" hidden={view !== 'activos'}>
                <p className="eyebrow">Avisos de seguimiento</p>
                <h3>Territorios activos desde hace más de un mes</h3>
                <div className="personal-alert-list">
                  {overdueReservations.map((reservation) => {
                    const territoryName =
                      rotuloTerritorio(territoriesById.get(reservation.territory_id)?.name)

                    return (
                      <article key={reservation.id} className="personal-alert-card">
                        <strong>{territoryName}</strong>
                        <span>
                          Activo para {profileDisplay(reservation.assigned_to, profilesById)} desde{' '}
                          {formatDate(reservation.reserved_at)}.
                        </span>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <section className="panel module-registry-panel" hidden={view !== 'activos'}>
              <div className="module-registry-toolbar">
                <div>
                  <p className="eyebrow">Asignaciones vigentes</p>
                  <h3>Territorios activos</h3>
                </div>
                <span className="status-pill status-activo">
                  {activeReservations.length} activos
                </span>
                <button type="button" className="primary-button" onClick={() => setAssignmentOpen(true)}>Asignar territorio</button>
              </div>

              {filteredActiveReservations.length === 0 ? (
                <Vacio
                  hay={activeReservations.length}
                  sinNada="No hay territorios personales activos."
                  comoEmpezar="Podés crear una asignación manual cuando tengas un perfil y un territorio confirmados."
                  filtrados="Ninguna asignación coincide con la búsqueda."
                />
              ) : (
                <div className="personal-reservation-list">
                  {filteredActiveReservations.map((reservation) => {
                    const territoryName =
                      rotuloTerritorio(territoriesById.get(reservation.territory_id)?.name)
                    const days = getReservedDays(reservation.reserved_at)
                    const isLegacy = !reservation.assigned_to
                    const selectedBeneficiary = beneficiaryByReservation[reservation.id] ?? ''

                    return (
                      <article key={reservation.id} className="personal-reservation-card">
                        <div>
                          <span className="status-pill status-activo">
                            {isLegacy ? 'Activa · revisar vínculo' : 'Activa'}
                          </span>
                          <strong>{territoryName}</strong>
                          <p>
                            Beneficiario:{' '}
                            {isLegacy
                              ? 'Pendiente de vincular'
                              : profileDisplay(reservation.assigned_to, profilesById)}
                          </p>
                          <small>
                            Desde {formatDate(reservation.reserved_at)}
                            {days === null ? '' : ` · ${days} día/s`}
                          </small>
                          <small>
                            Grupo: {reservation.assigned_to ? groupsByProfile.get(reservation.assigned_to) ?? 'Sin grupo' : 'Sin persona vinculada'} · Aprobó: {profileDisplay(reservation.decided_by, profilesById)}
                          </small>
                          {reservation.assigned_to && !activeProfileIds.has(reservation.assigned_to) ? (
                            <div className="form-feedback error">
                              La persona asignada ya no aparece entre los perfiles activos. Revisá el
                              vínculo; no se reemplaza automáticamente.
                            </div>
                          ) : null}

                          {isLegacy ? (
                            <div className="form-stack">
                              <label>
                                Vincular con perfil activo
                                <Desplegable
                                  etiqueta="Elegir perfil activo"
                                  valor={selectedBeneficiary}
                                  alElegir={(value) =>
                                    setReservationBeneficiary(reservation.id, value)
                                  }
                                  deshabilitado={isSaving || activeProfiles.length === 0}
                                  opciones={profileOptions}
                                />
                              </label>
                              <label>
                                Nota de revisión
                                <textarea
                                  value={decisionNotes[reservation.id] ?? ''}
                                  onChange={(event) =>
                                    setReservationNote(reservation.id, event.target.value)
                                  }
                                  placeholder="Opcional; deja constancia de cómo se resolvió la ambigüedad"
                                  maxLength={2000}
                                  rows={3}
                                  disabled={isSaving}
                                />
                              </label>
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => void handleLinkLegacy(reservation)}
                                disabled={isSaving}
                              >
                                {isSaving ? 'Procesando...' : 'Vincular persona'}
                              </button>
                            </div>
                          ) : null}
                        </div>

                        <div className="module-table-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void handleReservationAction(reservation, 'devolver')}
                            disabled={isSaving}
                          >
                            {isSaving ? 'Procesando...' : 'Devolver'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <Modal abierto={assignmentOpen} alCerrar={() => setAssignmentOpen(false)} titulo="Asignar territorio" bajada="Elegí una persona y un territorio disponible.">
            <section>
                <p className="eyebrow">Nueva asignación</p>
                <h3>Asignar manualmente</h3>
                <p>
                  Usá esta opción para una asignación que no nace de una solicitud. No se puede ocupar un territorio que ya está activo.
                </p>

                <form className="form-stack" onSubmit={handleManualAssignment}>
                  <label>
                    Territorio
                    <Desplegable
                      etiqueta="Elegir territorio"
                      valor={manualTerritoryId}
                      alElegir={setManualTerritoryId}
                      deshabilitado={isSaving || territories.length === 0}
                      opciones={territoryOptions}
                    />
                  </label>

                  <label>
                    Beneficiario
                    <Desplegable
                      etiqueta="Elegir perfil activo"
                      valor={manualAssignedTo}
                      alElegir={setManualAssignedTo}
                      deshabilitado={isSaving || activeProfiles.length === 0}
                      opciones={profileOptions}
                    />
                  </label>

                  <label>
                    Nota
                    <textarea
                      value={manualNote}
                      onChange={(event) => setManualNote(event.target.value)}
                      placeholder="Opcional; por qué se asigna manualmente"
                      maxLength={2000}
                      rows={3}
                      disabled={isSaving}
                    />
                  </label>

                  <button
                    type="submit"
                    className="primary-button full-width"
                    disabled={
                      isSaving ||
                      !manualTerritoryId ||
                      !manualAssignedTo ||
                      territories.length === 0 ||
                      activeProfiles.length === 0
                    }
                  >
                    {isSaving ? 'Procesando...' : 'Crear asignación'}
                  </button>
                </form>
            </section>
            </Modal>

            <section className="panel module-registry-panel" hidden={view !== 'historial'}>
              <div className="module-registry-toolbar">
                <div>
                  <p className="eyebrow">Auditoría</p>
                  <h3>Historial de decisiones</h3>
                </div>
                <span className="status-pill status-inactivo">
                  {movements.length} movimientos
                </span>
              </div>

              {filteredMovements.length === 0 ? (
                <Vacio
                  hay={movements.length}
                  sinNada="Todavía no hay movimientos registrados."
                  comoEmpezar="Las solicitudes, aprobaciones, devoluciones y vínculos quedan acá."
                  filtrados="Ningún movimiento coincide con la búsqueda."
                />
              ) : (
                <div className="personal-reservation-list">
                  {filteredMovements.map((movement) => {
                    const reservation = reservationsById.get(movement.reserva_id)
                    const territoryName = reservation
                      ? rotuloTerritorio(territoriesById.get(reservation.territory_id)?.name)
                      : 'Territorio no disponible'

                    return (
                      <article key={movement.id} className="personal-reservation-card">
                        <div>
                          <span className={`status-pill ${statusClass(movement.estado_nuevo)}`}>
                            {movementText(movement)}
                          </span>
                          <strong>{territoryName}</strong>
                          <p>
                            {reservation
                              ? `Texto conservado: ${reservation.reserved_for || 'Sin texto cargado'}`
                              : `Reserva ${movement.reserva_id}`}
                          </p>
                          <small>
                            {formatDateTime(movement.created_at)} · Actor:{' '}
                            {profileDisplay(movement.actor_id, profilesById)}
                          </small>
                          <small>
                            Estado: {statusText(movement.estado_anterior ?? 'inicio')} →{' '}
                            {statusText(movement.estado_nuevo)} · Beneficiario:{' '}
                            {profileDisplay(movement.assigned_to, profilesById)}
                          </small>
                          {movement.nota ? <p>Nota: {movement.nota}</p> : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
