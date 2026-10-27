import { MARCA_FONDO, formasDeLaMarca, puntosSvg } from '../lib/marca'

// La marca de la app (ver src/lib/marca.ts). Es decorativa: el nombre
// "Territorios" siempre va escrito al lado.
export function SimboloTerritorios({ tamaño = 36 }: { tamaño?: number }) {
  // Chica, el contorno de la casa necesita más grosor para verse.
  const trazo = tamaño < 28 ? 4.5 : 3.2
  return (
    <svg className="simbolo-territorios" width={tamaño} height={tamaño} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" fill={MARCA_FONDO} />
      {formasDeLaMarca({ trazo }).map((f, i) =>
        f.tipo === 'poligono' ? (
          <polygon key={i} points={puntosSvg(f.puntos)} fill={f.color} />
        ) : (
          <rect key={i} x={f.x} y={f.y} width={f.lado} height={f.lado} fill={f.color} />
        ),
      )}
    </svg>
  )
}
