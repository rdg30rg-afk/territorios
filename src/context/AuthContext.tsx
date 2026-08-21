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
  type ModuleKey,
  type PendingUserRequest,
  type Profile,
} from './AuthTypes'

const PRIMARY_LOGIN_ALIAS = 'Blade30$'
const PRIMARY_LOGIN_EMAIL = 'blade30@territorios.app'

// Solicitudes de alta de usuarios pendientes
const PENDING_USERS_TABLE = 'pending_users'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [moduleAccess, setModuleAccess] = useState<ModuleKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pendingRequests, setPendingRequests] = useState<PendingUserRequest[]>([])

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
          .select('id, full_name, role')
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

  // Cargar solicitudes de alta pendientes (solo admin)
  const loadPendingRequests = useCallback(async () => {
    if (!supabase || profile?.role !== 'admin') {
      return
    }

    const { data, error } = await supabase
      .from(PENDING_USERS_TABLE)
      .select('id, full_name, email')
      .order('requested_at', { ascending: false })

    if (error) {
      console.error(error.message)
      return
    }

    setPendingRequests(data ?? [])
  }, [profile?.role])

  useEffect(() => {
    if (profile?.role === 'admin') {
      void loadPendingRequests()
      return
    }

    setPendingRequests([])
  }, [loadPendingRequests, profile?.role])

  // Solicitar alta de usuario (nuevo usuario solicita acceso)
  const signUp = async (fullName: string, email: string, password: string, username?: string) => {
    if (!supabase) {
      return { error: 'Faltan las variables de entorno de Supabase.' }
    }

    void password

    // Insertar en tabla de solicitudes pendientes
    const { error: insertError } = await supabase
      .from(PENDING_USERS_TABLE)
      .insert({
        full_name: fullName.trim(),
        email: email.trim(),
        username: username?.trim(),
      })

    if (insertError) {
      return { error: insertError.message }
    }

    return { error: null }
  }

  // Aprobar solicitud de alta (solo admin): crea usuario en auth.users y perfil en DB
  const approveUser = async (userId: string) => {
    if (!supabase || profile?.role !== 'admin') {
      return { error: 'No tiene permisos de admin.' }
    }

    // 1. Obtener datos del solicitante de pending_users
    const { data: pendingUser, error: fetchError } = await supabase
      .from(PENDING_USERS_TABLE)
      .select('full_name, email, username')
      .eq('id', userId)
      .single()

    if (fetchError) {
      return { error: fetchError.message }
    }

    if (!pendingUser) {
      return { error: 'Solicitud no encontrada.' }
    }

    // 2. Crear usuario en auth.users
    const { error: authError } = await supabase.auth.signUp({
      email: pendingUser.email,
      password: 'TempPass123!', // El usuario deberá cambiar esto al primer ingreso
      options: {
        data: {
          full_name: pendingUser.full_name,
          username: pendingUser.username || pendingUser.email.split('@')[0],
        },
      },
    })

    if (authError) {
      return { error: authError.message }
    }

    // 3. El trigger handle_new_user en auth.users debería crear el perfil automáticamente
    // Ya que insertamos full_name y username en los datos, el trigger los procesará

    // 4. Eliminar de pending_users
    const { error: deleteError } = await supabase
      .from(PENDING_USERS_TABLE)
      .delete()
      .eq('id', userId)

    if (deleteError) {
      return { error: deleteError.message }
    }

    // Recargar solicitudes
    await loadPendingRequests()

    return { error: null }
  }

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
    pendingRequests,
    signIn,
    signUp,
    signOut,
    approveUser,
    canAccessModule,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
