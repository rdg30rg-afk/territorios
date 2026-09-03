import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AuthGuard } from './components/AuthGuard'
import { ModuleGuard } from './components/ModuleGuard'
import { LoginPage } from './pages/LoginPage'

const ConductoresPage = lazy(() =>
  import('./pages/ConductoresPage').then((module) => ({
    default: module.ConductoresPage,
  })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
)
const GruposPage = lazy(() =>
  import('./pages/GruposPage').then((module) => ({
    default: module.GruposPage,
  })),
)
const ImportacionPage = lazy(() =>
  import('./pages/ImportacionPage').then((module) => ({
    default: module.ImportacionPage,
  })),
)
const MapasPage = lazy(() =>
  import('./pages/MapasPage').then((module) => ({ default: module.MapasPage })),
)
const SalidasGrupoPage = lazy(() =>
  import('./pages/SalidasGrupoPage').then((module) => ({
    default: module.SalidasGrupoPage,
  })),
)
const SalidasPage = lazy(() =>
  import('./pages/SalidasPage').then((module) => ({ default: module.SalidasPage })),
)
const PredicacionPage = lazy(() =>
  import('./pages/PredicacionPage').then((module) => ({
    default: module.PredicacionPage,
  })),
)
const TerritorioPersonalPage = lazy(() =>
  import('./pages/TerritorioPersonalPage').then((module) => ({
    default: module.TerritorioPersonalPage,
  })),
)

function loadRoute(element: ReactNode) {
  return (
    <Suspense fallback={<div className="status-card">Cargando modulo...</div>}>
      {element}
    </Suspense>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        {/* Fuera del AppShell a proposito: la vista del hermano tiene sus
            propias pestanias abajo, y dos navegaciones a la vez no son
            navegacion. Sin ModuleGuard: es la pantalla de cualquier
            publicador, y cada seccion muestra su estado vacio si RLS no le
            deja leer esos datos. */}
        <Route path="predicacion" element={loadRoute(<PredicacionPage />)} />
        <Route element={<AppShell />}>
          <Route index element={loadRoute(<DashboardPage />)} />
          {/* Sin ModuleGuard: no es un modulo, es del admin. La pagina se
              guarda sola y el RLS del staging solo deja leer a un admin. */}
          <Route path="importacion" element={loadRoute(<ImportacionPage />)} />
          <Route element={<ModuleGuard moduleKey="mapas" />}>
            <Route path="mapas" element={loadRoute(<MapasPage />)} />
          </Route>
          <Route element={<ModuleGuard moduleKey="conductores" />}>
            <Route path="conductores" element={loadRoute(<ConductoresPage />)} />
          </Route>
          <Route element={<ModuleGuard moduleKey="grupos" />}>
            <Route path="grupos" element={loadRoute(<GruposPage />)} />
          </Route>
          <Route element={<ModuleGuard moduleKey="salidas" />}>
            <Route path="salidas" element={loadRoute(<SalidasPage />)} />
          </Route>
          <Route element={<ModuleGuard moduleKey="salidas_grupo" />}>
            <Route path="salidas-grupo" element={loadRoute(<SalidasGrupoPage />)} />
          </Route>
          <Route element={<ModuleGuard moduleKey="territorio_personal" />}>
            <Route
              path="territorio-personal"
              element={loadRoute(<TerritorioPersonalPage />)}
            />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
