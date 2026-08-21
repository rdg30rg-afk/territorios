import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export function AuthGuard() {
  const { isApproved, isConfigured, isLoading, isAuthenticated, profile, signOut } = useAuth()
  const location = useLocation()

  if (!isConfigured) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (isLoading) {
    return <div className="status-card">Cargando sesion segura...</div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!isApproved) {
    return (
      <div className="auth-layout">
        <section className="auth-card">
          <div className="auth-copy">
            <p className="eyebrow">Acceso pendiente</p>
            <h2>Tu usuario espera autorizacion</h2>
            <p className="lead">
              {profile
                ? 'Un administrador debe asignarte acceso a uno o mas modulos antes de entrar al sistema.'
                : 'Tu perfil se esta preparando. Si el mensaje persiste, avisa al administrador.'}
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void signOut()}>
            Cerrar sesion
          </button>
        </section>
      </div>
    )
  }

  return <Outlet />
}
