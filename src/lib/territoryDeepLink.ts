export function getTerritoryDeepLinkTransition(
  requestedTerritoryId: string | null,
  lastProcessedTerritoryId: string | null | undefined,
) {
  const changed = requestedTerritoryId !== lastProcessedTerritoryId
  return { changed, shouldFocus: changed && requestedTerritoryId !== null }
}
