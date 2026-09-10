import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import type { ModuleKey, ProfileRole } from '../context/AuthTypes'
import { Desplegable } from '../components/Desplegable'
import { TerritorySuggestions } from '../components/TerritorySuggestions'
import { useAuth } from '../context/useAuth'
import { decirElError } from '../lib/decirElError'
import { supabase } from '../lib/supabase'
import '../styles/inicio-admin.css'
import { Icono } from '../components/Icono'

const moduleLabels: Record<ModuleKey, string> = {
  mapas: 'Mapas y Territorios',
  conductores: 'Conductores',
  grupos: 'Grupos para el Servicio',
  salidas: 'Salidas',
  salidas_grupo: 'Salidas Grupo de Servicio',
  territorio_personal: 'Territorio Personal',
}

const manageableRoles: Array<{ value: ProfileRole; label: string }> = [
  { value: 'viewer', label: 'Publicador' },
  { value: 'conductor', label: 'Conductor' },
  { value: 'siervo', label: 'Siervo' },
  { value: 'superintendente', label: 'Superintendente' },
  { value: 'admin', label: 'Administrador' },
]

type DriverOption = {
  id: string
  full_name: string
  status: 'activo' | 'pendiente' | 'inactivo'
}

type GroupOption = {
  id: string
  group_number: number | null
  group_name: string | null
}

type GroupMembership = {
  profile_id: string
  group_id: string
}

export function DashboardPage() {
  const { profile, moduleAccess } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const section = searchParams.get('seccion') === 'usuarios' ? 'usuarios' : 'resumen'

  if (profile?.role !== 'admin' && moduleAccess.length === 0) return <Navigate to="/predicacion" replace />

  return (
    <div className="page">
      <Saludo />
      {profile?.role === 'admin' ? (
        <div className="segmentado dashboard-sections" role="tablist" aria-label="Sección de Inicio">
          <button type="button" role="tab" aria-selected={section === 'resumen'} onClick={() => setSearchParams({ seccion: 'resumen' })}>
            <Icono nombre="inicio" tamaño={18} />
            Resumen
          </button>
          <button type="button" role="tab" aria-selected={section === 'usuarios'} onClick={() => setSearchParams({ seccion: 'usuarios' })}>
            <Icono nombre="persona" tamaño={18} />
            Usuarios
          </button>
        </div>
      ) : null}
      {section === 'resumen' ? (
        <>
          <QueNecesitaAtencion />
          {profile?.role === 'admin' ? <TerritorySuggestions /> : null}
        </>
      ) : profile?.role === 'admin' ? <UserAccessPanel /> : null}
    </div>
  )
}

/**
 * EL INICIO DEL ADMIN
 *
 * Antes esta pantalla explicaba el sistema: "arquitectura sugerida",
 * "React + Capacitor + Supabase", la lista de modulos disponibles. Eso
 * es un pitch, y le sirve a alguien que todavia no lo compro. Al que
 * entra todos los dias no le dice nada que no sepa.
 *
 * La vista del hermano abre distinto: "Buenas noches, Mateo. Las salidas
 * de hoy ya pasaron". Contesta que necesita ahora. Esto hace lo mismo
 * para el que administra: lo que esta esperando una decision suya, y
 * nada mas. Si no hay nada, lo dice y se calla.
 */
function Saludo() {
  const { profile } = useAuth()
  const hora = new Date().getHours()
  const momento = hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches'
  const nombre = (profile?.full_name || '').split(' ')[0]
  return (
    <section className="page-header">
      <div>
        <p className="eyebrow">Inicio</p>
        <h2>
          {momento}
          {nombre ? `, ${nombre}` : ''}.
        </h2>
      </div>
    </section>
  )
}

type Pendiente = {
  clave: string
  cuantos: number
  titulo: string
  detalle: string
  a: string
  accion: string
}

function QueNecesitaAtencion() {
  const { profile, managedUsers, managedUsersError, loadManagedUsers } = useAuth()
  const [items, setItems] = useState<Pendiente[] | null>(null)
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const esAdmin = profile?.role === 'admin'

  const enEspera = useMemo(
    () =>
      managedUsers.filter(
        (u) => u.access_status === 'pending',
      ).length,
    [managedUsers],
  )

  useEffect(() => {
    if (!supabase || !esAdmin) {
      setItems([])
      setUnavailable(esAdmin ? ['conexión con la base'] : [])
      return
    }
    const cliente = supabase
    let vivo = true
    setItems(null)
    setUnavailable([])
    void (async () => {
      // Mostrar lo que sí se pudo consultar, pero jamás confundir errores con
      // cero pendientes ni afirmar que todo está al día.
      try {
      const cuenta = async (p: PromiseLike<{ count: number | null; error: unknown }>) => {
        try {
          const { count, error } = await p
          return error ? null : count
        } catch {
          return null
        }
      }
      const cuantas = { count: 'exact', head: true } as const

      // Solo la corrida que vale. La primera importacion fallo a mitad y
      // quedo marcada 'revertida' con sus 1.800 filas: contarlas aca
      // inflaba el numero -decia 94 cuando eran 59- y un tablero que
      // exagera es peor que no tenerlo, porque se le deja de creer.
      const { data: corridas, error: corridaError } = await cliente
        .from('importaciones')
        .select('id')
        .neq('estado', 'revertida')
        .order('corrida_at', { ascending: false })
        .limit(1)
      const corrida = corridaError ? null : (corridas as { id: string }[] | null)?.[0]?.id ?? null

      const [conflictos, sinConductor, solicitudes] = await Promise.all([
        corrida
          ? cuenta(
              cliente
                .from('importacion_registros')
                .select('id', cuantas)
                .eq('importacion_id', corrida)
                .eq('estado', 'conflicto'),
            )
          : Promise.resolve(corridaError ? null : 0),
        (async () => {
          const conTexto = await cuenta(
            cliente
              .from('salidas')
              .select('id', cuantas)
              .is('driver_id', null)
              .or('conductor_texto.is.null,conductor_texto.eq.')
              .gte('scheduled_for', new Date().toISOString()),
          )
          if (conTexto !== null) return conTexto
          return cuenta(
            cliente
              .from('salidas')
              .select('id', cuantas)
              .is('driver_id', null)
              .gte('scheduled_for', new Date().toISOString()),
          )
        })(),
        cuenta(
          cliente
            .from('territorio_personal_reservas')
            .select('id', cuantas)
            .eq('status', 'solicitada'),
        ),
      ])
      if (!vivo) return
      setUnavailable([
        ...(conflictos === null ? ['conflictos de importación'] : []),
        ...(sinConductor === null ? ['salidas sin conductor'] : []),
        ...(solicitudes === null ? ['solicitudes de territorio'] : []),
      ])

      const lista: Pendiente[] = []
      if (enEspera > 0) {
        lista.push({
          clave: 'usuarios',
          cuantos: enEspera,
          titulo: enEspera === 1 ? 'Una persona espera acceso' : `${enEspera} personas esperan acceso`,
          detalle: 'Se registraron y todavía no pueden entrar a nada.',
          a: '/?seccion=usuarios&filtro=pendientes',
          accion: 'Darles acceso',
        })
      }
      if (solicitudes) {
        lista.push({
          clave: 'solicitudes',
          cuantos: solicitudes,
          titulo:
            solicitudes === 1
              ? 'Un hermano pidió un territorio'
              : `${solicitudes} hermanos pidieron territorio`,
          detalle: 'Están esperando que se lo asignes o se lo rechaces.',
          a: '/territorio-personal',
          accion: 'Ver los pedidos',
        })
      }
      if (sinConductor) {
        lista.push({
          clave: 'conductor',
          cuantos: sinConductor,
          titulo:
            sinConductor === 1
              ? 'Una salida no tiene conductor'
              : `${sinConductor} salidas no tienen conductor`,
          detalle: 'Están programadas y nadie las conduce todavía.',
          a: '/salidas?agenda=sin-conductor',
          accion: 'Asignar conductor',
        })
      }
      if (conflictos) {
        lista.push({
          clave: 'excel',
          cuantos: conflictos,
          titulo: `${conflictos} filas del Excel esperan tu decisión`,
          detalle: 'Ninguna cuenta las resuelve: la casilla dice una cosa y la observación otra.',
          a: '/importacion',
          accion: 'Revisarlas',
        })
      }
      setItems(lista)
      } catch {
        if (vivo) { setUnavailable(['pendientes del sistema']); setItems([]) }
      }
    })()
    return () => {
      vivo = false
    }
  }, [esAdmin, enEspera, reload])

  if (!esAdmin) return null

  if (items === null) {
    return (
      <section className="panel">
        <p className="lead">Viendo qué quedó pendiente…</p>
      </section>
    )
  }

  const missing = [...unavailable, ...(managedUsersError ? ['personas que esperan acceso'] : [])]
  const warning = missing.length ? <div className="form-feedback error" role="alert">
    <p>No se pudo comprobar: {missing.join(', ')}. No podemos afirmar que esté todo al día.</p>
    <button type="button" className="secondary-button" onClick={() => {
      setReload(value => value + 1)
      if (managedUsersError) void loadManagedUsers().catch(() => setUnavailable(current => [...current, 'accesos']))
    }}><Icono nombre="rehacer" tamaño={18} />Volver a consultar pendientes</button>
  </div> : null

  if (!items.length && !missing.length) {
    return (
      <section className="panel inicio-tranquilo">
        <p className="eyebrow">Al día</p>
        <h3>No hay nada esperándote.</h3>
        <p>
          Cuando alguien pida un territorio, se registre una persona nueva o quede una salida
          sin conductor, te lo vas a encontrar acá.
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      {warning}
      <p className="eyebrow">Te está esperando</p>
      <ul className="inicio-lista">
        {items.map((p) => (
          <li key={p.clave}>
            <span className="inicio-cuantos">{p.cuantos}</span>
            <span className="inicio-texto">
              <strong>{p.titulo}</strong>
              <small>{p.detalle}</small>
            </span>
            <Link to={p.a} className="inicio-accion">
              {p.accion} <Icono nombre="siguiente" tamaño={17} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function UserAccessPanel() {
  const {
    deactivateUser,
    loadManagedUsers,
    managedUsers,
    managedUsersError,
    profile,
    updateUserAccess,
  } = useAuth()
  const location = useLocation()
  const [draftRoles, setDraftRoles] = useState<Record<string, ProfileRole>>({})
  const [draftModules, setDraftModules] = useState<Record<string, ModuleKey[]>>({})
  const [draftDriverIds, setDraftDriverIds] = useState<Record<string, string>>({})
  const [draftGroupIds, setDraftGroupIds] = useState<Record<string, string>>({})
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [groupByProfile, setGroupByProfile] = useState<Record<string, string>>({})
  const [isSavingUserId, setIsSavingUserId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const initialFilter = new URLSearchParams(location.search).get('filtro')
  const [userFilter, setUserFilter] = useState<'todos' | 'pendientes' | 'activos' | 'inactivos'>(
    initialFilter === 'pendientes' || initialFilter === 'activos' || initialFilter === 'inactivos'
      ? initialFilter
      : 'todos',
  )
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const pendingUsers = useMemo(
    () =>
      managedUsers.filter(
        (user) =>
          user.access_status === 'pending',
      ),
    [managedUsers],
  )
  const approvedUsers = useMemo(
    () =>
      managedUsers.filter(
        (user) =>
          user.access_status === 'active',
      ),
    [managedUsers],
  )
  const inactiveUsers = useMemo(
    () => managedUsers.filter((user) => user.access_status === 'inactive'),
    [managedUsers],
  )
  const pendingGroupMembers = useMemo(
    () => managedUsers.filter((user) => user.miembroEstado === 'pendiente').length,
    [managedUsers],
  )
  const visibleUsers = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('es-AR')
    return managedUsers.filter((user) => {
      const matchesFilter =
        userFilter === 'todos' ||
        (userFilter === 'pendientes' && user.access_status === 'pending') ||
        (userFilter === 'activos' && user.access_status === 'active') ||
        (userFilter === 'inactivos' && user.access_status === 'inactive')
      if (!matchesFilter) return false
      if (!query) return true
      return [user.full_name, user.username, user.auth_email, user.groupName, user.groupNumber]
        .filter((value) => value != null)
        .join(' ')
        .toLocaleLowerCase('es-AR')
        .includes(query)
    })
  }, [managedUsers, searchTerm, userFilter])

  const loadDrivers = useCallback(async () => {
    if (!supabase || profile?.role !== 'admin') {
      setDrivers([])
      return
    }

    const { data, error: loadError } = await supabase
      .from('conductores')
      .select('id, full_name, status')
      .order('full_name', { ascending: true })

    if (loadError) {
      setError(decirElError(loadError))
      setDrivers([])
      return
    }

    setDrivers((data as DriverOption[]) ?? [])
  }, [profile?.role])

  const loadGroups = useCallback(async () => {
    if (!supabase || profile?.role !== 'admin') {
      setGroups([])
      setGroupByProfile({})
      return
    }

    const [{ data: groupRows, error: groupsError }, { data: memberRows, error: membersError }] = await Promise.all([
      supabase
        .from('grupos_servicio')
        .select('id, group_number, group_name')
        .order('group_number', { ascending: true, nullsFirst: false })
        .order('group_name', { ascending: true }),
      supabase
        .from('grupo_miembros')
        .select('profile_id, group_id')
        .is('hasta', null),
    ])

    if (groupsError || membersError) {
      setError(decirElError(groupsError ?? membersError))
      return
    }

    setGroups((groupRows as GroupOption[]) ?? [])
    setGroupByProfile(Object.fromEntries(
      ((memberRows as GroupMembership[]) ?? []).map((membership) => [membership.profile_id, membership.group_id]),
    ))
  }, [profile?.role])

  useEffect(() => {
    void Promise.all([loadDrivers(), loadGroups()])
  }, [loadDrivers, loadGroups])

  const refreshAccessPanel = async () => {
    setError(null)
    setFeedback(null)
    setIsRefreshing(true)

    await Promise.all([loadManagedUsers(), loadDrivers(), loadGroups()])

    setFeedback(
      `Panel actualizado ${new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date())}.`,
    )
    setIsRefreshing(false)
  }

  useEffect(() => {
    if (location.hash !== '#accesos') return
    document.getElementById('accesos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash, pendingUsers.length, approvedUsers.length])

  const getDraftRole = (userId: string, fallback: ProfileRole) =>
    draftRoles[userId] ?? fallback

  const getDraftModules = (userId: string, fallback: ModuleKey[]) =>
    draftModules[userId] ?? fallback

  const getDraftDriverId = (userId: string, fallback: string | null) =>
    draftDriverIds[userId] ?? fallback ?? ''

  const getDraftGroupId = (userId: string) =>
    draftGroupIds[userId] ?? groupByProfile[userId] ?? ''

  const saveGroup = async (userId: string) => {
    if (!supabase) return
    setError(null)
    setFeedback(null)
    setIsSavingUserId(userId)

    const groupId = getDraftGroupId(userId)
    const { error: saveError } = await supabase.rpc('administrar_grupo_usuario', {
      p_profile_id: userId,
      p_group_id: groupId || null,
    })

    if (saveError) {
      setError(decirElError(saveError))
    } else {
      setGroupByProfile((current) => ({ ...current, [userId]: groupId }))
      setDraftGroupIds((current) => {
        const next = { ...current }
        delete next[userId]
        return next
      })
      await loadManagedUsers()
      setFeedback(groupId ? 'Listo, el grupo quedó asignado.' : 'Listo, la persona quedó sin grupo.')
    }

    setIsSavingUserId(null)
  }

  const toggleModule = (userId: string, moduleKey: ModuleKey, fallback: ModuleKey[]) => {
    const currentModules = getDraftModules(userId, fallback)
    const nextModules = currentModules.includes(moduleKey)
      ? currentModules.filter((item) => item !== moduleKey)
      : [...currentModules, moduleKey]

    setDraftModules((current) => ({
      ...current,
      [userId]: nextModules,
    }))
  }

  const saveUser = async (
    userId: string,
    fallbackRole: ProfileRole,
    fallbackModules: ModuleKey[],
    fallbackDriverId: string | null,
  ) => {
    setError(null)
    setFeedback(null)
    setIsSavingUserId(userId)

    const result = await updateUserAccess(
      userId,
      getDraftRole(userId, fallbackRole),
      getDraftModules(userId, fallbackModules),
      getDraftDriverId(userId, fallbackDriverId),
    )

    if (result.error) {
      setError(result.error)
    } else {
      setFeedback('Listo, ya tiene el acceso actualizado.')
    }

    setIsSavingUserId(null)
  }

  const disableUser = async (userId: string) => {
    const persona =
      managedUsers.find((u) => u.id === userId)
    const nombre = persona?.full_name || persona?.auth_email || 'esta cuenta'
    if (
      !window.confirm(
        `¿Dás de baja a ${nombre}? Deja de poder entrar hasta que lo reactives.`,
      )
    ) {
      return
    }

    setError(null)
    setFeedback(null)
    setIsSavingUserId(userId)

    const result = await deactivateUser(userId)

    if (result.error) {
      setError(result.error)
    } else {
      setDraftRoles((current) => ({ ...current, [userId]: 'viewer' }))
      setDraftModules((current) => ({ ...current, [userId]: [] }))
      setDraftDriverIds((current) => ({ ...current, [userId]: '' }))
      setFeedback('Listo, quedó dado de baja.')
    }

    setIsSavingUserId(null)
  }

  const renderUserAccessCard = (user: (typeof managedUsers)[number], variant: 'pending' | 'active' | 'inactive' = 'active') => {
    const draftRole = getDraftRole(user.id, user.role)
    const draftAccess = getDraftModules(user.id, user.moduleAccess)
    const draftDriverId = getDraftDriverId(user.id, user.driver_id)
    const draftGroupId = getDraftGroupId(user.id)
    const isOwnUser = user.id === profile?.id
    const isRequestOnly = Boolean(user.requestOnly)
    const isDisabled = isSavingUserId === user.id || isOwnUser || isRequestOnly
    const isEditing = editingUserId === user.id

    return (
      <article
        key={user.id}
        className={
          variant === 'pending'
            ? 'admin-user-card admin-user-card-pending'
            : 'admin-user-card'
        }
      >
        <div className="admin-user-main">
          <strong>{user.full_name || user.username || user.auth_email}</strong>
          <span>
            {user.auth_email ||
              'Sin email registrado en la cuenta.'}
          </span>
          <span>
            {user.groupNumber
              ? `Grupo ${user.groupNumber}`
              : user.groupName
                ? user.groupName
                : 'Sin grupo'}
            {user.miembroEstado === 'pendiente' ? ' · espera confirmación' : ''}
          </span>
          <span
            className={
              user.access_status === 'active'
                ? 'status-pill status-activo'
                : 'status-pill status-pendiente'
            }
          >
            {isRequestOnly
              ? 'Solicitud recibida'
              : user.access_status === 'active'
              ? 'Autorizado'
              : user.access_status === 'inactive' ? 'Inactivo' : 'Pendiente'}
          </span>
          {!user.auth_email || isRequestOnly ? (
            <span>
              Si no puede entrar, fijate también que haya confirmado el email.
            </span>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            aria-expanded={isEditing}
            onClick={() => setEditingUserId(isEditing ? null : user.id)}
          >
            <Icono nombre={isEditing ? 'cerrar' : 'dibujar'} tamaño={18} />
            {isEditing ? 'Cerrar edición' : variant === 'pending' ? 'Revisar solicitud' : 'Editar acceso'}
          </button>
        </div>

        {isEditing ? <>
        <label>
          Rol
          <Desplegable
            etiqueta="Rol"
            valor={draftRole}
            deshabilitado={isDisabled}
            alElegir={(valor) =>
              setDraftRoles((current) => ({ ...current, [user.id]: valor as ProfileRole }))
            }
            opciones={manageableRoles.map((role) => ({
              valor: role.value,
              texto: role.label,
            }))}
          />
        </label>

        <label>
          Conductor vinculado
          <Desplegable
            etiqueta="Conductor vinculado"
            valor={draftDriverId}
            deshabilitado={isDisabled}
            alElegir={(valor) =>
              setDraftDriverIds((current) => ({ ...current, [user.id]: valor }))
            }
            opciones={[
              { valor: '', texto: 'Sin vincular' },
              ...drivers.map((driver) => ({
                valor: driver.id,
                texto:
                  driver.status !== 'activo'
                    ? `${driver.full_name} (${driver.status})`
                    : driver.full_name,
              })),
            ]}
          />
        </label>

        <div className="admin-group-assignment">
          <label>
            Grupo al que pertenece
            <Desplegable
              etiqueta="Grupo al que pertenece"
              valor={draftGroupId}
              deshabilitado={isSavingUserId === user.id || isRequestOnly}
              alElegir={(valor) =>
                setDraftGroupIds((current) => ({ ...current, [user.id]: valor }))
              }
              opciones={[
                { valor: '', texto: 'Sin grupo' },
                ...groups.map((group) => ({
                  valor: group.id,
                  texto: group.group_number
                    ? `Grupo ${group.group_number}${group.group_name ? ` · ${group.group_name}` : ''}`
                    : group.group_name || 'Grupo sin nombre',
                })),
              ]}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void saveGroup(user.id)}
            disabled={isSavingUserId === user.id || isRequestOnly}
          >
            <Icono nombre="grupo" tamaño={18} />
            {isSavingUserId === user.id ? 'Guardando...' : 'Guardar grupo'}
          </button>
        </div>

        {draftRole === 'admin' ? (
          <p className="admin-access-complete">Acceso completo al panel.</p>
        ) : (
        <div className="admin-module-checks">
          {Object.entries(moduleLabels).map(([moduleKey, label]) => (
            <label key={moduleKey}>
              <input
                type="checkbox"
                checked={draftAccess.includes(moduleKey as ModuleKey)}
                onChange={() =>
                  toggleModule(user.id, moduleKey as ModuleKey, user.moduleAccess)
                }
                disabled={isDisabled}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        )}

        <div className="admin-user-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void saveUser(user.id, user.role, user.moduleAccess, user.driver_id)
            }
            disabled={isDisabled}
          >
            <Icono nombre="guardar" tamaño={18} />
            {isSavingUserId === user.id
              ? 'Guardando...'
              : variant === 'pending'
                ? 'Autorizar acceso'
                : variant === 'inactive'
                  ? 'Reactivar'
                  : 'Guardar acceso'}
          </button>
          {variant !== 'inactive' ? (
          <button
            type="button"
            className="danger-button"
            onClick={() => void disableUser(user.id)}
            disabled={isDisabled}
          >
            <Icono nombre="eliminar" tamaño={18} />
            Dar de baja
          </button>
          ) : null}
        </div>
        </> : null}
      </article>
    )
  }

  return (
    <section className="panel admin-access-panel" id="accesos">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h3>Altas, bajas y permisos</h3>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void refreshAccessPanel()}
          disabled={isRefreshing}
        >
          <Icono nombre="rehacer" tamaño={18} />
          {isRefreshing ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {error ? <div className="form-feedback error">{error}</div> : null}
      {managedUsersError ? <div className="form-feedback error" role="alert">{managedUsersError}</div> : null}
      {feedback ? <div className="form-feedback success">{feedback}</div> : null}

      {pendingGroupMembers > 0 ? (
        <div className="status-card">
          <strong>{pendingGroupMembers} {pendingGroupMembers === 1 ? 'persona espera' : 'personas esperan'} confirmación de su grupo.</strong>
          <Link to="/grupos">Abrir Grupos</Link>
        </div>
      ) : null}

      <div className="module-registry-toolbar admin-users-toolbar">
        <label className="module-search-field">
          <span className="sr-only">Buscar persona</span>
          <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar por nombre, email o grupo" />
        </label>
        <Desplegable
          etiqueta="Estado"
          valor={userFilter}
          alElegir={(value) => setUserFilter(value as typeof userFilter)}
          opciones={[
            { valor: 'todos', texto: `Todos (${managedUsers.length})` },
            { valor: 'pendientes', texto: `Pendientes (${pendingUsers.length})` },
            { valor: 'activos', texto: `Activos (${approvedUsers.length})` },
            { valor: 'inactivos', texto: `Inactivos (${inactiveUsers.length})` },
          ]}
        />
      </div>
      <div className="admin-user-list">
        {visibleUsers.length === 0 ? <div className="status-card">No hay personas que coincidan con la búsqueda y el filtro.</div> : visibleUsers.map((user) =>
          renderUserAccessCard(
            user,
            user.access_status === 'pending' ? 'pending' : user.access_status === 'inactive' ? 'inactive' : 'active',
          ),
        )}
      </div>
    </section>
  )
}
