import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { accessLanding } from '../lib/access'
import { normalizarCodigoGrupo } from '../lib/vistaHermano'
import { Icono } from '../components/Icono'

const getFriendlyAuthError = (error: string | null) => {
  if (!error) {
    return null
  }

  if (error.toLowerCase().includes('email not confirmed')) {
    return 'Todavía falta confirmar el email. Abrí el correo de Territorios y tocá “Confirmar email”.'
  }

  return error
}

export function LoginPage() {
  const { isConfigured, isAuthenticated, isLoading, signIn, signUp, profile, moduleAccess } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [groupCode, setGroupCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('confirmado') === '1'
      ? 'Email confirmado. Ya podés ingresar con tu usuario y contraseña.'
      : null,
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectTo = accessLanding(profile, moduleAccess, location.state?.from?.pathname)

  if (isAuthenticated && !isLoading) {
    return <Navigate to={redirectTo} replace />
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const result = await signIn(login, password)
      setError(getFriendlyAuthError(result.error))
    } catch {
      setError('No pudimos ingresar. Revisá la conexión y volvé a intentar.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const result = await signUp(fullName, email, password, username, groupCode)
      if (result.error) {
        setError(result.error)
      } else if (result.joined) {
        setMessage('Entraste al grupo. Ya podés ver el programa.')
        setFullName('')
        setUsername('')
        setEmail('')
        setPassword('')
        setGroupCode('')
      } else {
        setMessage('Te enviamos un email para confirmar la cuenta. Después volvé e ingresá con tu usuario y contraseña.')
        setMode('login')
        setFullName('')
        setUsername('')
        setEmail('')
        setPassword('')
        setGroupCode('')
      }
    } catch {
      setError('No pudimos confirmar el envío. Revisá la conexión antes de volver a intentar.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-card">
        <div className="auth-copy">
          <p className="eyebrow">Territorios</p>
          <h2>Entrá a tu cuenta</h2>
          <p className="lead">
            Usá tu usuario o email y tu contraseña para ver el programa y tu territorio.
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
                aria-pressed={mode === 'login'}
                disabled={isSubmitting}
                onClick={() => {
                  setMode('login')
                  setError(null)
                }}
              >
                <Icono nombre="persona" tamaño={18} />
                Ingresar
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'active' : ''}
                aria-pressed={mode === 'register'}
                disabled={isSubmitting}
                onClick={() => {
                  setMode('register')
                  setError(null)
                }}
              >
                <Icono nombre="reservar" tamaño={18} />
                Solicitar acceso
              </button>
            </div>

            {mode === 'login' ? (
              <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                  Usuario o email
                  <input
                    value={login}
                    autoComplete="username"
                    autoCapitalize="none"
                    onChange={(event) => setLogin(event.target.value)}
                    placeholder="usuario o nombre@ejemplo.com"
                    required
                  />
                </label>

                <label>
                  Contraseña
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimo 6 caracteres"
                    minLength={6}
                    required
                  />
                </label>

                {error ? <div className="form-feedback error" role="alert">{error}</div> : null}
                {message ? <div className="form-feedback success" role="status">{message}</div> : null}

                <button type="submit" className="primary-button" disabled={isSubmitting || isLoading}>
                  <Icono nombre="persona" tamaño={18} />
                  {isSubmitting ? 'Procesando...' : 'Ingresar'}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleRegister}>
                <label>
                  Nombre completo
                  <input
                    value={fullName}
                    autoComplete="name"
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Ej. Juan Perez"
                    required
                  />
                </label>

                <label>
                  Usuario
                  <input
                    value={username}
                    autoComplete="username"
                    autoCapitalize="none"
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Ej. jperez"
                    required
                  />
                </label>

                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
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
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimo 6 caracteres"
                    minLength={6}
                    required
                  />
                </label>

                <label>
                  Código de tu grupo (opcional)
                  <input
                    value={groupCode}
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={6}
                    onChange={(event) => setGroupCode(normalizarCodigoGrupo(event.target.value))}
                    placeholder="Te lo pasa el superintendente"
                  />
                </label>

                {error ? <div className="form-feedback error" role="alert">{error}</div> : null}

                <button type="submit" className="primary-button" disabled={isSubmitting || isLoading}>
                  <Icono nombre="reservar" tamaño={18} />
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
