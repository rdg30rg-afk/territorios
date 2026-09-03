import { SanJuanMap } from '../components/SanJuanMap'

/**
 * MAPAS Y TERRITORIOS
 *
 * Quien entra: el que arma los territorios, en la PC, a dibujar o a
 * buscar uno. Viene a ver el mapa. La unica accion es tocar un
 * territorio de la lista, o dibujar uno nuevo.
 *
 * Antes esta pantalla tenia, debajo del mapa, dos paneles que explicaban
 * la aplicacion: "Como usarlo: selecciona un territorio desde la tabla
 * superior" y "Formato de guardado: GeoJSON listo para crecer". El
 * primero describia el boton que estaba tres centimetros mas arriba; el
 * segundo nombraba el formato del archivo, que es un detalle de adentro
 * del sistema y no cambia ninguna decision de nadie. Los dos ocupaban la
 * mitad de la pantalla debajo del mapa. El mapa es la pantalla.
 */
export function MapasPage() {
  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h2>Mapas y Territorios</h2>
          <p className="lead">
            Buscá un territorio en la lista para verlo, o dibujá uno nuevo sobre el mapa.
          </p>
        </div>
      </section>

      <SanJuanMap />
    </div>
  )
}
