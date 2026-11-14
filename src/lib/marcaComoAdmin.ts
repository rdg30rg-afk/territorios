/**
 * Administradores que marcan un territorio que no es suyo.
 *
 * Se abre con `/predicacion?territorio=<id>`. Solo lo respeta quien es
 * `admin_territorios` o `superadmin` activo; para cualquier otra persona el
 * parámetro se ignora. La marca viaja con el origen `admin` (migración
 * 20261113040000_cobertura_admin_marca.sql).
 */
import type { CoverageInput } from './coverageOutbox'

type PerfilMinimo = { access_status?: string | null; system_role?: string | null } | null | undefined

export function esAdminQueMarca(perfil: PerfilMinimo): boolean {
  return perfil?.access_status === 'active'
    && (perfil.system_role === 'admin_territorios' || perfil.system_role === 'superadmin')
}

/** El id del territorio pedido en la dirección, o null si no hay o no parece un id. */
export function territorioDeLaDireccion(search: string): string | null {
  const valor = new URLSearchParams(search).get('territorio')?.trim() ?? ''
  return /^[0-9a-f-]{8,64}$/i.test(valor) ? valor.toLowerCase() : null
}

/** ¿Este territorio se marca como administrador? Solo el pedido por la dirección, y solo si no es suyo. */
export function marcaComoAdmin(params: {
  perfil: PerfilMinimo
  territorioPedido: string | null
  territorioAbierto: string | null | undefined
  esPropio: boolean
}): boolean {
  return esAdminQueMarca(params.perfil)
    && Boolean(params.territorioPedido)
    && params.territorioPedido === params.territorioAbierto?.toLowerCase()
    && !params.esPropio
}

/** Las marcas de un administrador viajan con origen `admin`; el resto no se toca. */
export function conOrigenAdmin(entradas: readonly CoverageInput[], comoAdmin: boolean): CoverageInput[] {
  return comoAdmin ? entradas.map((e) => ({ ...e, origen: 'admin' as const })) : [...entradas]
}

export function avisoMarcandoComoAdmin(territorio: string): string {
  return `Estás marcando como administrador el territorio ${territorio}`
}
