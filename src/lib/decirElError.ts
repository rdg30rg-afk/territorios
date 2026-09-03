/**
 * DECIR QUE PASO, NO REPETIR LO QUE DIJO POSTGRES
 *
 * Los once lugares que informan un error mostraban `error.message` tal
 * cual. Eso es un mensaje escrito para quien programa: dice
 * 'insert or update on table "salidas" violates foreign key constraint
 * "salidas_driver_id_fkey"'. Quien lo lee no sabe que hacer con eso.
 *
 * La regla es que el mensaje diga QUE PASA y COMO SALIR. Cuando el codigo
 * no se reconoce se muestra el original: inventar una explicacion que no
 * corresponde es peor que mostrar algo tecnico, porque manda a la persona
 * a buscar donde no es.
 */
type ErrorDeLaBase = { message?: string; code?: string; details?: string } | null | undefined

export function decirElError(error: ErrorDeLaBase, queSeIntentaba?: string): string {
  if (!error) return 'Algo fallo y no se pudo guardar.'

  const codigo = error.code ?? ''
  const texto = error.message ?? ''

  // Clave foranea: se quiere borrar algo que otra cosa esta usando.
  if (codigo === '23503') {
    return 'No se puede borrar porque hay salidas o grupos que lo estan usando. Sacalo de ahi primero.'
  }

  // Unicidad.
  if (codigo === '23505') {
    return 'Ya existe uno con esos datos.'
  }

  // Sesion vencida.
  if (codigo === 'PGRST303' || /jwt expired/i.test(texto)) {
    return 'Se vencio la sesion. Volve a entrar y probá de nuevo; lo que escribiste sigue en pantalla.'
  }

  // Permisos: RLS rechazo la operacion.
  if (codigo === '42501' || /row-level security|permission denied/i.test(texto)) {
    return 'Tu usuario no tiene permiso para esto. Pediselo a un administrador.'
  }

  // La columna o la tabla no existe: falta aplicar una migracion.
  if (codigo === '42703' || codigo === '42P01') {
    return 'Esta parte de la base todavia no esta creada en este entorno. Falta aplicar una migracion.'
  }

  // Sin red.
  if (/failed to fetch|networkerror/i.test(texto)) {
    return 'No se pudo llegar a la base. Fijate si tenes internet y probá de nuevo.'
  }

  return queSeIntentaba ? `${queSeIntentaba} ${texto}` : texto
}
