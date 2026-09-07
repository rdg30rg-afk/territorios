# Plan: roles, grupos de servicio y Vista del hermano por rol

Fecha: 7 de septiembre de 2026. Base revisada: clon DEV (`rkmioktcsgqqjshrlkmy`). Producción no se toca.
Para quien implementa (Grok): leé entero. Reglas de trabajo en la sección 12. Este plan se apoya en `docs/PLAN-PUNTOS-DE-ENCUENTRO-2026-09-06.md` (ya aplicado) y convive con `docs/PLAN-ROTACION-Y-PROPUESTA-DE-PROGRAMA-2026-09-06.md` (pendiente).

## 0. Qué se vio en las capturas y por qué pasa

| Captura | Problema | Causa en el código |
|---|---|---|
| Lista «Mirar el territorio» | `<select>` nativo del sistema (gris, chico, sin la identidad, 70 opciones en una lista de iOS). | `PredicacionPage.tsx` ~1253: `<select className="boton chico">`. No hay desplegable propio del hermano; `Desplegable.tsx` es del panel admin (38 px, mouse). |
| Tarjeta oscura «Tu territorio 4 · Te faltan 9 · Cuadras: 37 sin dato» | Se muestra **aunque el hermano solo esté consultando**. Dice «Tu territorio» y «Te faltan» de un territorio que no es suyo ni pidió. «0 de 9 recorridas · Sin información suficiente» y «37 sin dato» son ruido para alguien que solo mira. | ~1304: la condición es `miTerritorio && !sinDibujo`; no mira `asignado`. El rótulo, las cifras y la línea «Cuadras» son fijas. |
| «Salidas de Grupos · 10:00 · Cómo llegar: En auto / En colectivo» | Botones de «cómo llegar» a **ninguna parte**: la salida de grupos no tiene lugar único, cada grupo sale de su punto. Además el hermano no sabe cuál es su grupo ni su punto. | `sePuedeLlegar` excluye `tipo === 'grupos'`, pero esas filas tienen `tipo = null`: el ETL (`classify_salida_type`) solo marca `grupos` si el texto contiene «grupo», y en el Excel la columna trae el código **`SG`**. El nombre «Salidas de Grupos» viene del punto especial `SG`. Con `lugar` texto, `urlComoLlegar` arma una búsqueda de Google Maps de la frase «Salidas de Grupos». |

Tres bugs concretos, y detrás un hueco de modelo: **la app no sabe a qué grupo pertenece una persona.**

## 1. Lo que existe hoy (verificado)

- `profiles.role`: `admin | superintendente | siervo | conductor | viewer`. `access_status`: `pending | active | inactive`. `driver_id` opcional. **No hay `group_id`.**
- Alta: «Solicitar acceso» → `signUp` → trigger crea profile `viewer/pending` → el admin autoriza desde `UserAccessPanel` (Dashboard). No hay invitaciones ni código de grupo.
- `grupos_servicio`: `group_number`, `group_name`, `driver_id` (el conductor que es su encargado), `manager_name`, `manager_role (superintendente|siervo|auxiliar)`. **No hay tabla de miembros.** La única pertenencia posible es «soy el conductor encargado» (`serviceGroupAssignments` en `SalidasPage`).
- `user_module_access`: módulos del panel (`mapas, conductores, grupos, salidas, salidas_grupo, territorio_personal`). Es permiso de pantalla, no pertenencia.
- Landing: activo sin módulos → `/predicacion`; admin o con módulos → panel.
- Reserva de territorio personal: `solicitar_territorio` (cualquier activo), `gestionar_reserva`/`asignar_territorio` **solo admin**. Los textos del hermano dicen «cuando el siervo de tu grupo responda», pero el siervo no puede responder.
- Vista del hermano: pestañas Hoy / Salidas / Mi territorio. Si `driver_id`, aparece «Resultado de las salidas» (sus salidas). No hay «mis salidas» ni «mi grupo». `MiCuenta` solo edita el nombre.
- Salidas con `tipo='grupos'`: chip «Cada grupo por su lado» y sin botones. Pero las 
  filas `SG` del Excel quedaron con `tipo = null` (ver 0).

## 2. Las personas (quién entra y a qué viene)

| Persona | Rol en `profiles` | Dispositivo y momento | Viene a |
|---|---|---|---|
| **Publicador** | `viewer` | Teléfono, en la esquina, con sol | Dónde y a qué hora es la salida. Dónde sale **mi grupo** el sábado. Mi territorio personal si tengo uno. |
| **Conductor raso** | `conductor` (+ `driver_id`) | Teléfono | Lo mismo que el publicador **más**: cuáles son **mis** salidas, informar resultado y cuadras al terminar. |
| **Superintendente / auxiliar de grupo** | `superintendente` o `siervo` (+ `driver_id` si conduce) | Teléfono en el día a día; PC para armar el programa del grupo | Lo del conductor **más**: mi grupo (quiénes son), aprobar a los que piden entrar, definir el punto de encuentro del grupo, dar territorio personal a alguien de mi grupo, ver/armar las salidas del grupo. |
| **Siervo de territorios (admin)** | `admin` | PC | Todo el panel. |
| **Invitado / recién llegado** | sin cuenta → `viewer/pending` | Teléfono | Entrar con el código de su grupo y ver el programa **sin esperar días**. |

Regla que ordena todo: **hay una sola app para el teléfono (`/predicacion`) y un solo panel para la PC.** No se hace una tercera app para conductores ni otra para superintendentes. En el teléfono cada rol ve **más secciones**, no otra pantalla. En el panel, el super de grupo ya tiene `/salidas-grupo`; se le suma lo de su grupo (miembros, punto, solicitudes), y nada más.

## 3. Modelo de datos (migración `20260908020000_grupos_miembros_e_invitaciones.sql`)

### 3.1 `grupo_miembros` — quién es de qué grupo

```sql
create table public.grupo_miembros (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references grupos_servicio (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  rol_en_grupo text not null default 'publicador'
    check (rol_en_grupo in ('publicador','conductor','auxiliar','superintendente')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','confirmado','retirado')),
  desde date not null default current_date,
  hasta date,
  confirmado_por uuid references profiles (id),
  confirmado_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index grupo_miembros_vigente_idx on grupo_miembros (profile_id) where hasta is null;
```

Una persona pertenece a **un** grupo vigente. Cambiar de grupo = cerrar (`hasta`) y abrir otra fila. El historial queda.

**Sembrado inicial**: por cada `grupos_servicio` con `driver_id` cuyo conductor tenga un `profiles.driver_id` igual → fila `confirmado` con `rol_en_grupo = manager_role` (`siervo` del Excel se mapea a `superintendente`). Los `admin` no se siembran en ningún grupo (pueden estar, pero lo decide el admin).

### 3.2 `grupo_invitaciones` — el código para entrar

```sql
create table public.grupo_invitaciones (
  group_id uuid primary key references grupos_servicio (id) on delete cascade,
  codigo text not null unique,            -- 6 letras sin ambigüedad (sin O/0/I/1), ej. 'KPMRTX'
  activo boolean not null default true,
  renovado_por uuid references profiles (id),
  renovado_at timestamptz not null default now()
);
```

Un código por grupo, renovable por el super o el admin. Se comparte por WhatsApp. **No es un secreto fuerte**: da acceso a ver el programa (que ya circula por WhatsApp), nunca a marcar ni a administrar.

### 3.3 Puntos de encuentro de grupo

`puntos_encuentro` ya tiene `tipo in ('territorial','especial')`. Se agrega `'grupo'` y `group_id uuid references grupos_servicio`. Cada grupo tiene **un** punto activo (índice único parcial `(group_id) where tipo='grupo' and activo`). Lo define el super o el admin; con GPS por mapa (el `MeetingPointPickerMap` existente) o link de Maps.

### 3.4 `salidas.tipo` para los códigos especiales

Backfill idempotente: `update salidas set tipo = 'grupos' where tipo is null and upper(btrim(territorio_codigo)) in ('SG')`. Idem `SR`, `SS` → `'especial'` (reunión de servicio / servicio especial: confirmar con Mateo el significado; hasta que no se confirme, `'especial'`). Y en el RPC `crear_salidas_lote`/`crear_salida`/`editar_salida`: si el `meeting_point_id` apunta a un punto `tipo='especial'` con código `SG`, setear `tipo='grupos'`. El ETL (`classify_salida_type`) aprende `sg → grupos`, `sr/ss → especial`.

### 3.5 Excepciones por fecha para la salida de grupo (opcional, segunda pasada)

`grupo_salida_excepciones (group_id, fecha, meeting_point_id, hora, nota)`: «este sábado el grupo 3 sale de otro lado». Si no hay fila, vale el punto del grupo. Se deja para después de que lo básico funcione; anotar en QUE-FALTA.

### 3.6 Perfil, en una sola consulta

Vista `mi_contexto` (security invoker, filtra por `auth.uid()`): `profile_id, role, access_status, driver_id, full_name, group_id, group_number, group_name, rol_en_grupo, miembro_estado, punto_grupo_id, punto_grupo_nombre, punto_grupo_lat, punto_grupo_lng, es_super_de_grupo` (`rol_en_grupo in ('superintendente','auxiliar') and estado='confirmado'`). `AuthContext` la carga junto al profile y la expone como `contexto`.

### 3.7 RPCs

| RPC | Quién | Qué hace |
|---|---|---|
| `unirme_a_grupo(p_codigo)` | activo **o pending** | Busca el código; crea `grupo_miembros` `pendiente`. Si el profile está `pending`, **lo pasa a `active` con rol `viewer` y sin módulos** (ver 4). Devuelve el grupo. |
| `confirmar_miembro(p_miembro_id, p_accion)` | admin, o super/auxiliar confirmado **del mismo grupo** | `confirmar` / `rechazar` (→ `retirado` con nota) / `cambiar_rol` (solo entre `publicador` y `conductor`; `auxiliar`/`superintendente` solo admin). |
| `definir_punto_de_grupo(p_group_id, p_nombre, p_lat, p_lng, p_maps_url)` | admin o super del grupo | Desactiva el anterior, crea el nuevo (`tipo='grupo'`). |
| `renovar_codigo_grupo(p_group_id)` | admin o super del grupo | Nuevo código. |
| `gestionar_reserva` (**modificar**) | + super/auxiliar confirmado **del grupo del solicitante** | Hoy solo admin. La regla nueva: aprobar/rechazar reservas de miembros de su grupo. `asignar_territorio` idem, solo a miembros de su grupo. Los textos «cuando el siervo de tu grupo responda» pasan a ser verdad. |
| `salir_de_mi_grupo()` | el propio | Cierra la fila (`hasta = hoy`). |

RLS: `grupo_miembros` legible por el propio, por admin y por super del mismo grupo. `grupo_invitaciones` legible por admin y super del grupo (el código no se lista a todo el mundo). `puntos_encuentro` ya es legible por `authenticated`.

## 4. Entrar a la app: el camino del invitado

Hoy: se registra → se le cierra la sesión → «un administrador debe autorizar» → espera días → el admin lo busca en una lista sin saber quién es.

Propuesto:

1. `LoginPage`, pestaña «Solicitar acceso»: se agrega **«Código de tu grupo (te lo pasa el superintendente)»**, opcional.
2. Con código válido: al crear la cuenta se llama `unirme_a_grupo` → queda `active`, `viewer`, sin módulos, miembro `pendiente` del grupo. **Entra ya** a `/predicacion` y ve el programa y la salida de su grupo. Arriba una nota: «Estás en el Grupo 3 esperando que te confirmen. Mientras, podés ver el programa.»
3. Sin código: como hoy (`pending`, espera al admin). El mensaje pasa a decir «Si tenés el código de tu grupo, volvé a entrar y ponelo: entrás al instante.»
4. Lo que puede hacer un miembro `pendiente`: ver Hoy, Salidas, salida del grupo, consultar territorios. **No** puede pedir territorio personal ni marcar. Eso se abre al confirmarlo.
5. El super ve en «Mi grupo» a los pendientes con dos botones de 56 px: **Confirmar** / **No es del grupo**.

Por qué es seguro suficiente: un `viewer` sin módulos y sin `driver_id` no puede escribir nada salvo pedir un territorio (y eso queda bloqueado hasta confirmar). Lo que ve es el programa que ya va por WhatsApp.

## 5. Vista del hermano por rol (teléfono, `/predicacion`)

Se mantienen **tres pestañas** para todos: **Hoy · Salidas · Mi territorio**. Lo que cambia por rol es qué paneles aparecen dentro, en este orden. Nada nuevo abajo: una cuarta pestaña rompe el pulgar en pantallas chicas y la regla «56 px» ya ocupa el ancho.

### 5.1 Hoy

| Panel | Publicador | Conductor | Super/auxiliar | Notas |
|---|---|---|---|---|
| Saludo + «Hoy no hay salida / La salida de hoy» | ✓ | ✓ | ✓ | Como hoy. |
| **«Tu grupo sale»** (nuevo) | ✓ si tiene grupo | ✓ | ✓ | Ver 6. Reemplaza el sinsentido «Salidas de Grupos · En auto». |
| «Sos el conductor de…» (nuevo) | — | ✓ si hoy/mañana conduce | ✓ si conduce | Tarjeta lima con hora, territorio, punto, botón «Informar resultado» si ya empezó. |
| «Tu territorio» | ✓ | ✓ | ✓ | Solo si **asignado**. Si no: «Todavía no tenés uno. Podés pedirlo en Mi territorio.» |
| «Tu grupo» (nuevo, resumen) | — | — | ✓ | «Grupo 3 · 14 hermanos · **2 esperan confirmación**» → abre la hoja Mi grupo. |
| Sin grupo (nuevo) | ✓ | ✓ | — | «Todavía no estás en un grupo. Pedile el código al superintendente y ponelo acá.» + campo de código de 6 letras (teclado mayúsculas, 56 px). |

### 5.2 Salidas

| Panel | Publicador | Conductor | Super | Notas |
|---|---|---|---|---|
| Lista del programa | ✓ | ✓ | ✓ | Como hoy. Las filas `tipo='grupos'` muestran «Tu grupo sale de …» si tiene grupo; si no, «Cada grupo por su lado · preguntá en tu grupo». **Sin botones de llegar** salvo que haya punto de grupo con GPS. |
| Filtro «Las mías» (nuevo) | — | ✓ | ✓ si conduce | Un interruptor de 56 px arriba: «Todas / Las que conduzco». |
| Filtro «Las de mi grupo» (nuevo) | — | — | ✓ | Salidas con `group_id` del grupo. Cuando se use el programa por grupo. |
| «Resultado de las salidas» | — | ✓ | ✓ si conduce | Existe. El `<select>` nativo se cambia por el mismo `ElegirDeLista` de 6.3. |

### 5.3 Mi territorio

| Estado | Título | Qué se ve |
|---|---|---|
| Asignado | «Mi territorio» | Tarjeta oscura con cifras, «Te faltan N», marcar, historial, devolver. **Como hoy.** |
| Consultando (no asignado) | «Consultar territorio» | Panel «Estás mirando, no marcando» + `ElegirTerritorio` (6.2). Debajo, **tarjeta clara** (no oscura) «Territorio 4 · Solo consulta»: mapa chico, «Dónde queda», botón «Abrir el mapa en grande». **Sin** «Tu territorio», **sin** «Te faltan», **sin** «Cuadras: 37 sin dato». Si hay cobertura con dato: una línea neutra «Así está hoy: 3 de 9 manzanas recorridas». Si no hay dato: nada. Botón «Pedir este territorio» (solo miembro confirmado o cuenta activa sin grupo — como hoy). |
| Solicitado | «Consultar territorio» | Igual + nota «Pediste el 4. Cuando el superintendente de tu grupo o el siervo de territorios lo confirme, lo vas a ver acá.» |
| Rechazado | idem | Nota con el motivo, como hoy. |
| Sin dibujo | idem | Vacío «todavía no está en el mapa», como hoy. |
| Miembro pendiente de grupo | «Consultar territorio» | Se puede mirar. El botón «Pedir» aparece deshabilitado con «Cuando te confirmen en el grupo vas a poder pedirlo». |

### 5.4 Mi grupo (hoja nueva, solo super/auxiliar; se abre desde Hoy)

Una **hoja** (`.sobre`, como Historial) con cuatro bloques, en este orden:

1. **Esperan confirmación** (arriba de todo si hay): nombre, «se sumó hace 2 días», botones Confirmar / No es del grupo.
2. **La salida del grupo**: punto actual (nombre, barrio, «GPS listo» o «Falta el GPS»), botón «Cambiar el punto» → hoja con `BuscadorPunto` (permite elegir un punto existente **o** escribir una esquina) + mapa para marcar.
3. **Código para sumarse**: `KPMRTX` en grande, botón «Compartir por WhatsApp» (`https://wa.me/?text=...` con el texto armado) y «Cambiar el código».
4. **Hermanos del grupo**: lista, con rol (Publicador / Conductor / Auxiliar / Super). Tocar uno → acciones: «Darle un territorio» (lista de territorios libres → `asignar_territorio`), «Es conductor» / «Ya no conduce» (cambia `rol_en_grupo`; **no** crea `conductores`: eso lo hace el admin), «Sacarlo del grupo».

Lo que **no** hace el super desde el teléfono: crear conductores, tocar módulos del panel, editar el programa general. Eso es del panel.

### 5.5 Mi cuenta

Se suma: grupo actual («Grupo 3 · Publicador»), «Cambiar de grupo» (pide código nuevo; cierra la fila anterior), y si es conductor: «Sos conductor vinculado a: Juan Pérez».

## 6. Componentes nuevos del hermano (estilo `vista-hermano.css`, reglas 16 px / 56 px / icono + palabra)

### 6.1 `TarjetaGrupo` («Tu grupo sale»)

Para la salida `tipo='grupos'` del día (o la próxima):

- Con grupo y punto con GPS: «**Tu grupo sale** · sábado 10:00 · Rastreador Calivar y Fontanarrosa · Bo. SOEVA 3 · Grupo 3» + `BotonesComoLlegar` con las coords del punto del grupo.
- Con grupo, punto sin GPS: igual, sin botones, y una línea «El punto no tiene ubicación todavía» (el super la ve con un botón «Marcarla»).
- Con grupo, sin punto: «Tu grupo todavía no cargó dónde se junta. Preguntale al superintendente.»
- Sin grupo: «El sábado cada grupo sale por su lado. Sumate al tuyo con el código.» + campo de código.
- Miembro pendiente: como «con grupo» (ver el punto es inocuo) más la nota de «esperando confirmación».

### 6.2 `ElegirTerritorio`

Reemplaza el `<select>`. Una hoja (`.sobre`) que se abre con un botón de 56 px «Elegir territorio · 4 ▾»:

- Arriba, campo de búsqueda numérico («Número del territorio»), teclado numérico (`inputMode="numeric"`).
- Debajo, **grilla de botones** 4 por fila, 56 px de alto, con el número grande. 70 territorios = 18 filas; con el buscador se llega en un toque. Cada botón muestra un puntito con palabra si corresponde: «Tuyo», «Pedido», «Reservado» (por otro), nada si está libre.
- Elegir cierra la hoja. Escape/atrás también.

### 6.3 `ElegirDeLista`

Genérico para las otras listas del hermano (salida a informar, territorio asignado cuando tiene varios): botón de 56 px que abre hoja con opciones de 56 px, una por renglón, con texto principal y secundario. Sustituye a los tres `<select className="boton…">` que hay en `PredicacionPage`.

### 6.4 `CampoCodigoGrupo`

Seis casilleros grandes (o un input con `letter-spacing`), mayúsculas automáticas, botón «Entrar al grupo». Errores en palabras: «Ese código no es de ningún grupo. Fijate si lo copiaste bien.»

## 7. Panel admin (PC): lo mínimo que cambia

- **Grupos** (`GruposPage`): en la ficha de cada grupo, pestaña «Hermanos» (lista `grupo_miembros`, confirmar/rol/sacar), «Punto de encuentro del grupo», «Código de invitación» (ver/renovar). El admin puede hacer todo lo que hace el super, para todos los grupos.
- **Dashboard → `UserAccessPanel`**: columna «Grupo» (solo lectura, con enlace al grupo) y contador «N esperan confirmación de su grupo».
- **`/salidas-grupo`**: sin cambios de fondo. Cuando se guarden salidas del grupo, `group_id` ya viaja. Los publicadores de ese grupo ven «Las de mi grupo».
- **Territorio personal** (`TerritorioPersonalPage`): mostrar el grupo del solicitante y quién aprobó (admin o super).

## 8. Matriz de variantes y combinaciones (cada una con test o motivo visible)

| # | Situación | Qué pasa |
|---|---|---|
| 1 | Publicador sin grupo, sin territorio | Hoy: programa + «Sumate a tu grupo con el código». Mi territorio: consultar, puede pedir. |
| 2 | Publicador con grupo confirmado | Hoy: «Tu grupo sale» con punto del grupo. Puede pedir territorio; lo aprueba su super o el admin. |
| 3 | Publicador miembro **pendiente** | Ve todo lo de lectura; no puede pedir territorio ni marcar. Nota de «esperando confirmación». |
| 4 | Publicador rechazado por el super («No es del grupo») | Vuelve a «sin grupo» con nota «El Grupo 3 no te confirmó. Si es un error, hablá con el superintendente.» Puede poner otro código. |
| 5 | Se registra con código válido | Entra al instante (`active`, `viewer`). |
| 6 | Se registra con código inválido | Error claro; puede seguir sin código (queda `pending` como hoy). |
| 7 | Se registra sin código | Como hoy. Mensaje sugiere pedir el código. |
| 8 | Cuenta `inactive` con código | No entra. `unirme_a_grupo` rechaza `inactive` (solo el admin reactiva). |
| 9 | Conductor con `driver_id`, sin grupo | Ve «Las que conduzco», «Sos el conductor de…», resultado y cuadras. Sin «Tu grupo sale» → «Sumate». |
| 10 | Conductor en grupo, conduce hoy | Tarjeta «Sos el conductor de la salida de hoy» arriba de «La salida de hoy» (no duplicar: si es la misma, una sola tarjeta con la marca «Conducís vos»). |
| 11 | Conductor que es `rol_en_grupo='conductor'` pero sin `driver_id` | No puede informar (regla `canReportSalida` exige `driver_id`). En Mi cuenta: «Todavía no te vincularon como conductor. Pedíselo al siervo de territorios.» |
| 12 | Super de grupo sin `driver_id` | Ve Mi grupo; no ve «Las que conduzco» ni resultado. |
| 13 | Super que además conduce | Todo junto. |
| 14 | Super confirmado del grupo 3 intenta confirmar a alguien del grupo 5 | RPC rechaza. UI ni lo muestra. |
| 15 | Super aprueba reserva de un miembro pendiente | RPC rechaza: el solicitante debe ser miembro confirmado (o la aprueba el admin). |
| 16 | Persona que ya tiene territorio activo pide otro | Regla existente (una activa por persona, si la hay; si no la hay, definirla: máximo 1 activa por persona salvo admin). |
| 17 | Admin entra a `/predicacion` | Ve como conductor si tiene `driver_id`, más «Resultado» de todas (como hoy). No ve Mi grupo salvo que sea miembro super de uno. |
| 18 | Grupo sin punto de encuentro | «Tu grupo sale» dice que falta; super ve «Cargar el punto». |
| 19 | Grupo con punto sin GPS | Sin botones de llegar; super ve «Marcar la ubicación». |
| 20 | Punto de grupo creado desde un punto territorial existente (mismo lugar que 61.1) | Se crea un punto `tipo='grupo'` **aparte** copiando nombre/barrio/GPS. No se reutiliza el territorial (tienen ciclos de vida distintos). |
| 21 | Salida `SG` del Excel con `tipo=null` | Backfill → `grupos`. Test: ninguna salida con código `SG` tiene botones de llegar. |
| 22 | Salida `tipo='grupos'` para alguien sin grupo | «Cada grupo por su lado. Sumate al tuyo.» Sin botones. |
| 23 | Salida `SR`/`SS`/`ZO`/`AC`/`AR` | `especial`/`asamblea`: sin botones de llegar salvo que tengan GPS propio (asamblea sí puede tener lugar). Regla: botones **solo con lat/lng**, nunca con texto solo. |
| 24 | Consultar territorio ajeno reservado | Se puede mirar. Botón «Pedir» deshabilitado con «Lo tiene Yolanda R.». |
| 25 | Consultar territorio sin dibujo | Vacío «todavía no está en el mapa». |
| 26 | Consultar territorio con cobertura | Línea neutra «Así está hoy: 3 de 9». Sin «Te faltan». |
| 27 | Consultar territorio sin cobertura | Sin línea de cifras. Nada de «Sin información suficiente» ni «37 sin dato». |
| 28 | Cambio de grupo | Mi cuenta → código nuevo → fila anterior cerrada, nueva `pendiente`. Pierde «Tu grupo sale» del viejo al instante. |
| 29 | Super renueva el código | El viejo deja de servir. Los ya adentro no se afectan. |
| 30 | Dos grupos con el mismo `driver_id` encargado (dato sucio) | El sembrado toma el de menor `group_number` y lo anota en el log de migración; el admin corrige en Grupos. |
| 31 | Offline | «Tu grupo sale» y el punto del grupo se cachean con el programa (mismo mecanismo que `salidas`). Unirse/confirmar requiere red: botón deshabilitado con «Sin conexión». |
| 32 | Teléfono chico (320 px) | Grilla de `ElegirTerritorio` pasa a 3 por fila. Casilleros del código 6 × 44 px mínimo (excepción documentada a los 56: es un solo control). |
| 33 | Lector de pantalla | Hojas con `role="dialog"`, foco al abrir, `aria-live` para «Confirmado». Como `HojaHistorial`. |

## 9. Cómo se distribuye el front (decisión)

- **`/predicacion` es la app del hermano para todos los roles.** Progresiva: publicador ve 5 paneles, conductor 7, super 9. Nunca una pantalla distinta por rol. Beneficio: un solo CSS, una sola voz, un solo lugar donde probar las tres reglas duras.
- **El panel admin es para trabajo de escritorio**: programa general, mapas, conductores, grupos, accesos. El super de grupo tiene ahí `/salidas-grupo` y la ficha de su grupo; llega por el enlace «Panel» que ya existe en la vista del hermano si tiene módulos.
- **No se crea una «cuenta de invitado» distinta**: es un `viewer` que entró con código. Menos estados, menos bugs.
- Lo que hoy es texto («cuando el siervo de tu grupo responda») pasa a ser cierto por RPC, no al revés.

## 10. Orden de implementación (para Grok)

1. **Backup**: rama `backup/roles-grupos-antes-<fecha>` + `rsync` del árbol (ver `COMO-RESTAURAR.txt` de los backups anteriores). Sin esto no se sigue.
2. **Arreglos chicos primero, en un commit lógico aparte** (sin migración):
   - `sePuedeLlegar`: requiere `lat`/`lng`; nunca solo `lugar`. Y excluye `tipo in ('grupos','telefonica')`.
   - Tarjeta de Mi territorio: la oscura solo con `asignado`; la clara «Solo consulta» sin cifras personales.
   - `ElegirTerritorio` + `ElegirDeLista` reemplazando los tres `<select>`.
   - Tests: `tests/predicacion-llegar.test.mjs` (extraer `sePuedeLlegar` a `src/lib/comoLlegar.ts` para poder testearlo), casos 21–23, 26–27.
3. **Migración** (3.1–3.4, 3.6, 3.7). Aplicar en DEV. Verificar: `grupo_miembros` sembrada con los encargados; `select count(*) from salidas where territorio_codigo='SG' and tipo is null` → 0; `mi_contexto` devuelve una fila para el usuario de prueba.
4. **Test SQL** `tests/sql/grupos.sql`: `unirme_a_grupo` con código válido/invalido/inactive; `confirmar_miembro` por super del mismo grupo (ok) y de otro (falla); `gestionar_reserva` por super del grupo del solicitante (ok) y de otro (falla); `definir_punto_de_grupo` desactiva el anterior.
5. **AuthContext**: cargar `mi_contexto`; exponer `contexto`. `LoginPage`: campo de código.
6. **Vista del hermano**: `TarjetaGrupo`, `CampoCodigoGrupo`, «Sos el conductor de…», filtro «Las que conduzco», hoja **Mi grupo**, Mi cuenta ampliada. Cada panel con su condición de rol en una función pura `panelesPara(contexto)` en `src/lib/vistaHermano.ts` con tests (casos 1–17).
7. **Panel admin**: ficha de grupo (Hermanos / Punto / Código), columna Grupo en accesos.
8. **ETL**: `classify_salida_type` aprende `sg/sr/ss`. Test en `tests/test_procedencia_salidas.py` o nuevo.
9. **Verificación en navegador (DEV)** con cuatro usuarios de prueba (crear en DEV, borrar al final): publicador sin grupo, publicador con código, conductor, super. Recorrer las 3 pestañas en 390 px de ancho y en 320 px. Captura de cada estado en `docs/QA-ROLES-<fecha>.md` (solo texto de lo verificado; no subir capturas al repo).
10. **Docs**: sección en `docs/QUE-FALTA.md` con lo de la sección 11. No crear otros `.md`.

## 11. Fuera de alcance (anotar, no hacer)

- Excepciones por fecha para la salida de grupo (3.5).
- Programa propio por grupo con rotación (va con el plan de rotación).
- Que el super cree conductores (`conductores`) desde el teléfono.
- Notificaciones push o WhatsApp automático al confirmar.
- Varias membresías simultáneas (una persona en dos grupos).
- Cuenta sin email (solo teléfono): requiere OTP por SMS; hoy no hay.

## 12. Reglas para quien implementa

- **Producción (`dwgvzcnarrjgqjotocdw`) no se toca.** Solo DEV `rkmioktcsgqqjshrlkmy`.
- Credenciales DEV solo desde archivos locales (`/tmp/territorios-dev-db-password`, `/tmp/territorios-dev-service-role`). Si no existen, pedirlos al usuario; **no** buscarlos en otro lado ni pegarlos en el chat.
- Aplicar SQL: `SUPABASE_PROJECT_REF=rkmioktcsgqqjshrlkmy SUPABASE_DB_PASSWORD_FILE=/tmp/territorios-dev-db-password node scripts/apply-dev-migration.mjs supabase/migrations/<archivo>.sql`.
- Vista del hermano: 16 px mínimo, 56 px de alto en todo lo que se toca, color siempre con icono y palabra. Voseo rioplatense. Los nombres son los de la persona, no los de la tabla.
- Nada de `<select>` nativo en la vista del hermano.
- No inventar GPS. Sin dato = sin dato, y se dice en palabras.
- No pisar datos importados del Excel (`meeting_point_name`, `barrio`, `territorio_codigo`, `priorizar`).
- Toda regla de permiso vive en SQL (RPC/RLS) **y** se refleja en el front; el front nunca es la única barrera.
- No commitear salvo pedido explícito.
- Tests: `npx tsc --noEmit` limpio; `node --experimental-strip-types --test tests/*.test.mjs` verde; tests SQL locales verdes; `python3 -m pytest tests/` si se toca el ETL.
