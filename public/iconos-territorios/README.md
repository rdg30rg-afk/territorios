# Territorios · pack de iconos 01

39 SVG originales dibujados para la app. Retícula 24 × 24, trazo 1.75, extremos y uniones redondeados, color heredado con currentColor. Referencias de claridad y sobriedad del estudio JW; ningún trazado se extrajo de sus recursos.

## Uso

Preferir SVG inline o sprite para heredar color. Ejemplo decorativo junto a texto:

```html
<button type="button"><svg width="24" height="24" aria-hidden="true"><use href="/iconos-territorios/sprite.svg#guardar"></use></svg> Guardar</button>
```

Si se usa un botón sin texto visible, añadir aria-label al botón. El SVG decorativo lleva aria-hidden. Para imagen informativa independiente, usar img con alt. Los archivos independientes usan negro por defecto al cargarse mediante img; currentColor no atraviesa img.

Tamaños recomendados: 24 px para interfaz, 32 para accesos destacados. 20 px solo donde conserve legibilidad; no usar detalles del editor a 16 px. Área táctil mínima de 56 × 56 px y texto de al menos 16 px en vista hermano. Mantener palabra junto a herramientas y estados. El color se define en el contenedor: oliva #63752F, texto #252B27, error #A33D32.

Fusionar indica convergencia de dos áreas; dividir muestra una línea de corte; mover muestra traslado de una zona a otra; vértices muestra nodos manipulables. Conductor representa a quien guía, con una bandera, no un automóvil. Responsable usa persona y escudo sin jerarquía numérica. Validar estas dos metáforas con usuarios antes de sustituir etiquetas.

Este pack se entrega para revisión: no cambia navegación ni permisos. Abrir index.html para revisar tamaños, fondo claro/oscuro y ejemplos táctiles.

## Catálogo

- `inicio` — Inicio (Navegación)
- `territorios` — Territorios (Navegación)
- `salidas` — Salidas (Navegación)
- `persona` — Publicador (Personas)
- `grupo` — Grupo (Personas)
- `conductor` — Conductor (Personas)
- `responsable` — Responsable de grupo (Personas)
- `personal` — Mi territorio (Navegación)
- `punto` — Punto de encuentro (Navegación)
- `cobertura` — Cobertura (Navegación)
- `reservar` — Reservar territorio (Acciones)
- `dibujar` — Dibujar manzana (Editor)
- `dividir` — Dividir manzana (Editor)
- `fusionar` — Fusionar manzanas (Editor)
- `mover` — Mover a territorio (Editor)
- `vertices` — Editar vértices (Editor)
- `marcar` — Marcar manzanas (Editor)
- `caras` — Marcar lados (Editor)
- `letras` — Poner letras (Editor)
- `iman` — Imán (Editor)
- `guardar` — Guardar (Acciones)
- `deshacer` — Deshacer (Acciones)
- `rehacer` — Rehacer (Acciones)
- `eliminar` — Eliminar (Acciones)
- `descargar` — Descargar PDF (Acciones)
- `compartir` — Compartir (Acciones)
- `buscar` — Buscar (Acciones)
- `menu` — Abrir menú (Acciones)
- `cerrar` — Cerrar (Acciones)
- `completo` — Completado (Estados)
- `pendiente` — Pendiente (Estados)
- `error` — Revisá el resultado (Estados)
- `sin-conexion` — Sin conexión (Estados)
- `historial` — Historial (Estados)
- `chevron-abajo` — Abrir selector (Controles)
- `auto` — Auto (Movilidad)
- `colectivo` — Colectivo (Movilidad)
- `anterior` — Anterior (Navegación)
- `siguiente` — Siguiente (Navegación)
