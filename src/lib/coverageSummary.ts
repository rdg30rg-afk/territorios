export type CoverageState = 'recorrido' | 'no_accesible' | 'revisitar' | 'sin_dato'
export function coverageSummary(sides: { id: string; largo_m: number | string }[], states: Record<string, string>) {
  const counts: Record<CoverageState, number> = { recorrido: 0, no_accesible: 0, revisitar: 0, sin_dato: 0 }
  let totalMeters = 0, walkedMeters = 0, invalidLengths = 0
  for (const side of sides) {
    const value = states[side.id]
    const state: CoverageState = value === 'recorrido' || value === 'no_accesible' || value === 'revisitar' ? value : 'sin_dato'
    counts[state]++
    const length = Number(side.largo_m)
    if (!Number.isFinite(length) || length <= 0) { invalidLengths++; continue }
    totalMeters += length
    if (state === 'recorrido') walkedMeters += length
  }
  const hasData = counts.recorrido + counts.no_accesible + counts.revisitar > 0
  return {
    counts, totalMeters, walkedMeters, invalidLengths, hasData,
    percent: hasData && totalMeters > 0 && invalidLengths === 0 ? Math.round(100 * walkedMeters / totalMeters) : null,
    complete: sides.length > 0 && counts.recorrido === sides.length,
  }
}
