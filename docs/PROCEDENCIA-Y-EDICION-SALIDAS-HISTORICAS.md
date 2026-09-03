# Procedencia y edición de salidas históricas

## Estado

Implementado para la corrida auditada de DEV `rkmioktcsgqqjshrlkmy`. La
producción `dwgvzcnarrjgqjotocdw` queda fuera de alcance.

La corrida contiene 1.790 salidas importadas. Cada una conserva el texto exacto
que estaba en `salidas.notes` en `salida_importacion_procedencia.source_notes_raw`
y el objeto parseado en `source_payload`. Los campos consultables quedan
separados: alias escrito, alias relacionado, texto de priorización, narrativa,
estado de fuente y estado de resolución. La tabla es inmutable y está enlazada a
`importaciones`, `importacion_registros`, `importacion_aplicaciones` y `salidas`.

`salidas.notes` queda reservado para observaciones humanas. El backfill sólo lo
deja en `NULL` después de insertar y reconciliar las 1.790 filas; no reescribe
ningún territorio, conductor, grupo, punto ni horario.

Resultado verificado en DEV el 3 de septiembre de 2026:

- Aplicación `04786295-c896-466b-b4d5-17efdce96d5b` para la corrida
  `9e15fcde-fbeb-4520-930c-9cbd6fedad8b`, versión
  `2.1.0-salida-procedencia`.
- 1.790 procedencias, 1.790 `source_notes_raw` iguales al JSON fuente y 1.790
  objetos con forma válida; 1.781 alias exactos relacionados y 9 fuentes vacías
  o `-`, sin coincidencias no resueltas ni ambiguas.
- 1.790 `notes` quedaron sin JSON legado; las 1.790 salidas mantienen territorio,
  conductor, grupo, punto y GPS ausentes cuando la fuente no los aportaba.
- La staging completa quedó reconciliada: 3.346 filas, 3.275 aplicadas y 71
  cerradas como descartadas/auditables, 0 pendientes, 0 conflictos y 0 filas sin
  destino. Dentro del tipo salida quedaron 1.790 salidas y 64 cierres de fuente.

## Regla de alias

Se usa únicamente `lower(trim(alias))` contra `conductor_alias`:

- 1.781 filas tienen coincidencia exacta y guardan `source_conductor_alias_id`.
- 9 filas conservan el texto fuente vacío o `-` y no reciben alias.
- 0 filas quedan sin coincidencia y 0 quedan ambiguas.

Que exista un alias relacionado no asigna `salidas.driver_id`. La identidad
operativa se completa después, explícitamente, cuando haya evidencia.

## Edición progresiva

Una salida con `origen = 'excel'` o `registro_id` puede abrirse desde Salidas y
guardarse aunque todavía no tenga territorio, conductor, grupo, punto o GPS.
Los campos vacíos conservan el valor que ya estaba guardado; una edición
posterior agrega lo que se conozca. Un punto guardado sólo se vincula cuando la
persona lo elige explícitamente, y un punto de mapa requiere una marca manual.
El centro geométrico del territorio no se usa como sustituto.

La fecha y la hora se muestran, se conservan como el instante original y la
base impide cambiarlas junto con `tipo`, `origen`, `registro_id` y `created_at`.
La procedencia nunca entra al textarea. Cada cambio operativo de una salida
histórica queda en `salida_ediciones` con usuario, fecha, campos modificados y
snapshots anterior/posterior. La fuente y la bitácora son append-only; la
salida histórica tampoco se puede borrar.

## Aplicación segura

La migración es
`supabase/migrations/20260903200000_procedencia_y_edicion_salidas.sql`.
El cliente de aplicación es
`scripts/aplicar-procedencia-salidas.py`.

El flujo exige hash `1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2`,
parser `2.0.0-temporal`, exactamente 1.790 registros y JSON con las cinco
claves auditadas. Sin `--apply`, el script sólo ejecuta el preflight. Con
`--apply`, PostgreSQL bloquea la corrida, registra una aplicación, inserta la
procedencia, limpia el legado y reconcilia; una segunda ejecución devuelve
`already_completed` sin duplicar filas.

RPC disponibles sólo para `service_role`:

- `preflight_salida_importacion_procedencia(uuid)`
- `backfill_salida_importacion_procedencia(uuid)`
- `validate_salida_importacion_procedencia(uuid)`

## Pruebas

Las pruebas puras están en `tests/test_procedencia_salidas.py` y cubren el
destino DEV, preservación del JSON, alias vacío/ambiguo/no encontrado y
protección de fecha/procedencia. La validación remota reporta 1.790
procedencias, 0 JSON fuente en `notes`, 0 pérdida de texto fuente y una sola
aplicación completada de `2.1.0-salida-procedencia`.
