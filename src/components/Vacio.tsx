// La hoja va importada desde aca, igual que en Falta. La primera version
// no la traia y en Territorio Personal -- la unica pantalla que usa este
// componente sin usar tambien Falta-- .vacio quedaba en display:block:
// las dos frases se dibujaban encima, medido strongTop 313 y spanTop 313.
// El estilo viaja con quien lo usa; el mismo error, dos veces.
import '../styles/inicio-admin.css'

/**
 * CUANDO NO HAY NADA QUE MOSTRAR
 *
 * Las cinco listas decian lo mismo en los dos casos: "No hay conductores
 * para el filtro seleccionado". Pero son dos situaciones distintas y la
 * confusion cae siempre del lado peor:
 *
 *  - No hay ninguno cargado todavia. Es la PRIMERA pantalla que ve
 *    alguien nuevo, y el sistema le echaba la culpa a un filtro que nunca
 *    toco. Ahi lo que hace falta no es una explicacion sino decirle como
 *    cargar el primero.
 *  - Hay, pero el filtro los tapa. Ahi si hablar del filtro sirve, porque
 *    es lo que hay que soltar.
 *
 * `hay` es cuantos existen en total, no cuantos pasan el filtro.
 */
export function Vacio({
  hay,
  sinNada,
  comoEmpezar,
  filtrados,
}: {
  hay: number
  sinNada: string
  comoEmpezar?: string
  filtrados: string
}) {
  if (hay === 0) {
    return (
      <div className="status-card vacio">
        <strong>{sinNada}</strong>
        {comoEmpezar ? <span>{comoEmpezar}</span> : null}
      </div>
    )
  }

  return (
    <div className="status-card vacio">
      <strong>{filtrados}</strong>
      <span>Probá cambiando el filtro o el texto que buscás.</span>
    </div>
  )
}
