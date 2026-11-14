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

// Mensajes que escribe Postgres en inglés para quien programa. Un mensaje
// que NO se parece a esto lo escribió una función de la base a propósito
// (en castellano, pensado para la persona) y se muestra tal cual.
const ESTILO_POSTGRES =
  /violates|duplicate key|constraint|relation ".*"|column ".*"|null value|invalid input|syntax error|does not exist|could not|schema cache|permission denied|row-level security|jwt|failed to fetch|networkerror|load failed|timeout|unexpected|undefined|\bfunction\b.*\b(arguments|exist)/i

/** Pasa cualquier cosa que se haya lanzado (Error, objeto de Supabase, texto) a la forma que entiende decirElError. */
export function comoErrorDeLaBase(valor: unknown): ErrorDeLaBase {
  if (!valor) return null
  if (typeof valor === 'string') return { message: valor }
  if (typeof valor === 'object') {
    const objeto = valor as { message?: unknown; code?: unknown; details?: unknown }
    return {
      message: typeof objeto.message === 'string' ? objeto.message : undefined,
      code: typeof objeto.code === 'string' ? objeto.code : undefined,
      details: typeof objeto.details === 'string' ? objeto.details : undefined,
    }
  }
  return null
}

export function decirElError(error: ErrorDeLaBase, queSeIntentaba?: string): string {
  if (!error) return 'Algo falló y no se pudo guardar.'

  const codigo = error.code ?? ''
  const texto = (error.message ?? '').trim()
  const esDePostgres = ESTILO_POSTGRES.test(texto)

  // Sesión vencida.
  if (codigo === 'PGRST303' || /jwt expired/i.test(texto)) {
    return 'Se venció la sesión. Volvé a entrar y probá de nuevo; lo que escribiste sigue en pantalla.'
  }

  // Sin red.
  if (/failed to fetch|networkerror|load failed/i.test(texto)) {
    return 'No se pudo llegar a la base. Fijate si tenés internet y probá de nuevo.'
  }

  // Permisos: RLS rechazó la operación. Si la función de la base explicó el
  // motivo en castellano ("No tenés permiso para cambiar el código") vale más.
  if (codigo === '42501' || /row-level security|permission denied/i.test(texto)) {
    return texto && !esDePostgres
      ? texto
      : 'Tu usuario no tiene permiso para esto. Pediselo a un administrador.'
  }

  // La columna o la tabla no existe: falta aplicar una migración.
  if (codigo === '42703' || codigo === '42P01') {
    return 'Esta parte de la base todavía no está creada en este entorno. Falta aplicar una migración.'
  }

  // Clave foránea y unicidad: el genérico solo cuando el mensaje es el crudo
  // de Postgres. Si la función de la base explicó qué pasa ("Esa persona ya
  // tiene un territorio"), eso es mejor que cualquier genérico.
  if (codigo === '23503') {
    return texto && !esDePostgres
      ? texto
      : 'No se puede borrar porque hay salidas o grupos que lo están usando. Sacalo de ahí primero.'
  }
  if (codigo === '23505') {
    return texto && !esDePostgres ? texto : 'Ya existe uno con esos datos.'
  }

  // Mensaje técnico que no reconocemos: no se lo mostramos a nadie en inglés.
  if (!texto || esDePostgres) {
    return queSeIntentaba
      ? `${queSeIntentaba} Probá de nuevo y, si sigue igual, avisale a un administrador.`
      : 'No se pudo completar. Probá de nuevo y, si sigue igual, avisale a un administrador.'
  }

  return queSeIntentaba ? `${queSeIntentaba} ${texto}` : texto
}
