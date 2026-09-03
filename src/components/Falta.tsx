// La hoja se importa desde aca y no desde cada pagina: este componente usa
// .falta, .inicio-cuantos y .inicio-texto, y sin esta linea se renderizaba
// pelado en todo modulo que no fuera el Inicio -- que era el unico que la
// importaba. Medido en /salidas: grid-template-columns "none", fondo
// transparente, 24px de alto. El estilo viaja con quien lo usa.
import '../styles/inicio-admin.css'

/**
 * LO QUE FALTA EN ESTA PANTALLA
 *
 * El Inicio abre diciendo que espera una decision tuya. Cada modulo abre
 * igual, con lo mismo pero de lo suyo: el mismo objeto, en el mismo
 * lugar, con el numero adelante. Que se repita es el punto -- se aprende
 * una vez y sirve en las siete pantallas.
 *
 * Antes cada modulo abria con cuatro cifras (Total, Activos, Pendientes,
 * Inactivos) donde el Total era la suma de las otras tres. Contar no es
 * informar: la unica cifra que vale es la que dice que hay algo por
 * hacer. Si no hay nada, esto no aparece -- no se muestra un cero.
 *
 * `varios` lleva {n} donde va el numero.
 */
export function Falta({
  cuantos,
  uno,
  varios,
  detalle,
}: {
  cuantos: number
  uno: string
  varios: string
  detalle?: string
}) {
  if (!cuantos) return null

  return (
    <p className="falta">
      <span className="inicio-cuantos">{cuantos}</span>
      <span className="inicio-texto">
        <strong>{cuantos === 1 ? uno : varios.replace('{n}', String(cuantos))}</strong>
        {detalle ? <small>{detalle}</small> : null}
      </span>
    </p>
  )
}
