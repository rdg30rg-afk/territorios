import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { modules } from '../data/modules'
import { usePwaInstall } from '../hooks/usePwaInstall'

export function AppShell() {
  const { profile, user, signOut, canAccessModule, moduleAccess } = useAuth()
  const { canInstall, isInstalled, isInstalling, promptInstall } = usePwaInstall()
  const visibleModules = modules.filter((module) => {
    if (module.key === 'dashboard') {
      return true
    }

    return profile?.role === 'admin' || canAccessModule(module.key)
  })

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-panel">
          <p className="eyebrow">Territorios</p>
          <h1>Gestor territorial</h1>
          <p className="brand-copy">
            Base del MVP para administrar mapas, conductores, grupos y salidas
            desde web, PWA o APK.
          </p>
        </div>

        <nav className="module-nav" aria-label="Modulos principales">
          {visibleModules.map((module) => (
            <NavLink
              key={module.path}
              to={module.path}
              className={({ isActive }) =>
                isActive ? 'module-link active' : 'module-link'
              }
              end={module.path === '/'}
            >
              <span className="module-icon" aria-hidden="true">
                {module.icon}
              </span>
              <span>
                <strong>{module.title}</strong>
                <small>{module.summary}</small>
              </span>
            </NavLink>
          ))}
        </nav>

        <section className="user-card">
          <p className="eyebrow">Sesion</p>
          <strong>{profile?.full_name || user?.email || 'Usuario'}</strong>
          <small>
            Rol: {profile?.role ?? 'pendiente'} · Modulos:{' '}
            {profile?.role === 'admin'
              ? 'todos'
              : moduleAccess.length > 0
                ? moduleAccess.join(', ')
                : 'sin acceso asignado'}
          </small>
          <button type="button" className="ghost-button" onClick={() => void signOut()}>
            Cerrar sesion
          </button>
        </section>

        <section className="security-card">
          <p className="eyebrow">Acceso seguro</p>
          <ul>
            <li>Login con Supabase Auth</li>
            <li>Roles por modulo</li>
            <li>Reglas RLS en base de datos</li>
          </ul>
        </section>

        <section className="install-card">
          <p className="eyebrow">Instalacion</p>
          <strong>{isInstalled ? 'App instalada' : 'Usala como aplicacion'}</strong>
          <p className="brand-copy">
            {isInstalled
              ? 'Esta sesion ya puede abrirse en modo app independiente.'
              : canInstall
                ? 'Instala esta PWA para abrirla desde el telefono o la PC sin depender del navegador.'
                : 'Si el navegador lo permite, aqui aparecera la opcion para instalar la app.'}
          </p>
          <button
            type="button"
            className="ghost-button"
            disabled={!canInstall || isInstalling || isInstalled}
            onClick={() => void promptInstall()}
          >
            {isInstalled
              ? 'Instalada'
              : isInstalling
                ? 'Abriendo instalacion...'
                : 'Instalar app'}
          </button>
        </section>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
