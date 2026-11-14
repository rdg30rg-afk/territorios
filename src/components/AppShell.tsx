import { useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { modules } from '../data/modules'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { canOpenAdminPanel } from '../lib/access'
import { Icono } from './Icono'
import { SimboloTerritorios } from './SimboloTerritorios'

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
  const { profile, contexto, user, signOut, canAccessModule, moduleAccess } = useAuth()
  const { canInstall, isInstalled, isInstalling, promptInstall } = usePwaInstall()
  const adminPanel = canOpenAdminPanel(profile, contexto)
  const visibleModules = modules.filter((module) => {
    if (module.key === 'dashboard') {
      return true
    }

    return adminPanel || canAccessModule(module.key)
  })

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="mobile-admin-header">
          <span>Territorios</span>
          <button ref={menuButton} type="button" aria-expanded={menuOpen}
            aria-controls="admin-navigation" onClick={() => setOpenAt(menuOpen ? null : location.key)}
            onKeyDown={event => { if (event.key === 'Escape') setOpenAt(null) }}>
            <Icono nombre={menuOpen ? 'cerrar' : 'menu'} tamaño={18} />
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
        <div className="brand-panel">
          <div className="marca-territorios">
            <SimboloTerritorios tamaño={40} />
            <div>
              <h1>Territorios</h1>
              <p className="brand-copy">Congregación San Juan</p>
            </div>
          </div>
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
                <Icono nombre={module.icon} tamaño={25} />
              </span>
              <span>
                <strong>{module.title}</strong>
                <small>{module.summary}</small>
              </span>
            </NavLink>
          ))}
        </nav>

        <NavLink to="/predicacion" className="module-link vista-hermano-link">
          <span className="module-icon" aria-hidden="true">
            <Icono nombre="persona" tamaño={25} />
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
            {adminPanel
              ? 'acceso completo'
              : moduleAccess.length > 0
                ? moduleAccess.map((clave) => moduloNombre[clave] ?? clave).join(', ')
                : 'sin acceso asignado'}
          </small>
          <button type="button" className="ghost-button" onClick={() => void signOut()}>
            <Icono nombre="cerrar" tamaño={18} />
            Cerrar sesión
          </button>
        </section>

        {/* La invitacion a instalar vive en un desplegable cerrado: no es una
            decision del dia. Antes compartia lugar con un cartel de "Base de
            prueba" que era falso (esta base es la de verdad) y se quito. */}
        {canInstall && !isInstalled ? (
          <details className="sidebar-extras">
            <summary>Ajustes de la app</summary>

            {canInstall && !isInstalled ? (
              <button
                type="button"
                className="ghost-button"
                disabled={isInstalling}
                onClick={() => void promptInstall()}
              >
                <Icono nombre="descargar" tamaño={18} />
                {isInstalling ? 'Abriendo instalación…' : 'Instalar como aplicación'}
              </button>
            ) : null}
          </details>
        ) : null}
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
