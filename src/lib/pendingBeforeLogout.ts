type LocalStore = Pick<Storage, 'length' | 'key' | 'getItem'>

// Aviso común para todos los botones de salir. Nunca borra pendientes.
export function pendingBeforeLogout(storage: LocalStore, project: string, user: string): string | null {
  try {
    let coverage = 0, results = 0
    const raw = storage.getItem(`coverage-outbox:v1:${encodeURIComponent(project)}:${encodeURIComponent(user)}`)
    if (raw !== null) {
      const box = JSON.parse(raw)
      if (box.version !== 1 || box.projectRef !== project || box.userId !== user || !Array.isArray(box.events)) throw Error('Formato inválido')
      coverage = box.events.length
    }
    const prefix = `territorios:result-attempt:v1:${project}:${user}:`
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(prefix) && storage.getItem(key) !== null) results++
    }
    if (!coverage && !results) return null
    return `Tenés ${coverage} marcas y ${results} resultados de salida sin confirmar. Se conservan en este dispositivo para esta cuenta; salir no los envía ni los borra. ¿Querés cerrar sesión igualmente?`
  } catch {
    return 'No pudimos comprobar los envíos pendientes de este dispositivo. No borres los datos del navegador. ¿Querés cerrar sesión igualmente?'
  }
}
