export function validAt(row: { vigente_desde?: string | null; vigente_hasta?: string | null }, instant: string) {
  const at = Date.parse(instant)
  const from = Date.parse(row.vigente_desde ?? '')
  const until = row.vigente_hasta ? Date.parse(row.vigente_hasta) : Infinity
  // Sin fecha de vigencia no inventamos que el dibujo ya existía.
  return Number.isFinite(at) && Number.isFinite(from) && from <= at && at < until
}

export function latestEventsAt<T extends { id: string; lado_id: string; informado_at: string }>(events: T[], instant: string) {
  const end = Date.parse(instant)
  const latest = new Map<string, T>()
  for (const event of events) {
    const time = Date.parse(event.informado_at)
    if (!Number.isFinite(time) || time > end || !Number.isFinite(end)) continue
    const prior = latest.get(event.lado_id)
    if (!prior || time > Date.parse(prior.informado_at) || (time === Date.parse(prior.informado_at) && event.id > prior.id)) {
      latest.set(event.lado_id, event)
    }
  }
  return latest
}
