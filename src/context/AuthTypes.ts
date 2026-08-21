import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type ProfileRole =
  | 'admin'
  | 'superintendente'
  | 'siervo'
  | 'conductor'
  | 'viewer'

export type ModuleKey = 'mapas' | 'conductores' | 'grupos' | 'salidas'

export type Profile = {
  id: string
  full_name: string | null
  role: ProfileRole
}

export type PendingUserRequest = {
  id: string
  full_name: string
  email: string
}

export type AuthContextValue = {
  isConfigured: boolean
  isLoading: boolean
  isAuthenticated: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  moduleAccess: ModuleKey[]
  pendingRequests: PendingUserRequest[]
  signIn: (login: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    fullName: string,
    email: string,
    password: string,
    username?: string,
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  approveUser: (userId: string) => Promise<{ error: string | null }>
  canAccessModule: (moduleKey: ModuleKey) => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
