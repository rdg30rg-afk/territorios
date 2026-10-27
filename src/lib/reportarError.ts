/**
 * ERRORES DEL CLIENTE A UNA TABLA
 *
 * Se importa una sola vez, al principio de `main.tsx`, y listo: desde ahi
 * escucha `error` (window.onerror) y `unhandledrejection` y manda cada falla
 * a la RPC `reportar_error_cliente`, que la guarda en `errores_cliente`
 * (solo la leen los administradores).
 *
 * Que se manda: mensaje, pila, ruta SIN query ni hash, version de la app y
 * user agent, todo truncado y sin emails, tokens ni coordenadas. Que NO se
 * manda: nada de lo que hay en pantalla, ni formularios, ni el usuario.
 *
 * Reglas (viven en reportarErrorNucleo.ts y estan probadas):
 * - el mismo mensaje se manda una sola vez;
 * - como maximo 20 por sesion;
 * - si la RPC todavia no existe en esa base (404 o PGRST202) se apaga sola,
 *   sin ruido en la consola;
 * - sin sesion iniciada no se manda nada (la RPC es solo para `authenticated`).
 */
import { supabase } from './supabase'
import {
  crearReportero,
  esFuncionInexistente,
  type EstadoEnvio,
  type ReporteDeError,
} from './reportarErrorNucleo'

// La define el build con VITE_APP_VERSION (o VITE_APP_COMMIT). Hoy ninguno la
// pone: el reporte dice "sin-version" y la fecha ubica la publicacion.
const VERSION_DE_LA_APP = String(
  import.meta.env.VITE_APP_VERSION ?? import.meta.env.VITE_APP_COMMIT ?? 'sin-version',
)

async function enviar(reporte: ReporteDeError): Promise<EstadoEnvio> {
  if (!supabase) return 'no_disponible'
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return 'error'
    const { error, status } = await supabase.rpc('reportar_error_cliente', {
      p_mensaje: reporte.mensaje,
      p_pila: reporte.pila,
      p_ruta: reporte.ruta,
      p_version_app: reporte.version_app,
      p_user_agent: reporte.user_agent,
    })
    if (!error) return 'ok'
    return esFuncionInexistente(error, status) ? 'no_disponible' : 'error'
  } catch {
    return 'error'
  }
}

export const reportero = crearReportero({
  enviar,
  contexto: () => ({
    ruta: window.location.pathname,
    version: VERSION_DE_LA_APP,
    userAgent: navigator.userAgent,
  }),
})

/** Para avisar a mano de un error que se atrapo (por ejemplo en un catch). */
export function reportarError(error: unknown): void {
  void reportero.reportar(error)
}

// Una sola instalacion aunque el modulo se evalue dos veces (recarga en caliente).
const MARCA = '__territoriosReportarErrorInstalado'
if (typeof window !== 'undefined') {
  const ventana = window as unknown as Record<string, unknown>
  if (!ventana[MARCA]) {
    ventana[MARCA] = true
    reportero.instalar(window)
  }
}
