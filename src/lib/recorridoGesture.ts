export type ScreenPoint = { x: number; y: number }

export function distanceToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
  ))
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy))
}

export function nearestPath<T>(
  point: ScreenPoint,
  paths: Array<{ id: T; points: ScreenPoint[] }>,
  maximumDistance = 24,
) {
  let nearest: { id: T; distance: number } | null = null
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      const distance = distanceToSegment(point, path.points[index - 1], path.points[index])
      if (distance <= maximumDistance && (!nearest || distance < nearest.distance)) {
        nearest = { id: path.id, distance }
      }
    }
  }
  return nearest?.id ?? null
}
