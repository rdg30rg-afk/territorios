import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type DriverStatus = 'activo' | 'pendiente' | 'inactivo'
type DriverAvailabilityTurn = 'manana' | 'tarde' | 'telefonica'

type DriverAvailability = {
  days: number[]
  turns: DriverAvailabilityTurn[]
  byDay?: Record<string, DriverAvailabilityTurn[]>
}

type DriverRecord = {
  id: string
  full_name: string
  phone: string | null
  notes: string | null
  status: DriverStatus
  availability: DriverAvailability | null
  created_at: string
}

const statusLabels: Record<DriverStatus, string> = {
  activo: 'Activo',
  pendiente: 'Pendiente',
  inactivo: 'Inactivo',
}

const weekDays = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miercoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sabado' },
  { value: 0, label: 'Domingo' },
]

const availabilityTurns: Array<{ value: DriverAvailabilityTurn; label: string }> = [
  { value: 'manana', label: 'Manana' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'telefonica', label: 'Telefonica' },
]

const emptyAvailability: DriverAvailability = {
  days: [],
  turns: [],
  byDay: {},
}

function normalizeAvailability(value: unknown): DriverAvailability {
  if (!value || typeof value !== 'object') {
    return emptyAvailability
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

function formatDriverAvailability(availability: DriverAvailability | null) {
  const normalized = normalizeAvailability(availability)

  if (normalized.days.length === 0 && normalized.turns.length === 0) {
    return 'Sin disponibilidad cargada'
  }

  const dayLabels =
    normalized.days.length === 0
      ? 'Cualquier dia'
      : weekDays
          .filter((day) => normalized.days.includes(day.value))
          .map((day) => day.label)
          .join(', ')
  const hasDetailedAvailability = Object.keys(normalized.byDay ?? {}).length > 0
  const turnLabels =
    hasDetailedAvailability
      ? weekDays
          .filter((day) => normalized.days.includes(day.value))
          .map((day) => {
            const dayTurns = normalized.byDay?.[String(day.value)] ?? []

            if (dayTurns.length === 0) {
              return `${day.label}: sin turno`
            }

            return `${day.label}: ${availabilityTurns
              .filter((turn) => dayTurns.includes(turn.value))
              .map((turn) => turn.label)
              .join('/')}`
          })
          .join(' · ')
      : normalized.turns.length === 0
      ? 'Cualquier turno'
      : availabilityTurns
          .filter((turn) => normalized.turns.includes(turn.value))
          .map((turn) => turn.label)
          .join(', ')

  return hasDetailedAvailability ? turnLabels : `${dayLabels} - ${turnLabels}`
}

export function ConductoresPage() {
  const { profile } = useAuth()
  const client = supabase
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<DriverStatus>('activo')
  const [availability, setAvailability] = useState<DriverAvailability>(emptyAvailability)
  const [statusFilter, setStatusFilter] = useState<'todos' | DriverStatus>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const canManageDrivers = profile?.role === 'admin'
  const activeCount = drivers.filter((driver) => driver.status === 'activo').length
  const pendingCount = drivers.filter((driver) => driver.status === 'pendiente').length
  const inactiveCount = drivers.filter((driver) => driver.status === 'inactivo').length

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selectedDriverId) ?? null,
    [drivers, selectedDriverId],
  )

  useEffect(() => {
    if (!client) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadDrivers = async () => {
      setIsLoading(true)
      const { data, error: loadError } = await client
        .from('conductores')
        .select('id, full_name, phone, notes, status, availability, created_at')
        .order('full_name', { ascending: true })

      if (!isMounted) {
        return
      }

      if (loadError) {
        setError(loadError.message)
        setDrivers([])
      } else {
        setError(null)
        setDrivers((data as DriverRecord[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadDrivers()

    return () => {
      isMounted = false
    }
  }, [client])

  const filteredDrivers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return drivers.filter((driver) => {
      const matchesStatus =
        statusFilter === 'todos' ? true : driver.status === statusFilter

      if (!matchesStatus) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const haystack = [
        driver.full_name,
        driver.phone ?? '',
        driver.notes ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [drivers, searchTerm, statusFilter])

  const resetForm = () => {
    setEditingDriverId(null)
    setFullName('')
    setPhone('')
    setNotes('')
    setStatus('activo')
    setAvailability(emptyAvailability)
  }

  const startEditing = (driver: DriverRecord) => {
    setSelectedDriverId(driver.id)
    setEditingDriverId(driver.id)
    setFullName(driver.full_name)
    setPhone(driver.phone ?? '')
    setNotes(driver.notes ?? '')
    setStatus(driver.status)
    setAvailability(normalizeAvailability(driver.availability))
    setError(null)
    setMessage(null)
  }

  const toggleAvailabilityDay = (day: number) => {
    setAvailability((current) => {
      const days = current.days.includes(day)
        ? current.days.filter((item) => item !== day)
        : [...current.days, day]
      const byDay = { ...(current.byDay ?? {}) }

      if (days.includes(day)) {
        byDay[String(day)] = byDay[String(day)] ?? []
      } else {
        delete byDay[String(day)]
      }

      return {
        ...current,
        days: days.sort((left, right) => left - right),
        byDay,
      }
    })
  }

  const toggleAvailabilityTurn = (day: number, turn: DriverAvailabilityTurn) => {
    setAvailability((current) => {
      const byDay = { ...(current.byDay ?? {}) }
      const currentTurns = byDay[String(day)] ?? []
      const nextTurns = currentTurns.includes(turn)
        ? currentTurns.filter((item) => item !== turn)
        : [...currentTurns, turn]

      byDay[String(day)] = nextTurns

      return {
        ...current,
        turns: [],
        byDay,
      }
    })
  }

  const handleDelete = async (driver: DriverRecord) => {
    if (!client || !canManageDrivers) {
      return
    }

    const confirmed = window.confirm(
      `Se eliminara el conductor "${driver.full_name}".`,
    )

    if (!confirmed) {
      return
    }

    setError(null)
    setMessage(null)

    const { error: deleteError } = await client
      .from('conductores')
      .delete()
      .eq('id', driver.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setDrivers((current) => current.filter((item) => item.id !== driver.id))
    if (selectedDriverId === driver.id) {
      setSelectedDriverId(null)
    }
    if (editingDriverId === driver.id) {
      resetForm()
    }
    setMessage('Conductor eliminado correctamente.')
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Primero debes configurar Supabase.')
      return
    }

    if (!canManageDrivers) {
      setError('Solo un administrador puede cargar nuevos conductores.')
      return
    }

    if (!fullName.trim()) {
      setError('El nombre del conductor es obligatorio.')
      return
    }

    setIsSaving(true)

    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      status,
      availability,
    }

    const query = editingDriverId
      ? client
          .from('conductores')
          .update(payload)
          .eq('id', editingDriverId)
      : client.from('conductores').insert(payload)

    const { data, error: saveError } = await query
      .select('id, full_name, phone, notes, status, availability, created_at')
      .single()

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    setDrivers((current) =>
      [...current.filter((item) => item.id !== (data as DriverRecord).id), data as DriverRecord]
        .sort((left, right) => left.full_name.localeCompare(right.full_name, 'es')),
    )
    setSelectedDriverId((data as DriverRecord).id)
    setMessage(
      editingDriverId
        ? 'Conductor actualizado correctamente.'
        : 'Conductor guardado correctamente.',
    )
    resetForm()
    setIsSaving(false)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Modulo 2</p>
          <h2>Conductores</h2>
          <p className="lead">
            Consola de conductores para registrar disponibilidad y dejar cada
            perfil listo para usarlo en las salidas.
          </p>
        </div>
      </section>

      <div className="module-console">
        <section className="module-hero">
          <div className="module-hero-copy">
            <p className="eyebrow">Movilidad del servicio</p>
            <h3>Organiza conductores por disponibilidad y estado real</h3>
            <p>
              {canManageDrivers
                ? 'Mantén una base confiable de conductores con teléfono, observaciones y estado para asignarlos rápido en cada salida.'
                : 'Puedes revisar los conductores registrados. La gestión queda reservada para administradores.'}
            </p>
          </div>

          <div className="module-hero-stats">
            <article className="module-stat-card">
              <span>Total conductores</span>
              <strong>{drivers.length}</strong>
              <small>Base general</small>
            </article>
            <article className="module-stat-card">
              <span>Activos</span>
              <strong>{activeCount}</strong>
              <small>Disponibles para salida</small>
            </article>
            <article className="module-stat-card">
              <span>Pendientes</span>
              <strong>{pendingCount}</strong>
              <small>Requieren confirmacion</small>
            </article>
            <article className="module-stat-card">
              <span>Inactivos</span>
              <strong>{inactiveCount}</strong>
              <small>Fuera de asignacion</small>
            </article>
          </div>
        </section>

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">Listado</p>
              <h3>Conductores cargados</h3>
            </div>

            <div className="module-registry-actions">
              <label className="module-search-field">
                <span className="sr-only">Buscar conductores</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por nombre, telefono u observacion"
                />
              </label>

              <label className="inline-filter">
                Estado
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as 'todos' | DriverStatus)
                  }
                >
                  <option value="todos">Todos</option>
                  <option value="activo">Activos</option>
                  <option value="pendiente">Pendientes</option>
                  <option value="inactivo">Inactivos</option>
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="status-card">Cargando conductores...</div>
          ) : filteredDrivers.length === 0 ? (
            <div className="status-card">
              {isSupabaseConfigured
                ? 'No hay conductores para el filtro seleccionado.'
                : 'Cuando conectes Supabase, aqui apareceran los conductores.'}
            </div>
          ) : (
            <div className="module-table-shell">
              <div className="module-table module-table-head driver-availability-table">
                <span>Conductor</span>
                <span>Telefono</span>
                <span>Disponibilidad</span>
                <span>Estado</span>
                <span>Acciones</span>
              </div>

              <div className="module-table-body">
                {filteredDrivers.map((driver) => (
                  <button
                    key={driver.id}
                    type="button"
                    className={
                      selectedDriverId === driver.id
                        ? 'module-table module-table-row module-table-row-button driver-availability-table active'
                        : 'module-table module-table-row module-table-row-button driver-availability-table'
                    }
                    onClick={() => setSelectedDriverId(driver.id)}
                  >
                    <strong>{driver.full_name}</strong>
                    <span>{driver.phone || 'Sin telefono'}</span>
                    <span>{formatDriverAvailability(driver.availability)}</span>
                    <span>
                      <span className={`status-pill status-${driver.status}`}>
                        {statusLabels[driver.status]}
                      </span>
                    </span>
                    <span className="module-table-actions">
                      {canManageDrivers ? (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              startEditing(driver)
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDelete(driver)
                            }}
                          >
                            Eliminar
                          </button>
                        </>
                      ) : (
                        <span className="table-hint">Solo lectura</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="two-column-grid module-form-grid">
          <article className="panel">
            <p className="eyebrow">{editingDriverId ? 'Edicion' : 'Alta'}</p>
            <h3>{editingDriverId ? 'Editar conductor' : 'Nuevo conductor'}</h3>
            <p>
              Completa los datos básicos y define el estado actual para que el
              conductor pueda reutilizarse luego en el planificador.
            </p>

            <form className="form-stack" onSubmit={handleSubmit}>
              <label>
                Nombre completo
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Ej. Carlos Gomez"
                  disabled={!canManageDrivers}
                />
              </label>

              <label>
                Telefono
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+54 264 555 0101"
                  disabled={!canManageDrivers}
                />
              </label>

              <label>
                Estado
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as DriverStatus)}
                  disabled={!canManageDrivers}
                >
                  <option value="activo">Activo</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>

              <div className="availability-editor">
                <div>
                  <strong>Disponibilidad por dia</strong>
                  <span>
                    Marca un dia y luego elige si puede conducir de manana, tarde
                    o telefonica.
                  </span>
                </div>
                <div className="availability-day-list">
                  {weekDays.map((day) => (
                    <div key={day.value} className="availability-day-card">
                      <label>
                        <input
                          type="checkbox"
                          checked={availability.days.includes(day.value)}
                          onChange={() => toggleAvailabilityDay(day.value)}
                          disabled={!canManageDrivers}
                        />
                        <span>{day.label}</span>
                      </label>

                      {availability.days.includes(day.value) ? (
                        <div className="availability-turn-options">
                          {availabilityTurns.map((turn) => (
                            <label key={turn.value}>
                              <input
                                type="checkbox"
                                checked={Boolean(
                                  availability.byDay?.[String(day.value)]?.includes(
                                    turn.value,
                                  ),
                                )}
                                onChange={() =>
                                  toggleAvailabilityTurn(day.value, turn.value)
                                }
                                disabled={!canManageDrivers}
                              />
                              <span>{turn.label}</span>
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <label>
                Observaciones
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Notas internas del conductor"
                  rows={4}
                  disabled={!canManageDrivers}
                />
              </label>

              {error ? <div className="form-feedback error">{error}</div> : null}
              {message ? <div className="form-feedback success">{message}</div> : null}

              {editingDriverId ? (
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
                disabled={!canManageDrivers || isSaving}
              >
                {isSaving
                  ? 'Guardando...'
                  : editingDriverId
                    ? 'Actualizar conductor'
                    : 'Guardar conductor'}
              </button>
            </form>
          </article>

          <article className="panel">
            <p className="eyebrow">
              {selectedDriver ? 'Ficha rapida' : 'Referencia rapida'}
            </p>
            <h3>
              {selectedDriver ? selectedDriver.full_name : 'Buenas practicas para usar conductores'}
            </h3>

            {selectedDriver ? (
              <div className="module-detail-list">
                <div className="module-detail-card">
                  <span>Telefono</span>
                  <strong>{selectedDriver.phone || 'Sin telefono cargado'}</strong>
                </div>
                <div className="module-detail-card">
                  <span>Estado</span>
                  <strong>{statusLabels[selectedDriver.status]}</strong>
                </div>
                <div className="module-detail-card">
                  <span>Disponibilidad</span>
                  <strong>{formatDriverAvailability(selectedDriver.availability)}</strong>
                </div>
                <div className="module-detail-card">
                  <span>Observaciones</span>
                  <strong>{selectedDriver.notes || 'Sin observaciones'}</strong>
                </div>
              </div>
            ) : (
              <div className="module-guidance-list">
                <div className="module-guidance-item">
                  <strong>1. Mantén el estado actualizado</strong>
                  <span>Así el planificador mostrará quién está disponible.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>2. Guarda el teléfono</strong>
                  <span>Sirve para contacto rápido antes de una salida.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>3. Usa observaciones</strong>
                  <span>Allí puedes dejar notas útiles para coordinación interna.</span>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </div>
  )
}
