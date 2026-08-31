import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AuthGuard } from './components/AuthGuard'
import { ModuleGuard } from './components/ModuleGuard'
import { ConductoresPage } from './pages/ConductoresPage'
import { DashboardPage } from './pages/DashboardPage'
import { GruposPage } from './pages/GruposPage'
import { LoginPage } from './pages/LoginPage'
import { MapasPage } from './pages/MapasPage'
import { SalidasGrupoPage } from './pages/SalidasGrupoPage'
import { SalidasPage } from './pages/SalidasPage'
import { TerritorioPersonalPage } from './pages/TerritorioPersonalPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route element={<ModuleGuard moduleKey="mapas" />}>
            <Route path="mapas" element={<MapasPage />} />
          </Route>
          <Route element={<ModuleGuard moduleKey="conductores" />}>
            <Route path="conductores" element={<ConductoresPage />} />
          </Route>
          <Route element={<ModuleGuard moduleKey="grupos" />}>
            <Route path="grupos" element={<GruposPage />} />
          </Route>
          <Route element={<ModuleGuard moduleKey="salidas" />}>
            <Route path="salidas" element={<SalidasPage />} />
          </Route>
          <Route element={<ModuleGuard moduleKey="salidas_grupo" />}>
            <Route path="salidas-grupo" element={<SalidasGrupoPage />} />
          </Route>
          <Route element={<ModuleGuard moduleKey="territorio_personal" />}>
            <Route path="territorio-personal" element={<TerritorioPersonalPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
