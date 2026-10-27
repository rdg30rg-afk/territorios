import { Icono } from './Icono'
import { TEXTO_DESHECHO, type MarcaReciente } from '../lib/deshacerMarca'

/**
 * "Marcaste la manzana B · Deshacer". Aviso de abajo, de 56 px, que dura 8
 * segundos: un toque de más con el pulgar se arregla acá, sin buscar la línea
 * en el mapa. Después de deshacer queda un "Listo" unos segundos y nada más.
 *
 * El tiempo lo maneja quien lo usa (así sobrevive a que el aviso cambie de
 * lugar cuando se abre el mapa grande).
 */
export function AvisoDeshacer({
  marca,
  onDeshacer,
}: {
  marca: MarcaReciente | null
  onDeshacer: () => void
}) {
  // La región vive siempre: un role="status" que aparece junto con su texto
  // no se anuncia. Vacía y oculta no ocupa lugar.
  return (
    <div className="avisoCalle avisoDeshacer" role="status" hidden={!marca}>
      {marca?.fase === 'reciente' && (
        <>
          <Icono nombre="completo" tamaño={24} className="avisoCalleIcono" />
          <span className="avisoCalleTexto">{marca.texto}</span>
          <button type="button" className="avisoCalleBoton" onClick={onDeshacer}>
            <Icono nombre="deshacer" tamaño={22} />
            Deshacer
          </button>
        </>
      )}
      {marca?.fase === 'deshecha' && (
        <>
          <Icono nombre="deshacer" tamaño={24} className="avisoCalleIcono" />
          <span className="avisoCalleTexto">{TEXTO_DESHECHO}</span>
        </>
      )}
    </div>
  )
}
