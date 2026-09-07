import type { Session } from '@supabase/supabase-js'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  canManageAdministrators,
  canOpenAdminPanel,
  hasActiveAccess,
  hasModuleAccess,
  isSystemRole,
} from '../lib/access'
import { readAllRows } from '../lib/readAllRows'
import { pendingBeforeLogout } from '../lib/pendingBeforeLogout'
import {
  AuthContext,
  type AuthContextValue,
  type AccessContext,
  type ManagedUser,
  type ModuleKey,
  type PendingUserRequest,
  type Profile,
  type ProfileRole,
} from './AuthTypes'
import type { SupabaseClient } from '@supabase/supabase-js'

function contextoDesdeFila(
  fila: AccessContext | null,
  profileRow: Profile | null,
): AccessContext | null {
  const legacyAdmin = profileRow ? canOpenAdminPanel(profileRow) : false
  if (fila) {
    return {
      role: fila.role,
      access_status: fila.access_status,
      driver_id: fila.driver_id,
      full_name: fila.full_name,
      group_id: fila.group_id,
      group_number: fila.group_number,
      group_name: fila.group_name,
      rol_en_grupo: fila.rol_en_grupo,
      miembro_estado: fila.miembro_estado,
      punto_grupo_id: fila.punto_grupo_id,
      punto_grupo_nombre: fila.punto_grupo_nombre,
      punto_grupo_lat: fila.punto_grupo_lat,
      punto_grupo_lng: fila.punto_grupo_lng,
      es_super_de_grupo: Boolean(fila.es_super_de_grupo),
      system_role: fila.system_role ?? profileRow?.system_role,
      es_conductor: typeof fila.es_conductor === 'boolean'
        ? fila.es_conductor
        : Boolean(fila.driver_id),
      puede_administrar_grupo: typeof fila.puede_administrar_grupo === 'boolean'
        ? fila.puede_administrar_grupo
        : Boolean(fila.es_super_de_grupo),
      puede_informar_salidas: typeof fila.puede_informar_salidas === 'boolean'
        ? fila.puede_informar_salidas
        : Boolean(fila.driver_id || fila.es_super_de_grupo || legacyAdmin),
      puede_abrir_panel: typeof fila.puede_abrir_panel === 'boolean'
        ? fila.puede_abrir_panel
        : legacyAdmin,
      puede_administrar_admins: typeof fila.puede_administrar_admins === 'boolean'
        ? fila.puede_administrar_admins
        : profileRow?.system_role === 'superadmin',
    }
  }
  if (!profileRow) return null
  return {
    role: profileRow.role,
    access_status: profileRow.access_status,
    driver_id: profileRow.driver_id,
    full_name: profileRow.full_name,
    group_id: null,
    group_number: null,
    group_name: null,
    rol_en_grupo: null,
    miembro_estado: null,
    punto_grupo_id: null,
    punto_grupo_nombre: null,
    punto_grupo_lat: null,
    punto_grupo_lng: null,
    es_super_de_grupo: false,
    system_role: profileRow.system_role,
    es_conductor: Boolean(profileRow.driver_id),
    puede_administrar_grupo: false,
    puede_informar_salidas: Boolean(profileRow.driver_id || legacyAdmin),
    puede_abrir_panel: legacyAdmin,
    puede_administrar_admins: profileRow.system_role === 'superadmin',
  }
}

function esErrorDeColumnaAusente(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === '42703'
    || error.code === 'PGRST204'
    || /system_role|could not find the .*column/i.test(error.message ?? '')
}

async function leerPerfil(
  client: SupabaseClient,
  userId: string,
) {
  const current = await client
    .from('profiles')
    .select('id, full_name, role, system_role, driver_id, access_status')
    .eq('id', userId)
    .maybeSingle()

  if (!esErrorDeColumnaAusente(current.error)) return current

  return client
    .from('profiles')
    .select('id, full_name, role, driver_id, access_status')
    .eq('id', userId)
    .maybeSingle()
}

type PendingUserRow = {
  id: string
  full_name: string | null
  email: string
  username: string | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [contexto, setContexto] = useState<AccessContext | null>(null)
  const [moduleAccess, setModuleAccess] = useState<ModuleKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authAttempt, setAuthAttempt] = useState(0)
  const [pendingRequests, setPendingRequests] = useState<PendingUserRequest[]>([])
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([])
  const [managedUsersError, setManagedUsersError] = useState<string | null>(null)
  const managedGeneration = useRef(0)
  const authIdentity = useRef<string | null>(null)
  // Sobrevive a la reejecución del efecto que dispara "Volver a intentar".
  // Una misma sesión ya verificada no debe desmontar la pantalla protegida.
  const verifiedUser = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false)
      return
    }

    const client = supabase

    let mounted = true
    let generation = 0
    let pendingUser: string | null = null
    let deadline: ReturnType<typeof setTimeout> | undefined
    const deferred = new Set<ReturnType<typeof setTimeout>>()
    const expire = () => {
      if (!mounted) return
      generation++
      pendingUser = null
      verifiedUser.current = null
      setProfile(null)
      setContexto(null)
      setModuleAccess([])
      setAuthError('La comprobación tardó demasiado. Revisá la conexión y volvé a intentar.')
      setIsLoading(false)
    }
    deadline = setTimeout(expire, 15000)

    const hydrateUser = async (activeSession: Session | null) => {
      if (!mounted) {
        return
      }

      const userId = activeSession?.user.id ?? null
      // INITIAL_SESSION, SIGNED_IN y getSession pueden describir la misma
      // sesión simultáneamente. Compartir la lectura que ya está pendiente.
      setSession(activeSession)
      if (userId && pendingUser === userId) return
      const request = ++generation
      const sameUser = Boolean(userId && verifiedUser.current === userId)
      if (authIdentity.current !== userId) {
        managedGeneration.current++
        setManagedUsers([])
        setPendingRequests([])
        setManagedUsersError(null)
      }
      authIdentity.current = userId
      setAuthError(null)
      clearTimeout(deadline)
      if (!sameUser) {
        setProfile(null)
        setContexto(null)
        setModuleAccess([])
        verifiedUser.current = null
      }

      if (!activeSession?.user) {
        pendingUser = null
        setManagedUsers([])
        setPendingRequests([])
        setManagedUsersError(null)
        setProfile(null)
        setContexto(null)
        setModuleAccess([])
        setIsLoading(false)
        return
      }

      pendingUser = userId
      // Actualizar permisos en segundo plano conserva el Outlet y sus
      // formularios. Si se revocan o falla la comprobación, cerrar el acceso.
      if (!sameUser) setIsLoading(true)
      deadline = setTimeout(expire, 15000)

      try {
        const [{ data: profileRow, error: profileError }, { data: accessRows, error: accessError }, contextoRes] = await Promise.all([
          leerPerfil(client, activeSession.user.id),
          client
            .from('user_module_access')
            .select('module_key')
            .eq('user_id', activeSession.user.id),
          client.from('mi_contexto').select('*').maybeSingle(),
        ])
        const contextoNoDisponible = contextoRes.error?.code === '42P01'
          || esErrorDeColumnaAusente(contextoRes.error)
        const contextoRow = contextoNoDisponible
          ? null
          : (contextoRes.data as AccessContext | null)

      if (!mounted || request !== generation) {
        return
      }

        if (profileError || accessError || (contextoRes.error && !contextoNoDisponible)) {
          throw profileError ?? accessError ?? contextoRes.error
        }

        clearTimeout(deadline)
        pendingUser = null
        verifiedUser.current = userId
        const profileFromQuery = (profileRow ?? null) as Profile | null
        const contextSystemRole = isSystemRole(contextoRow?.system_role)
        const profileForSession = profileFromQuery && contextSystemRole
          ? { ...profileFromQuery, system_role: contextoRow.system_role }
          : profileFromQuery
      // No reiniciar efectos/formularios que dependen del perfil cuando
      // Supabase devuelve los mismos valores con otra identidad de objeto.
        setProfile(previous => {
          const next = profileForSession
          if (previous && next && previous.id === next.id &&
            previous.full_name === next.full_name && previous.role === next.role &&
            previous.system_role === next.system_role && previous.driver_id === next.driver_id &&
            previous.access_status === next.access_status) return previous
          return next
        })
        setContexto(contextoDesdeFila(contextoRow, profileForSession))
        setModuleAccess(
          (accessRows ?? [])
            .map((row) => row.module_key)
            .filter(
              (value): value is ModuleKey =>
                value === 'mapas' ||
                value === 'conductores' ||
                value === 'grupos' ||
                value === 'salidas' ||
                value === 'salidas_grupo' ||
                value === 'territorio_personal',
            ),
        )
        setIsLoading(false)
      } catch {
        if (!mounted || request !== generation) return
        clearTimeout(deadline)
        pendingUser = null
        verifiedUser.current = null
        setProfile(null)
        setContexto(null)
        setModuleAccess([])
        setAuthError('No pudimos comprobar tu acceso. Revisá la conexión y volvé a intentar.')
        setIsLoading(false)
      }
    }

    const initialGeneration = generation
    client.auth.getSession().then(({ data, error }) => {
      if (!mounted || generation !== initialGeneration) return
      if (error) {
        clearTimeout(deadline)
        setAuthError('No pudimos recuperar tu sesión. Volvé a intentar.')
        setIsLoading(false)
        return
      }
      void hydrateUser(data.session)
    }).catch(() => {
      if (!mounted || generation !== initialGeneration) return
      clearTimeout(deadline)
      setAuthError('No pudimos recuperar tu sesión. Volvé a intentar.')
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, activeSession) => {
      deferred.forEach(clearTimeout)
      deferred.clear()
      // Salir/cambiar de cuenta invalida inmediatamente. Las consultas se
      // inician fuera del callback de Auth para no competir con su lock.
      if ((activeSession?.user.id ?? null) !== authIdentity.current) {
        generation++
        pendingUser = null
        verifiedUser.current = null
        authIdentity.current = null
        managedGeneration.current++
        setProfile(null)
        setContexto(null)
        setModuleAccess([])
        setManagedUsers([])
        setPendingRequests([])
        setSession(activeSession)
        setIsLoading(Boolean(activeSession))
      }
      const timer = setTimeout(() => {
        deferred.delete(timer)
        void hydrateUser(activeSession)
      }, 0)
      deferred.add(timer)
    })

    return () => {
      mounted = false
      clearTimeout(deadline)
      deferred.forEach(clearTimeout)
      managedGeneration.current++
      subscription.unsubscribe()
    }
  }, [authAttempt])

  const signIn = async (login: string, password: string) => {
    if (!supabase) {
      return { error: 'Faltan las variables de entorno de Supabase.' }
    }

    const trimmedLogin = login.trim()
    let email = trimmedLogin

    if (!trimmedLogin.includes('@')) {
      const { data, error } = await supabase.rpc('resolve_login_email', {
        login_identifier: trimmedLogin,
      })

      if (error || !data) {
        return { error: 'Usuario no encontrado.' }
      }

      email = data
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    if (!supabase) {
      return
    }

    if (session?.user.id) {
      let warning: string | null
      try {
        const project = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]
        warning = pendingBeforeLogout(localStorage, project, session.user.id)
      } catch {
        warning = 'No pudimos comprobar los envíos pendientes. No borres los datos del navegador. ¿Querés cerrar sesión igualmente?'
      }
      if (warning && !window.confirm(warning)) return
    }
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const isApproved = hasActiveAccess(profile)

  const loadManagedUsers = useCallback(async () => {
    const request = ++managedGeneration.current
    const profileId = profile?.id
    if (!supabase || !profileId || !canOpenAdminPanel(profile, contexto) || authIdentity.current !== profileId) {
      setManagedUsers([])
      setPendingRequests([])
      return
    }
    const client = supabase
    setManagedUsersError(null)
    try {
    const [profileRows, accessRows, pendingRows, memberRows] = await Promise.all([
        readAllRows((from, to) => client
          .from('profiles')
          .select('id, full_name, username, auth_email, role, driver_id, access_status')
          .order('created_at', { ascending: false }).order('id').range(from, to)),
        readAllRows((from, to) => client.from('user_module_access').select('user_id, module_key')
          .order('user_id').order('module_key').range(from, to)),
        readAllRows((from, to) => client
          .from('pending_users')
          .select('id, full_name, email, username')
          .order('requested_at', { ascending: false }).order('id').range(from, to)),
        (async () => {
          try {
            const res = await client
              .from('grupo_miembros')
              .select('profile_id, estado, grupos_servicio(group_number, group_name)')
              .is('hasta', null)
            return res.error ? [] : res.data ?? []
          } catch {
            return []
          }
        })(),
      ])
    if (request !== managedGeneration.current || authIdentity.current !== profileId) return

    const gruposPorPersona = new Map<string, { groupName: string | null; groupNumber: number | null; miembroEstado: ManagedUser['miembroEstado'] }>()
    for (const fila of memberRows as Array<{
      profile_id: string
      estado: ManagedUser['miembroEstado']
      grupos_servicio: { group_number: number | null; group_name: string | null } | { group_number: number | null; group_name: string | null }[] | null
    }>) {
      const grupo = Array.isArray(fila.grupos_servicio) ? fila.grupos_servicio[0] : fila.grupos_servicio
      gruposPorPersona.set(fila.profile_id, {
        groupName: grupo?.group_name ?? null,
        groupNumber: grupo?.group_number ?? null,
        miembroEstado: fila.estado,
      })
    }

    const users: ManagedUser[] = ((profileRows ?? []) as Array<{
      id: string
      full_name: string | null
      username: string | null
      auth_email: string | null
      role: ProfileRole
      driver_id: string | null
      access_status: 'pending' | 'active' | 'inactive' | null
    }>).map((user) => ({
      ...user,
      access_status: user.access_status ?? 'pending',
      groupName: gruposPorPersona.get(user.id)?.groupName ?? null,
      groupNumber: gruposPorPersona.get(user.id)?.groupNumber ?? null,
      miembroEstado: gruposPorPersona.get(user.id)?.miembroEstado ?? null,
      moduleAccess: ((accessRows ?? []) as Array<{
        user_id: string
        module_key: ModuleKey
      }>)
        .filter((access) => access.user_id === user.id)
        .map((access) => access.module_key),
    }))

    const existingEmails = new Set(
      users
        .map((user) => user.auth_email?.toLowerCase())
        .filter((email): email is string => Boolean(email)),
    )
    const requestOnlyUsers: ManagedUser[] = ((pendingRows ?? []) as PendingUserRow[])
      .filter((request) => !existingEmails.has(request.email.toLowerCase()))
      .map((request) => ({
        id: `request:${request.id}`,
        full_name: request.full_name,
        username: request.username,
        auth_email: request.email,
        role: 'viewer',
        driver_id: null,
        access_status: 'pending',
        moduleAccess: [],
        requestOnly: true,
      }))

    const allUsers = [...requestOnlyUsers, ...users]

    setManagedUsers(allUsers)
    setPendingRequests(
      allUsers
        .filter(
          (user) => user.access_status === 'pending',
        )
        .map((user) => ({
          id: user.id,
          full_name: user.full_name ?? user.username ?? 'Usuario sin nombre',
          email: user.auth_email ?? '',
        })),
    )
    } catch {
      if (request !== managedGeneration.current || authIdentity.current !== profileId) return
      setManagedUsersError('No pudimos actualizar los accesos. La lista puede estar desactualizada; volvé a intentar.')
    }
  }, [contexto, profile])

  useEffect(() => {
    if (canOpenAdminPanel(profile, contexto)) {
      void loadManagedUsers()
      return
    }

    setPendingRequests([])
    setManagedUsers([])
    setManagedUsersError(null)
  }, [contexto, loadManagedUsers, profile])

  const signUp = async (
    fullName: string,
    email: string,
    password: string,
    username?: string,
    groupCode?: string,
  ) => {
    if (!supabase) {
      return { error: 'Faltan las variables de entorno de Supabase.' }
    }

    const normalizedEmail = email.trim()
    const normalizedUsername = username?.trim() || normalizedEmail.split('@')[0]
    const codigo = groupCode?.trim().toUpperCase()

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          username: normalizedUsername,
        },
      },
    })

    if (error) {
      return { error: error.message }
    }

    if (codigo && data.session) {
      const { error: joinError } = await supabase.rpc('unirme_a_grupo', { p_codigo: codigo })
      if (joinError) {
        await supabase.auth.signOut()
        return {
          error: /ningún grupo|ningun grupo|22023/i.test(joinError.message)
            ? 'Ese código no es de ningún grupo. Fijate si lo copiaste bien.'
            : joinError.message,
        }
      }
      return { error: null, joined: true }
    }

    await supabase.auth.signOut()
    return { error: null, joined: false }
  }

  const approveUser = async (userId: string) => {
    return updateUserAccess(userId, 'viewer', [])
  }

  const updateUserAccess = async (
    userId: string,
    role: ProfileRole,
    modules: ModuleKey[],
    driverId?: string | null,
  ) => {
    if (!supabase || !canOpenAdminPanel(profile, contexto)) {
      return { error: 'No tiene permisos de admin.' }
    }
    if (role === 'admin' && !canManageAdministrators(profile, contexto)) {
      return { error: 'Sólo un superadmin puede administrar cuentas administrativas.' }
    }

    const { error } = await supabase.rpc('administrar_acceso', {
      p_user_id: userId, p_role: role, p_status: 'active',
      p_modules: Array.from(new Set(modules)), p_driver_id: driverId || null,
    })
    if (error) return { error: error.message }

    await loadManagedUsers()

    return { error: null }
  }

  const deactivateUser = async (userId: string) => {
    if (!supabase || !canOpenAdminPanel(profile, contexto)) {
      return { error: 'No tiene permisos de admin.' }
    }

    const { error } = await supabase.rpc('administrar_acceso', {
      p_user_id: userId, p_role: 'viewer', p_status: 'inactive',
      p_modules: [], p_driver_id: null,
    })
    if (error) return { error: error.message }

    await loadManagedUsers()

    return { error: null }
  }

  const canAccessModule = (moduleKey: ModuleKey) => hasModuleAccess(profile, moduleAccess, moduleKey, contexto)

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    isLoading,
    authError,
    retryAuth: () => setAuthAttempt((attempt) => attempt + 1),
    isAuthenticated: Boolean(session?.user),
    session,
    user: session?.user ?? null,
    profile,
    contexto,
    moduleAccess,
    isApproved,
    pendingRequests,
    managedUsers,
    managedUsersError,
    signIn,
    signUp,
    signOut,
    approveUser,
    loadManagedUsers,
    updateUserAccess,
    deactivateUser,
    canAccessModule,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
