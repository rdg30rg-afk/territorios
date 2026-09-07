export type TerritoryCoverage = {
  territory_id: string; name: string; lados: number | string
  lados_hechos?: number | string | null
  pct_metros: number | string | null; ultima_marca: string | null
  tiene_dato: boolean; reservado: boolean
}
type SuggestionCategory = 'asignado' | 'sin_geometria' | 'verificar' | 'completar' | 'completo'
export function suggestTerritories(rows: TerritoryCoverage[], now = Date.now()) {
  return rows.map(row => {
    const sides = Number(row.lados)
    const raw = row.pct_metros === null || (typeof row.pct_metros === 'string' && !row.pct_metros.trim())
      ? NaN : Number(row.pct_metros)
    const percent = row.tiene_dato === true && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null
    const stamp = row.ultima_marca ? Date.parse(row.ultima_marca) : NaN
    const age = Number.isFinite(stamp) && stamp <= now ? Math.floor((now - stamp) / 86400000) : null
    const walkedSides = row.lados_hechos === null || row.lados_hechos === undefined
      || (typeof row.lados_hechos === 'string' && !row.lados_hechos.trim()) ? NaN : Number(row.lados_hechos)
    const countsValid = Number.isInteger(sides) && sides > 0 && Number.isInteger(walkedSides)
      && walkedSides >= 0 && walkedSides <= sides
    const allSidesWalked = countsValid && walkedSides === sides
    const category: SuggestionCategory = row.reservado ? 'asignado' : !Number.isFinite(sides) || sides <= 0 ? 'sin_geometria'
      : percent === null || !countsValid ? 'verificar' : allSidesWalked && percent === 100 ? 'completo' : 'completar'
    const reason = category === 'asignado' ? 'Tiene una reserva activa; coordinar antes de programarlo.'
      : category === 'sin_geometria' ? 'Faltan lados para evaluar la cobertura.'
      : category === 'verificar' ? 'Sin cobertura concluyente: verificar antes de decidir; no equivale a 0%.'
      : category === 'completar' ? `${percent}% de los metros figura recorrido (porcentaje redondeado); ${walkedSides} de ${sides} lados recorridos. Revisar qué falta.`
      : 'Todos los metros figuran recorridos; revisar antigüedad antes de iniciar otra ronda.'
    return { ...row, percent, age, category, reason }
  }).sort((a,b) => {
    const order = { completar:0, verificar:1, completo:2, sin_geometria:3, asignado:4 }
    return order[a.category] - order[b.category]
      || (a.percent ?? 101) - (b.percent ?? 101)
      || (b.age ?? -1) - (a.age ?? -1)
      || a.name.localeCompare(b.name,'es',{numeric:true})
      || a.territory_id.localeCompare(b.territory_id)
  })
}
