# Contrato T-01 — retiro integral de un territorio

Fecha: 6 de septiembre de 2026. Estado: **SQL escrito en `supabase/migrations/20260921010000_retiro_territorio.sql`; no aplicado en DEV ni en producción**.

Alcance exclusivo de la futura implementación en DEV `rkmioktcsgqqjshrlkmy`. Este documento no ejecuta SQL, no cambia migraciones ni frontend y no habilita producción `dwgvzcnarrjgqjotocdw`.

## 1. Semántica acordada

Retirar significa que el territorio deja de estar disponible para nueva actividad (reservas, asignaciones, salidas, geometrías y marcas), sin borrar su identidad ni los hechos que ya ocurrieron. No significa cancelar una salida, liberar una reserva, quitar un grupo, reasignar personas, transferir cobertura ni recalcular lados. Una corrección administrativa de un hecho histórico sigue siendo posible por su RPC append-only y se distingue de una nueva actividad.

El actor debe ser un administrador activo: `public.is_admin(auth.uid())` (que en el esquema efectivo exige `role = 'admin'` y `access_status = 'active'`) se comprueba explícitamente en preflight y confirmación. No alcanza con el rol textual ni con un módulo.

La operación solo puede confirmar si el preflight no encuentra ninguno de estos bloqueos exactos:

1. `territorio_personal_reservas.status = 'activa'` (préstamo/asignación vigente).
2. `territorio_personal_reservas.status = 'solicitada'` (solicitud pendiente).
3. Una salida futura (`salidas.scheduled_for > clock_timestamp()`) sin un resultado actual en `salida_resultado_actual`, **o cuyo resultado actual tenga `estado = 'sin_dato'`**. `sin_dato` es desconocido, no una resolución; el bloqueo conservador evita retirar una salida cuyo cierre todavía no es concluyente. `realizada`, `parcial`, `no_realizada` y `cancelada` son estados explícitos.
4. Una asignación vigente de grupo: `grupo_territorio.vigente_hasta is null` y relación exacta por `territory_id`, o por `territory_unit_version_id` cuya unidad tenga `legacy_territory_id` igual al territorio.

Ante cualquier bloqueo se devuelve detalle estable (`tipo`, `id`, fecha/estado disponible) y no se modifica ninguna fila. No se cancela, libera, rechaza ni reasigna automáticamente.

## 2. Esquema efectivo y brechas reales

La lectura acumulada de `supabase/schema.sql` y las migraciones hasta `20260906010000` deja este modelo relevante:

| Objeto | Columnas existentes que usa T-01 | Uso histórico/actual |
| --- | --- | --- |
| `territorios` | `id`, `name`, `description`, `polygon_geojson`, `code_text`, `parent_id`, `kind`, `sector`, `updated_at`, `editor_revision` | Identidad que leen hoy el mapa, reservas, programa y heatmap. El `DELETE` está revocado a clientes por `20260905080000`. **No tiene estado de retiro ni `retired_at`.** |
| `territorio_manzanas` | `id`, `territory_id`, geometría, `geometry_version`, `vigente_desde`, `vigente_hasta`, `updated_at` | La fila vigente es la geometría actual; las retiradas anteriores permanecen. |
| `manzana_lados` | `id`, `manzana_id`, `territory_id`, `orden`, geometría, `largo_m`, `rumbo_grados`, `medio_lat`, `medio_lng`, `geometry_version`, `vigente_desde`, `vigente_hasta` | Identidad estable del lado y geometría histórica. No se deben tocar sus atributos ni generar lados nuevos al retirar. |
| `cobertura_eventos` | `id`, `lado_id`, `manzana_id`, `territory_id`, `estado`, `origen`, `informado_por`, `informado_at`, `salida_id`, `corrige_evento_id` | Bitácora append-only; `UPDATE`/`DELETE` están revocados y las marcas apuntan a lados concretos. |
| `territorio_personal_reservas` / `reserva_movimientos` | Estados `solicitada`, `activa`, `liberada`, `rechazada`; `assigned_to`, `requested_by`; movimientos con actor y fecha | La reserva activa es el préstamo; los movimientos no se escriben directamente desde el cliente. |
| `salidas` / `salida_resultados` | `salidas.territory_id`, `scheduled_for`; resultado actual derivado por `salida_resultado_actual` | `salidas` no tiene estado de resolución propio. `salida_resultados.salida_id` es `ON DELETE RESTRICT` desde `20260905040000`; los resultados son hechos inmutables. |
| `grupo_territorio` | `territory_id`, `territory_unit_version_id`, `vigente_desde`, `vigente_hasta`, `source_code_text` | La asignación vigente es la fila con `vigente_hasta is null`; la FK efectiva a territorio es restrictiva desde `20260903120000`. |

El modelo paralelo tiene `territory_entities.retired_at`, `territory_map_versions.status/valid_to` y `territory_unit_versions.status/legacy_territory_id`, pero la aplicación actual no usa esas tablas como fuente de territorios corrientes. `territorios_actuales` tampoco filtra por el retiro del legado. Por eso no es correcto usar `territory_entities.retired_at` como sustituto: faltaría enlazar y filtrar todos los consumidores.

### Cambios de esquema que la implementación deberá proponer

Son **nuevos**, no columnas existentes:

- En `territorios`: `retired_at timestamptz null`, `retired_by uuid references profiles(id) on delete set null` y `retirement_note text null`. No agregar un segundo `status`: `retired_at is null` es el estado corriente y evita dos fuentes de verdad.
- En una tabla append-only nueva, por ejemplo `territory_retirements`: `operation_id uuid primary key`, `territory_id uuid not null references territorios(id) on delete restrict` con unicidad por territorio, `retired_at`, `retired_by`, `previous_editor_revision`, `new_editor_revision`, `note` y `created_at`. `operation_id` es el UUID de reintento; un retry no crea otro retiro. La misma operación solo puede repetirse con el mismo territorio, actor, revisión esperada y nota normalizada.

Si main prefiere que la auditoría viva en otra tabla, debe conservar como mínimo territorio, actor, instante, revisión anterior/nueva, nota y UUID idempotente. No reutilizar `territorio_historial`: sus clases (`trabajado`, `bloqueo`, `excepcion`, `sin_dato`) no representan un retiro. No modificar `territory_map_versions` ni unidades publicadas para simularlo.

## 3. Preflight y RPC de confirmación

### `preflight_retirar_territorio(p_territory_id uuid)`

RPC de solo lectura lógica para el admin activo. Primero comprueba `public.is_admin(auth.uid())`. Devuelve `territory_id`, `already_retired`, `can_retire`, `observed_editor_revision`, `observed_at`, conteos y `blockers[]`. Cada bloqueador debe incluir al menos `tipo` e `id`; no devolver nombres personales innecesarios.

El preflight sirve para la pantalla, pero no reserva un lock después de responder. La RPC final repite todas las comprobaciones bajo lock y es la única autoridad.

### `retirar_territorio(p_territory_id uuid, p_expected_editor_revision integer, p_operation_id uuid, p_note text default null)`

RPC `security definer`, solo para `is_admin(auth.uid())`, sin privilegio DML directo para la app. La transacción debe:

1. Comprobar `auth.uid() is not null` y `public.is_admin(auth.uid())`; rechazar cualquier otro actor (`42501`). Tomar `territorios` por `id` con `FOR UPDATE`; rechazar inexistente, ya retirado solo como nueva operación o revisión esperada obsoleta (`40001`). Si `p_operation_id` ya existe, solo devolver el retiro como replay cuando coincidan exactamente territorio, `retired_by`, `p_expected_editor_revision`/`previous_editor_revision` y nota normalizada. Si el territorio ya está retirado y llega otro UUID, devolver `status = 'already_retired'`, el `existing_operation_id` y `replayed = false`, sin crear auditoría ni presentar ese estado como replay propio.
2. Repetir el preflight, incluyendo la consulta de resultados actuales y asignaciones exactas; `sin_dato` sigue bloqueando. Un preflight limpio de la UI nunca basta.
3. Fijar un único `v_retired_at` del servidor; actualizar solo el estado/metadata de `territorios` (`retired_at`, `retired_by`, `retirement_note`, `updated_at`) e incrementar `editor_revision` una vez usando el mismo criterio monotónico de publicación/geometría: `greatest(editor_revision, max(geometry_version), 0) + 1`.
4. Cerrar con ese mismo instante únicamente las filas abiertas de `territorio_manzanas` y `manzana_lados` (`vigente_hasta is null`), conservando IDs, geometrías, versiones, orden y medidas. No ejecutar `DELETE`, `cargar_manzanas_de_territorio`, `retirar_manzana` ni ningún cálculo de lados.
5. Insertar una sola fila en `territory_retirements` con la revisión anterior/nueva y el mismo instante. Si falla, revierte todo; no debe quedar el territorio retirado sin bitácora.
6. Devolver resumen de filas cerradas, revisión nueva, `operation_id` y estado. No tocar reservas, movimientos, grupos, salidas, resultados, cobertura, historial ni procedencia.

El retiro es irreversible desde este contrato: no existe `unretire` ni actualización de hechos históricos. Revertirlo requeriría una decisión y contrato separado.

## 4. Locks, carreras y frontera de escritura

No se debe resumir el orden como “padre primero” omitiendo advisory locks. Los órdenes relevantes que hoy existen son:

- Reservas y geometría: `solicitar_territorio`, `gestionar_reserva`, `asignar_territorio`, `agregar_manzana`, `retirar_manzana`, `cargar_manzanas_de_territorio` y `publicar_territorios_atomico` toman el territorio con `FOR UPDATE` (la publicación ordena varios territorios por `id`) y luego las filas dependientes.
- `informar_cobertura`: advisory del UUID del evento → `territorios FOR SHARE` → advisory del lado → `manzana_lados FOR SHARE`. El retiro espera el `FOR SHARE`; una marca nueva debe fallar por territorio retirado. Una marca offline pendiente no se remapea: queda pendiente/error explícito.
- `informar_resultado_salida`: hoy toma advisory del UUID del intento → advisory de la salida → `salidas FOR SHARE`, **sin lock del territorio**. La frontera propuesta para resultados es UUID → advisory de salida → `territorios FOR SHARE` → `salidas FOR SHARE`; el territorio debe adquirirse antes de la fila de salida. Una escritura inicial sobre territorio retirado se rechaza; una corrección admin append-only (`p_corrige_id` apuntando al resultado actual) puede continuar aunque el territorio ya esté retirado.

La RPC de retiro toma `territorios FOR UPDATE` y no debe tomar `FOR UPDATE` sobre filas de `salidas`: escanea sus relaciones bajo ese lock y deja que los writers de salida compartan el lock del territorio. Así se evita invertir el orden con la frontera de resultados. Todas las comprobaciones se repiten tras obtener el lock; no se confía en un snapshot de preflight.

Hay una incompatibilidad concreta que no resuelve un trigger trivial: `SalidasPage` todavía hace `INSERT`, `UPDATE` y `DELETE` directo de `salidas` (`src/pages/SalidasPage.tsx:1210-1213,1489-1500,1641-1645`), y un `UPDATE` toma primero el tuple lock de la salida antes de que un trigger pueda mirar el territorio. Si otro writer toma territorio → salida, puede producirse deadlock. Antes de habilitar T-01 se debe elegir una frontera única: revocar DML de `salidas` para `authenticated` y llevar esos tres caminos (incluido `SalidasGrupoPage`) a RPCs que tomen territorio → salida, o suspender/denegar esos writers durante el retiro. Un trigger puede quedar como defensa adicional de `retired_at`, pero no es la serialización principal ni debe adquirir el padre en sentido inverso.

La misma frontera debe impedir nuevas reservas/asignaciones, geometrías, asignaciones de grupo y salidas hacia un territorio retirado. `SanJuanMap` también debe rechazar metadata sobre un territorio retirado y usar `editor_revision`; su update directo no puede reabrir ni saltarse el retiro.

Tras el commit, falla cerrado toda **nueva actividad**: solicitar/asignar reserva, publicar/agregar/retirar geometría, insertar cobertura `app_hermano`/`cierre_salida`, informar un resultado inicial, crear/editar una salida futura, crear asignación de grupo y crear una unidad versionada ligada a ese legado. Excepciones permitidas: lectura histórica y correcciones administrativas append-only de cobertura (`origen = 'correccion'`, evento anterior del mismo lado) o de resultados (`p_corrige_id` del resultado actual), siempre con admin activo, motivo/linaje válido y sin alterar ni borrar el hecho original.

## 5. Consumidores activos y filtro correcto

No todos los lectores deben aplicar el mismo filtro: “corriente” excluye retirados; “histórico/as-of” conserva el territorio si era válido en el instante consultado.

| Consumidor activo | Punto leído/escrito | Regla posterior a T-01 |
| --- | --- | --- |
| `src/components/SanJuanMap.tsx:1665-1682` | Lista `territorios` y manzanas vigentes; `:1853-1865`, `:2573-2581`, `:2671-2688` escriben geometría/metadatos | Lista y edición solo `retired_at is null`; altas/retiro de manzana y metadata deben pasar por guard/revisión. El botón de retiro integral reemplazará el mensaje pendiente, no hará `DELETE`. |
| `src/pages/TerritorioPersonalPage.tsx:113-150,620-755` | Territorios, reservas/movimientos y RPC de decisión/asignación | Opciones nuevas solo vigentes; reservas históricas se leen y no se alteran. RPCs rechazan pedir/aprobar/asignar sobre retirado. |
| `src/pages/PredicacionPage.tsx:77-88,669-674,751-757` | Territorio propio, manzanas/lados vigentes, solicitudes y devolución | No ofrecer retiro como territorio corriente ni marcar lados vigentes retirados. Solicitud/devolución y cobertura respetan el guard. |
| `src/pages/PredicacionPage.tsx:1768-1798` (`HojaHistorial`) | Todas las geometrías y eventos para historia | **No filtrar por `vigente_hasta is null` ni ocultar por retiro**; reconstruir el instante histórico con la geometría que entonces era válida. |
| `src/pages/SalidasPage.tsx:621-648` y `src/pages/SalidasGrupoPage.tsx:1-4` | Catálogos, salidas y reservas; `:1210-1213`, `:1489-1500`, `:1641-1645` escriben salidas | Selector/alta/edición de salidas nuevas excluye retirados; salidas históricas permanecen consultables. La base bloquea especialmente una salida futura nueva o editada hacia el territorio. |
| `src/components/SalidaCoverageForm.tsx:42-46,90-94` | Lados/manzanas vigentes y cobertura de cierre | No cargar lados retirados para una operación nueva; el RPC rechaza una cola nueva que llegue después del retiro. Las correcciones históricas no pasan por este formulario y siguen su RPC append-only. |
| `src/pages/DashboardPage.tsx:153-162` y `src/lib/territorySuggestions.ts` | Conteos de salidas futuras, solicitudes y sugerencias | No contar ni sugerir territorios retirados como accionables; distinguir histórico de pendiente. |
| `src/lib/loadCoverageHeatmap.ts:12-22` / `src/components/CoverageHeatmapPanel.tsx` | Territorios, geometrías y eventos para heatmap | Vista corriente excluye retirados; consulta histórica incluye el territorio solo si el retiro ocurrió después del instante elegido. No cambiar cálculo de lados ni transferir eventos. |
| `supabase/migrations/20260903120000_versiones_y_linaje_territorial.sql:475-497` (`territorios_actuales`) | Vista de unidades publicadas | Debe filtrar el legado retirado al consumir `legacy_territory_id`; no editar/borrar versiones publicadas ni convertir su historia en vigente actual. |

No se encontraron lecturas frontend de `grupo_territorio`; sí existe la tabla y sus FKs. Tampoco se debe olvidar el cargador operativo `scripts/cargar-geometrias-y-lados.mjs:204-206`, que llama `cargar_manzanas_de_territorio`: su writer debe rechazar un territorio retirado antes de modificar geometrías.

## 6. Auditoría, pruebas y criterios de aceptación

Pruebas necesarias antes de declarar T-01 terminado, todas sobre DEV y sin borrar hechos:

- Preflight y RPC final requieren admin activo y bloquean por separado reserva `activa`, solicitud `solicitada`, salida futura sin resultado, salida futura con `sin_dato` y asignación vigente de grupo; los estados y filas bloqueadoras permanecen idénticos.
- Éxito en un territorio sin bloqueos: una sola fila de auditoría, UUID replay idempotente, `retired_at`/actor/nota/revisiones correctos, una marca de tiempo común y cierre de todas las geometrías abiertas. Verificar que no cambien IDs, GeoJSON, `orden`, `largo_m`, `rumbo_grados`, `geometry_version`, eventos, resultados, salidas, historial ni movimientos.
- Reintento con el mismo `operation_id` y payload exacto devuelve el mismo retiro; el mismo UUID con otro territorio, actor, revisión o nota falla. Un UUID distinto sobre territorio ya retirado devuelve `already_retired` con el `existing_operation_id` y `replayed = false`, sin duplicar auditoría.
- Carreras reales/locales con cada lock existente: solicitud/asignación, publicación, alta/retiro de manzana, cobertura, resultado, salida futura y grupo. La operación que tome primero el padre termina; la otra revalida y no deja una operación nueva tras el retiro. Verificar especialmente que el escritor directo de `UPDATE salidas` no quede habilitado junto a un orden de locks invertido.
- Después del commit, probar rechazo por RPC y por la frontera DML de nueva reserva, salida, cobertura, resultado, geometría, grupo y unidad versionada. Probar también admin inactivo/no admin.
- Tras el retiro, probar que un admin activo puede insertar una corrección histórica válida de cobertura y resultado mediante sus RPCs, y que un intento inicial de nueva marca/resultado sigue rechazado; ningún `UPDATE`/`DELETE` histórico es permitido.
- Lectura histórica: un evento y resultado anteriores siguen visibles con su geometría original; lectura corriente y sugerencias no muestran el territorio retirado. No usar una pantalla vacía como prueba de conservación.

Riesgo principal que queda para la implementación: la base protege `DELETE` de `territorios` para clientes, pero las escrituras directas de `SalidasPage`/`SanJuanMap` y los grants administrativos de tablas versionadas siguen existiendo. En especial, un trigger colocado detrás de un `UPDATE salidas` directo no es suficiente por el tuple-lock/deadlock descrito arriba. La aceptación debe demostrar una frontera única de serialización y todos los guards, sin confiar en filtros visuales ni en el éxito del preflight.

## Referencias leídas

- `supabase/schema.sql`.
- `supabase/migrations/20260902120000_cobertura_lados_y_puntos_encuentro.sql` y `20260902230000_redibujar_sin_perder_historia.sql`.
- `supabase/migrations/20260902200000_solicitud_de_territorio.sql` y `20260905020000_reservas_por_persona_y_decisiones.sql`.
- `supabase/migrations/20260905030000_cobertura_por_rpc_idempotente.sql`, `20260905040000_resultados_salida_por_rpc.sql`, `20260905060000_publicacion_atomica_editor.sql`, `20260905070000_manzanas_con_revision_compartida.sql` y `20260905080000_proteger_borrado_territorios.sql`.
- `supabase/migrations/20260903120000_versiones_y_linaje_territorial.sql`.
- `src/components/SanJuanMap.tsx`, `src/pages/PredicacionPage.tsx`, `src/pages/TerritorioPersonalPage.tsx`, `src/pages/SalidasPage.tsx`, `src/components/SalidaCoverageForm.tsx`, `src/lib/loadCoverageHeatmap.ts`, `src/pages/DashboardPage.tsx` y `scripts/cargar-geometrias-y-lados.mjs`.
