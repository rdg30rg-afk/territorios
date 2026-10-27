import { Icono } from './Icono'
import { textoDeEnvio, type ModoDeEnvio } from '../lib/marcasPendientes'

/**
 * "3 marcas esperando señal" / "Todo enviado". Siempre con icono y palabras:
 * el color del aviso solo acompaña. Si algo se trabó y hay señal, ofrece
 * reintentar con un botón de 56 px.
 */
export function MarcasPendientes({
  modo,
  cantidad,
  conError,
  enLinea,
  onReintentar,
}: {
  modo: ModoDeEnvio
  cantidad: number
  conError: boolean
  enLinea: boolean
  onReintentar: () => void
}) {
  const frase = textoDeEnvio(modo, { cantidad, conError, enLinea })
  // La región vive siempre, aunque esté vacía (ver AvisoDeshacer).
  return (
    <div className={`avisoCalle marcasPendientes ${modo}`} role="status" hidden={!frase}>
      {frase && (
        <>
          <Icono nombre={frase.icono} tamaño={24} className="avisoCalleIcono" />
          <span className="avisoCalleTexto">{frase.texto}</span>
          {modo === 'pendientes' && conError && enLinea && (
            <button type="button" className="avisoCalleBoton" onClick={onReintentar}>
              <Icono nombre="rehacer" tamaño={22} />
              Reintentar
            </button>
          )}
        </>
      )}
    </div>
  )
}
