import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ModuleKey, ProfileRole } from '../context/AuthTypes'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import '../styles/inicio-admin.css'

const moduleLabels: Record<ModuleKey, string> = {
  mapas: 'Mapas y Territorios',
  conductores: 'Conductores',
  grupos: 'Grupos para el Servicio',
  salidas: 'Salidas',
  salidas_grupo: 'Salidas Grupo de Servicio',
  territorio_personal: 'Territorio Personal',
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
      <Saludo />
      <QueNecesitaAtencion />

      {profile?.role === 'admin' ? <UserAccessPanel /> : null}
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
  const { profile, managedUsers } = useAuth()
  const [items, setItems] = useState<Pendiente[] | null>(null)
  const esAdmin = profile?.role === 'admin'

  const enEspera = useMemo(
    () =>
      managedUsers.filter(
        (u) => u.role !== 'admin' && u.access_status !== 'inactive' && u.moduleAccess.length === 0,
      ).length,
    [managedUsers],
  )

  useEffect(() => {
    if (!supabase || !esAdmin) {
      setItems([])
      return
    }
    const cliente = supabase
    let vivo = true
    void (async () => {
      // Cada cuenta va por separado y ninguna puede tumbar al resto: si una
      // tabla todavia no existe en este entorno, esa fila no aparece y las
      // demas si. Un tablero a medias sirve; uno que no carga, no.
      const cuenta = async (p: PromiseLike<{ count: number | null; error: unknown }>) => {
        try {
          const { count, error } = await p
          return error ? null : (count ?? 0)
        } catch {
          return null
        }
      }
      const cuantas = { count: 'exact', head: true } as const

      // Solo la corrida que vale. La primera importacion fallo a mitad y
      // quedo marcada 'revertida' con sus 1.800 filas: contarlas aca
      // inflaba el numero -decia 94 cuando eran 59- y un tablero que
      // exagera es peor que no tenerlo, porque se le deja de creer.
      const { data: corridas } = await cliente
        .from('importaciones')
        .select('id')
        .neq('estado', 'revertida')
        .order('corrida_at', { ascending: false })
        .limit(1)
      const corrida = (corridas as { id: string }[] | null)?.[0]?.id ?? null

      const [conflictos, sinConductor, solicitudes] = await Promise.all([
        corrida
          ? cuenta(
              cliente
                .from('importacion_registros')
                .select('id', cuantas)
                .eq('importacion_id', corrida)
                .eq('estado', 'conflicto'),
            )
          : Promise.resolve(null),
        cuenta(
          cliente
            .from('salidas')
            .select('id', cuantas)
            .is('driver_id', null)
            .gte('scheduled_for', new Date().toISOString()),
        ),
        cuenta(
          cliente
            .from('territorio_personal_reservas')
            .select('id', cuantas)
            .eq('status', 'solicitada'),
        ),
      ])
      if (!vivo) return

      const lista: Pendiente[] = []
      if (enEspera > 0) {
        lista.push({
          clave: 'usuarios',
          cuantos: enEspera,
          titulo: enEspera === 1 ? 'Una persona espera acceso' : `${enEspera} personas esperan acceso`,
          detalle: 'Se registraron y todavía no pueden entrar a nada.',
          a: '/',
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
          a: '/salidas',
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
    })()
    return () => {
      vivo = false
    }
  }, [esAdmin, enEspera])

  if (!esAdmin) return null

  if (items === null) {
    return (
      <section className="panel">
        <p className="lead">Viendo qué quedó pendiente…</p>
      </section>
    )
  }

  if (!items.length) {
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
              {p.accion} →
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
    profile,
    updateUserAccess,
  } = useAuth()
  const [draftRoles, setDraftRoles] = useState<Record<string, ProfileRole>>({})
  const [draftModules, setDraftModules] = useState<Record<string, ModuleKey[]>>({})
  const [draftDriverIds, setDraftDriverIds] = useState<Record<string, string>>({})
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [isSavingUserId, setIsSavingUserId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingUsers = useMemo(
    () =>
      managedUsers.filter(
        (user) =>
          user.role !== 'admin' &&
          user.access_status !== 'inactive' &&
          user.moduleAccess.length === 0,
      ),
    [managedUsers],
  )
  const approvedUsers = useMemo(
    () =>
      managedUsers.filter(
        (user) =>
          user.access_status !== 'inactive' &&
          (user.role === 'admin' || user.moduleAccess.length > 0),
      ),
    [managedUsers],
  )
  const inactiveUsers = useMemo(
    () => managedUsers.filter((user) => user.access_status === 'inactive'),
    [managedUsers],
  )

  useEffect(() => {
    void loadManagedUsers()
  }, [loadManagedUsers])

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
      setError(loadError.message)
      setDrivers([])
      return
    }

    setDrivers((data as DriverOption[]) ?? [])
  }, [profile?.role])

  useEffect(() => {
    void loadDrivers()
  }, [loadDrivers])

  const refreshAccessPanel = async () => {
    setError(null)
    setFeedback(null)
    setIsRefreshing(true)

    await Promise.all([loadManagedUsers(), loadDrivers()])

    setFeedback(
      `Panel actualizado ${new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date())}.`,
    )
    setIsRefreshing(false)
  }

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
    const isRequestOnly = Boolean(user.requestOnly)
    const isDisabled = isSavingUserId === user.id || isOwnUser || isRequestOnly

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
          <span>
            {user.auth_email ||
              'Sin email registrado: falta sincronizar con Supabase Auth'}
          </span>
          <span
            className={
              user.moduleAccess.length > 0 || user.role === 'admin'
                ? 'status-pill status-activo'
                : 'status-pill status-pendiente'
            }
          >
            {isRequestOnly
              ? 'Solicitud recibida'
              : user.moduleAccess.length > 0 || user.role === 'admin'
              ? 'Autorizado'
              : 'Pendiente'}
          </span>
          {!user.auth_email || isRequestOnly ? (
            <span>
              Si no puede iniciar sesion, revisa tambien que el email este
              confirmado en Supabase Authentication.
            </span>
          ) : null}
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
            disabled={isDisabled}
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
            disabled={isDisabled}
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
                disabled={isDisabled || draftRole === 'admin'}
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
            disabled={isDisabled}
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
            disabled={isDisabled}
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
        <button
          type="button"
          className="secondary-button"
          onClick={() => void refreshAccessPanel()}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Actualizando...' : 'Actualizar'}
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

      {inactiveUsers.length > 0 ? (
        <div className="admin-access-subhead">
          <div>
            <p className="eyebrow">Usuarios dados de baja</p>
            <h4>Fuera de solicitudes y accesos activos</h4>
          </div>
          <span>{inactiveUsers.length} dado/s de baja</span>
        </div>
      ) : null}
    </section>
  )
}
