# Revisión crítica del plan de migración

> Contraste del plan de Codex y del informe de Luna Max contra el esquema y el código que hay hoy.
> No modifiqué nada. Fecha: 2 de septiembre de 2026.
>
> Leí: `docs/PLAN-MIGRACION-Y-SISTEMA-INTELIGENTE.md`, el informe de Luna Max,
> `supabase/schema.sql`, `src/pages/TerritorioPersonalPage.tsx`, `src/pages/SalidasPage.tsx`,
> `src/components/SanJuanMap.tsx` y el respaldo de producción del 1 de septiembre.

## Veredicto en una línea

El plan es sólido como diseño y su recomendación final —primero el resultado de la salida,
después el ranking— es correcta. Pero **da por sentado que los territorios de la app y los
del Excel son la misma cosa, y no lo son**. Hasta resolver eso, ninguna fase se puede empezar,
porque no hay a qué fila enganchar la historia.

Además hay dos defectos que ya existen hoy, sin migrar nada, y que el plan hereda sin verlos:
la tabla de grupos guarda personas, no grupos, y la autorización de salidas identifica al
usuario por el conductor equivocado.

---

## Bloqueantes

### B1 · La app tiene 69 territorios enteros; el Excel opera con 192 subterritorios

**Evidencia.** Respaldo de producción: `territorios` tiene 69 filas con `name` = `'1'` … `'69'`.
El informe de Luna: 192 códigos numéricos, bases 1 a 68, subcódigos `1.1`, `1.2`, …, `68.5`,
más 8 códigos especiales. De las 1.854 filas de agenda, 1.590 referencias primarias son
numéricas y en su mayoría son **subcódigos**.

**Riesgo.** Esas 1.590 referencias no tienen fila a la que apuntar. `territorio 4.1` no existe
en la base; existe `4`. Un ETL que resuelva "4.1 → territorio 4" está inventando una
equivalencia que nadie decidió, y sobre esa equivalencia se calcularía después el ranking y
el heatmap. También sobra un territorio: la app llega hasta 69 y el Excel hasta 68.

**Decisión humana, y es la primera de todas.** Hay tres caminos y no son equivalentes:

| Camino | Qué implica | Costo |
|---|---|---|
| Subdividir | Dibujar ~192 polígonos; los 69 actuales pasan a ser padres | Redibujar casi todo el mapa |
| Colapsar | La historia se guarda a nivel base; se pierde el detalle `1.1` vs `1.2` | Barato, pero el ranking pierde precisión donde el Excel sí la tenía |
| Convivir | `territorios` sigue siendo la unidad operativa y los subcódigos entran como `territory_units` junto a las manzanas | Intermedio; hay que decidir si un subterritorio es un conjunto de manzanas |

Mi lectura: la tercera. Un subterritorio del Excel y una manzana de la app son la misma
naturaleza —una parte de un territorio— y ya tenés 635 manzanas dibujadas. Pero es tu
decisión y **el resto del plan depende de ella**.

### B2 · `grupos_servicio` guarda personas, no grupos

**Evidencia.** 11 filas para 5 grupos. `group_number` 1 aparece dos veces: una fila
"Grupo 1 / Mateo Luna / superintendente" y otra "Grupo 1 / Eduardo Ponce / auxiliar".
No hay unicidad sobre `group_number`.

**Riesgo.** `salidas.group_id` apunta a **una** de las dos filas. Una salida del Grupo 1
queda colgada del superintendente o del auxiliar, arbitrariamente. Consecuencias directas:

- Filtrar "las salidas de mi grupo" da resultados incompletos según a qué fila se ató cada una.
- Es exactamente lo que rompe la función que pediste para la app del hermano: *"que puedan
  ver en su app si están asociados al grupo 1 qué salida es"*.
- El factor "equilibrio de rotación por grupo" del ranking contaría dos grupos donde hay uno.

**Propuesta.** `grupos` (número único, nombre) + `grupo_integrantes` (grupo, persona, rol,
vigencia). El plan lo pide en §8.3 pero como mejora futura; en realidad es una corrección de
un dato ya cargado, y hay que hacerla antes de importar 1.854 salidas contra `group_id`.

### B3 · La autorización de salidas identifica al usuario por el conductor, y el rol es del grupo

**Evidencia.** `supabase/schema.sql`, políticas "Group service users can …":

```sql
join public.grupos_servicio g on g.driver_id = p.driver_id
where p.id = auth.uid()
  and g.id = salidas.group_id
  and g.manager_role in ('superintendente', 'auxiliar')
```

**El problema.** `manager_role` describe a `manager_name`, que es **texto libre** y no es el
usuario. El usuario se identifica por `profiles.driver_id = grupos_servicio.driver_id`.
Es decir: quien pueda escribir las salidas de un grupo es **el conductor vinculado a esa fila**,
y el permiso se concede porque *otra persona* (la nombrada en `manager_name`) tiene rol de
superintendente. Son dos personas distintas y el SQL las trata como una.

Hoy funciona por casualidad: Fernando Pozo es a la vez el conductor de esa fila y su auxiliar.
Con 4 usuarios y 27 conductores, la coincidencia no se sostiene.

**Por qué es bloqueante.** El plan agrega "quién puede informar resultados y quién debe
aprobarlos" (§14.15) encima de esta base. Ampliar un modelo de permisos que ya identifica mal
al sujeto multiplica el error.

### B4 · Las formas de las manzanas viven fuera de la base — y eso lo introduje yo

**Evidencia.** `territorio_manzanas` guarda `label`, `lat`, `lng` (`numeric(9,6)`): un punto,
no un polígono. Las formas están en `public/datos/manzanas-territorios.json`, un archivo
estático **indexado por `territorios.name`**, que `SanJuanMap.tsx` lee para dibujar.

**Riesgo doble.**

1. `territorios.name` **no tiene índice único** (`create table territorios (… name text not null …)`).
   Hoy no hay duplicados, pero nada lo impide. Dos territorios "20" y el archivo le da las
   mismas formas a los dos.
2. Es una bifurcación de la verdad. Si un admin redibuja o renombra un territorio en la app,
   el archivo sigue con la geometría vieja y **no falla**: dibuja lo anterior en silencio.

Lo hice así a propósito para no tocar la BD cuando me lo pediste, y como puente está bien.
Como base de un heatmap por manzana, no: el plan dice correctamente (§7) que la geometría
tiene que estar en la base, y hasta que lo esté, cualquier cobertura por manzana se apoya en
un archivo que se puede desincronizar sin aviso.

### B5 · "El historial no se sobrescribe" no se consigue con RLS

**Evidencia.** Todas las políticas de admin son `for all … using (is_admin(...))`. `for all`
incluye `delete`. Un admin puede borrar cualquier fila de cualquier tabla.

**El punto técnico.** RLS filtra filas; no quita verbos. Para que `coverage_reports` y
`territory_assignment_events` sean realmente inmutables hay que **revocar el privilegio**:

```sql
revoke update, delete on public.territory_assignment_events from authenticated;
```

y dejar solo `insert` + `select`. Las correcciones entran como filas nuevas. El principio 3
del plan no tiene mecanismo detrás; sin esto es una intención, no una garantía.

---

## Importantes

### I1 · El ranking no tiene con qué calcularse hoy, y su insumo real es una sola pestaña

`salidas` tiene **0 filas** en producción. No hay ninguna cobertura registrada. El factor
dominante del ranking —"días desde la última cobertura confirmada", +0 a +35— sale casi
entero de una única fuente: `REGISTRO TERRITORIOS`, una grilla de 68 × 17 con 961 fechas.

**Discrepo del orden del plan.** La Fase 3 importa toda la historia (1.854 filas de agenda,
55 pestañas, formatos que cambian tres veces, 33 errores de fórmula). Esa es la parte cara,
sucia y lenta. La grilla de 68 × 17 es una sola pestaña, sin fórmulas, y da el 80% del valor
del ranking. Importaría **esa primero, sola**, y la agenda al final o nunca.

**Y una trampa de puntaje que nadie menciona.** En esa misma grilla, 70 celdas no son fechas
sino textos `bloq Yoli R`, `bloq vivi`, etc. Ocupan la posición de una fecha. Un territorio con
muchos bloqueos tiene **menos fechas**, así que se ve más viejo de lo que es y el ranking lo
va a subir por un motivo falso. Hay que contar los `bloq` como slots ocupados, no como
ausencia de actividad.

### I2 · El modelo nuevo perdería una garantía de concurrencia que ya tenés

El plan pregunta cómo evitar la doble reserva bajo concurrencia. **Ya está resuelto**, en el
esquema actual:

```sql
create unique index territorio_personal_reservas_active_unique_idx
  on territorio_personal_reservas (territory_id) where status = 'activa';
```

Es la respuesta correcta: la base lo impide, no la UI. Pero `territory_assignments` con
estados `requested / approved / active / returned / rejected / cancelled / expired` **no la
hereda**. Hay que reponerla explícitamente, sobre el conjunto de estados que bloquean:

```sql
create unique index on territory_assignments (territory_id)
  where status in ('approved', 'active');
```

Y ojo con §14.17 (¿una reserva puede abarcar parte de un territorio?) y §14.12 (el territorio 61
tiene dos zonas personales, "Por Ig. De la Roza" y "Por Meglioli"): si la respuesta es sí, un
índice único por territorio **ya no alcanza** y hace falta una restricción de exclusión o
reservas a nivel de unidad. Esa pregunta y este índice son la misma pregunta.

### I3 · `jsonb` no es geometría

No hay PostGIS. Con `polygon_geojson jsonb` no se puede consultar solapamiento, contención
ni área. Tres cosas que el plan promete lo necesitan: "geometrías superpuestas" (§11.2),
"agrupamiento geográfico/rutas" (P3) y un heatmap ponderado por superficie en vez de por
conteo de manzanas. Decisión: habilitar PostGIS (`create extension postgis`, la extensión está
disponible en Supabase) o aceptar por escrito que esas tres quedan del lado del cliente.

### I4 · La identidad de las personas está en tres lugares y ninguno es una FK

- `conductores` — 27 filas, tabla propia.
- `profiles` — 4 filas, con `driver_id` hacia conductores.
- `territorio_personal_reservas.reserved_for` — **texto libre**.
- `grupos_servicio.manager_name` — **texto libre**.

El plan propone `people` + `person_aliases` sin decir qué pasa con `conductores`. Y no puede
reemplazarla sin más: **las políticas RLS de salidas dependen de `profiles.driver_id`** (B3).

Lo más importante: `reserved_for` como texto es el mismo problema que las 55 variantes de
conductor del Excel, **reproducido dentro del sistema nuevo**. Vas a pedir "registrar bien el
movimiento de cada territorio por si alguien solicita territorio personal" y el registro va a
decir "Yoli R" sin saber quién es. Antes de importar los 9 personales del Excel y los 70 `bloq`,
`reserved_for` tiene que ser una FK a personas.

### I5 · La app del hermano ya genera el dato por manzana y lo tira

`vista-hermano.html` deja marcar cada manzana como recorrida. Ese estado vive en un `Set` de
JavaScript en el navegador: se pierde al recargar y no lo ve nadie más.

Es, literalmente, la primera fuente real de cobertura por manzana que va a tener el sistema
—más confiable que cualquier cosa reconstruida del Excel, porque la marca quien caminó la
manzana. No tiene tabla. `coverage_unit_results` debería existir **antes** de que esa pantalla
salga a los hermanos, o vas a acumular semanas de trabajo real sin registrar.

### I6 · La importación no es idempotente como está descrita

`import_batches` tiene hash del archivo, pero `source_rows` no declara clave natural.
Sin `unique (source_file_hash, source_sheet, source_row, source_cell)`, correr el ETL dos
veces duplica todo. Y las filas canonical necesitan `source_row_id` + upsert por esa clave
para que reprocesar sea reconciliable en vez de acumulativo. Es una línea de SQL y es la
diferencia entre poder reintentar y no poder.

### I7 · Privacidad: el heatmap no puede llevar el nombre encima

`territorio_personal_reservas` es legible por cualquiera con el módulo `salidas` o
`salidas_grupo`, y `reserved_for` es el nombre de una persona. Si el heatmap general pinta
"reservado" con tramado (bien, §7.1), el payload que llega al navegador **no debe incluir
para quién**. Lo mismo con los 70 `bloq <nombre>`: son datos personales dentro de una grilla
de rotación. Una vista `territory_current_status` que exponga `assigned: true` sin
`assigned_to` resuelve el 90%.

### I8 · `module_key` es un `check` con la lista escrita a mano

```sql
check (module_key in ('mapas','conductores','grupos','salidas','salidas_grupo','territorio_personal'))
```

Cada módulo nuevo del plan —informes, heatmap, recomendaciones, calidad— es una migración que
altera el constraint. Conviene una tabla `modulos` con FK. Menor, pero se paga cuatro veces.

---

## Opcionales

- **O1 · Consorcios no justifica una tabla todavía.** De 72 filas, solo 7 tienen consorcio,
  6 tienen calles, 6 tienen departamentos, y `COMPLETO` es `False` en las 72. Es andamiaje
  vacío. El plan lo pone como §11.11 condicional; los datos dicen que la condición no se cumple.
- **O2 · `Tareas` (13 filas, una hecha) no es historia.** No migrar.
- **O3 · Los 39 destinos de Maps reutilizados** probablemente sean puntos de encuentro
  compartidos, que es justamente lo que `meeting_points` resuelve. Confirma el diseño del plan.

---

## Respuestas a las diez preguntas del §16

1. **¿Evolucionar o crear tablas nuevas?** Mixto. `territorios`, `conductores` y
   `grupos_servicio` tienen datos reales y correctos → evolucionar con `alter table`.
   `salidas` tiene **0 filas** → reemplazar sin costo. Todo lo de resultados, cobertura,
   asignaciones y recomendaciones es nuevo. La única migración de datos verdadera es
   `territorio_personal_reservas` (0 filas hoy) y `grupos_servicio` (11 → 5 + integrantes).
2. **¿Doble reserva bajo concurrencia?** Índice único parcial (ver I2). Ya lo tenés; hay que
   no perderlo. Si las reservas pueden ser parciales, exclusión con PostGIS o filas por unidad.
3. **¿Qué es inmutable?** Inmutables (revocar `update`/`delete`): `source_rows`,
   `coverage_reports`, `coverage_unit_results`, `territory_assignment_events`,
   `recommendation_runs`/`items`. Editables: catálogos (`territorios`, `people`, `grupos`,
   `meeting_points`), configuración de pesos, y la **planificación** de una salida mientras
   siga `planned`.
4. **¿Versionar geometrías?** `geometry_version` + `valid_from`/`valid_to`, y que la cobertura
   apunte a `territory_unit_id` (estable) **y** guarde la versión vigente al momento del informe.
   Nunca borrar una geometría: cerrarla.
5. **¿Qué métricas son confiables el día uno?** Solo dos: **días desde la última asignación**
   (de `REGISTRO TERRITORIOS`, a nivel base, corrigiendo los `bloq`) y **si está reservado o
   bloqueado hoy**. El porcentaje de manzanas pendientes **no** es confiable hasta que la app
   registre cobertura: hoy sería 100% pendiente en los 69 territorios.
6. **¿RLS por rol?** El modelo actual mezcla dos ejes: `profiles.role` y `user_module_access`.
   Antes de agregar roles hay que arreglar B3. Sugerencia: el rol define **qué puede hacer**
   (leer / informar / aprobar / administrar) y el módulo **dónde**; el vínculo con el grupo
   sale de `grupo_integrantes`, no de `driver_id`.
7. **¿Qué parte es SQL, script y humano?** Extracción y normalización → script (Python, fuera
   de la base). Carga raw y vistas derivadas → SQL. Humano: años dudosos, `68.5`, `32.2`,
   alias de personas, precedencia booleano/observación. Regla: **el script nunca decide, marca**.
8. **¿Idempotencia?** Clave natural en `source_rows` + upsert por `source_row_id` (I6).
9. **¿Qué datos no salen a mapas ni logs?** Nombres de asignatarios y textos `bloq …` (I7).
   Y el enlace de Zoom con credencial: fuera del catálogo, sí o sí.
10. **¿Qué le falta a una recomendación para ser defendible?** Que muestre **de qué fila del
    Excel o de qué informe salió cada factor**. Un puntaje sin trazabilidad hasta la evidencia
    es una opinión con decimales.

---

## Orden que propongo, distinto del plan

El plan termina bien (§18) pero mete la importación masiva antes de tiempo. Yo haría:

| # | Paso | Por qué antes |
|---:|---|---|
| 0 | **Decidir la granularidad** (B1) y unicidad de `territorios.name` | Todo lo demás depende |
| 1 | Arreglar `grupos_servicio` → grupos + integrantes (B2) y la RLS de salidas (B3) | Son defectos vivos, no deuda futura |
| 2 | Geometría de manzanas a la base (B4) | Mata el archivo estático y habilita el heatmap |
| 3 | `coverage_reports` + `coverage_unit_results`, append-only (B5, I5) | Es lo que la app del hermano ya produce |
| 4 | Importar **solo** `REGISTRO TERRITORIOS` (I1) | Una pestaña, sin fórmulas, da el ranking |
| 5 | Asignaciones con persona real (I4) + índice de exclusividad (I2) | El "movimiento del territorio" que pediste |
| 6 | Heatmap general, y el individual cuando haya cobertura propia | Ya hay datos honestos |
| 7 | Ranking explicable | Recién acá tiene fundamento |
| — | Las 1.854 filas de agenda | Caro, sucio, y en gran parte redundante con el paso 4 |

## Criterios de aceptación que agregaría

- Ningún territorio tiene dos filas con el mismo `name`; existe el índice único que lo impide.
- Un grupo es una fila; sus integrantes son N. Toda salida del Grupo 1 se recupera con una
  sola consulta.
- Un usuario sin `driver_id` puede tener permisos de su grupo (hoy no puede).
- Redibujar un territorio en la app cambia lo que se ve en el mapa del hermano, sin tocar
  ningún archivo a mano.
- Un admin no puede borrar un informe de cobertura: la corrección es una fila nueva.
- El heatmap devuelve "reservado" sin devolver para quién.
- El ETL corrido dos veces deja la base idéntica.

## Lo que no revisé

- El XLSX en sí: trabajé sobre el informe de Luna Max, no sobre el archivo.
- Los 3.171 renglones de `SanJuanMap.tsx` en detalle; miré la carga de formas y de manzanas.
- El permiso de Drive y el enlace de Zoom: es correcto lo que dice el plan, pero son acciones
  tuyas sobre tu cuenta, no mías.
