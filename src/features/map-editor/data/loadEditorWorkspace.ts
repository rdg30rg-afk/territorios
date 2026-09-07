import {
  loadAllEditorCandidates,
  readEditorDraft,
  type EditorDataTransport,
} from './editorRepository.ts'
import {
  decodeEditorDraftState,
  type DecodedEditorDraft,
} from '../model/draftCodec.ts'
import type { EditorTerritory } from '../model/types.ts'

export type LoadedEditorWorkspace = {
  revision: number
  updatedBy: string | null
  updatedAt: string | null
  draft: DecodedEditorDraft
}

export async function loadEditorWorkspace(
  transport: EditorDataTransport,
  territories: readonly EditorTerritory[],
  signal?: AbortSignal,
): Promise<LoadedEditorWorkspace> {
  const [candidates, remoteDraft] = await Promise.all([
    loadAllEditorCandidates(transport, signal),
    readEditorDraft(transport),
  ])
  if (signal?.aborted) throw new DOMException('Carga cancelada', 'AbortError')
  if (!remoteDraft.state) {
    throw new Error(
      'No hay un borrador compartido. Antes de editar hay que iniciar uno desde el mapa publicado.',
    )
  }
  return {
    revision: remoteDraft.revision,
    updatedBy: remoteDraft.updatedBy,
    updatedAt: remoteDraft.updatedAt,
    draft: decodeEditorDraftState(remoteDraft.state, territories, candidates),
  }
}
