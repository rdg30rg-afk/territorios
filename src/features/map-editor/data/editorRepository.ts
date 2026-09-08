import type { SupabaseClient } from '@supabase/supabase-js'
import { polygonRingLatLng } from '../geometry/blockGeometry.ts'
import type {
  AtomicPublicationItemV2,
  TerritoryRevisionV2,
} from '../model/publication.ts'
import type { EditorPolygon } from '../model/types.ts'

export type EditorViewport = {
  west: number
  south: number
  east: number
  north: number
}

export type EditorCandidate = {
  id: string
  sourceKey: string
  datasetVersion: string
  geometry: EditorPolygon
  center: readonly [lat: number, lng: number]
  diagnostics: Record<string, unknown>
}

export type EditorDraft<TState = unknown> = {
  revision: number
  state: TState | null
  updatedBy: string | null
  updatedAt: string | null
}

type CandidateRow = {
  id: string
  source_key: string
  dataset_version: string
  geometry_geojson: EditorPolygon
  centro_lat: number | string
  centro_lng: number | string
  diagnostics: Record<string, unknown> | null
}

type RpcResult = {
  data: unknown
  error: { message: string; code?: string } | null
}

type CandidateQueryResult = {
  data: CandidateRow[] | null
  error: { message: string } | null
}

export type EditorDataTransport = {
  queryCandidates: (
    viewport: EditorViewport,
    from: number,
    to: number,
    signal?: AbortSignal,
  ) => Promise<CandidateQueryResult>
  queryAllCandidates: (
    from: number,
    to: number,
    signal?: AbortSignal,
  ) => Promise<CandidateQueryResult>
  callRpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult>
}

const CANDIDATE_PAGE_SIZE = 500
const CANDIDATE_COLUMNS = 'id, source_key, dataset_version, geometry_geojson, centro_lat, centro_lng, diagnostics'

function assertViewport(viewport: EditorViewport) {
  const values = Object.values(viewport)
  if (values.some((value) => !Number.isFinite(value)) ||
    viewport.west < -180 || viewport.east > 180 ||
    viewport.south < -90 || viewport.north > 90 ||
    viewport.west > viewport.east || viewport.south > viewport.north) {
    throw new Error('El encuadre del mapa es inválido.')
  }
}

function parseCandidate(row: CandidateRow): EditorCandidate {
  if (!row.id || !row.source_key || !row.dataset_version) {
    throw new Error('La base devolvió una candidata incompleta.')
  }
  polygonRingLatLng(row.geometry_geojson)
  const lat = Number(row.centro_lat)
  const lng = Number(row.centro_lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`La candidata ${row.source_key} no tiene centro válido.`)
  }
  return {
    id: row.id,
    sourceKey: row.source_key,
    datasetVersion: row.dataset_version,
    geometry: row.geometry_geojson,
    center: [lat, lng],
    diagnostics: row.diagnostics ?? {},
  }
}

function selectActiveCandidates(client: SupabaseClient) {
  return client
    .from('manzana_candidatas')
    .select(CANDIDATE_COLUMNS)
    .eq('activa', true)
}

async function resolveCandidateQuery(
  query: ReturnType<typeof selectActiveCandidates>,
  signal?: AbortSignal,
): Promise<CandidateQueryResult> {
  if (signal) query = query.abortSignal(signal)
  const result = await query
  return {
    data: result.data as CandidateRow[] | null,
    error: result.error ? { message: result.error.message } : null,
  }
}

export function createSupabaseEditorTransport(client: SupabaseClient): EditorDataTransport {
  return {
    async queryCandidates(viewport, from, to, signal) {
      const query = selectActiveCandidates(client)
        .lte('bbox_min_lng', viewport.east)
        .gte('bbox_max_lng', viewport.west)
        .lte('bbox_min_lat', viewport.north)
        .gte('bbox_max_lat', viewport.south)
        .order('source_key')
        .range(from, to)
      return resolveCandidateQuery(query, signal)
    },
    async queryAllCandidates(from, to, signal) {
      const query = selectActiveCandidates(client)
        .order('source_key')
        .range(from, to)
      return resolveCandidateQuery(query, signal)
    },
    async callRpc(name, args) {
      const result = await client.rpc(name, args)
      return {
        data: result.data,
        error: result.error ? { message: result.error.message, code: result.error.code } : null,
      }
    },
  }
}

type CandidatePageQuery = (
  from: number,
  to: number,
  signal?: AbortSignal,
) => Promise<CandidateQueryResult>

async function loadCandidatePages(queryPage: CandidatePageQuery, signal?: AbortSignal) {
  const candidates: EditorCandidate[] = []
  for (let from = 0; ; from += CANDIDATE_PAGE_SIZE) {
    if (signal?.aborted) throw new DOMException('Carga cancelada', 'AbortError')
    const { data, error } = await queryPage(from, from + CANDIDATE_PAGE_SIZE - 1, signal)
    if (error) throw new Error(error.message)
    const page = (data ?? []).map(parseCandidate)
    candidates.push(...page)
    if (page.length < CANDIDATE_PAGE_SIZE) break
  }

  const datasetVersions = new Set(candidates.map((candidate) => candidate.datasetVersion))
  if (datasetVersions.size > 1) {
    throw new Error('La base devolvió más de una versión activa de candidatas.')
  }
  return candidates
}

export async function loadEditorCandidates(
  transport: EditorDataTransport,
  viewport: EditorViewport,
  signal?: AbortSignal,
) {
  assertViewport(viewport)
  return loadCandidatePages(
    (from, to, pageSignal) => transport.queryCandidates(viewport, from, to, pageSignal),
    signal,
  )
}

export async function loadAllEditorCandidates(
  transport: EditorDataTransport,
  signal?: AbortSignal,
) {
  return loadCandidatePages(
    (from, to, pageSignal) => transport.queryAllCandidates(from, to, pageSignal),
    signal,
  )
}

function parseDraft<TState>(value: unknown): EditorDraft<TState> {
  if (!value || typeof value !== 'object') throw new Error('La base devolvió un borrador inválido.')
  const row = value as Record<string, unknown>
  const revision = Number(row.revision)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('La revisión del borrador es inválida.')
  }
  return {
    revision,
    state: (row.estado ?? null) as TState | null,
    updatedBy: typeof row.actualizado_por === 'string' ? row.actualizado_por : null,
    updatedAt: typeof row.actualizado_at === 'string' ? row.actualizado_at : null,
  }
}

function throwRpcError(error: RpcResult['error']) {
  if (!error) return
  if (error.code === '40001') {
    throw new Error('Otra persona guardó el editor después que vos. Recargá antes de seguir.')
  }
  throw new Error(error.message)
}

export async function readEditorDraft<TState>(transport: EditorDataTransport) {
  const result = await transport.callRpc('leer_borrador_editor')
  throwRpcError(result.error)
  return parseDraft<TState>(result.data)
}

export async function saveEditorDraft<TState extends Record<string, unknown>>(
  transport: EditorDataTransport,
  revision: number,
  state: TState,
) {
  const result = await transport.callRpc('guardar_borrador_editor', {
    p_revision: revision,
    p_estado: state,
  })
  throwRpcError(result.error)
  return parseDraft<TState>(result.data)
}

export async function discardEditorDraft(transport: EditorDataTransport, revision: number) {
  const result = await transport.callRpc('descartar_borrador_editor', { p_revision: revision })
  throwRpcError(result.error)
  return parseDraft(result.data)
}

export async function reviewEditorPublicationV2(
  transport: EditorDataTransport,
  territoryIds: readonly string[],
): Promise<TerritoryRevisionV2[]> {
  if (!territoryIds.length || territoryIds.some((id) => !id)) {
    throw new Error('Elegí al menos un territorio válido para revisar la publicación.')
  }
  const result = await transport.callRpc('revisar_publicacion_editor_v2', {
    p_territory_ids: [...territoryIds],
  })
  throwRpcError(result.error)
  if (!Array.isArray(result.data)) {
    throw new Error('La base no devolvió una revisión de publicación válida.')
  }
  return result.data as TerritoryRevisionV2[]
}

export async function publishEditorPublicationV2(
  transport: EditorDataTransport,
  operationId: string,
  changes: readonly AtomicPublicationItemV2[],
) {
  if (!operationId || !changes.length) {
    throw new Error('La publicación necesita una operación y al menos un territorio.')
  }
  const result = await transport.callRpc('publicar_territorios_atomico_v2', {
    p_operation_id: operationId,
    p_cambios: structuredClone(changes),
  })
  if (result.error?.code === '40001') {
    throw new Error('Un territorio cambió mientras revisabas la publicación. Recargá y revisá el lote antes de volver a publicar.')
  }
  throwRpcError(result.error)
  if (!Array.isArray(result.data)) {
    throw new Error('La base no confirmó una publicación válida.')
  }
  const confirmed = new Map<string, number>()
  for (const row of result.data) {
    if (!row || typeof row.territory_id !== 'string' || !Number.isSafeInteger(row.version) || confirmed.has(row.territory_id)) {
      throw new Error('La confirmación del lote está incompleta o es inválida. Conservá el intento para verificarlo.')
    }
    confirmed.set(row.territory_id, row.version)
  }
  if (confirmed.size !== changes.length || changes.some((change) => confirmed.get(change.territory_id) !== change.version_esperada + 1)) {
    throw new Error('La confirmación no coincide con los territorios y versiones enviados. Conservá el intento para verificarlo.')
  }
  return result.data
}
