import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type GroupAssignment = 'superintendente' | 'siervo' | 'auxiliar'
type DriverStatus = 'activo' | 'pendiente' | 'inactivo'

type DriverOption = {
  id: string
  full_name: string
  status: DriverStatus
}

type GroupRecord = {
  id: string
  group_name: string
  group_number: number | null
  driver_id: string | null
  manager_name: string
  manager_role: GroupAssignment
  created_at: string
}

const assignmentLabels: Record<GroupAssignment, string> = {
  superintendente: 'Superintendente',
  siervo: 'Siervo de grupo',
  auxiliar: 'Auxiliar de grupo',
}

const assignmentOptions: Array<{ value: GroupAssignment; label: string }> = [
  { value: 'superintendente', label: 'Superintendente' },
  { value: 'siervo', label: 'Siervo de grupo' },
  { value: 'auxiliar', label: 'Auxiliar de grupo' },
]

function getGroupDisplayName(group: GroupRecord) {
  return group.group_number ? `Grupo ${group.group_number}` : group.group_name
}

function getGroupKey(group: GroupRecord) {
  return group.group_number ? `number-${group.group_number}` : `legacy-${group.group_name}`
}

export function GruposPage() {
  const { profile } = useAuth()
  const client = supabase
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupNumber, setGroupNumber] = useState('')
  const [driverId, setDriverId] = useState('')
  const [assignment, setAssignment] = useState<GroupAssignment>('siervo')
  const [assignmentFilter, setAssignmentFilter] = useState<'todos' | GroupAssignment>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const canManageGroups = profile?.role === 'admin'
  const uniqueGroupCount = new Set(groups.map(getGroupKey)).size
  const superintendentCount = groups.filter(
    (group) => group.manager_role === 'superintendente',
  ).length
  const servantCount = groups.filter((group) => group.manager_role === 'siervo').length
  const auxiliaryCount = groups.filter((group) => group.manager_role === 'auxiliar').length

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  )

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.status === 'activo'),
    [drivers],
  )

  useEffect(() => {
    if (!client) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadData = async () => {
      setIsLoading(true)

      const [
        { data: groupsData, error: groupsError },
        { data: driversData, error: driversError },
      ] = await Promise.all([
        client
          .from('grupos_servicio')
          .select('id, group_name, group_number, driver_id, manager_name, manager_role, created_at')
          .order('group_number', { ascending: true, nullsFirst: false })
          .order('group_name', { ascending: true }),
        client
          .from('conductores')
          .select('id, full_name, status')
          .order('full_name', { ascending: true }),
      ])

      if (!isMounted) {
        return
      }

      const loadError = groupsError?.message || driversError?.message

      if (loadError) {
        setError(loadError)
        setGroups([])
        setDrivers([])
      } else {
        setError(null)
        setGroups((groupsData as GroupRecord[]) ?? [])
        setDrivers((driversData as DriverOption[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [client])

  const filteredGroups = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return groups.filter((group) => {
      const matchesAssignment =
        assignmentFilter === 'todos' ? true : group.manager_role === assignmentFilter

      if (!matchesAssignment) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const haystack = [
        getGroupDisplayName(group),
        group.manager_name,
        assignmentLabels[group.manager_role],
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [assignmentFilter, groups, searchTerm])

  const groupedAssignments = useMemo(() => {
    const grouped = new Map<string, GroupRecord[]>()

    filteredGroups.forEach((group) => {
      const key = getGroupKey(group)
      const current = grouped.get(key) ?? []
      current.push(group)
      grouped.set(key, current)
    })

    return Array.from(grouped.values())
  }, [filteredGroups])

  const resetForm = () => {
    setEditingGroupId(null)
    setGroupNumber('')
    setDriverId('')
    setAssignment('siervo')
  }

  const startEditing = (group: GroupRecord) => {
    setSelectedGroupId(group.id)
    setEditingGroupId(group.id)
    setGroupNumber(group.group_number ? String(group.group_number) : '')
    setDriverId(group.driver_id ?? '')
    setAssignment(group.manager_role)
    setError(null)
    setMessage(null)
  }

  const handleDelete = async (group: GroupRecord) => {
    if (!client || !canManageGroups) {
      return
    }

    const confirmed = window.confirm(
      `Se eliminara la asignacion de "${group.manager_name}" en ${getGroupDisplayName(group)}.`,
    )

    if (!confirmed) {
      return
    }

    setError(null)
    setMessage(null)

    const { error: deleteError } = await client
      .from('grupos_servicio')
      .delete()
      .eq('id', group.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setGroups((current) => current.filter((item) => item.id !== group.id))
    if (selectedGroupId === group.id) {
      setSelectedGroupId(null)
    }
    if (editingGroupId === group.id) {
      resetForm()
    }
    setMessage('Asignacion eliminada correctamente.')
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Primero debes configurar Supabase.')
      return
    }

    if (!canManageGroups) {
      setError('Solo un administrador puede cargar grupos.')
      return
    }

    const parsedGroupNumber = Number(groupNumber)

    if (!Number.isInteger(parsedGroupNumber) || parsedGroupNumber <= 0) {
      setError('Completa un numero de grupo valido.')
      return
    }

    const selectedDriver = drivers.find((driver) => driver.id === driverId)

    if (!selectedDriver) {
      setError('Selecciona un conductor cargado.')
      return
    }

    const existingMainAssignment = groups.find(
      (group) =>
        group.id !== editingGroupId &&
        group.group_number === parsedGroupNumber &&
        group.manager_role !== 'auxiliar' &&
        assignment !== 'auxiliar',
    )

    if (existingMainAssignment) {
      setError('Ese grupo ya tiene superintendente o siervo asignado.')
      return
    }

    setIsSaving(true)

    const payload = {
      group_name: `Grupo ${parsedGroupNumber}`,
      group_number: parsedGroupNumber,
      driver_id: selectedDriver.id,
      manager_name: selectedDriver.full_name,
      manager_role: assignment,
    }

    const query = editingGroupId
      ? client.from('grupos_servicio').update(payload).eq('id', editingGroupId)
      : client.from('grupos_servicio').insert(payload)

    const { data, error: saveError } = await query
      .select('id, group_name, group_number, driver_id, manager_name, manager_role, created_at')
      .single()

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    setGroups((current) =>
      [...current.filter((item) => item.id !== (data as GroupRecord).id), data as GroupRecord]
        .sort((left, right) => {
          const leftNumber = left.group_number ?? Number.MAX_SAFE_INTEGER
          const rightNumber = right.group_number ?? Number.MAX_SAFE_INTEGER

          if (leftNumber !== rightNumber) {
            return leftNumber - rightNumber
          }

          return left.manager_name.localeCompare(right.manager_name, 'es')
        }),
    )
    setSelectedGroupId((data as GroupRecord).id)
    setMessage(
      editingGroupId
        ? 'Asignacion actualizada correctamente.'
        : 'Asignacion guardada correctamente.',
    )
    resetForm()
    setIsSaving(false)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Modulo 3</p>
          <h2>Grupos para el Servicio</h2>
          <p className="lead">
            Consola para armar cada grupo con su numero, responsables y
            auxiliares usando los conductores ya cargados.
          </p>
        </div>
      </section>

      <div className="module-console">
        <section className="module-hero">
          <div className="module-hero-copy">
            <p className="eyebrow">Coordinacion interna</p>
            <h3>Un grupo, sus hermanos asignados y sus funciones</h3>
            <p>
              {canManageGroups
                ? 'Selecciona el numero de grupo, el conductor y su asignacion. Cada grupo puede tener un superintendente o siervo, mas uno o dos auxiliares.'
                : 'Puedes revisar los grupos existentes y sus asignaciones. La gestion queda reservada para administradores.'}
            </p>
          </div>

          <div className="module-hero-stats">
            <article className="module-stat-card">
              <span>Total grupos</span>
              <strong>{uniqueGroupCount}</strong>
              <small>Numeros creados</small>
            </article>
            <article className="module-stat-card">
              <span>Superintendentes</span>
              <strong>{superintendentCount}</strong>
              <small>Responsables principales</small>
            </article>
            <article className="module-stat-card">
              <span>Siervos</span>
              <strong>{servantCount}</strong>
              <small>Responsables de grupo</small>
            </article>
            <article className="module-stat-card">
              <span>Auxiliares</span>
              <strong>{auxiliaryCount}</strong>
              <small>Apoyo asignado</small>
            </article>
          </div>
        </section>

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">Listado</p>
              <h3>Asignaciones cargadas</h3>
            </div>

            <div className="module-registry-actions">
              <label className="module-search-field">
                <span className="sr-only">Buscar grupos</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por grupo, nombre o asignacion"
                />
              </label>

              <label className="inline-filter">
                Asignacion
                <select
                  value={assignmentFilter}
                  onChange={(event) =>
                    setAssignmentFilter(event.target.value as 'todos' | GroupAssignment)
                  }
                >
                  <option value="todos">Todos</option>
                  <option value="superintendente">Superintendentes</option>
                  <option value="siervo">Siervos de grupo</option>
                  <option value="auxiliar">Auxiliares de grupo</option>
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="status-card">Cargando grupos...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="status-card">
              {isSupabaseConfigured
                ? 'No hay grupos para el filtro seleccionado.'
                : 'Cuando conectes Supabase, aqui apareceran los grupos.'}
            </div>
          ) : (
            <div className="group-assignment-list">
              {groupedAssignments.map((assignments) => {
                const firstAssignment = assignments[0]

                if (!firstAssignment) {
                  return null
                }

                return (
                  <article key={getGroupKey(firstAssignment)} className="group-assignment-card">
                    <div className="group-assignment-head">
                      <div>
                        <span>Numero de Grupo</span>
                        <strong>{getGroupDisplayName(firstAssignment)}</strong>
                      </div>
                      <small>{assignments.length} asignacion/es</small>
                    </div>

                    <div className="module-table-shell">
                      <div className="module-table module-table-head group-member-table">
                        <span>Numero</span>
                        <span>Nombre y Apellido</span>
                        <span>Asignacion</span>
                        <span>Acciones</span>
                      </div>

                      <div className="module-table-body">
                        {assignments.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            className={
                              selectedGroupId === group.id
                                ? 'module-table module-table-row module-table-row-button group-member-table active'
                                : 'module-table module-table-row module-table-row-button group-member-table'
                            }
                            onClick={() => setSelectedGroupId(group.id)}
                          >
                            <strong>{group.group_number ?? '-'}</strong>
                            <span>{group.manager_name}</span>
                            <span>
                              <span className="status-pill status-pendiente">
                                {assignmentLabels[group.manager_role]}
                              </span>
                            </span>
                            <span className="module-table-actions">
                              {canManageGroups ? (
                                <>
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      startEditing(group)
                                    }}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="danger-button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handleDelete(group)
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
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="two-column-grid module-form-grid">
          <article className="panel">
            <p className="eyebrow">{editingGroupId ? 'Edicion' : 'Alta'}</p>
            <h3>{editingGroupId ? 'Editar asignacion' : 'Nueva asignacion'}</h3>
            <p>
              Carga una fila por cada hermano asignado al grupo. Para sumar
              auxiliares, repite el mismo numero de grupo y cambia la asignacion.
            </p>

            <form className="form-stack" onSubmit={handleSubmit}>
              <label>
                Numero de Grupo
                <input
                  type="number"
                  min="1"
                  value={groupNumber}
                  onChange={(event) => setGroupNumber(event.target.value)}
                  placeholder="Ej. 1"
                  disabled={!canManageGroups}
                />
              </label>

              <label>
                Nombre y Apellido
                <select
                  value={driverId}
                  onChange={(event) => setDriverId(event.target.value)}
                  disabled={!canManageGroups}
                >
                  <option value="">Seleccionar desde conductores</option>
                  {activeDrivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Asignacion
                <select
                  value={assignment}
                  onChange={(event) => setAssignment(event.target.value as GroupAssignment)}
                  disabled={!canManageGroups}
                >
                  {assignmentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {error ? <div className="form-feedback error">{error}</div> : null}
              {message ? <div className="form-feedback success">{message}</div> : null}

              {editingGroupId ? (
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
                disabled={!canManageGroups || isSaving}
              >
                {isSaving
                  ? 'Guardando...'
                  : editingGroupId
                    ? 'Actualizar asignacion'
                    : 'Guardar asignacion'}
              </button>
            </form>
          </article>

          <article className="panel">
            <p className="eyebrow">
              {selectedGroup ? 'Ficha rapida' : 'Referencia rapida'}
            </p>
            <h3>
              {selectedGroup ? getGroupDisplayName(selectedGroup) : 'Como conviene usar este modulo'}
            </h3>

            {selectedGroup ? (
              <div className="module-detail-list">
                <div className="module-detail-card">
                  <span>Nombre y Apellido</span>
                  <strong>{selectedGroup.manager_name}</strong>
                </div>
                <div className="module-detail-card">
                  <span>Asignacion</span>
                  <strong>{assignmentLabels[selectedGroup.manager_role]}</strong>
                </div>
                <div className="module-detail-card">
                  <span>Uso esperado</span>
                  <strong>
                    {selectedGroup.manager_role === 'superintendente'
                      ? 'Coordina el grupo como responsable principal.'
                      : selectedGroup.manager_role === 'siervo'
                        ? 'Responsable directo del grupo para la organizacion.'
                        : 'Auxilia al responsable cuando se necesita apoyo adicional.'}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="module-guidance-list">
                <div className="module-guidance-item">
                  <strong>1. Usa el numero del grupo</strong>
                  <span>El mismo numero agrupa al responsable y sus auxiliares.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>2. Elige el nombre desde conductores</strong>
                  <span>Asi evitamos duplicar personas y mantenemos una sola base.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>3. Reutiliza en salidas</strong>
                  <span>Luego podremos usar estos grupos para asignaciones mas rapidas.</span>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </div>
  )
}
