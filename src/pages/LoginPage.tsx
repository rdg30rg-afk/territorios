import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

const getFriendlyAuthError = (error: string | null) => {
  if (!error) {
    return null
  }

  if (error.toLowerCase().includes('email not confirmed')) {
    return 'El email todavia no fue confirmado en Supabase. Primero debe confirmar el correo recibido o un administrador debe marcarlo como confirmado en Authentication.'
  }

  return error
}

export function LoginPage() {
  const { isConfigured, isAuthenticated, isLoading, signIn, signUp } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectTo = location.state?.from?.pathname ?? '/'

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    const result = await signIn(login, password)
    setError(getFriendlyAuthError(result.error))

    setIsSubmitting(false)
  }

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    const result = await signUp(fullName, email, password, username)

    if (result.error) {
      setError(result.error)
    } else {
      setMessage('Solicitud enviada. Un administrador debe autorizar tu acceso.')
      setMode('login')
      setFullName('')
      setUsername('')
      setEmail('')
      setPassword('')
    }

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
          <>
            <div className="auth-mode-tabs">
              <button
                type="button"
                className={mode === 'login' ? 'active' : ''}
                onClick={() => {
                  setMode('login')
                  setError(null)
                }}
              >
                Ingresar
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setMode('register')
                  setError(null)
                }}
              >
                Solicitar acceso
              </button>
            </div>

            {mode === 'login' ? (
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
                {message ? <div className="form-feedback success">{message}</div> : null}

                <button type="submit" className="primary-button" disabled={isSubmitting || isLoading}>
                  {isSubmitting ? 'Procesando...' : 'Ingresar'}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleRegister}>
                <label>
                  Nombre completo
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Ej. Juan Perez"
                    required
                  />
                </label>

                <label>
                  Usuario
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Ej. jperez"
                    required
                  />
                </label>

                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="nombre@ejemplo.com"
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
                  {isSubmitting ? 'Enviando...' : 'Enviar solicitud'}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  )
}
