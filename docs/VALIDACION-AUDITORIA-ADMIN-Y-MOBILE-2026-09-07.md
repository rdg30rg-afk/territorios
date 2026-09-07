# Validación de la auditoría admin y mobile

Fecha: 7 de septiembre de 2026. Rama: `dev`. Base permitida: Supabase DEV
`rkmioktcsgqqjshrlkmy`. Producción `dwgvzcnarrjgqjotocdw` no fue consultada ni
modificada.

## Entregas 2–6

| Entrega | Evidencia implementada | Verificación automática |
|---|---|---|
| 2 · Mapas | Lista compacta junto al mapa, ficha al seleccionar, edición contextual, ayuda y exportación plegadas; sin código posicional, compañía ni estado inventado. | `35b9bf4`; pruebas de mapa, enlaces, puntos y cobertura. |
| 3 · Salidas | Agenda primero; planificador “Armar programa” separado; filtros temporales y “Sin conductor”; grupo visible y aplicado a agenda/lote; consulta no bloquea territorios reservados. | `5448fec`; pruebas de rango, etiquetas, permisos y RPC transaccionales DEV. |
| 4 · Inicio | Resumen/Usuarios, destinos con filtro, búsqueda y estado, edición individual, baja confirmada con nombre y reactivación; sugerencias acotadas. | `e91d4ea`; pruebas de pendientes y sugerencias. |
| 5 · Secundarios | Territorios personales en Pendientes/Activos/Historial y asignación modal; fichas modales en Conductores/Grupos; responsable primero y sin columna Número; Importación con lenguaje operativo. | `ad9e79f`; `tsc` y pruebas de importación/acceso/permisos. |
| 6 · Transversal/mobile | Menú admin plegable, tablas angostas apiladas, `/predicacion` sin `select` nativo, piso de 16 px y 56 px táctiles, navegación con icono y palabra, reglas específicas para 390 y 320 px. | 163/163 pruebas; `tsc --noEmit`; `build:dev:seguro`. |

## Editor “Sin sesión”

La causa reproducible en código era que el editor independiente leía el token
que mantiene `supabase-js`, pero el enlace reemplazaba la pestaña de la app. Al
salir de la app se detenía el cliente que renueva la sesión. El enlace ahora
abre el editor en otra pestaña con `noopener`; cada operación del editor vuelve
a leer el token actualizado del mismo origen. El editor conserva estados
distintos para sesión ausente/vencida, carga, error, vacío, borrador y conflicto.

## Resultado de controles

- `npx tsc --noEmit`: verde.
- `node --experimental-strip-types --test tests/*.test.mjs`: 163 aprobadas,
  0 fallidas.
- Las pruebas RPC de grupos y salidas corrieron contra DEV dentro de sus
  transacciones de rollback.
- `npm run build:dev:seguro`: verde; URL efectiva
  `https://rkmioktcsgqqjshrlkmy.supabase.co`, rol público `anon`, entradas `/` y
  `/editor-manzanas.html`, 76 archivos del service worker verificados.
- El build seguro rechaza explícitamente el ref de producción y secretos
  `service_role` en el paquete público.

## Validación visual pendiente

La inspección manual en navegador de 1366 × 768, 1440 × 900, 390 × 844 y
320 × 568 queda pendiente porque la Mac estaba bloqueada y la automatización no
pudo acceder a ninguna ventana. No se declara esa parte como aprobada hasta
recorrer búsqueda/selección/edición, teclado, carga/error/vacío y cierre/retorno
de foco en el navegador.
