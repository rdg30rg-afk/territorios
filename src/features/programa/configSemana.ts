/**
 * La semana de la congregación, leída y escrita en la base.
 *
 * La app viaja en dos entregas: primero el cliente, después el esquema. Por eso
 * esto devuelve `null` cuando las tablas todavía no existen —o cuando están
 * vacías— y la pantalla sigue andando con la semana que tiene en el código.
 * Una lista vacía no es una semana sin salidas: es una semana sin cargar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConfigSemana, Turno } from '../../lib/programa.ts'

/** Los códigos con los que Postgres y PostgREST avisan que la tabla no está. */
const NO_EXISTE = new Set(['42P01', 'PGRST205', 'PGRST106'])

export class FaltaLaMigracion extends Error {
  constructor() {
    super('La semana todavía no vive en la base: falta aplicar la migración.')
    this.name = 'FaltaLaMigracion'
  }
}

/** Postgres devuelve '09:30:00'; la pantalla usa '09:30'. */
function horaCorta(valor: unknown): string {
  return typeof valor === 'string' ? valor.slice(0, 5) : ''
}

export async function cargarConfigSemana(
  client: SupabaseClient,
): Promise<ConfigSemana | null> {
  const [horarios, titulares, telefono, grupos] = await Promise.all([
    client.from('programa_horarios').select('dow, turno, hora'),
    client.from('programa_titulares').select('dow, turno, orden, conductor_id').order('orden'),
    client.from('programa_telefono').select('dow, hora'),
    client.from('programa_grupos').select('dow, hora'),
  ])

  const errores = [horarios.error, titulares.error, telefono.error, grupos.error]
  if (errores.some((e) => e && NO_EXISTE.has(e.code ?? ''))) return null
  if (errores.some(Boolean)) return null

  const config: ConfigSemana = { horarios: {}, titulares: {}, telefono: [], grupos: [] }
  for (const fila of (horarios.data ?? []) as Array<{ dow: number; turno: Turno; hora: string }>) {
    config.horarios[`${fila.dow}-${fila.turno}`] = horaCorta(fila.hora)
  }
  for (const fila of (titulares.data ?? []) as Array<{
    dow: number
    turno: string
    conductor_id: string
  }>) {
    const clave = `${fila.dow}-${fila.turno}`
    config.titulares[clave] = [...(config.titulares[clave] ?? []), fila.conductor_id]
  }
  config.telefono = ((telefono.data ?? []) as Array<{ dow: number; hora: string }>).map((d) => ({
    dow: d.dow,
    hora: horaCorta(d.hora),
  }))
  config.grupos = ((grupos.data ?? []) as Array<{ dow: number; hora: string }>).map((d) => ({
    dow: d.dow,
    hora: horaCorta(d.hora),
  }))

  /* Sin ningún turno cargado no es una semana: es una tabla recién creada. */
  const sinTurnos =
    Object.keys(config.horarios).length === 0 &&
    config.telefono.length === 0 &&
    config.grupos.length === 0
  return sinTurnos ? null : config
}

export async function guardarConfigSemana(
  client: SupabaseClient,
  config: ConfigSemana,
): Promise<void> {
  const horarios = Object.entries(config.horarios).map(([clave, hora]) => {
    const [dow, turno] = clave.split('-')
    return { dow: Number(dow), turno, hora }
  })
  const titulares = Object.entries(config.titulares).flatMap(([clave, ids]) => {
    const [dow, turno] = clave.split('-')
    return ids.map((conductorId, indice) => ({
      dow: Number(dow),
      turno,
      orden: indice + 1,
      conductor_id: conductorId,
    }))
  })

  const { error } = await client.rpc('guardar_programa_semanal', {
    p_horarios: horarios,
    p_titulares: titulares,
    p_telefono: config.telefono,
    p_grupos: config.grupos,
  })
  if (error) {
    if (NO_EXISTE.has(error.code ?? '') || /could not find the function/i.test(error.message)) {
      throw new FaltaLaMigracion()
    }
    throw error
  }
}
