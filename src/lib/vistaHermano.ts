/**
 * Qué paneles ve cada hermano. La pantalla es una; el rol cambia
 * qué aparece adentro, no a qué ruta se va.
 */

export type RolEnGrupo = 'publicador' | 'auxiliar' | 'siervo' | 'superintendente'

export type ContextoHermano = {
  role: 'admin' | 'superintendente' | 'siervo' | 'conductor' | 'viewer'
  access_status: 'pending' | 'active' | 'inactive'
  driver_id: string | null
  full_name?: string | null
  group_id: string | null
  group_number: number | null
  group_name: string | null
  rol_en_grupo: RolEnGrupo | null
  miembro_estado: 'pendiente' | 'confirmado' | 'retirado' | null
  punto_grupo_id: string | null
  punto_grupo_nombre: string | null
  punto_grupo_lat: number | null
  punto_grupo_lng: number | null
  es_super_de_grupo: boolean
  puede_administrar_grupo?: boolean
  puede_informar_salidas?: boolean
  puede_abrir_panel?: boolean
}

export type PanelHoy =
  | 'saludo'
  | 'tuGrupoSale'
  | 'sosConductor'
  | 'tuTerritorio'
  | 'resumenGrupo'
  | 'sinGrupo'

export function tieneGrupo(ctx: ContextoHermano | null | undefined): boolean {
  return Boolean(ctx?.group_id && ctx.miembro_estado && ctx.miembro_estado !== 'retirado')
}

export function esMiembroPendiente(ctx: ContextoHermano | null | undefined): boolean {
  return Boolean(ctx?.group_id && ctx.miembro_estado === 'pendiente')
}

export function esMiembroConfirmado(ctx: ContextoHermano | null | undefined): boolean {
  return Boolean(ctx?.group_id && ctx.miembro_estado === 'confirmado')
}

export function panelesHoy(ctx: ContextoHermano | null | undefined): PanelHoy[] {
  const paneles: PanelHoy[] = ['saludo']
  if (!ctx) return paneles
  if (tieneGrupo(ctx)) paneles.push('tuGrupoSale')
  else paneles.push('sinGrupo')
  if (ctx.driver_id) paneles.push('sosConductor')
  paneles.push('tuTerritorio')
  if (ctx.es_super_de_grupo) paneles.push('resumenGrupo')
  return paneles
}

export function puedePedirTerritorio(ctx: ContextoHermano | null | undefined): boolean {
  if (!ctx || ctx.access_status !== 'active') return false
  if (esMiembroPendiente(ctx)) return false
  return true
}

export function puedeMarcarTerritorio(ctx: ContextoHermano | null | undefined, asignado: boolean): boolean {
  if (!asignado || ctx?.access_status !== 'active') return false
  if (esMiembroPendiente(ctx)) return false
  return true
}

export function filtrosSalidas(ctx: ContextoHermano | null | undefined) {
  return {
    lasMias: Boolean(ctx?.driver_id),
    lasDeMiGrupo: Boolean(ctx?.es_super_de_grupo && ctx.group_id),
    resultado: Boolean(ctx?.puede_informar_salidas ?? (ctx?.driver_id || ctx?.role === 'admin')),
  }
}

export function salidaCorrespondeAlGrupo(
  salida: { groupId?: string | null; tipo?: string | null },
  groupId: string | null | undefined,
): boolean {
  if (!groupId) return false
  if (salida.groupId) return salida.groupId === groupId
  return salida.tipo === 'grupos'
}

export function tituloSalidaGrupo(params: {
  tipo?: string | null
  lugar?: string
  tieneGrupo: boolean
  puntoNombre?: string | null
}): string {
  if (params.tipo !== 'grupos') return params.lugar || 'Salida'
  if (params.tieneGrupo && params.puntoNombre) return `Tu grupo sale de ${params.puntoNombre}`
  if (params.tieneGrupo) return 'Tu grupo sale · todavía no cargaron el punto'
  return 'Cada grupo por su lado · preguntá en tu grupo'
}

export function rotuloRolGrupo(rol: RolEnGrupo | null | undefined): string {
  if (rol === 'superintendente') return 'Superintendente'
  if (rol === 'auxiliar') return 'Auxiliar'
  if (rol === 'siervo') return 'Siervo de grupo'
  if (rol === 'publicador') return 'Publicador'
  return 'Sin rol'
}

export function normalizarCodigoGrupo(valor: string): string {
  return valor
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .replace(/[OI]/g, '')
    .slice(0, 6)
}
