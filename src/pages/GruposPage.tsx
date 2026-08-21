import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type GroupAssignment = 'superintendente' | 'siervo' | 'auxiliar'

type GroupRecord = {
  id: string
  group_name: string
  manager_name: string
  manager_role: GroupAssignment
  created_at: string
}

const assignmentLabels: Record<GroupAssignment, string> = {
  superintendente: 'Superintendente',
  siervo: 'Siervo de grupo',
  auxiliar: 'Auxiliar de grupo',
}

export function GruposPage() {
  const { profile } = useAuth()
  const client = supabase
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [managerName, setManagerName] = useState('')
  const [managerRole, setManagerRole] = useState<GroupAssignment>('superintendente')
  const [roleFilter, setRoleFilter] = useState<'todos' | GroupAssignment>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const canManageGroups = profile?.role === 'admin'
  const superintendentCount = groups.filter(
    (group) => group.manager_role === 'superintendente',
  ).length
  const servantCount = groups.filter((group) => group.manager_role === 'siervo').length
  const auxiliaryCount = groups.filter((group) => group.manager_role === 'auxiliar').length

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  )

  useEffect(() => {
    if (!client) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadGroups = async () => {
      setIsLoading(true)
      const { data, error: loadError } = await client
        .from('grupos_servicio')
        .select('id, group_name, manager_name, manager_role, created_at')
        .order('group_name', { ascending: true })

      if (!isMounted) {
        return
      }

      if (loadError) {
        setError(loadError.message)
        setGroups([])
      } else {
        setError(null)
        setGroups((data as GroupRecord[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadGroups()

    return () => {
      isMounted = false
    }
  }, [client])

  const filteredGroups = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return groups.filter((group) => {
      const matchesRole = roleFilter === 'todos' ? true : group.manager_role === roleFilter

      if (!matchesRole) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const haystack = [
        group.group_name,
        group.manager_name,
        assignmentLabels[group.manager_role],
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [groups, roleFilter, searchTerm])

  const resetForm = () => {
    setEditingGroupId(null)
    setGroupName('')
    setManagerName('')
    setManagerRole('superintendente')
  }

  const startEditing = (group: GroupRecord) => {
    setSelectedGroupId(group.id)
    setEditingGroupId(group.id)
    setGroupName(group.group_name)
    setManagerName(group.manager_name)
    setManagerRole(group.manager_role)
    setError(null)
    setMessage(null)
  }

  const handleDelete = async (group: GroupRecord) => {
    if (!client || !canManageGroups) {
      return
    }

    const confirmed = window.confirm(
      `Se eliminara el grupo "${group.group_name}".`,
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
    setMessage('Grupo eliminado correctamente.')
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

    if (!groupName.trim() || !managerName.trim()) {
      setError('Completa el nombre del grupo y del encargado.')
      return
    }

    setIsSaving(true)

    const payload = {
      group_name: groupName.trim(),
      manager_name: managerName.trim(),
      manager_role: managerRole,
    }

    const query = editingGroupId
      ? client.from('grupos_servicio').update(payload).eq('id', editingGroupId)
      : client.from('grupos_servicio').insert(payload)

    const { data, error: saveError } = await query
      .select('id, group_name, manager_name, manager_role, created_at')
      .single()

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    setGroups((current) =>
      [...current.filter((item) => item.id !== (data as GroupRecord).id), data as GroupRecord]
        .sort((left, right) => left.group_name.localeCompare(right.group_name, 'es')),
    )
    setSelectedGroupId((data as GroupRecord).id)
    setMessage(
      editingGroupId
        ? 'Grupo actualizado correctamente.'
        : 'Grupo guardado correctamente.',
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
            Consola para registrar grupos, separar responsables y dejar listas
            las referencias que luego se usan en las salidas.
          </p>
        </div>
      </section>

      <div className="module-console">
        <section className="module-hero">
          <div className="module-hero-copy">
            <p className="eyebrow">Coordinacion interna</p>
            <h3>Ordena grupos y responsables desde una sola vista</h3>
            <p>
              {canManageGroups
                ? 'Define cada grupo y su asignacion: superintendente, siervo o auxiliar, para dejar la estructura lista para usarla en las salidas.'
                : 'Puedes revisar los grupos existentes y sus responsables. La gestion queda reservada para administradores.'}
            </p>
          </div>

          <div className="module-hero-stats">
            <article className="module-stat-card">
              <span>Total grupos</span>
              <strong>{groups.length}</strong>
              <small>Base activa</small>
            </article>
            <article className="module-stat-card">
              <span>Superintendentes</span>
              <strong>{superintendentCount}</strong>
              <small>Responsables principales</small>
            </article>
            <article className="module-stat-card">
              <span>Siervos</span>
              <strong>{servantCount}</strong>
              <small>Apoyo de grupo</small>
            </article>
            <article className="module-stat-card">
              <span>Auxiliares</span>
              <strong>{auxiliaryCount}</strong>
              <small>Refuerzo asignado</small>
            </article>
          </div>
        </section>

        <section className="panel module-registry-panel">
          <div className="module-registry-toolbar">
            <div>
              <p className="eyebrow">Listado</p>
              <h3>Grupos cargados</h3>
            </div>

            <div className="module-registry-actions">
              <label className="module-search-field">
                <span className="sr-only">Buscar grupos</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por grupo, encargado o asignacion"
                />
              </label>

              <label className="inline-filter">
                Asignacion
                <select
                  value={roleFilter}
                  onChange={(event) =>
                    setRoleFilter(event.target.value as 'todos' | GroupAssignment)
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
            <div className="module-table-shell">
              <div className="module-table module-table-head">
                <span>Grupo</span>
                <span>Encargado</span>
                <span>Asignacion</span>
                <span>Acciones</span>
              </div>

              <div className="module-table-body">
                {filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={
                      selectedGroupId === group.id
                        ? 'module-table module-table-row module-table-row-button active'
                        : 'module-table module-table-row module-table-row-button'
                    }
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <strong>{group.group_name}</strong>
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
          )}
        </section>

        <section className="two-column-grid module-form-grid">
          <article className="panel">
            <p className="eyebrow">{editingGroupId ? 'Edicion' : 'Alta'}</p>
            <h3>{editingGroupId ? 'Editar grupo' : 'Nuevo grupo'}</h3>
            <p>
              Carga el nombre del grupo y el responsable para mantener ordenada
              la estructura del servicio.
            </p>

            <form className="form-stack" onSubmit={handleSubmit}>
              <label>
                Nombre del grupo
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Ej. Grupo Norte"
                  disabled={!canManageGroups}
                />
              </label>

              <label>
                Encargado
                <input
                  value={managerName}
                  onChange={(event) => setManagerName(event.target.value)}
                  placeholder="Ej. Ana Ruiz"
                  disabled={!canManageGroups}
                />
              </label>

              <label>
                Asignacion
                <select
                  value={managerRole}
                  onChange={(event) => setManagerRole(event.target.value as GroupAssignment)}
                  disabled={!canManageGroups}
                >
                  <option value="superintendente">Superintendente</option>
                  <option value="siervo">Siervo de grupo</option>
                  <option value="auxiliar">Auxiliar de grupo</option>
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
                    ? 'Actualizar grupo'
                    : 'Guardar grupo'}
              </button>
            </form>
          </article>

          <article className="panel">
            <p className="eyebrow">
              {selectedGroup ? 'Ficha rapida' : 'Referencia rapida'}
            </p>
            <h3>
              {selectedGroup ? selectedGroup.group_name : 'Como conviene usar este modulo'}
            </h3>

            {selectedGroup ? (
              <div className="module-detail-list">
                <div className="module-detail-card">
                  <span>Encargado</span>
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
                        ? 'Acompana la organizacion del grupo como apoyo.'
                        : 'Refuerza la coordinacion cuando se necesita ayuda adicional.'}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="module-guidance-list">
                <div className="module-guidance-item">
                  <strong>1. Crea el grupo</strong>
                  <span>Usa un nombre claro para distinguir zonas o equipos.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>2. Define el responsable</strong>
                  <span>Marca si corresponde superintendente, siervo o auxiliar.</span>
                </div>
                <div className="module-guidance-item">
                  <strong>3. Reutiliza en salidas</strong>
                  <span>Luego podrás asociar estos grupos al planificador.</span>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </div>
  )
}
