# Análisis de los mapas — 27 de octubre de 2026

Solo lectura. No se cambió código. Los riesgos marcados "verificado" se
revisaron contra el código; el resto sale de la lectura de los agentes.

---

## 1. Cómo está armado

### Dos editores que no comparten código

- **El editor real es `editor-manzanas.html`**: un archivo de unas 3.460 líneas
  con Leaflet y turf. La pantalla Mapas lo carga dentro de un iframe
  (`src/pages/MapasPage.tsx:90`). Fuera de localhost usa la copia
  `editor-manzanas-embedded.html`, que genera `scripts/build-dev-seguro.mjs`.
- **`src/features/map-editor/` es una reescritura en React** que hoy no se ve en
  la app: `MapasPage.tsx:97` monta `SanJuanMap` con `editingEnabled={false}`.
- Guardan el borrador de forma distinta sobre la misma fila (`editor_estado`):

  | | HTML | React |
  |---|---|---|
  | Borrador | escribe la fila directo, controla choques por `actualizado_at` | RPC `guardar_borrador_editor`, controla choques por `revision` |
  | Publicación | v1, por nombre: `publicar_territorios_atomico` y `publicar_editor_con_renumeracion` | v2, por UUID y `operation_id`: `publicar_territorios_atomico_v2` |

### Librerías y fondo

- **Leaflet 1.9** en el editor, `SanJuanMap`, `PredicacionPage`,
  `CoverageHeatmapPanel` y `SalidaCoverageForm`.
- **MapLibre** solo en `MeetingPointPickerMap` (punto de encuentro).
- **Fondo**: todo pasa por `src/lib/fondoMapa.ts`.
  - Con `VITE_MAPTILER_KEY` usa MapTiler `dataviz-light`.
  - Sin clave usa OpenStreetMap desaturado.
  - Si MapTiler falla 6 veces seguidas, cambia solo a OpenStreetMap.
  - La clave viaja al navegador: hay que limitarla por dominio en MapTiler.

### Editor de manzanas

- **Pintado**: `refrescarMapa()` (`:698`) dibuja solo lo que está a la vista.
  Las manzanas aparecen desde el zoom 15 y las letras desde el 16.
- **Herramientas** (atajos 1–9, Esc sale paso a paso):

  | Herramienta | Qué hace |
  |---|---|
  | Dibujar | Clic en el primer punto o Enter para cerrar. |
  | Dividir | Corta con una línea de dos clics (`intersect`/`difference`). |
  | Fusionar | `union` de dos manzanas vecinas. |
  | Mover | Pasa la manzana al territorio activo. |
  | Vértices | Arrastrar, punto medio para agregar, clic derecho para quitar. |
  | Marcar | Suma manzanas sueltas al territorio. |
  | Borrar | La saca y la anota como descartada para que no vuelva. |
  | Arreglar caras | Une o parte caras a mano. |
  | Letras | Tocás las manzanas en orden y Enter. |

- **Imán**: pega a un vértice a 13 px o a un lado a 9 px (`ajustar`, `:1596`).
- **Alrededor (Solo este / +2 / +4 / Todos)**: muestra los N territorios
  vecinos que más se tocan con el activo. En "Solo este", las manzanas sueltas
  se ven en una franja de 250 m.
- **Revisar dibujo**: marca manzanas sin viviendas, de más de 4 ha, muy
  alargadas o de más de 40 vértices.
- **Historial**: hasta 30 fotos del estado completo en JSON.
- **Guardado**, en capas:
  1. Copia en el navegador (`territorios:prototipo`).
  2. Archivo en disco, opcional.
  3. Borrador en Supabase (`editor_estado`), a los ~1,2 s de cada cambio.
  4. "Guardar este territorio": publica en la base de una sola vez, sin dejar
     nada a medias.
- **Cambios sin commitear**: color por territorio y renumeración con
  intercambio de números (`5`, `5b`, `5.1`).

### Caras (lados de cuadra)

- **Regla**: agrupar tramos seguidos que difieren 25° o menos y descartar las
  caras de menos de 12 m. Las correcciones a mano se guardan por índice de
  vértice y se pierden si cambia la cantidad de vértices.
- **El módulo principal es
  `src/features/map-editor/geometry/blockGeometry.ts`.**
  `scripts/cargar-geometrias-y-lados.mjs` lo importa, no lo copia.
- **`PredicacionPage` no calcula caras**: lee `manzana_lados` de la base.
- **Copias reales**:
  - `editor-manzanas.html:2466`: equivalente al módulo.
  - `vista-hermano.html:530`: ignora las caras corregidas a mano, no tiene
    defensa contra polígonos rotos y mete el lado hacia adentro con otra regla.
- `docs/QUE-FALTA.md` dice que el algoritmo está en "el editor, el script y
  `PredicacionPage`". En realidad está en el módulo TS, el editor y
  `vista-hermano.html`.

### Vista del publicador (`PredicacionPage`)

- Cada cara es una línea metida 9 m hacia adentro, con una línea invisible de
  26 px para el dedo.
- **Marcar**: cada marca entra en una cola local (`useCoverageOutbox`) y se
  envía con el RPC `informar_cobertura`, que no duplica aunque se reintente
  (usa `event_id`).
- **Desmarcar**: manda `sin_dato`. La bitácora nunca se borra.

### Mapa de calor de cobertura

- No es un mapa de calor de densidad: son líneas por cara, coloreadas según su
  último estado.
- Trae **todos** los `cobertura_eventos` hasta la fecha elegida, sin filtrar
  por territorio.

### Datos

| Archivo | Contenido | Uso |
|---|---|---|
| `manzanas-congregacion.geojson` | 1.144 manzanas | Candidatas del editor; se cargan con `cargar-candidatas-editor-dev.mjs` |
| `manzanas-territorios.json` | 68 territorios, 605 manzanas | Forma dibujada por territorio; respaldo de `SanJuanMap` |
| `manzanas-san-juan.geojson` | 4.352 manzanas, 2 MB | No lo usa nada; sus `id` no coinciden con los de congregación |

- Las manzanas salieron de OpenStreetMap, pero no hay script ni documento que
  permita regenerarlas.
- `cargar-geometrias-y-lados.mjs` (simulación): 68 territorios, 605 manzanas,
  2.715 caras.

---

## 2. Riesgos

### Verificados

1. **Las caras fallan cerca de ±180°.**
   - Está en `blockGeometry.ts:65` y en las dos copias.
   - La fórmula `Math.abs(((a-b)+180)%360-180)` da 356° en vez de 4° para
     rumbos de +178° y −178°, porque `%` en JS conserva el signo.
   - Las cuadras que corren hacia el sur pueden quedar partidas en dos caras.
   - Como el script de carga usa ese módulo, el error ya está en
     `manzana_lados`.
   - Arreglarlo cambia caras que tienen cobertura colgada, así que hay que
     planear la migración de datos.
2. **Un build de producción no deja marcar nada.**
   `useCoverageOutbox.ts:40` y `resultDelivery.ts:4` solo aceptan escribir en
   DEV. Es intencional, pero hay que sacarlo antes de salir.
3. **La migración de renumeración (sin commitear) puede borrar dibujos.**
   - `jsonb_set(polygon_geojson, '{color}', …)` (`:106`) devuelve NULL si
     `polygon_geojson` es NULL, y eso borra la columna.
   - No tiene `operation_id`: si se reintenta tras perder la respuesta, falla
     con "cambió de número" aunque el cambio ya se aplicó.
4. **"Vaciar" pisa el borrador compartido.**
   - El aviso dice "la base no se toca" (`editor-manzanas.html:2208`), pero
     `refrescar()` llama a `guardar()`, que escribe el estado vacío en
     `editor_estado`.
5. **Selector de punto de encuentro** (verificado leyendo el código, no en el
   navegador).
   - El marcador y el territorio se dibujan solo si `isStyleLoaded()`
     (`MeetingPointPickerMap.tsx:113` y `:140`), y nada los repite cuando
     termina de cargar el estilo.
   - Además, el mapa se rearma en cada redibujo: `onPick` cambia en cada render
     de `SalidasPage` (`:2582`, `:3327`) y es dependencia del efecto que crea
     el mapa (`:109`).
6. **El editor React no puede descartar un intento de publicación.**
   `publicationAttempt.ts` no tiene `clear` ni `discard`. Un lote que falla de
   forma definitiva queda trabado.

### Señalados por los agentes, sin verificar a mano

7. **Sin mapa offline.** `vite.config.ts` no tiene `runtimeCaching` y excluye
   `/datos/`. Sin señal no se ven ni el fondo ni las manzanas, aunque las
   marcas se encolan igual.
8. **Archivo expuesto.** `public/datos/respaldo-actual.json` sale en
   `npm run build` y se puede descargar por URL. Solo `build:dev:seguro` lo
   filtra.
9. **Comparación inconsistente tras renumerar.** "Ver qué falta guardar"
   compara con `t.numero` y el panel usa `numeroBase ?? numero` (`:3034` vs
   `:1287`). Un territorio renumerado y no publicado aparece como "sin guardar
   nunca".
10. **Importar sin defensas.** Hace `JSON.parse` sin try/catch y no reinicia
    `tocados`, `descartadas`, `numeroBase` ni `colorBase`.
11. **Dividir y fusionar no limpian `m.caras`.** Si la cantidad de vértices
    coincide por casualidad, se usan índices viejos.
12. **Editor React**:
    - Un borrador descartado (`descartado:true`) rompe la carga.
    - Los polígonos con huecos fallan recién al publicar.
    - `touchedTerritoryIds` no se limpia tras publicar, así que vuelve a subir
      versión a dibujos idénticos.
13. **El mapa de calor carga todos los eventos** sin filtro de territorio.
    Crece sin límite.
14. **Carga de candidatas no atómica.** El upsert y la desactivación de la
    versión anterior son dos pedidos separados.
15. **Tests de SQL**: los de `npm test` sobre migraciones son regex sobre el
    texto. Las aserciones SQL reales (`tests/sql/`) no corren con `npm test`.

---

## 3. Arreglos sugeridos, de menor a mayor esfuerzo

1. `coalesce(polygon_geojson, '{}'::jsonb)` en la migración de renumeración.
2. Que "Vaciar" no guarde en la base, o que el aviso diga la verdad.
3. Volver a dibujar el marcador y el territorio en el evento `load` de
   MapLibre, y usar `useCallback` (o un ref) para `onPick`.
4. Sacar `respaldo-actual.json` de `public/` o filtrarlo en el build normal.
5. Corregir `difAng`/`angleDifference` (`((d % 360) + 540) % 360 - 180`) en
   las tres copias, con un plan para recortar de nuevo las caras afectadas
   sin perder cobertura.
6. Decidir si la reescritura React sigue o se archiva. Mientras convivan, la
   fila `editor_estado` tiene dos dueños.
7. Caché offline de teselas y geometrías para el publicador.
