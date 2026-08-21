import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export function LoginPage() {
  const { isConfigured, isAuthenticated, isLoading, signIn } = useAuth()
  const location = useLocation()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectTo = location.state?.from?.pathname ?? '/'

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result = await signIn(login, password)
    setError(result.error)

    setIsSubmitting(false)
  }

  return (
    <div className="auth-layout">
      <section className="auth-card">
        <div className="auth-copy">
          <p className="eyebrow">Acceso seguro</p>
          <h2>Ingresar al gestor territorial</h2>
          <p className="lead">
            Ingresa con tu usuario o email y contraseña. Los permisos por
            modulo y rol siguen controlados desde Supabase.
          </p>
        </div>

        {!isConfigured ? (
          <div className="status-card">
            Completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env`
            para habilitar el acceso.
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Usuario o email
              <input
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder="Blade30$ o nombre@ejemplo.com"
                required
              />
            </label>

            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimo 6 caracteres"
                minLength={6}
                required
              />
            </label>

            {error ? <div className="form-feedback error">{error}</div> : null}

            <button type="submit" className="primary-button" disabled={isSubmitting || isLoading}>
              {isSubmitting ? 'Procesando...' : 'Ingresar'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
