import type { LatLngTuple } from 'leaflet'

export function linePoints(geometry: unknown): LatLngTuple[] | null {
  if(!geometry || typeof geometry!=='object') return null
  const g=geometry as {type?:string;coordinates?:unknown}
  if(g.type!=='LineString'||!Array.isArray(g.coordinates)||g.coordinates.length<2) return null
  const points:LatLngTuple[]=[]
  for(const value of g.coordinates) {
    if(!Array.isArray(value)||value.length<2||!Number.isFinite(value[0])||!Number.isFinite(value[1])
      ||Math.abs(value[0])>180||Math.abs(value[1])>90) return null
    points.push([value[1],value[0]])
  }
  return points
}
