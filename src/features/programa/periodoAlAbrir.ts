import { aClaveFecha, crearEstadoPrograma, periodoVigente } from '../../lib/programaRango.ts'

type PeriodoGuardado = { preset: string; desde: string; hasta: string }

/** Lo que el borrador tiene cargado, por fecha (las claves empiezan con AAAA-MM-DD). */
type BorradorConFechas = {
  filas?: Record<string, unknown>
  extras?: Record<string, unknown>
  dias?: Record<string, unknown>
  orden?: Record<string, unknown>
}

function borradorTocaElPeriodo(borrador: BorradorConFechas | null | undefined, p: PeriodoGuardado): boolean {
  if (!borrador) return false
  return [borrador.filas, borrador.extras, borrador.dias, borrador.orden].some((grupo) =>
    Object.keys(grupo ?? {}).some((clave) => {
      const fecha = clave.slice(0, 10)
      return fecha >= p.desde && fecha <= p.hasta
    }),
  )
}

/**
 * Qué período abre el Programa.
 *
 * `periodoVigente` conserva el período guardado en el borrador mientras no haya
 * pasado entero; eso es lo que hacía abrir «16 nov – 29 nov» un viernes 13
 * (quedó de otra sesión) en vez de la semana en curso, que todavía tenía
 * días por delante.
 *
 * Acá se afina: un período guardado que empieza DESPUÉS de hoy solo se conserva
 * si hay algo armado adentro (trabajo sin guardar que no conviene esconder).
 * Si no, se abre en la semana en curso, o en la próxima si ya es domingo.
 */
export function periodoAlAbrir<T extends PeriodoGuardado>(
  guardado: T | null | undefined,
  borrador: BorradorConFechas | null | undefined,
  hoy = new Date(),
): T | ReturnType<typeof crearEstadoPrograma> {
  const vigente = periodoVigente(guardado, hoy) as T | ReturnType<typeof crearEstadoPrograma>
  if (guardado && vigente === guardado && guardado.desde > aClaveFecha(hoy) && !borradorTocaElPeriodo(borrador, guardado)) {
    return crearEstadoPrograma(hoy)
  }
  return vigente
}
