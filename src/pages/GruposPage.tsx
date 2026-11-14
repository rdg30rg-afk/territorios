import { useEffect, useMemo, useState } from 'react'
import { useMenusMas } from '../lib/useMenusMas'
import { Desplegable } from '../components/Desplegable'
import { Falta } from '../components/Falta'
import { Vacio } from '../components/Vacio'
import { Modal } from '../components/Modal'
import { HojaMiGrupo } from '../components/HojaMiGrupo'
import { useAuth } from '../context/useAuth'
import type { Profile } from '../context/AuthTypes'
import { decirElError } from '../lib/decirElError'
import { supabase } from '../lib/supabase'
import { Icono } from '../components/Icono'

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

function GrupoFichaExtra({ group, profile }: { group: GroupRecord; profile: Profile }) {
  const client = supabase
  const [codigo, setCodigo] = useState<string | null>(null)
  const [miembros, setMiembros] = useState(0)
  const [pendientes, setPendientes] = useState(0)
  const [punto, setPunto] = useState<string | null>(null)
  const [administrando, setAdministrando] = useState(false)
  const [revision, setRevision] = useState(0)
  const [falloCarga, setFalloCarga] = useState(false)
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    if (!client) return
    let vivo = true
    setFalloCarga(false)
    void Promise.all([
      client.from('grupo_invitaciones').select('codigo').eq('group_id', group.id).maybeSingle(),
      client.from('grupo_miembros').select('id, estado').eq('group_id', group.id).is('hasta', null),
      client.from('puntos_encuentro').select('nombre').eq('group_id', group.id).eq('tipo', 'grupo').eq('activo', true).maybeSingle(),
    ]).then(([inv, miembrosRes, puntoRes]) => {
      if (!vivo) return
      // Si algo falló no se puede decir «0 hermanos» ni «sin código»: no se sabe.
      if (inv.error || miembrosRes.error || puntoRes.error) {
        setFalloCarga(true)
        return
      }
      setCargado(true)
      setCodigo(inv.data?.codigo ?? null)
      const filas = miembrosRes.data ?? []
      setMiembros(filas.length)
      setPendientes(filas.filter((f) => f.estado === 'pendiente').length)
      setPunto(puntoRes.data?.nombre ?? null)
    }).catch(() => {
      if (vivo) setFalloCarga(true)
    })
    return () => {
      vivo = false
    }
  }, [client, group.id, revision])

  const contextoAdmin = {
    profile_id: profile.id,
    role: profile.role,
    access_status: profile.access_status,
    driver_id: profile.driver_id,
    full_name: profile.full_name,
    group_id: group.id,
    group_number: group.group_number,
    group_name: group.group_name,
    rol_en_grupo: 'superintendente' as const,
    miembro_estado: 'confirmado' as const,
    punto_grupo_id: null,
    punto_grupo_nombre: punto,
    punto_grupo_lat: null,
    punto_grupo_lng: null,
    es_super_de_grupo: true,
  }

  return (
    <>
      {falloCarga ? (
        <div className="form-feedback error" role="alert">
          No pudimos cargar los hermanos, el punto y el código de este grupo.{' '}
          <button type="button" className="secondary-button" onClick={() => setRevision((actual) => actual + 1)}>
            Probar de nuevo
          </button>
        </div>
      ) : null}
      <div className="module-detail-card">
        <span>Hermanos</span>
        <strong>
          {falloCarga ? 'No se pudo cargar' : !cargado ? 'Cargando…' : (
            <>
              {miembros}
              {pendientes ? ` · ${pendientes} esperan confirmación` : ''}
            </>
          )}
        </strong>
      </div>
      <div className="module-detail-card">
        <span>Punto de encuentro del grupo</span>
        <strong>{falloCarga ? 'No se pudo cargar' : !cargado ? 'Cargando…' : (punto ?? 'Todavía no está cargado')}</strong>
      </div>
      <div className="module-detail-card">
        <span>Código de invitación</span>
        <strong>{falloCarga ? 'No se pudo cargar' : !cargado ? 'Cargando…' : (codigo ?? 'Este grupo todavía no tiene código')}</strong>
      </div>
      <button type="button" className="primary-button full-width" onClick={() => setAdministrando(true)}>
        <Icono nombre="grupo" tamaño={18} />
        Administrar el grupo
      </button>
      <HojaMiGrupo
        contexto={contextoAdmin}
        abierto={administrando}
        onCerrar={() => setAdministrando(false)}
        onCambio={() => setRevision((actual) => actual + 1)}
      />
    </>
  )
}

export function GruposPage() {
  useMenusMas()
  const { profile } = useAuth()
  const client = supabase
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  // El formulario vive en una ventana encima: abajo de la tabla el cambio
  // pasaba fuera de la pantalla y parecia que el boton no hacia nada.
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [groupNumber, setGroupNumber] = useState('')
  const [driverId, setDriverId] = useState('')
  const [assignment, setAssignment] = useState<GroupAssignment>('siervo')
  const [assignmentFilter, setAssignmentFilter] = useState<'todos' | GroupAssignment>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  // `error` es del formulario (se ve dentro de la ventana). `errorPagina` y
  // `message` van sobre el listado: la ventana ya se cerró cuando llegan.
  const [error, setError] = useState<string | null>(null)
  const [errorPagina, setErrorPagina] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  const canManageGroups = profile?.role === 'admin'
  // Antes se contaban grupos, superintendentes, siervos y auxiliares. Son
  // cuatro numeros que no cambian ninguna decision: saber que hay tres
  // siervos no le dice a nadie que hacer. Lo que si hay que hacer algo al
  // respecto es un grupo sin nadie a cargo -- ni superintendente ni
  // siervo. Un auxiliar solo no alcanza: es apoyo, no responsable.
  const gruposSinResponsable = useMemo(() => {
    const aCargo = new Set(
      groups
        .filter(
          (group) =>
            group.manager_role === 'superintendente' || group.manager_role === 'siervo',
        )
        .map(getGroupKey),
    )
    return [...new Set(groups.map(getGroupKey))].filter((key) => !aCargo.has(key)).length
  }, [groups])

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
      setErrorPagina(null)

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
        setErrorPagina(decirElError(groupsError ?? driversError, 'No pudimos cargar los grupos.'))
        setGroups([])
        setDrivers([])
      } else {
        setGroups((groupsData as GroupRecord[]) ?? [])
        setDrivers((driversData as DriverOption[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [client, recarga])

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

    const order: Record<GroupAssignment, number> = {
      superintendente: 0,
      siervo: 1,
      auxiliar: 2,
    }
    return Array.from(grouped.values()).map((assignments) =>
      [...assignments].sort((left, right) => order[left.manager_role] - order[right.manager_role]),
    )
  }, [filteredGroups])

  const cerrarFormulario = () => {
    setFormularioAbierto(false)
    resetForm()
    setError(null)
  }

  const abrirNuevo = () => {
    resetForm()
    setError(null)
    setMessage(null)
    setFormularioAbierto(true)
  }

  const resetForm = () => {
    setEditingGroupId(null)
    setGroupNumber('')
    setDriverId('')
    setAssignment('siervo')
  }

  const startEditing = (group: GroupRecord) => {
    // No se marca selectedGroupId: al cerrar «Editar» se abría la ficha.
    setFormularioAbierto(true)
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
      `Se eliminará la asignación de "${group.manager_name}" en ${getGroupDisplayName(group)}.`,
    )

    if (!confirmed) {
      return
    }

    setErrorPagina(null)
    setMessage(null)

    const { error: deleteError } = await client
      .from('grupos_servicio')
      .delete()
      .eq('id', group.id)

    if (deleteError) {
      setErrorPagina(decirElError(deleteError, 'No se pudo eliminar la asignación.'))
      return
    }

    setGroups((current) => current.filter((item) => item.id !== group.id))
    if (selectedGroupId === group.id) {
      setSelectedGroupId(null)
    }
    if (editingGroupId === group.id) {
      resetForm()
    }
    setMessage('Asignación eliminada correctamente.')
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Falta conectar la base para cargar grupos.')
      return
    }

    if (!canManageGroups) {
      setError('Solo un administrador puede cargar grupos.')
      return
    }

    const parsedGroupNumber = Number(groupNumber)

    if (!Number.isInteger(parsedGroupNumber) || parsedGroupNumber <= 0) {
      setError('Poné un número de grupo válido.')
      return
    }

    const selectedDriver = drivers.find((driver) => driver.id === driverId)

    if (!selectedDriver) {
      setError('Elegí un conductor de los que ya están cargados.')
      return
    }

    // La base guarda UNA fila por número de grupo (índice único). Sumar un
    // auxiliar repitiendo el número no se puede en este modelo: antes la base
    // contestaba «Ya existe uno con esos datos» sin explicar nada.
    const mismoNumero = groups.find(
      (group) => group.id !== editingGroupId && group.group_number === parsedGroupNumber,
    )
    if (mismoNumero) {
      setError(
        `El grupo ${parsedGroupNumber} ya está cargado con ${mismoNumero.manager_name}. Hoy cada grupo es una sola fila: para cambiar quién está a cargo, tocá «Editar» en esa fila.`,
      )
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
      setError(decirElError(saveError))
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
    setMessage(
      editingGroupId
        ? 'Asignación actualizada correctamente.'
        : 'Asignación guardada correctamente.',
    )
    resetForm()
    setFormularioAbierto(false)
    setIsSaving(false)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h2>Grupos para el Servicio</h2>
          <p className="lead">
            Cada grupo con su número, quién está a cargo y quién lo acompaña.
          </p>
        </div>
      </section>

      <div className="module-console">
        <Falta
          cuantos={gruposSinResponsable}
          uno="Un grupo no tiene a nadie a cargo"
          varios="{n} grupos no tienen a nadie a cargo"
        />

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div className="module-registry-actions">
              {canManageGroups ? (
                <button type="button" className="primary-button" onClick={abrirNuevo}>
                  <Icono nombre="grupo" tamaño={18} />
                  Nueva asignación
                </button>
              ) : null}
              <label className="module-search-field">
                <span className="sr-only">Buscar grupos</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por grupo, nombre o asignación"
                />
              </label>

              <label className="inline-filter">
                Asignación
                <Desplegable
                  etiqueta="Asignación"
                  valor={assignmentFilter}
                  alElegir={(valor) =>
                    setAssignmentFilter(valor as 'todos' | GroupAssignment)
                  }
                  opciones={[
                    { valor: 'todos', texto: 'Todos' },
                    { valor: 'superintendente', texto: 'Superintendentes' },
                    { valor: 'siervo', texto: 'Siervos de grupo' },
                    { valor: 'auxiliar', texto: 'Auxiliares de grupo' },
                  ]}
                />
              </label>
            </div>
          </div>

          {errorPagina ? (
            <div className="form-feedback error" role="alert">
              {errorPagina}{' '}
              <button type="button" className="secondary-button" onClick={() => setRecarga((n) => n + 1)}>
                Probar de nuevo
              </button>
            </div>
          ) : null}
          {message ? (
            <div className="form-feedback success" role="status">{message}</div>
          ) : null}

          {isLoading ? (
            <div className="status-card">Cargando grupos...</div>
          ) : errorPagina ? null : filteredGroups.length === 0 ? (
            <Vacio
              hay={groups.length}
              sinNada="Todavía no hay ningún grupo armado."
              comoEmpezar={'Tocá "Nueva asignación" para poner al primer hermano a cargo.'}
              filtrados="Ningún grupo coincide con lo que buscás."
            />
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
                        <span>Número de grupo</span>
                        <strong>{getGroupDisplayName(firstAssignment)}</strong>
                      </div>
                      {assignments.length > 1 ? <small>{assignments.length} asignaciones</small> : null}
                    </div>

                    <div className="module-table-shell">
                      <div className="module-table module-table-head group-member-table">
                        <span>Nombre y Apellido</span>
                        <span>Asignación</span>
                        <span>Acciones</span>
                      </div>

                      <div className="module-table-body">
                        {assignments.map((group) => (
                          /* Div y no boton: adentro estan "Editar" y "Eliminar".
                             El control que recibe el foco es el nombre del
                             hermano, no el numero de grupo: un boton que se
                             anuncia como "3" no le dice nada a nadie. */
                          <div
                            key={group.id}
                            className={
                              selectedGroupId === group.id || editingGroupId === group.id
                                ? 'module-table module-table-row module-table-row-button group-member-table active'
                                : 'module-table module-table-row module-table-row-button group-member-table'
                            }
                            onClick={() => setSelectedGroupId(group.id)}
                          >
                            <span>
                              <button
                                type="button"
                                className="fila-nombre"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setSelectedGroupId(group.id)
                                }}
                              >
                                {group.manager_name}
                              </button>
                            </span>
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
                                          void handleDelete(group)
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
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <Modal
          abierto={formularioAbierto}
          alCerrar={cerrarFormulario}
          titulo={editingGroupId ? 'Editar asignación' : 'Nueva asignación'}
          bajada="Una fila por grupo: el número y quién está a cargo."
        >
          <form className="form-stack" onSubmit={handleSubmit}>
              <label>
                Número de grupo
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
                <Desplegable
                  etiqueta="Elegir desde conductores"
                  valor={driverId}
                  alElegir={setDriverId}
                  deshabilitado={!canManageGroups}
                  opciones={[
                    { valor: '', texto: 'Elegir desde conductores' },
                    ...activeDrivers.map((driver) => ({
                      valor: driver.id,
                      texto: driver.full_name,
                    })),
                  ]}
                />
              </label>

              <label>
                Asignación
                <Desplegable
                  etiqueta="Asignación"
                  valor={assignment}
                  alElegir={(valor) => setAssignment(valor as GroupAssignment)}
                  deshabilitado={!canManageGroups}
                  opciones={assignmentOptions.map((option) => ({
                    valor: option.value,
                    texto: option.label,
                  }))}
                />
              </label>

              {error ? <div className="form-feedback error">{error}</div> : null}

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
                disabled={!canManageGroups || isSaving}
              >
                <Icono nombre="guardar" tamaño={18} />
                {isSaving
                  ? 'Guardando...'
                  : editingGroupId
                    ? 'Actualizar asignación'
                    : 'Guardar asignación'}
              </button>
          </form>
        </Modal>

        <Modal
          /* Mismo caso que en Conductores: startEditing marca la fila para
             que se vea cual se edita, y con eso se abria tambien esta ficha
             encima del formulario. */
          abierto={Boolean(selectedGroup) && !formularioAbierto}
          alCerrar={() => setSelectedGroupId(null)}
          titulo={selectedGroup ? getGroupDisplayName(selectedGroup) : 'Ficha del grupo'}
          bajada="Responsable, hermanos, punto de encuentro y código."
        >
            {selectedGroup ? (
              <div className="module-detail-list">
                <div className="module-detail-card">
                  <span>Nombre y Apellido</span>
                  <strong>{selectedGroup.manager_name}</strong>
                </div>
                <div className="module-detail-card">
                  <span>Asignación</span>
                  <strong>{assignmentLabels[selectedGroup.manager_role]}</strong>
                </div>
                {profile ? <GrupoFichaExtra group={selectedGroup} profile={profile} /> : null}
              </div>
            ) : null}
        </Modal>
      </div>
    </div>
  )
}
