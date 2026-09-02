import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const productionSupabaseRef = import.meta.env.VITE_PRODUCTION_SUPABASE_REF

export const appEnvironment = import.meta.env.VITE_APP_ENV ?? 'production'
export const isDevelopmentEnvironment = appEnvironment === 'development'

if (
  isDevelopmentEnvironment &&
  productionSupabaseRef &&
  supabaseUrl?.includes(`${productionSupabaseRef}.supabase.co`)
) {
  throw new Error(
    'Configuracion bloqueada: el entorno de desarrollo no puede conectarse a Supabase de produccion.',
  )
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
