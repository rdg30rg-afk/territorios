import type { Session } from '@supabase/supabase-js'
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  AuthContext,
  type AuthContextValue,
  type ManagedUser,
  type ModuleKey,
  type PendingUserRequest,
  type Profile,
  type ProfileRole,
} from './AuthTypes'

const PRIMARY_LOGIN_ALIAS = 'Blade30$'
const PRIMARY_LOGIN_EMAIL = 'blade30@territorios.app'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [moduleAccess, setModuleAccess] = useState<ModuleKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pendingRequests, setPendingRequests] = useState<PendingUserRequest[]>([])
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([])

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false)
      return
    }

    const client = supabase

    let mounted = true

    const hydrateUser = async (activeSession: Session | null) => {
      if (!mounted) {
        return
      }

      setSession(activeSession)

      if (!activeSession?.user) {
        setProfile(null)
        setModuleAccess([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)

      const [{ data: profileRow }, { data: accessRows }] = await Promise.all([
        client
          .from('profiles')
          .select('id, full_name, role, driver_id')
          .eq('id', activeSession.user.id)
          .maybeSingle(),
        client
          .from('user_module_access')
          .select('module_key')
          .eq('user_id', activeSession.user.id),
      ])

      if (!mounted) {
        return
      }

      setProfile(profileRow ?? null)
      setModuleAccess(
        (accessRows ?? [])
          .map((row) => row.module_key)
          .filter(
            (value): value is ModuleKey =>
              value === 'mapas' ||
              value === 'conductores' ||
              value === 'grupos' ||
              value === 'salidas',
          ),
      )
      setIsLoading(false)
    }

    client.auth.getSession().then(({ data }) => {
      void hydrateUser(data.session)
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, activeSession) => {
      void hydrateUser(activeSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (login: string, password: string) => {
    if (!supabase) {
      return { error: 'Faltan las variables de entorno de Supabase.' }
    }

    const trimmedLogin = login.trim()
    let email = trimmedLogin

    if (!trimmedLogin.includes('@')) {
      if (trimmedLogin.toLowerCase() === PRIMARY_LOGIN_ALIAS.toLowerCase()) {
        email = PRIMARY_LOGIN_EMAIL
      } else {
        const { data, error } = await supabase.rpc('resolve_login_email', {
          login_identifier: trimmedLogin,
        })

        if (error) {
          return { error: 'Usuario no encontrado.' }
        }

        if (!data) {
          return { error: 'Usuario no encontrado.' }
        }

        email = data
      }
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

    await supabase.auth.signOut()
  }

  const isApproved = Boolean(
    profile?.role === 'admin' || (profile && moduleAccess.length > 0),
  )

  const loadManagedUsers = useCallback(async () => {
    if (!supabase || profile?.role !== 'admin') {
      setManagedUsers([])
      return
    }

    const [{ data: profileRows, error: profileError }, { data: accessRows, error: accessError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, auth_email, role, driver_id')
          .order('created_at', { ascending: false }),
        supabase.from('user_module_access').select('user_id, module_key'),
      ])

    if (profileError || accessError) {
      console.error(profileError?.message ?? accessError?.message)
      return
    }

    const users = ((profileRows ?? []) as Array<{
      id: string
      full_name: string | null
      username: string | null
      auth_email: string | null
      role: ProfileRole
      driver_id: string | null
    }>).map((user) => ({
      ...user,
      moduleAccess: ((accessRows ?? []) as Array<{
        user_id: string
        module_key: ModuleKey
      }>)
        .filter((access) => access.user_id === user.id)
        .map((access) => access.module_key),
    }))

    setManagedUsers(users)
    setPendingRequests(
      users
        .filter((user) => user.role !== 'admin' && user.moduleAccess.length === 0)
        .map((user) => ({
          id: user.id,
          full_name: user.full_name ?? user.username ?? 'Usuario sin nombre',
          email: user.auth_email ?? '',
        })),
    )
  }, [profile?.role])

  // Compatibilidad con la vista anterior: pendientes = usuarios sin modulos.
  const loadPendingRequests = useCallback(async () => {
    if (!supabase || profile?.role !== 'admin') {
      setPendingRequests([])
      return
    }

    await loadManagedUsers()
  }, [loadManagedUsers, profile?.role])

  useEffect(() => {
    if (profile?.role === 'admin') {
      void loadManagedUsers()
      void loadPendingRequests()
      return
    }

    setPendingRequests([])
    setManagedUsers([])
  }, [loadManagedUsers, loadPendingRequests, profile?.role])

  const signUp = async (fullName: string, email: string, password: string, username?: string) => {
    if (!supabase) {
      return { error: 'Faltan las variables de entorno de Supabase.' }
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          username: username?.trim() || email.trim().split('@')[0],
        },
      },
    })

    if (error) {
      return { error: error.message }
    }

    await supabase.auth.signOut()

    return { error: null }
  }

  const approveUser = async (userId: string) => {
    return updateUserAccess(userId, 'viewer', ['mapas'])
  }

  const updateUserAccess = async (
    userId: string,
    role: ProfileRole,
    modules: ModuleKey[],
    driverId?: string | null,
  ) => {
    if (!supabase || profile?.role !== 'admin') {
      return { error: 'No tiene permisos de admin.' }
    }

    const profileUpdate: { role: ProfileRole; driver_id?: string | null } = { role }

    if (driverId !== undefined) {
      profileUpdate.driver_id = driverId || null
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update(profileUpdate)
      .eq('id', userId)

    if (profileError) {
      return { error: profileError.message }
    }

    const { error: deleteAccessError } = await supabase
      .from('user_module_access')
      .delete()
      .eq('user_id', userId)

    if (deleteAccessError) {
      return { error: deleteAccessError.message }
    }

    const uniqueModules = Array.from(new Set(modules))

    if (uniqueModules.length > 0) {
      const { error: insertAccessError } = await supabase
        .from('user_module_access')
        .insert(
          uniqueModules.map((moduleKey) => ({
            user_id: userId,
            module_key: moduleKey,
          })),
        )

      if (insertAccessError) {
        return { error: insertAccessError.message }
      }
    }

    await loadManagedUsers()

    return { error: null }
  }

  const deactivateUser = async (userId: string) =>
    updateUserAccess(userId, 'viewer', [], null)

  const canAccessModule = (moduleKey: ModuleKey) => {
    if (profile?.role === 'admin') {
      return true
    }

    return moduleAccess.includes(moduleKey)
  }

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    isLoading,
    isAuthenticated: Boolean(session?.user),
    session,
    user: session?.user ?? null,
    profile,
    moduleAccess,
    isApproved,
    pendingRequests,
    managedUsers,
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
