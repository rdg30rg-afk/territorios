import { useEffect, useMemo, useState } from 'react'
import type { ModuleKey, ProfileRole } from '../context/AuthTypes'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'

const moduleStatus = [
  {
    name: 'Mapas y Territorios',
    detail: 'Mapa inicial listo. Falta dibujo y guardado de poligonos.',
  },
  {
    name: 'Conductores',
    detail: 'Vista modelo preparada para alta y listado.',
  },
  {
    name: 'Grupos para el Servicio',
    detail: 'Base para perfiles de superintendente y siervo.',
  },
  {
    name: 'Salidas',
    detail: 'Modelo listo para usar puntos de encuentro geolocalizados.',
  },
  {
    name: 'Salidas Grupo de Servicio',
    detail: 'Reservas de territorios por grupo con acceso delegado.',
  },
]

const moduleLabels: Record<ModuleKey, string> = {
  mapas: 'Mapas y Territorios',
  conductores: 'Conductores',
  grupos: 'Grupos para el Servicio',
  salidas: 'Salidas',
  salidas_grupo: 'Salidas Grupo de Servicio',
}

const manageableRoles: Array<{ value: ProfileRole; label: string }> = [
  { value: 'viewer', label: 'Pendiente' },
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

export function DashboardPage() {
  const { profile } = useAuth()

  return (
    <div className="page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">MVP fase 1</p>
          <h2>Sistema modular con foco en territorios y salidas</h2>
          <p className="lead">
            Esta base ya esta preparada para crecer como web y APK, usando una
            sola aplicacion conectada a una base de datos en la nube, y ahora
            tambien puede instalarse como PWA.
          </p>
        </div>

        <div className="hero-highlight">
          <span>Arquitectura sugerida</span>
          <strong>React + Capacitor + Supabase + MapLibre</strong>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <p className="eyebrow">Base de datos</p>
          <strong>Supabase</strong>
          <span>PostgreSQL con Auth y reglas RLS</span>
        </article>
        <article className="stat-card">
          <p className="eyebrow">Mapa</p>
          <strong>OpenStreetMap</strong>
          <span>Visualizacion de San Juan con MapLibre</span>
        </article>
        <article className="stat-card">
          <p className="eyebrow">Publicacion</p>
          <strong>Web + PWA + APK</strong>
          <span>Un solo codigo para navegador, instalacion web y Android</span>
        </article>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Modulos</p>
            <h3>Estado inicial del producto</h3>
          </div>
        </div>

        <div className="checklist">
          {moduleStatus.map((item) => (
            <article key={item.name} className="list-card">
              <strong>{item.name}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {profile?.role === 'admin' ? <UserAccessPanel /> : null}
    </div>
  )
}

function UserAccessPanel() {
  const {
    deactivateUser,
    loadManagedUsers,
    managedUsers,
    profile,
    updateUserAccess,
  } = useAuth()
  const [draftRoles, setDraftRoles] = useState<Record<string, ProfileRole>>({})
  const [draftModules, setDraftModules] = useState<Record<string, ModuleKey[]>>({})
  const [draftDriverIds, setDraftDriverIds] = useState<Record<string, string>>({})
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [isSavingUserId, setIsSavingUserId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingUsers = useMemo(
    () =>
      managedUsers.filter(
        (user) => user.role !== 'admin' && user.moduleAccess.length === 0,
      ),
    [managedUsers],
  )
  const approvedUsers = useMemo(
    () =>
      managedUsers.filter(
        (user) => user.role === 'admin' || user.moduleAccess.length > 0,
      ),
    [managedUsers],
  )

  useEffect(() => {
    void loadManagedUsers()
  }, [loadManagedUsers])

  useEffect(() => {
    if (!supabase || profile?.role !== 'admin') {
      setDrivers([])
      return
    }

    const client = supabase
    let isMounted = true

    const loadDrivers = async () => {
      const { data, error: loadError } = await client
        .from('conductores')
        .select('id, full_name, status')
        .order('full_name', { ascending: true })

      if (!isMounted) {
        return
      }

      if (loadError) {
        setError(loadError.message)
        setDrivers([])
        return
      }

      setDrivers((data as DriverOption[]) ?? [])
    }

    void loadDrivers()

    return () => {
      isMounted = false
    }
  }, [profile?.role])

  const getDraftRole = (userId: string, fallback: ProfileRole) =>
    draftRoles[userId] ?? fallback

  const getDraftModules = (userId: string, fallback: ModuleKey[]) =>
    draftModules[userId] ?? fallback

  const getDraftDriverId = (userId: string, fallback: string | null) =>
    draftDriverIds[userId] ?? fallback ?? ''

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
      setFeedback('Acceso actualizado correctamente.')
    }

    setIsSavingUserId(null)
  }

  const disableUser = async (userId: string) => {
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
      setFeedback('Usuario dado de baja correctamente.')
    }

    setIsSavingUserId(null)
  }

  const renderUserAccessCard = (user: (typeof managedUsers)[number], isPendingCard = false) => {
    const draftRole = getDraftRole(user.id, user.role)
    const draftAccess = getDraftModules(user.id, user.moduleAccess)
    const draftDriverId = getDraftDriverId(user.id, user.driver_id)
    const isOwnUser = user.id === profile?.id

    return (
      <article
        key={user.id}
        className={
          isPendingCard
            ? 'admin-user-card admin-user-card-pending'
            : 'admin-user-card'
        }
      >
        <div className="admin-user-main">
          <strong>{user.full_name || user.username || user.auth_email}</strong>
          <span>{user.auth_email || 'Sin email registrado'}</span>
          <span
            className={
              user.moduleAccess.length > 0 || user.role === 'admin'
                ? 'status-pill status-activo'
                : 'status-pill status-pendiente'
            }
          >
            {user.moduleAccess.length > 0 || user.role === 'admin'
              ? 'Autorizado'
              : 'Pendiente'}
          </span>
        </div>

        <label>
          Asignacion
          <select
            value={draftRole}
            onChange={(event) =>
              setDraftRoles((current) => ({
                ...current,
                [user.id]: event.target.value as ProfileRole,
              }))
            }
            disabled={isSavingUserId === user.id || isOwnUser}
          >
            {manageableRoles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Conductor vinculado
          <select
            value={draftDriverId}
            onChange={(event) =>
              setDraftDriverIds((current) => ({
                ...current,
                [user.id]: event.target.value,
              }))
            }
            disabled={isSavingUserId === user.id || isOwnUser}
          >
            <option value="">Sin vincular</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.full_name}
                {driver.status !== 'activo' ? ` (${driver.status})` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-module-checks">
          {Object.entries(moduleLabels).map(([moduleKey, label]) => (
            <label key={moduleKey}>
              <input
                type="checkbox"
                checked={draftAccess.includes(moduleKey as ModuleKey)}
                onChange={() =>
                  toggleModule(user.id, moduleKey as ModuleKey, user.moduleAccess)
                }
                disabled={isSavingUserId === user.id || isOwnUser || draftRole === 'admin'}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="admin-user-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void saveUser(user.id, user.role, user.moduleAccess, user.driver_id)
            }
            disabled={isSavingUserId === user.id || isOwnUser}
          >
            {isSavingUserId === user.id
              ? 'Guardando...'
              : isPendingCard
                ? 'Autorizar acceso'
                : 'Guardar acceso'}
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void disableUser(user.id)}
            disabled={isSavingUserId === user.id || isOwnUser}
          >
            Dar de baja
          </button>
        </div>
      </article>
    )
  }

  return (
    <section className="panel admin-access-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Administracion</p>
          <h3>Altas, bajas y permisos de usuarios</h3>
        </div>
        <button type="button" className="secondary-button" onClick={() => void loadManagedUsers()}>
          Actualizar
        </button>
      </div>

      {error ? <div className="form-feedback error">{error}</div> : null}
      {feedback ? <div className="form-feedback success">{feedback}</div> : null}

      <div className="admin-notification-panel">
        <div className="admin-notification-head">
          <div>
            <p className="eyebrow">Notificaciones</p>
            <h4>Solicitudes esperando aprobacion</h4>
            <span>
              Define los modulos permitidos antes de autorizar el acceso.
            </span>
          </div>
          <strong>{pendingUsers.length}</strong>
        </div>

        {pendingUsers.length === 0 ? (
          <div className="status-card">No hay usuarios pendientes de aprobacion.</div>
        ) : (
          <div className="admin-user-list">
            {pendingUsers.map((user) => renderUserAccessCard(user, true))}
          </div>
        )}
      </div>

      <div className="admin-access-subhead">
        <div>
          <p className="eyebrow">Usuarios activos</p>
          <h4>Gestion completa de accesos</h4>
        </div>
        <span>{approvedUsers.length} autorizado/s</span>
      </div>

      <div className="admin-user-list">
        {approvedUsers.map((user) => renderUserAccessCard(user))}
      </div>
    </section>
  )
}
