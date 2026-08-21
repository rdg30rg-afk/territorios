import { SanJuanMap } from '../components/SanJuanMap'

export function MapasPage() {
  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Modulo 1</p>
          <h2>Mapas y Territorios</h2>
          <p className="lead">
            Vista operativa para PC: buscar territorios, revisar la biblioteca,
            dibujar poligonos sobre San Juan y guardar cada zona en la nube.
          </p>
        </div>
      </section>

      <SanJuanMap />

      <section className="two-column-grid">
        <article className="panel">
          <p className="eyebrow">Como usarlo</p>
          <h3>Listado + mapa</h3>
          <p>
            Selecciona un territorio desde la tabla superior o pulsa `Nuevo
            territorio` para activar la herramienta de poligono y empezar a
            delimitar la zona.
          </p>
        </article>

        <article className="panel">
          <p className="eyebrow">Formato de guardado</p>
          <h3>GeoJSON listo para crecer</h3>
          <p>
            Cada territorio se almacena como un poligono GeoJSON, listo para
            reutilizarse despues en asignaciones, filtros, salidas o reportes.
          </p>
        </article>
      </section>
    </div>
  )
}
