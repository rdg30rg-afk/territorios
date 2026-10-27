import { Icono } from './Icono'
import { mensajeDeCopia, type CausaDeCopia } from '../lib/copiaDeMapa'
import { describirPrecarga, type EstadoPrecarga } from '../lib/teselasPrecarga'

/**
 * Cómo va el guardado del mapa para usar sin señal: "Guardando…", "Listo para
 * usar sin señal", o por qué no pudo ser. Cada estado lleva icono y palabras.
 */
export function EstadoMapaSinSenal({
  estado,
  onReintentar,
}: {
  estado: EstadoPrecarga
  onReintentar: () => void
}) {
  const vista = describirPrecarga(estado)
  return (
    <div className={`estadoSinSenal ${estado.fase}`} role="status" hidden={!vista}>
      {vista && (
        <>
          <Icono nombre={vista.icono} tamaño={24} className="estadoSinSenalIcono" />
          <span className="estadoSinSenalTexto">{vista.texto}</span>
          {vista.accion && (
            <button type="button" className="estadoSinSenalBoton" onClick={onReintentar}>
              <Icono nombre={vista.accion.icono} tamaño={22} />
              {vista.accion.etiqueta}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Se muestra cuando el mapa sale de la copia del teléfono y no de la base:
 * "Sin señal · mostrando lo guardado el 27 de octubre a las 14:05". Que se
 * note, porque los colores pueden estar atrasados.
 */
export function AvisoDeCopia({
  copia,
}: {
  copia: { guardadoEl: string; causa: CausaDeCopia } | null
}) {
  return (
    <div className="avisoCalle avisoSinSenal" role="status" hidden={!copia}>
      {copia && (
        <>
          <Icono nombre="sin-conexion" tamaño={24} className="avisoCalleIcono" />
          <span className="avisoCalleTexto">{mensajeDeCopia(copia.guardadoEl, copia.causa)}</span>
        </>
      )}
    </div>
  )
}
