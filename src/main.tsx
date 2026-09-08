import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import './styles/theme-hermano.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'

// Un worker instalado por una compilacion anterior puede seguir respondiendo
// navegaciones de 127.0.0.1 aunque Vite tenga el PWA desactivado en desarrollo.
// Eso deja al navegador con HTML/CSS viejos mientras el codigo del repo ya es
// otro. En DEV limpiamos solamente el almacenamiento del origen local; el
// worker publicado en Estracom no entra en este bloque.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  const limpiarCaches = 'caches' in window
    ? caches.keys().then((claves) => Promise.all(claves.map((clave) => caches.delete(clave))))
    : Promise.resolve([])
  void Promise.all([
    navigator.serviceWorker.getRegistrations()
      .then((registros) => Promise.all(registros.map((registro) => registro.unregister()))),
    limpiarCaches,
  ]).catch(() => {
    // La limpieza es preventiva: nunca debe impedir que arranque la app local.
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
