import type { SVGProps } from 'react'
import type { IconoNombre } from '../lib/iconos'

type IconoProps = Omit<SVGProps<SVGSVGElement>, 'title'> & {
  nombre: IconoNombre
  tamaño?: number | string
  titulo?: string
}

/**
 * La aplicación usa el sprite propio de Territorios. El símbolo vive en
 * public para que también lo pueda consumir el editor de mapas y mantiene
 * currentColor, así cada pantalla decide su contraste sin duplicar dibujos.
 */
export function Icono({
  nombre,
  tamaño = 24,
  titulo,
  className,
  ...props
}: IconoProps) {
  return (
    <svg
      {...props}
      className={className ? `icono ${className}` : 'icono'}
      width={props.width ?? tamaño}
      height={props.height ?? tamaño}
      viewBox="0 0 24 24"
      aria-hidden={titulo ? undefined : true}
      aria-label={titulo}
      role={titulo ? 'img' : undefined}
      focusable="false"
    >
      <use href={`/iconos-territorios/sprite.svg#${nombre}`} />
    </svg>
  )
}
