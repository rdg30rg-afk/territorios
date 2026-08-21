const moduleStatus = [
  {
    name: 'Mapas y Territorios',
    detail: 'Mapa inicial listo. Falta dibujo y guardado de poligonos.',
  },
  {
    name: 'Conductores',
    detail: 'Vista modelo preparada para alta y listado.',
  },
  {
    name: 'Grupos para el Servicio',
    detail: 'Base para perfiles de superintendente y siervo.',
  },
  {
    name: 'Salidas',
    detail: 'Modelo listo para usar puntos de encuentro geolocalizados.',
  },
]

export function DashboardPage() {
  return (
    <div className="page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">MVP fase 1</p>
          <h2>Sistema modular con foco en territorios y salidas</h2>
          <p className="lead">
            Esta base ya esta preparada para crecer como web y APK, usando una
            sola aplicacion conectada a una base de datos en la nube, y ahora
            tambien puede instalarse como PWA.
          </p>
        </div>

        <div className="hero-highlight">
          <span>Arquitectura sugerida</span>
          <strong>React + Capacitor + Supabase + MapLibre</strong>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <p className="eyebrow">Base de datos</p>
          <strong>Supabase</strong>
          <span>PostgreSQL con Auth y reglas RLS</span>
        </article>
        <article className="stat-card">
          <p className="eyebrow">Mapa</p>
          <strong>OpenStreetMap</strong>
          <span>Visualizacion de San Juan con MapLibre</span>
        </article>
        <article className="stat-card">
          <p className="eyebrow">Publicacion</p>
          <strong>Web + PWA + APK</strong>
          <span>Un solo codigo para navegador, instalacion web y Android</span>
        </article>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Modulos</p>
            <h3>Estado inicial del producto</h3>
          </div>
        </div>

        <div className="checklist">
          {moduleStatus.map((item) => (
            <article key={item.name} className="list-card">
              <strong>{item.name}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
