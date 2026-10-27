/**
 * ERRORES DEL CLIENTE: LA LOGICA, SIN SUPABASE NI window
 *
 * Los hermanos no reportan bugs. Si el mapa falla en un telefono, hoy nadie
 * se entera. `reportarError.ts` cuelga esta logica de `window` y de la RPC
 * `reportar_error_cliente`; aca esta lo que se puede probar solo:
 *
 * - no mandar dos veces el mismo mensaje;
 * - no mandar mas de 20 por sesion (un error en un bucle no puede inundar);
 * - apagarse en silencio si la RPC todavia no existe en esa base;
 * - sacar de los textos emails, tokens, coordenadas y query strings.
 *
 * Nada de esto puede romper la app: ninguna funcion de aca lanza.
 */

export const MAX_REPORTES_POR_SESION = 20
export const MAX_MENSAJE = 500
export const MAX_PILA = 2000
export const MAX_RUTA = 200
export const MAX_VERSION = 40
export const MAX_USER_AGENT = 300

const SIN_MENSAJE = '(sin mensaje)'

/** ok: se guardo. error: no se pudo (red, sesion, tope del servidor). no_disponible: la RPC no existe. */
export type EstadoEnvio = 'ok' | 'error' | 'no_disponible'

export interface ReporteDeError {
  mensaje: string
  pila: string | null
  ruta: string
  version_app: string
  user_agent: string
}

export interface ContextoDelReporte {
  ruta: string
  version: string
  userAgent: string
}

export interface OpcionesDelReportero {
  enviar: (reporte: ReporteDeError) => Promise<EstadoEnvio>
  contexto: () => ContextoDelReporte
  maximoPorSesion?: number
}

export type VentanaConEventos = Pick<Window, 'addEventListener' | 'removeEventListener'>

// Mismas reglas, y en el mismo orden, que `errores_cliente_limpiar` en
// supabase/migrations/20261027151500_errores_cliente.sql. Si se cambia una,
// cambiar la otra: tests/sql-assertions.test.mjs compara las dos.
const PATRONES_A_LIMPIAR: ReadonlyArray<readonly [RegExp, string]> = [
  // Query y hash de URLs: ahi viajan codigos, tokens y filtros con datos.
  [/(https?:\/\/[^\s?#)"']+)[?#][^\s)"']*/g, '$1'],
  // JWT.
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]'],
  // Cadenas largas y opacas: claves, ids de sesion. Un UUID mide 36 y no entra.
  [/[A-Za-z0-9_-]{40,}/g, '[token]'],
  // Cuatro decimales o mas: la precision de una coordenada.
  [/(?<![0-9.])-?[0-9]{1,3}\.[0-9]{4,}(?![0-9])/g, '[coord]'],
]

// Avisos del navegador que no son fallas de la app y llenarian el tope de 20.
const IGNORADOS: readonly RegExp[] = [
  /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
]

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function recortar(texto: string, maximo: number): string {
  return texto.length > maximo ? texto.slice(0, maximo) : texto
}

export function limpiarTexto(texto: string): string {
  return PATRONES_A_LIMPIAR.reduce(
    (actual, [patron, reemplazo]) => actual.replace(patron, reemplazo),
    texto,
  )
}

/** Solo el camino: sin query ni hash, con los UUID reemplazados por :id. */
export function normalizarRuta(ruta: string): string {
  const soloCamino = ruta.split(/[?#]/)[0] || '/'
  return recortar(limpiarTexto(soloCamino.replace(UUID, ':id')), MAX_RUTA)
}

/** Saca mensaje y pila de lo que sea que haya llegado a `error` o `unhandledrejection`. */
export function describirError(valor: unknown): { mensaje: string; pila: string | null } {
  if (valor instanceof Error) {
    return { mensaje: valor.message || valor.name || SIN_MENSAJE, pila: valor.stack ?? null }
  }
  if (typeof valor === 'string') {
    return { mensaje: valor || SIN_MENSAJE, pila: null }
  }
  if (valor !== null && typeof valor === 'object') {
    // Errores de Supabase y de librerias: objetos con `message`. Se toma solo
    // message y code. `details` y `hint` pueden traer valores de filas.
    const { message, code, stack } = valor as { message?: unknown; code?: unknown; stack?: unknown }
    if (typeof message === 'string' && message) {
      return {
        mensaje: typeof code === 'string' && code ? `${code}: ${message}` : message,
        pila: typeof stack === 'string' ? stack : null,
      }
    }
  }
  return { mensaje: SIN_MENSAJE, pila: null }
}

/** La RPC no existe en esa base todavia: PostgREST responde 404 con PGRST202. */
export function esFuncionInexistente(error: { code?: string } | null | undefined, status?: number): boolean {
  return status === 404 || error?.code === 'PGRST202'
}

export function crearReportero(opciones: OpcionesDelReportero) {
  const maximo = opciones.maximoPorSesion ?? MAX_REPORTES_POR_SESION
  const vistos = new Set<string>()
  let enviados = 0
  let apagado = false

  async function reportar(valor: unknown, pilaAlternativa?: string): Promise<void> {
    if (apagado) return

    let reporte: ReporteDeError
    try {
      const { mensaje, pila } = describirError(valor)
      if (IGNORADOS.some((patron) => patron.test(mensaje))) return

      const mensajeLimpio = recortar(limpiarTexto(recortar(mensaje, 2000)), MAX_MENSAJE)
      if (vistos.has(mensajeLimpio)) return
      if (enviados >= maximo) return

      // Se anota antes de esperar la red: si llegan 50 errores juntos, el
      // tope y la deduplicacion ya cuentan los que estan en camino.
      vistos.add(mensajeLimpio)
      enviados += 1

      const contexto = opciones.contexto()
      const pilaCruda = pila ?? pilaAlternativa ?? ''
      reporte = {
        mensaje: mensajeLimpio,
        pila: pilaCruda ? recortar(limpiarTexto(recortar(pilaCruda, 6000)), MAX_PILA) : null,
        ruta: normalizarRuta(contexto.ruta),
        version_app: recortar(limpiarTexto(contexto.version), MAX_VERSION),
        user_agent: recortar(limpiarTexto(recortar(contexto.userAgent, 1000)), MAX_USER_AGENT),
      }
    } catch {
      return
    }

    let estado: EstadoEnvio
    try {
      estado = await opciones.enviar(reporte)
    } catch {
      estado = 'error'
    }
    if (estado === 'no_disponible') apagado = true
  }

  /** Engancha `error` y `unhandledrejection`. Devuelve la funcion que los suelta. */
  function instalar(ventana: VentanaConEventos): () => void {
    const alFallar = (evento: ErrorEvent) => {
      const donde = evento.filename ? `${evento.filename}:${evento.lineno}:${evento.colno}` : undefined
      void reportar(evento.error ?? evento.message, donde)
    }
    const alRechazar = (evento: PromiseRejectionEvent) => {
      void reportar(evento.reason)
    }
    ventana.addEventListener('error', alFallar)
    ventana.addEventListener('unhandledrejection', alRechazar)
    return () => {
      ventana.removeEventListener('error', alFallar)
      ventana.removeEventListener('unhandledrejection', alRechazar)
    }
  }

  return {
    reportar,
    instalar,
    estaApagado: () => apagado,
    cantidadEnviada: () => enviados,
  }
}
