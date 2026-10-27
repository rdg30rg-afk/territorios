/**
 * Dónde se guarda la copia del mapa en el teléfono.
 *
 * Primero IndexedDB, que no tiene el tope de 5 MB de localStorage y aguanta
 * varios territorios. Si IndexedDB no está o falla (navegación privada en
 * algunos navegadores, almacenamiento bloqueado), se prueba localStorage, y si
 * la copia no cabe ahí tampoco, no se guarda: perder la copia es un fastidio,
 * romper la pantalla es peor. Ninguna función de este archivo tira error.
 */
import {
  leerAsignaciones,
  leerCopia,
  serializarAsignaciones,
  serializarCopia,
  type AsignacionesGuardadas,
  type CopiaDeMapa,
} from './copiaDeMapa.ts'
import type { RegistroPrecarga } from './teselasPrecarga.ts'

export type AlmacenTexto = {
  leer(clave: string): Promise<string | null>
  escribir(clave: string, valor: string): Promise<void>
  borrar(clave: string): Promise<void>
}

const NOMBRE_BASE = 'territorios-sin-senal'
const NOMBRE_TABLA = 'kv'

function promesaDe<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pedido.onsuccess = () => resolve(pedido.result)
    pedido.onerror = () => reject(pedido.error ?? new Error('IndexedDB falló'))
  })
}

function transaccionTerminada(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB falló'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB canceló la operación'))
  })
}

export function crearAlmacenIndexedDB(
  fabrica: IDBFactory | undefined,
  nombre = NOMBRE_BASE,
): AlmacenTexto {
  let abierta: Promise<IDBDatabase> | null = null
  const abrir = () => {
    if (!fabrica) return Promise.reject(new Error('Este navegador no tiene IndexedDB.'))
    if (!abierta) {
      abierta = new Promise<IDBDatabase>((resolve, reject) => {
        const pedido = fabrica.open(nombre, 1)
        pedido.onupgradeneeded = () => { pedido.result.createObjectStore(NOMBRE_TABLA) }
        pedido.onsuccess = () => resolve(pedido.result)
        pedido.onerror = () => reject(pedido.error ?? new Error('No se pudo abrir IndexedDB.'))
        pedido.onblocked = () => reject(new Error('IndexedDB está bloqueada.'))
      })
      // Un intento fallido no puede quedar guardado para siempre.
      abierta.catch(() => { abierta = null })
    }
    return abierta
  }
  return {
    async leer(clave) {
      const db = await abrir()
      const valor = await promesaDe<unknown>(db.transaction(NOMBRE_TABLA, 'readonly').objectStore(NOMBRE_TABLA).get(clave))
      return typeof valor === 'string' ? valor : null
    },
    async escribir(clave, valor) {
      const db = await abrir()
      const tx = db.transaction(NOMBRE_TABLA, 'readwrite')
      tx.objectStore(NOMBRE_TABLA).put(valor, clave)
      await transaccionTerminada(tx)
    },
    async borrar(clave) {
      const db = await abrir()
      const tx = db.transaction(NOMBRE_TABLA, 'readwrite')
      tx.objectStore(NOMBRE_TABLA).delete(clave)
      await transaccionTerminada(tx)
    },
  }
}

export function crearAlmacenLocalStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): AlmacenTexto {
  const hay = () => {
    if (!storage) throw new Error('Este navegador no tiene localStorage.')
    return storage
  }
  return {
    async leer(clave) { return hay().getItem(clave) },
    async escribir(clave, valor) { hay().setItem(clave, valor) },
    async borrar(clave) { hay().removeItem(clave) },
  }
}

/**
 * Escribe en el principal; si falla, en el respaldo. Cuando el principal
 * anduvo, se borra el respaldo para que no quede una copia más vieja que
 * después gane la lectura. Lee del principal y, si no tiene nada, del respaldo.
 */
export function crearAlmacenConRespaldo(principal: AlmacenTexto, respaldo: AlmacenTexto): AlmacenTexto {
  return {
    async leer(clave) {
      try {
        const valor = await principal.leer(clave)
        if (valor !== null) return valor
      } catch { /* se prueba el respaldo */ }
      return respaldo.leer(clave)
    },
    async escribir(clave, valor) {
      try {
        await principal.escribir(clave, valor)
      } catch {
        await respaldo.escribir(clave, valor)
        return
      }
      try { await respaldo.borrar(clave) } catch { /* no había nada que borrar */ }
    },
    async borrar(clave) {
      let fallas = 0
      try { await principal.borrar(clave) } catch { fallas++ }
      try { await respaldo.borrar(clave) } catch { fallas++ }
      if (fallas === 2) throw new Error('No se pudo borrar la copia.')
    },
  }
}

let delTelefono: AlmacenTexto | null = null

/** El almacén real del navegador. Se arma la primera vez que se usa. */
export function almacenDelTelefono(): AlmacenTexto {
  if (!delTelefono) {
    let storage: Storage | undefined
    // Solo tocar `localStorage` ya puede tirar SecurityError.
    try { storage = globalThis.localStorage } catch { storage = undefined }
    delTelefono = crearAlmacenConRespaldo(
      crearAlmacenIndexedDB(globalThis.indexedDB),
      crearAlmacenLocalStorage(storage),
    )
  }
  return delTelefono
}

// ------------------------------------------------------------ claves y atajos

export const claveDeCopia = (userId: string, territorioId: string) => `mapa:v1:${userId}:${territorioId}`
export const claveDeAsignaciones = (userId: string) => `asignaciones:v1:${userId}`
export const claveDePrecarga = (userId: string, territorioId: string) => `precarga:v1:${userId}:${territorioId}`

/** `true` si quedó guardada. Nunca tira error. */
export async function guardarCopiaDeMapa(almacen: AlmacenTexto, copia: CopiaDeMapa): Promise<boolean> {
  try {
    await almacen.escribir(claveDeCopia(copia.userId, copia.territorioId), serializarCopia(copia))
    return true
  } catch { return false }
}

export async function leerCopiaDeMapa<M = unknown, L = unknown>(
  almacen: AlmacenTexto,
  userId: string,
  territorioId: string,
): Promise<CopiaDeMapa<M, L> | null> {
  try {
    return leerCopia<M, L>(await almacen.leer(claveDeCopia(userId, territorioId)), { userId, territorioId })
  } catch { return null }
}

export async function guardarAsignaciones(almacen: AlmacenTexto, datos: AsignacionesGuardadas): Promise<boolean> {
  try {
    await almacen.escribir(claveDeAsignaciones(datos.userId), serializarAsignaciones(datos))
    return true
  } catch { return false }
}

export async function leerAsignacionesGuardadas<R = unknown, T = unknown>(
  almacen: AlmacenTexto,
  userId: string,
): Promise<AsignacionesGuardadas<R, T> | null> {
  try {
    return leerAsignaciones<R, T>(await almacen.leer(claveDeAsignaciones(userId)), { userId })
  } catch { return null }
}

export async function guardarRegistroDePrecarga(
  almacen: AlmacenTexto,
  userId: string,
  territorioId: string,
  registro: RegistroPrecarga,
) {
  try { await almacen.escribir(claveDePrecarga(userId, territorioId), JSON.stringify(registro)) } catch { /* se vuelve a bajar */ }
}

export async function leerRegistroDePrecarga(
  almacen: AlmacenTexto,
  userId: string,
  territorioId: string,
): Promise<RegistroPrecarga | null> {
  try {
    const texto = await almacen.leer(claveDePrecarga(userId, territorioId))
    if (!texto) return null
    const dato = JSON.parse(texto)
    return typeof dato?.clave === 'string' && typeof dato?.terminadoEl === 'string' ? dato : null
  } catch { return null }
}
