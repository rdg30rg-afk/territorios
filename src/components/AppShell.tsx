import { useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { modules } from '../data/modules'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { isDevelopmentEnvironment } from '../lib/supabase'

const moduloNombre: Record<string, string> = {
  mapas: 'Mapas',
  conductores: 'Conductores',
  grupos: 'Grupos',
  salidas: 'Salidas',
  salidas_grupo: 'Salidas del grupo',
  territorio_personal: 'Territorio personal',
}

export function AppShell() {
  const location = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const menuOpen = openAt === location.key
  const menuButton = useRef<HTMLButtonElement>(null)
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
        <div className="mobile-admin-header">
          <span>Territorios{isDevelopmentEnvironment && <small>Base de prueba</small>}</span>
          <button ref={menuButton} type="button" aria-expanded={menuOpen}
            aria-controls="admin-navigation" onClick={() => setOpenAt(menuOpen ? null : location.key)}
            onKeyDown={event => { if (event.key === 'Escape') setOpenAt(null) }}>
            {menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          </button>
        </div>
        <div id="admin-navigation" className={`sidebar-menu${menuOpen ? ' is-open' : ''}`}
          onKeyDown={event => {
            if (event.key === 'Escape' && menuOpen) {
              setOpenAt(null)
              menuButton.current?.focus()
            }
          }}
          onClick={event => {
            if (menuOpen && (event.target as HTMLElement).closest('a')) {
              setOpenAt(null)
              menuButton.current?.focus()
            }
          }}>
        {isDevelopmentEnvironment && (
          <section className="security-card development-environment-card">
            <p className="eyebrow">Base de prueba</p>
            <strong>Entorno de desarrollo</strong>
            <p className="brand-copy">
              Lo que toques aca no afecta a la base de verdad.
            </p>
          </section>
        )}

        <div className="brand-panel">
          <p className="eyebrow">Territorios</p>
          <h1>Gestor territorial</h1>
          <p className="brand-copy">Congregacion San Juan</p>
        </div>

        <nav className="module-nav" aria-label="Módulos principales">
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

        {profile?.role === 'admin' && (
          /* Documento aparte, no una ruta de React: por eso <a> y no
             NavLink. Comparte origen y sesion con la app. */
          <a href="/editor-manzanas.html" className="module-link" target="_blank" rel="noopener">
            <span className="module-icon" aria-hidden="true">
              ▤
            </span>
            <span>
              <strong>Editor de manzanas</strong>
              <small>Dibujar manzanas y arreglar sus cuadras. Se abre aparte.</small>
            </span>
          </a>
        )}

        {profile?.role === 'admin' && (
          <NavLink to="/importacion" className="module-link">
            <span className="module-icon" aria-hidden="true">
              ⇪
            </span>
            <span>
              <strong>Revisión del Excel</strong>
              <small>Lo importado, antes de que entre.</small>
            </span>
          </NavLink>
        )}

        <NavLink to="/predicacion" className="module-link vista-hermano-link">
          <span className="module-icon" aria-hidden="true">
            ◆
          </span>
          <span>
            <strong>Vista del hermano</strong>
            <small>Lo que ve un publicador en el teléfono.</small>
          </span>
        </NavLink>

        <section className="user-card">
          <p className="eyebrow">Sesión</p>
          <strong>{profile?.full_name || user?.email || 'Usuario'}</strong>
          <small>
            Rol: {profile?.role ?? 'pendiente'} · Módulos:{' '}
            {profile?.role === 'admin'
              ? 'acceso completo'
              : moduleAccess.length > 0
                ? moduleAccess.map((clave) => moduloNombre[clave] ?? clave).join(', ')
                : 'sin acceso asignado'}
          </small>
          <button type="button" className="ghost-button" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
        </section>

        {canInstall && !isInstalled ? (
          <section className="install-card">
            <p className="eyebrow">Instalación</p>
            <strong>Usala como aplicación</strong>
            <p className="brand-copy">
              Instalála para abrirla desde el teléfono o la PC sin pasar por el navegador.
            </p>
            <button
              type="button"
              className="ghost-button"
              disabled={isInstalling}
              onClick={() => void promptInstall()}
            >
              {isInstalling ? 'Abriendo instalación…' : 'Instalar app'}
            </button>
          </section>
        ) : null}
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
