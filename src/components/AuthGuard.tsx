import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { Icono } from './Icono'

export function AuthGuard() {
  const { isApproved, isConfigured, isLoading, isAuthenticated, profile, signOut, authError, retryAuth } = useAuth()
  const location = useLocation()

  if (!isConfigured) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (isLoading) {
    return (
      <div className="auth-guard-loading" aria-busy="true">
        <span className="auth-guard-loading-mark" aria-hidden="true"><Icono nombre="pendiente" tamaño={28} /></span>
      </div>
    )
  }

  if (authError) return (
    <div className="auth-layout"><section className="auth-card">
      <h2>No pudimos comprobar tu acceso</h2>
      <p role="alert">{authError}</p>
      <button className="primary-button" onClick={retryAuth}><Icono nombre="rehacer" tamaño={18} />Volver a intentar</button>
      <button className="secondary-button" onClick={() => void signOut()}><Icono nombre="cerrar" tamaño={18} />Cerrar sesión</button>
    </section></div>
  )

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!isApproved) {
    if (profile?.access_status === 'pending' && location.pathname === '/predicacion') {
      return <Outlet />
    }
    if (profile?.access_status === 'pending') {
      return <Navigate to="/predicacion" replace />
    }
    return (
      <div className="auth-layout">
        <section className="auth-card">
          <div className="auth-copy">
            <p className="eyebrow">{profile?.access_status === 'inactive' ? 'Acceso suspendido' : 'Acceso pendiente'}</p>
            <h2>{profile?.access_status === 'inactive' ? 'Tu cuenta está inactiva' : 'Tu usuario espera autorización'}</h2>
            <p className="lead">
              {profile?.access_status === 'inactive'
                ? 'Hablá con un administrador si necesitás volver a entrar.'
                : profile ? 'Si tenés el código de tu grupo, andá a Predicación y ponelo: entrás al instante. Si no, un administrador tiene que autorizarte.'
                : 'Tu perfil se está preparando. Si el mensaje persiste, avisá al administrador.'}
            </p>
          </div>
          <button type="button" className="primary-button" onClick={retryAuth}><Icono nombre="rehacer" tamaño={18} />Comprobar de nuevo</button>
          <button type="button" className="secondary-button" onClick={() => void signOut()}>
            <Icono nombre="cerrar" tamaño={18} />
            Cerrar sesión
          </button>
        </section>
      </div>
    )
  }

  return <Outlet />
}
