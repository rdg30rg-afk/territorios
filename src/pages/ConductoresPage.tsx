import { useEffect, useMemo, useState } from 'react'
import { useMenusMas } from '../lib/useMenusMas'
import { Desplegable } from '../components/Desplegable'
import { Falta } from '../components/Falta'
import { Vacio } from '../components/Vacio'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/useAuth'
import { decirElError } from '../lib/decirElError'
import { supabase } from '../lib/supabase'
import { Icono } from '../components/Icono'

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
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]

const availabilityTurns: Array<{ value: DriverAvailabilityTurn; label: string }> = [
  { value: 'manana', label: 'Mañana' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'telefonica', label: 'Telefónica' },
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
  useMenusMas()
  const { profile } = useAuth()
  const client = supabase
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null)
  // El formulario vive en una ventana encima. Antes estaba debajo de la
  // tabla y apretar "Editar" no mostraba nada: el cambio pasaba fuera de
  // la pantalla. Llevar el scroll hasta ahi lo hacia visible pero te sacaba
  // del lugar donde estabas mirando.
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<DriverStatus>('activo')
  const [availability, setAvailability] = useState<DriverAvailability>(emptyAvailability)
  const [statusFilter, setStatusFilter] = useState<'todos' | DriverStatus>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  // El error del formulario vive dentro de la ventana. El de la pantalla
  // (la carga, eliminar) se ve afuera: la ventana puede estar cerrada.
  const [formError, setFormError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [message, setMessage] = useState<string | null>(null)

  const canManageDrivers = profile?.role === 'admin'
  // Solo se cuenta lo que hay que hacer. Activos e inactivos se veian en
  // las cifras de arriba y no cambiaban ninguna decision: el estado de
  // cada conductor ya esta en su fila, y el filtro de arriba los separa.
  const pendingCount = drivers.filter((driver) => driver.status === 'pendiente').length

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
        setPageError(decirElError(loadError, 'No se pudo cargar la lista de conductores.'))
        setLoadFailed(true)
        setDrivers([])
      } else {
        setPageError(null)
        setLoadFailed(false)
        setDrivers((data as DriverRecord[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadDrivers()

    return () => {
      isMounted = false
    }
  }, [client, reloadKey])

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

  const cerrarFormulario = () => {
    setFormularioAbierto(false)
    resetForm()
    setFormError(null)
    // Cerrar «Editar» no abre la ficha del mismo conductor.
    setSelectedDriverId(null)
  }

  const abrirNuevo = () => {
    resetForm()
    setFormError(null)
    setMessage(null)
    setFormularioAbierto(true)
  }

  const resetForm = () => {
    setEditingDriverId(null)
    setFullName('')
    setPhone('')
    setNotes('')
    setStatus('activo')
    setAvailability(emptyAvailability)
  }

  const startEditing = (driver: DriverRecord) => {
    setFormularioAbierto(true)
    setSelectedDriverId(null)
    setEditingDriverId(driver.id)
    setFullName(driver.full_name)
    setPhone(driver.phone ?? '')
    setNotes(driver.notes ?? '')
    setStatus(driver.status)
    setAvailability(normalizeAvailability(driver.availability))
    setFormError(null)
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

    setPageError(null)
    setMessage(null)

    // Eliminar no es solo borrar la ficha: la base lo saca de las salidas y
    // del programa semanal y suelta su cuenta. Se cuenta antes de preguntar.
    const [salidas, turnos, cuentas] = await Promise.all([
      client.from('salidas').select('id', { count: 'exact', head: true }).eq('driver_id', driver.id),
      client.from('programa_titulares').select('conductor_id', { count: 'exact', head: true }).eq('conductor_id', driver.id),
      client.from('profiles').select('id', { count: 'exact', head: true }).eq('driver_id', driver.id),
    ])
    const nSalidas = salidas.error ? null : salidas.count ?? 0
    const nTurnos = turnos.error ? null : turnos.count ?? 0
    const nCuentas = cuentas.error ? null : cuentas.count ?? 0

    const efectos: string[] = []
    efectos.push(
      nSalidas === null
        ? 'Deja de figurar en todas las salidas en las que está (no se pudo contar cuántas).'
        : nSalidas === 0
          ? 'No figura en ninguna salida.'
          : `Deja de figurar en ${nSalidas} ${nSalidas === 1 ? 'salida, que queda' : 'salidas, que quedan'} sin conductor.`,
    )
    efectos.push(
      nTurnos === null
        ? 'Deja de figurar en el programa semanal.'
        : nTurnos === 0
          ? 'No está en el programa semanal.'
          : `Deja de figurar en ${nTurnos} ${nTurnos === 1 ? 'turno' : 'turnos'} del programa semanal.`,
    )
    if (nCuentas === null || nCuentas > 0) {
      efectos.push('Se desvincula de su cuenta de usuario (la cuenta sigue existiendo).')
    }

    const confirmed = window.confirm(
      `¿Eliminar a "${driver.full_name}"?\n\n${efectos.join('\n')}\n\nSe pierde su ficha (teléfono, disponibilidad y observaciones) y no se puede deshacer.`,
    )

    if (!confirmed) {
      return
    }

    const { error: deleteError } = await client
      .from('conductores')
      .delete()
      .eq('id', driver.id)

    if (deleteError) {
      setPageError(decirElError(deleteError, 'No se pudo eliminar el conductor.'))
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
    setFormError(null)
    setMessage(null)

    if (!client) {
      setFormError('Falta conectar la base para cargar conductores.')
      return
    }

    if (!canManageDrivers) {
      setFormError('Solo un administrador puede cargar nuevos conductores.')
      return
    }

    if (!fullName.trim()) {
      setFormError('El nombre del conductor es obligatorio.')
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
      setFormError(decirElError(saveError))
      setIsSaving(false)
      return
    }

    setDrivers((current) =>
      [...current.filter((item) => item.id !== (data as DriverRecord).id), data as DriverRecord]
        .sort((left, right) => left.full_name.localeCompare(right.full_name, 'es')),
    )
    setMessage(
      editingDriverId
        ? 'Conductor actualizado correctamente.'
        : 'Conductor guardado correctamente.',
    )
    resetForm()
    setFormularioAbierto(false)
    setIsSaving(false)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h2>Conductores</h2>
          <p className="lead">
            Quién puede llevar hermanos al territorio, y cuándo está disponible.
          </p>
        </div>
      </section>

      <div className="module-console">
        {/* Antes habia aca un bloque de venta ("Manten una base confiable
            de conductores...") y cuatro cifras: Total, Activos, Pendientes
            e Inactivos, donde Total era la suma de las otras tres. Ninguna
            cambiaba una decision salvo Pendientes, que es la que quedo. */}
        {pageError ? (
          <div className="form-feedback error" role="alert">
            {pageError}
            {loadFailed ? (
              <>
                {' '}
                <button type="button" className="secondary-button" onClick={() => setReloadKey((n) => n + 1)}>
                  <Icono nombre="reintentar" tamaño={18} />
                  Volver a intentar
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <div className="form-feedback success" role="status">
            {message}
          </div>
        ) : null}

        <Falta
          cuantos={pendingCount}
          uno="Un conductor esta sin confirmar"
          varios="{n} conductores estan sin confirmar"
        />

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div className="module-registry-actions">
              {canManageDrivers ? (
                <button type="button" className="primary-button" onClick={abrirNuevo}>
                  <Icono nombre="persona" tamaño={18} />
                  Nuevo conductor
                </button>
              ) : null}
              <label className="module-search-field">
                <span className="sr-only">Buscar conductores</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por nombre, teléfono u observación"
                />
              </label>

              <label className="inline-filter">
                Estado
                <Desplegable
                  etiqueta="Estado"
                  valor={statusFilter}
                  alElegir={(valor) => setStatusFilter(valor as 'todos' | DriverStatus)}
                  opciones={[
                    { valor: 'todos', texto: 'Todos' },
                    { valor: 'activo', texto: 'Activos' },
                    { valor: 'pendiente', texto: 'Pendientes' },
                    { valor: 'inactivo', texto: 'Inactivos' },
                  ]}
                />
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="status-card">Cargando conductores...</div>
          ) : loadFailed ? null : filteredDrivers.length === 0 ? (
            <Vacio
              hay={drivers.length}
              sinNada="Todavía no hay ningún conductor cargado."
              comoEmpezar={'Tocá "Nuevo conductor" para cargar el primero.'}
              filtrados="Ningún conductor coincide con lo que buscás."
            />
          ) : (
            <div className="module-table-shell">
              <div className="module-table module-table-head driver-availability-table">
                <span>Conductor</span>
                <span>Teléfono</span>
                <span>Disponibilidad</span>
                <span>Estado</span>
                <span>Acciones</span>
              </div>

              <div className="module-table-body">
                {filteredDrivers.map((driver) => (
                  /* La fila es un div, no un boton: adentro viven "Editar" y
                     "Eliminar", y un boton dentro de otro es HTML invalido.
                     El click en cualquier parte sigue seleccionando -- con el
                     mouse no cambia nada-- y el control que recibe el foco de
                     teclado es el nombre, que si es un boton de verdad. */
                  <div
                    key={driver.id}
                    className={
                      selectedDriverId === driver.id || editingDriverId === driver.id
                        ? 'module-table module-table-row module-table-row-button driver-availability-table active'
                        : 'module-table module-table-row module-table-row-button driver-availability-table'
                    }
                    onClick={() => setSelectedDriverId(driver.id)}
                  >
                    <button
                      type="button"
                      className="fila-nombre"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedDriverId(driver.id)
                      }}
                    >
                      {driver.full_name}
                    </button>
                    <span>{driver.phone || 'Sin teléfono'}</span>
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
                            <Icono nombre="dibujar" tamaño={17} />
                            Editar
                          </button>
                          <details className="menu-mas" onClick={(event) => event.stopPropagation()}>
                            <summary>Más</summary>
                            <div className="menu-mas-caja">
                              <button
                                type="button"
                                className="danger-button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleDelete(driver)
                                }}
                              >
                                <Icono nombre="eliminar" tamaño={17} />
                                Eliminar
                              </button>
                            </div>
                          </details>
                        </>
                      ) : (
                        <span className="table-hint">—</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <Modal
          abierto={formularioAbierto}
          alCerrar={cerrarFormulario}
          titulo={editingDriverId ? 'Editar conductor' : 'Nuevo conductor'}
          bajada="El nombre y el estado alcanzan para poder usarlo en una salida."
        >
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
                Teléfono
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+54 264 555 0101"
                  disabled={!canManageDrivers}
                />
              </label>

              <label>
                Estado
                <Desplegable
                  etiqueta="Estado"
                  valor={status}
                  alElegir={(valor) => setStatus(valor as DriverStatus)}
                  deshabilitado={!canManageDrivers}
                  opciones={[
                    { valor: 'activo', texto: 'Activo' },
                    { valor: 'pendiente', texto: 'Pendiente' },
                    { valor: 'inactivo', texto: 'Inactivo' },
                  ]}
                />
              </label>

              <div className="availability-editor">
                <div>
                  <strong>Disponibilidad por día</strong>
                  {/* En bloque: strong y span pegados salian como
                      "Disponibilidad por diaMarca un dia...". */}
                  <span className="bloque">
                    Tildá un día y después elegí si puede conducir a la mañana, a
                    la tarde o por teléfono.
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

              {formError ? <div className="form-feedback error" role="alert">{formError}</div> : null}

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
                disabled={!canManageDrivers || isSaving}
              >
                <Icono nombre="guardar" tamaño={18} />
                {isSaving
                  ? 'Guardando...'
                  : editingDriverId
                    ? 'Actualizar conductor'
                    : 'Guardar conductor'}
              </button>
          </form>
        </Modal>

        <Modal
          /* La ficha no se abre encima del formulario. startEditing marca la
             fila como seleccionada para que se vea cual se esta editando, y
             eso alcanzaba para abrir tambien este modal: quedaban los dos
             apilados diciendo lo mismo del mismo conductor. */
          abierto={Boolean(selectedDriver) && !formularioAbierto}
          alCerrar={() => setSelectedDriverId(null)}
          titulo={selectedDriver?.full_name ?? 'Ficha del conductor'}
          bajada="Teléfono, disponibilidad y observaciones."
        >
          {selectedDriver ? (
              <div className="module-detail-list">
                <div className="module-detail-card">
                  <span>Teléfono</span>
                  <strong>{selectedDriver.phone || 'Sin teléfono cargado'}</strong>
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
            ) : null}
        </Modal>
      </div>
    </div>
  )
}
