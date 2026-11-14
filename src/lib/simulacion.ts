import type { AccessContext, Profile } from '../context/AuthTypes'

/**
 * Modo simulación: para recorrer la app contra la base real, como otro rol,
 * sin romper lo que ya existe.
 *
 * Solo se enciende si el servidor de desarrollo arranca con
 * VITE_SIMULACION=1 (la configuración «simulacion» de .claude/launch.json).
 * En el sitio publicado esa variable no existe y nada de esto corre.
 *
 * La regla del candado: se puede crear, y se puede tocar lo que se creó
 * durante la simulación. Lo que ya existía no se modifica ni se borra. Las
 * marcas del territorio personal pasan, porque son de quien inició sesión.
 *
 * `?como=publicador|conductor|super` muestra la pantalla como ese rol y
 * `?soy=Nombre` cambia el nombre que se ve. Es solo la vista: los permisos
 * con que la base contesta siguen siendo los de la sesión real.
 */
export const modoSimulacion = import.meta.env.VITE_SIMULACION === '1'

export type RolSimulado = 'publicador' | 'conductor' | 'super'

const CLAVE_ROL = 'simulacion:como'
const CLAVE_NOMBRE = 'simulacion:soy'
const CLAVE_CREADOS = 'simulacion:creados'
const CLAVE_BITACORA = 'simulacion:bitacora'

function esRol(valor: string | null): valor is RolSimulado {
  return valor === 'publicador' || valor === 'conductor' || valor === 'super'
}

function leerPersonaje(): { rol: RolSimulado | null; nombre: string | null } {
  if (!modoSimulacion || typeof window === 'undefined') return { rol: null, nombre: null }
  try {
    const pedido = new URLSearchParams(window.location.search)
    const como = pedido.get('como')
    if (como === 'admin') sessionStorage.removeItem(CLAVE_ROL)
    else if (esRol(como)) sessionStorage.setItem(CLAVE_ROL, como)
    const soy = pedido.get('soy')?.trim()
    if (soy) sessionStorage.setItem(CLAVE_NOMBRE, soy.slice(0, 60))
    const rol = sessionStorage.getItem(CLAVE_ROL)
    return { rol: esRol(rol) ? rol : null, nombre: sessionStorage.getItem(CLAVE_NOMBRE) }
  } catch {
    return { rol: null, nombre: null }
  }
}

// Se decide una vez por carga de la pestaña: las redirecciones del router
// pierden el `?como=`, y el personaje no puede cambiar a mitad de un recorrido.
const personaje = leerPersonaje()

type Vista = { profile: Profile | null; contexto: AccessContext | null }
let ultima: { de: Vista; vista: Vista } | null = null

/**
 * Devuelve el perfil y el contexto como los vería el personaje de la pestaña.
 * Para el mismo par de entrada devuelve siempre los mismos objetos, así toda
 * la app comparte una sola identidad de perfil.
 */
export function verComo(profile: Profile | null, contexto: AccessContext | null): Vista {
  if (ultima && ultima.de.profile === profile && ultima.de.contexto === contexto) return ultima.vista
  const vista = armarVista(profile, contexto)
  ultima = { de: { profile, contexto }, vista }
  return vista
}

function armarVista(profile: Profile | null, contexto: AccessContext | null): Vista {
  if (!modoSimulacion || !profile || (!personaje.rol && !personaje.nombre)) {
    return { profile, contexto }
  }
  const nombre = personaje.nombre ?? profile.full_name
  if (!personaje.rol) {
    return {
      profile: { ...profile, full_name: nombre },
      contexto: contexto ? { ...contexto, full_name: nombre } : contexto,
    }
  }
  const conduce = personaje.rol === 'conductor'
  const esSuper = personaje.rol === 'super'
  const rolViejo = conduce ? 'conductor' : esSuper ? 'superintendente' : 'viewer'
  const driverId = conduce ? profile.driver_id : null
  return {
    profile: { ...profile, full_name: nombre, role: rolViejo, system_role: 'miembro', driver_id: driverId },
    contexto: contexto
      ? {
          ...contexto,
          full_name: nombre,
          role: rolViejo,
          system_role: 'miembro',
          driver_id: driverId,
          es_conductor: conduce,
          es_super_de_grupo: esSuper,
          rol_en_grupo: contexto.group_id ? (esSuper ? 'superintendente' : 'publicador') : contexto.rol_en_grupo,
          puede_administrar_grupo: esSuper,
          puede_informar_salidas: conduce || esSuper,
          puede_abrir_panel: false,
          puede_administrar_admins: false,
        }
      : contexto,
  }
}

// ── El candado ────────────────────────────────────────────────────────────

type Veredicto =
  | { tipo: 'lectura' }
  | { tipo: 'permitida'; registrar: boolean; pedirFila?: boolean }
  | { tipo: 'bloqueada'; motivo: string; estado?: number }

const RPC_QUE_SOLO_LEEN = new Set([
  'resolve_login_email',
  'conductores_disponibles_para_salida_grupo',
  'territorios_disponibles_para_grupo',
])
const RPC_QUE_CREAN = new Set(['crear_salida', 'crear_salidas_lote', 'reportar_error_cliente'])
/** RPC que tocan una salida: solo pasan si la salida nació en la simulación. */
const RPC_SOBRE_UNA_SALIDA = new Set(['editar_salida', 'borrar_salida', 'informar_resultado_salida'])
/** Tablas donde se puede dar de alta una fila de prueba y después tocarla. */
const TABLAS_DE_PRUEBA = new Set(['conductores', 'grupos_servicio'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function leerLista(clave: string): unknown[] {
  try {
    const valor = JSON.parse(localStorage.getItem(clave) ?? '[]')
    return Array.isArray(valor) ? valor : []
  } catch {
    return []
  }
}

function creados(): Set<string> {
  return new Set(leerLista(CLAVE_CREADOS).filter((id): id is string => typeof id === 'string'))
}

function recordarCreados(cuerpo: unknown) {
  const nuevos: string[] = []
  const mirar = (valor: unknown) => {
    if (typeof valor === 'string' && UUID.test(valor)) nuevos.push(valor)
    else if (valor && typeof valor === 'object' && 'id' in valor) mirar((valor as { id: unknown }).id)
  }
  if (Array.isArray(cuerpo)) cuerpo.forEach(mirar)
  else mirar(cuerpo)
  if (!nuevos.length) return
  try {
    localStorage.setItem(CLAVE_CREADOS, JSON.stringify([...new Set([...creados(), ...nuevos])]))
  } catch {
    // Sin registro, lo creado queda protegido como si ya existiera.
  }
}

function idsDelFiltro(url: URL): string[] | null {
  const filtro = url.searchParams.get('id')
  if (!filtro) return null
  const ids = filtro.startsWith('eq.')
    ? [filtro.slice(3)]
    : filtro.startsWith('in.(')
      ? filtro.slice(4, -1).split(',').map((id) => id.replace(/"/g, '').trim())
      : null
  return ids && ids.length && ids.every((id) => UUID.test(id)) ? ids : null
}

function juzgar(url: URL, metodo: string, cuerpo: string | null): Veredicto {
  const ruta = url.pathname
  const lee = metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS'

  if (ruta.startsWith('/auth/v1/')) {
    if (lee || ruta === '/auth/v1/token') return { tipo: 'lectura' }
    // Un 500 hace que el cliente conserve la sesión en vez de cerrarla.
    if (ruta === '/auth/v1/logout') return { tipo: 'bloqueada', motivo: 'no se cierra la sesión compartida', estado: 500 }
    return { tipo: 'bloqueada', motivo: 'no se crean ni se cambian cuentas' }
  }

  if (ruta.startsWith('/rest/v1/rpc/')) {
    const nombre = ruta.slice('/rest/v1/rpc/'.length)
    if (RPC_QUE_SOLO_LEEN.has(nombre)) return { tipo: 'lectura' }
    if (RPC_QUE_CREAN.has(nombre)) return { tipo: 'permitida', registrar: true }
    let datos: Record<string, unknown> = {}
    try {
      datos = cuerpo ? (JSON.parse(cuerpo) as Record<string, unknown>) : {}
    } catch {
      return { tipo: 'bloqueada', motivo: 'no se pudo leer el pedido' }
    }
    const salida = typeof datos.p_salida_id === 'string' ? datos.p_salida_id : null
    if (RPC_SOBRE_UNA_SALIDA.has(nombre)) {
      return salida && creados().has(salida)
        ? { tipo: 'permitida', registrar: false }
        : { tipo: 'bloqueada', motivo: 'esa salida ya existía antes de la simulación' }
    }
    if (nombre === 'informar_cobertura') {
      if (datos.p_origen === 'app_hermano' && !salida) return { tipo: 'permitida', registrar: false }
      if (datos.p_origen === 'cierre_salida' && salida && creados().has(salida)) {
        return { tipo: 'permitida', registrar: false }
      }
      return { tipo: 'bloqueada', motivo: 'esa cobertura es de una salida que ya existía' }
    }
    return { tipo: 'bloqueada', motivo: 'cambia datos de personas o del programa real' }
  }

  if (ruta.startsWith('/rest/v1/')) {
    if (lee) return { tipo: 'lectura' }
    const tabla = ruta.slice('/rest/v1/'.length)
    if (!TABLAS_DE_PRUEBA.has(tabla)) return { tipo: 'bloqueada', motivo: 'esa tabla no admite pruebas' }
    if (metodo === 'POST') return { tipo: 'permitida', registrar: true, pedirFila: true }
    const ids = idsDelFiltro(url)
    const propios = creados()
    return (metodo === 'PATCH' || metodo === 'DELETE') && ids && ids.every((id) => propios.has(id))
      ? { tipo: 'permitida', registrar: false }
      : { tipo: 'bloqueada', motivo: 'esa fila ya existía antes de la simulación' }
  }

  return lee ? { tipo: 'lectura' } : { tipo: 'bloqueada', motivo: 'escritura fuera de lo previsto' }
}

const cuenta = { guardados: 0, bloqueados: 0 }

function anotar(metodo: string, url: URL, resultado: string, detalle: string) {
  if (resultado === 'bloqueado') cuenta.bloqueados += 1
  else if (resultado === 'guardado') cuenta.guardados += 1
  const renglon = {
    cuando: new Date().toISOString(),
    quien: personaje.nombre ?? personaje.rol ?? 'sesión real',
    metodo,
    ruta: url.pathname + (url.searchParams.get('id') ? `?id=${url.searchParams.get('id')}` : ''),
    resultado,
    detalle,
  }
  try {
    localStorage.setItem(CLAVE_BITACORA, JSON.stringify([...leerLista(CLAVE_BITACORA), renglon].slice(-600)))
  } catch {
    // La bitácora es para revisar después; nunca frena la app.
  }
  console.info(`[simulación] ${resultado}: ${metodo} ${renglon.ruta}${detalle ? ` — ${detalle}` : ''}`)
  pintarInsignia()
}

function pintarInsignia() {
  if (typeof document === 'undefined' || !document.body) return
  let insignia = document.getElementById('insignia-simulacion')
  if (!insignia) {
    insignia = document.createElement('div')
    insignia.id = 'insignia-simulacion'
    insignia.setAttribute('aria-hidden', 'true')
    insignia.style.cssText =
      'position:fixed;top:3px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;' +
      'font:600 11px/1.2 system-ui,sans-serif;padding:3px 9px;border-radius:999px;background:#7c2d12;' +
      'color:#fff;opacity:.92;white-space:nowrap'
    document.body.appendChild(insignia)
  }
  insignia.textContent =
    `Simulación${personaje.rol ? ` · ${personaje.rol}` : ''} · ` +
    `${cuenta.guardados} guardados · ${cuenta.bloqueados} bloqueados`
}

let instalada = false

/** Pone el candado sobre `fetch`. Hay que llamarlo antes de crear el cliente. */
export function instalarSimulacion(supabaseUrl: string) {
  if (!modoSimulacion || instalada || typeof window === 'undefined') return
  instalada = true
  const origenBase = new URL(supabaseUrl).origin
  const original = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const esPedido = typeof Request !== 'undefined' && input instanceof Request
    const url = new URL(esPedido ? input.url : String(input), window.location.href)
    if (url.origin !== origenBase) return original(input, init)

    const metodo = (init?.method ?? (esPedido ? input.method : 'GET')).toUpperCase()
    const cuerpo = typeof init?.body === 'string' ? init.body : null
    const veredicto = juzgar(url, metodo, cuerpo)
    if (veredicto.tipo === 'lectura') return original(input, init)

    // Nunca se anota el cuerpo de un pedido de cuentas: puede traer una clave.
    const detalle = url.pathname.startsWith('/auth/') ? '' : (cuerpo ?? '').slice(0, 240)

    if (veredicto.tipo === 'bloqueada') {
      anotar(metodo, url, 'bloqueado', `${veredicto.motivo}${detalle ? ` · ${detalle}` : ''}`)
      const mensaje = `Modo simulación: esto no se guardó (${veredicto.motivo}).`
      return new Response(
        JSON.stringify({ code: 'SIMUL', message: mensaje, msg: mensaje, details: null, hint: null }),
        { status: veredicto.estado ?? 403, headers: { 'content-type': 'application/json' } },
      )
    }

    let pedido = init
    if (veredicto.pedirFila) {
      // Sin la fila de vuelta no se sabe qué id nació, y no se la podría tocar después.
      const cabeceras = new Headers(init?.headers)
      cabeceras.set('Prefer', 'return=representation')
      pedido = { ...init, headers: cabeceras }
    }
    const respuesta = await original(input, pedido)
    anotar(metodo, url, respuesta.ok ? 'guardado' : `rechazado ${respuesta.status}`, detalle)
    if (veredicto.registrar && respuesta.ok) {
      try {
        recordarCreados(await respuesta.clone().json())
      } catch {
        // Una respuesta sin cuerpo no trae ids que recordar.
      }
    }
    return respuesta
  }

  if (document.body) pintarInsignia()
  else document.addEventListener('DOMContentLoaded', pintarInsignia)
}
