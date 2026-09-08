import { createEditorDocument } from '../model/editorDocument.ts'
import type { EditorDocument } from '../model/types.ts'

export type EditorRecovery = { revision: number; document: EditorDocument }

// Per-tab storage survives reload/back without mixing drafts from other tabs.
export function editorRecoveryStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, project: string, user: string) {
  const key = `territorios:editor-recovery:v1:${project}:${user}`
  return {
    key,
    read(): EditorRecovery | null {
      const raw = storage.getItem(key)
      if (raw === null) return null
      const value = JSON.parse(raw) as EditorRecovery
      if (!Number.isSafeInteger(value?.revision) || value.revision < 0 || !value.document?.territories || !value.document.blocks || !Array.isArray(value.document.touchedTerritoryIds)) {
        throw Error('La copia local no es válida. No se reemplazó: conservála antes de continuar.')
      }
      const validated = createEditorDocument(Object.values(value.document.territories), Object.values(value.document.blocks))
      if (Object.values(validated.blocks).some((block) => block.territoryId && !validated.territories[block.territoryId])) {
        throw Error('La copia local contiene un territorio desconocido.')
      }
      return value
    },
    write(value: EditorRecovery) { storage.setItem(key, JSON.stringify(value)) },
    clear() { storage.removeItem(key) },
  }
}
