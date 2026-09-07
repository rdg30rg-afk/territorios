# Giga plan de UI — vista del hermano y panel de administración

Fecha: 7 de septiembre de 2026 · Rama: `dev` (HEAD `5d1bd37`) · Estado: **plan aprobado para implementar**

Este documento es la orden de trabajo para la IA que implemente. Está escrito para
ejecutarse por fases, cada una con commit propio a `dev`, sin tocar lógica de datos
ni RPC. Todo lo que dice "mover" o "sacar" está autorizado por el dueño del producto.

---

## 0. Diagnóstico en una página

Las siete capturas que disparan este plan muestran cuatro enfermedades, no siete bugs:

| # | Enfermedad | Dónde se ve | Causa raíz (con línea) |
|---|---|---|---|
| E1 | **Un solo sistema para dos productos.** La vista del hermano (teléfono, dedo, 56 px) y el admin (escritorio, mouse, 38–44 px) comparten CSS y se contaminan. | Grilla de territorios blanca sobre blanco; botones gigantes a 1000 px de ancho; botones rosados en Mapas. | `.vh .boton.secundario` es blanco por defecto (`vista-hermano.css:196`); `.sobre` es `position:fixed; inset:0` sin ancho máximo (`:434`); `.toolbar-actions button` con paleta marrón/beige hardcodeada del tema viejo (`index.css:1225-1232`). |
| E2 | **Layouts que no se pliegan.** Grillas con mínimos rígidos y breakpoints desalineados. | Mapas a ~860–1100 px: tercera columna cortada, título "70 guardados" tapado. Salidas móvil: texto en columna de 130 px. | `.territory-stage` colapsa a 1099 px pero `.map-workspace` (`minmax(420px,1fr) minmax(270px,340px)`, `index.css:301-304`) colapsa a 1024 px; `.territory-registry-toolbar` exige `minmax(340px,auto)` dentro de un panel de 240–340 px (`index.css:361-368`); `.module-registry-toolbar` es `flex` sin `wrap` (`index.css:565-571`). |
| E3 | **Todo de una.** Listas sin ventana, textos que explican en vez de decir. | Salidas trae 300 tarjetas con 3 botones + 3 chips cada una. Dashboard: "0% de los metros figura recorrido (porcentaje redondeado); 0 de 25 lados recorridos. Revisar qué falta." y "hace 1 días". | `SALIDAS_QUE_SE_TRAEN = 300` (`SalidasPage.tsx:196`) sin paginación; `territorySuggestions.ts:26`; `TerritorySuggestions.tsx:55`. |
| E4 | **Carga lenta perceptible.** Se espera a tener todo antes de pintar. | Mapas y Salidas tardan; Dashboard corre sugerencias al entrar. | Ver §6 (auditoría de consultas). |

Además hay **deuda muerta**: `src/styles/theme-mapsi.css` (1.575 líneas) y
`src/styles/theme-ato.css` (934 líneas) **no se importan en ningún lado** (sólo
`index.css` y `theme-hermano.css` entran por `main.tsx`). Son 2.500 líneas de ruido que
confunden a cualquier IA que edite estilos. `theme-ato.css` tiene además un cambio sin
commitear: hay que decidir si se descarta (recomendado) antes de borrar.

---

## 1. Principios que rigen todas las fases

1. **Dos cascarones, un juego de tokens.**
   - Hermano (`/predicacion`, clase raíz `.vh`): teléfono primero, texto ≥ 16 px, toque ≥ 56 px, tres pestañas, una tarjeta oscura por pantalla. En escritorio se muestra **dentro de una columna de teléfono** (560 px centrados), nunca estirado.
   - Admin (todo lo demás, dentro de `AppShell`): escritorio primero, denso, controles 40–44 px, tablas y paneles. En móvil se **apila**, nunca se comprime en columnas.
   - Los colores, radios y tipografía salen de las mismas variables (`--h-*` en `theme-hermano.css`). Prohibido introducir hex nuevos en componentes.
2. **Un botón manda por pantalla.** El resto son secundarios (borde) o van a un menú `⋯`. Nunca tres botones del mismo peso en una tarjeta de lista.
3. **Nada muestra más de una pantalla de lista sin ventana.** Rango por defecto + "Ver más" de a 50, o filtro. La cantidad total se dice con un número, no con un párrafo.
4. **El texto dice el dato, no lo explica.** Número primero, una oración, sin paréntesis. Las aclaraciones metodológicas van a un `title`/tooltip o a un `<details>` cerrado.
5. **Pintar antes de saber.** Cada página muestra su esqueleto y encabezado en el primer render; las consultas llegan después y por separado (conteo ≠ lista ≠ geometrías).
6. **Sin dependencias nuevas.** Todo es CSS, JSX y consultas ya existentes. Sin librerías de UI, sin virtualización externa.
7. **Reglas que no se negocian:** contraste AA, foco visible, `prefers-reduced-motion`, sin `window.confirm` nuevos (usar el `Modal` existente), pluralización correcta en español.

---

## 2. Fase 0 — Cirugía de urgencia (sólo CSS y copy, 1 sesión)

Objetivo: que ninguna pantalla se vea **rota**. Sin cambios de estructura.

### 2.1 Vista del hermano

**F0-H1 · Botón secundario invisible sobre fondo claro (capturas 2 y 3).**
- `vista-hermano.css:196`: `.vh .boton.secundario` pasa a contexto claro por defecto:
  `background: var(--surface); color: var(--fg); border: 1px solid var(--line);`.
- La variante oscura ya existe en `:202` (`.vh .tarjeta .boton.secundario`), se conserva. Agregar `.vh .tarjeta.lima .boton.secundario` con tinta oscura si falta.
- Verificar visualmente: `ElegirTerritorio`, `ElegirDeLista`, `CampoCodigoGrupo`, `HojaMiGrupo`, `MiCuenta` (ya tenía override en `:142`, se puede borrar).
- Las reglas `:197-201` (`cuenta-resumen`, `actualizar-programa`) quedan pero ya son redundantes; dejarlas por ahora.

**F0-H2 · Las hojas `.sobre` en escritorio (capturas 2 y 3).**
- `.vh .sobre` mantiene `position: fixed; inset: 0` (backdrop) pero su contenido se centra en una columna:
  ```css
  .vh .sobreBarra, .vh #sobreModos, .vh .sobrePie,
  .vh .sobreCuerpo > :not(.mapaGrande) { width: 100%; max-width: 560px; margin-inline: auto; }
  @media (min-width: 720px) {
    .vh .sobre { background: rgba(22,25,29,.35); }
    .vh .sobre > * { background: var(--canvas); }
  }
  ```
  El mapa grande (`.mapaGrande`) sigue a pantalla completa: ahí sí conviene el ancho.
- `.sobreBarra h2`: agregar `white-space: normal; line-height: 1.2` y que el botón "Cerrar" nunca se encoja (`flex: 0 0 auto`). El título "Mirar el territorio" no puede partirse en tres renglones: si hace falta, el subtítulo `small` pasa debajo de la barra como `p.sub`.
- Grilla de `ElegirTerritorio`: `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` con `max-width: 560px`, nunca 4 columnas fijas al ancho de la ventana.

**F0-H3 · Columna de teléfono en escritorio.**
- `.vh` ya limita `.hoja` a 520 px. Falta la barra superior y las pestañas: `.vh .barra > *` y `.vh .pestanias` con `max-width: 560px; margin-inline: auto`. En ≥ 720 px, `.vh` pinta el `--canvas` en todo el ancho y la columna se ve como un teléfono apoyado en la mesa.

**F0-H4 · Mi cuenta (captura 1).**
- Sólo copy y orden por ahora: "Guardar nombre" deja de ser lima permanente; es `principal` sólo cuando el nombre cambió (`nombre.trim() !== profile.full_name`), si no es `secundario` deshabilitado.
- "Cerrar sesión" pasa a `boton chico` y va último con `margin-top: 18px` para que no compita.

### 2.2 Panel de administración

**F0-A1 · Mapas: encabezado tapado y columnas cortadas (captura 5).**
- `index.css:361`: `.territory-registry-toolbar { grid-template-columns: 1fr; }` (apilar siempre dentro del panel lateral: título arriba, buscador + botón abajo).
- `index.css:366`: `.territory-registry-actions { grid-template-columns: minmax(0,1fr) auto; }`.
- Unificar breakpoint: `.map-workspace` colapsa a **una columna en ≤ 1279 px** (ya hay una media query en `:1753` para 1280; usarla) y `.territory-stage` también en ≤ 1279. Entre 1280 y 1439 el panel derecho "Herramientas" se vuelve `<details>` cerrado bajo el mapa.
- `.toolbar-actions button` (`index.css:1225-1232`): eliminar el `#ecd8ca/#8a4b2d`; heredar de `.secondary-button`/`.ghost-button` del tema hermano.
- Leaflet: los controles de dibujo y la paleta de colores se pisan con el zoom (esquina superior izquierda). Mover paleta + dibujo a `topright` y zoom queda en `topleft`. Es una opción de `L.control({position})`.

**F0-A2 · Salidas móvil: columna de 130 px (captura 7).**
- `index.css:565`: `.module-registry-toolbar { flex-wrap: wrap; }` y en ≤ 720 px `flex-direction: column; align-items: stretch;`.
- Los cuatro controles (Armar programa, Nueva salida, buscador, filtros) pasan a una grilla `repeat(auto-fit, minmax(160px, 1fr))` para que en móvil sean dos columnas de 2 filas y no una torre.
- `.table-hint` ("Se muestran las 300…") se reemplaza por un contador corto: **"300 de 1.794 · las más recientes"** con `title` explicativo.

**F0-A3 · Dashboard: frases largas y "1 días" (captura 6).**
- `src/lib/territorySuggestions.ts:26`: la razón pasa a formato dato:
  - `completar` → `"${walkedSides} de ${sides} lados · ${percent}%"`
  - `verificar` → `"Sin dato suficiente · verificar"`
  - `sin_geometria` → `"Sin lados cargados"`
  - completo → `"Todos los lados · revisar antigüedad"`
- `src/components/TerritorySuggestions.tsx:55`: `hace ${age} ${age === 1 ? 'día' : 'días'}`; `age === 0` → "hoy".
- El `<details>` "Cómo se ordenan" se convierte en un ícono ⓘ con `title` (ahorra dos renglones).
- Actualizar `tests/territory-suggestions.test.mjs` y `tests/dashboard-pendientes.test.mjs` al nuevo texto.

**F0-A4 · AppShell móvil.**
- `mobile-admin-header`: "Territorios" + chip `Base de prueba` en una sola línea (`display:flex; gap:8px; align-items:baseline`), botón "Menú" de 44 px con ícono ≡ y texto.

**Definición de hecho Fase 0:** capturas a 390, 768, 1024 y 1280 px de: `/predicacion` (Hoy, Mi territorio con hoja "Mirar el territorio" abierta, Mi cuenta), `/mapas`, `/salidas`, `/` (dashboard). Ninguna muestra texto invisible, superposición ni scroll horizontal. `npm test` y `tsc` verdes. Commit: `UI fase 0: arregla contraste, plegado y copy`.

---

## 3. Fase 1 — Vista del hermano: pulido

**F1-1 · Mi cuenta deja de ser un cajón de sastre.**
El popover actual mezcla 6 acciones (`MiCuenta.tsx:63-115`). Queda así:
- Popover: nombre (input + guardar sólo si cambió), una línea "Grupo 4 · Publicador" o "Sin grupo", y dos acciones: **Cambiar/Sumarme a un grupo** (abre una hoja `.sobre` propia, `HojaGrupoCodigo`) y **Cerrar sesión** (chico).
- La línea de conductor vinculado ("Sos conductor vinculado a…") se muestra sólo si existe y en `small`.
- El aviso "El código nuevo cierra tu pertenencia…" vive dentro de la hoja, no en el popover.

**F1-2 · Tarjeta de salida expandida (captura 4).**
Está bien. Sólo: quitar el borde doble entre la cabecera lima y el cuerpo (`border-top: 0` en el cuerpo), y el mini mapa de 150 px pasa a `aspect-ratio: 16/10` con `max-height: 220px` para que no se vea como una franja.

**F1-3 · Pestañas.** El ícono y el texto miden lo mismo en las tres; verificar que `aria-current` pinte fondo lima suave y no sólo la rayita.

**F1-4 · Tamaño A+.** El botón ya existe; el paso máximo 1.3 rompe la grilla de manzanas en 360 px. Limitar a 1.2 en ≤ 380 px o bajar la grilla a `minmax(64px,1fr)` cuando `--step ≥ 1.2`.

Commit: `UI fase 1: Mi cuenta en tres pasos y tarjeta de salida`.

---

## 4. Fase 2 — Admin Salidas: la agenda manda

Hoy la página es un formulario de 3.218 líneas con la lista al final. La reestructuración autorizada:

**F2-1 · Encabezado en una fila.**
`Salidas` (h2) · contador `300 de 1.794` · a la derecha `[Buscar…] [Filtros ▾] [+ Nueva salida] [Armar programa]`. En móvil, buscador solo en una fila y los tres botones en otra. "Armar programa" es el único `primary-button`.

**F2-2 · Ventana temporal por defecto.**
- Por defecto se listan **desde hoy en adelante** (próximas), agrupadas por día con cabecera pegajosa `Viernes 12 sept`. Debajo, un botón `Ver anteriores` que trae de a 50 hacia atrás (`.range(offset, offset+49)` ordenado desc). El contador total ya se pide bien (`head:true, count:'exact'`, `SalidasPage.tsx:699`); se conserva.
- La procedencia de importación (`salida_importacion_procedencia`, dos consultas de 1.000 filas en `:706-718`) **no se carga al entrar**: se pide sólo al abrir la ficha de una salida histórica (`.eq('salida_id', id)`).
- Los filtros Territorio/Agenda se mantienen pero dentro de `Filtros ▾` (un `<details>` con la misma grilla).

**F2-3 · Tarjeta de salida en una línea y media.**
- Línea 1: `17:00 · 22.3 Meglioli y Av. José I. de la Roza` (hora, territorio, punto).
- Línea 2: `Gustavo Brizuela · Próxima` — **un solo chip** de estado (Próxima / Hoy / Pasada / Sin conductor). "Histórica · Excel" y "Histórica · no se borra" desaparecen de la tarjeta: van como texto gris en el menú y en la ficha.
- Acciones: **una** contextual (`Completar` si ya pasó, `Resultado` si tiene, `Editar` si es futura) y un `⋯` con PDF / Resultado / Completar / Eliminar (deshabilitado con motivo si es histórica).
- Tocar la tarjeta abre la ficha lateral/`Modal` con todo el detalle (no expandir en línea).

**F2-4 · Armar programa.**
Sigue en su propia sección, pero se abre como página completa dentro del contenido (ya hay `armarPrograma` booleano) con botón "Volver a la agenda" arriba a la izquierda.

Commit: `UI fase 2: Salidas agrupadas por día con ventana y una acción por tarjeta`.

---

## 5. Fase 3 — Admin Mapas: dos paneles, no tres

**F3-1 · Composición.** Izquierda 320 px: buscador + lista de territorios (una línea por fila: número, color, y a la derecha `%` de cobertura si existe). Derecha: mapa ocupando `calc(100dvh - cabecera)`. El tercer panel "Herramientas · Exportar y ver ayuda" desaparece: sus acciones van a un botón `⋯` en la barra del mapa (Exportar GeoJSON, Ver cobertura, Ayuda, Pantalla completa).

**F3-2 · Barra del mapa.** Una sola fila sobre el mapa: `[Territorio seleccionado: 12 ▾]  [Dibujar]  [⋯]`. "Refrescar territorios" se elimina: el mapa se refresca solo después de guardar/borrar (ya se llama `renderTerritoriesOnMap` en `SanJuanMap.tsx:2730`). Si hace falta forzar, va dentro de `⋯`.

**F3-3 · Modo dibujo explícito.** La paleta de colores, el lápiz y el tacho aparecen **sólo** al tocar "Dibujar" (estado `isDrawing`), en `topright`. Fuera de ese modo, el mapa tiene únicamente zoom. Esto elimina la superposición de controles de la captura 5.

**F3-4 · Móvil (≤ 1279).** Lista arriba como `<details>` "70 territorios ▾" cerrado; mapa debajo a `70dvh`. La ficha del territorio seleccionado abre en `Modal` (ya existe el componente).

**F3-5 · Pestañas "Territorios y dibujo / Ver cobertura".** Se mantienen como segmented control alineado a la derecha del h2, 40 px de alto, no botones sueltos flotando entre el texto y los paneles.

Commit: `UI fase 3: Mapas en dos paneles con modo dibujo`.

---

## 6. Fase 4 — Dashboard y AppShell

**F4-1 · Inicio del admin.**
- Arriba: tres números grandes (Territorios activos · Salidas esta semana · Accesos pendientes) en una fila; en móvil, tres en columna de 72 px.
- "Qué territorios conviene revisar" pasa a **"Para revisar"**: tres filas compactas `Territorio 57 · 19 de 48 lados · hace 4 días · →`. El botón "Actualizar cobertura" queda como acción secundaria a la derecha del título; nunca corre solo al entrar (respetar la regla actual de "nunca asignan automáticamente").
- Enlaces "Revisar los mapas · Abrir el programa" se vuelven dos botones secundarios de 44 px.

**F4-2 · AppShell.**
- Escritorio: sidebar 260 px se mantiene. Quitar la "install-card" y la "security-card" de la sidebar en producción; en dev quedan colapsadas en un `<details>` "Base de prueba".
- Móvil: cabecera de 56 px con marca + `Menú`; el menú abre como hoja de pantalla completa con las mismas entradas a 52 px de alto cada una.

Commit: `UI fase 4: inicio con tres números y menú móvil`.

---

## 7. Fase 5 — Rendimiento percibido y limpieza de CSS

**F5-1 · Consultas.** Ver el anexo A (auditoría de `useEffect` por página) y aplicar:
- Todo listado: primero `count` con `head:true`, después la ventana. Nunca `readAllRows` en el primer render de una página de lista.
- Mapas: las geometrías se piden una vez y se cachean en memoria del módulo; el mapa de calor sólo al entrar en "Ver cobertura".
- Skeletons: `.status-card` "Cargando…" se reemplaza por bloques grises (`.skeleton`) con la altura de tres filas; el encabezado y la barra de acciones se pintan siempre. El mismo skeleton se usa como `fallback` de los `Suspense` que ya existen en `App.tsx`.

**F5-2 · CSS.**
- Borrar `src/styles/theme-mapsi.css` y `src/styles/theme-ato.css` (no se importan). Descartar antes el cambio sin commit de `theme-ato.css` (`git checkout -- src/styles/theme-ato.css`) salvo indicación contraria del dueño.
- Buscar y eliminar la paleta vieja en `index.css`: `#ecd8ca`, `#8a4b2d`, `rgba(109, 76, 65, …)`, `rgba(187, 62, 3, …)`, `#fffcf7`. Reemplazar por `--h-line`, `--h-olive`, `--h-surface`.
- Partir `index.css` (2.450 líneas) en: `admin-shell.css`, `admin-components.css` (botones, tablas, tarjetas), `mapas.css`, `salidas.css`. Sin cambiar selectores en este paso; sólo mover.
- Alinear breakpoints a tres: **720** (móvil), **1024** (tableta), **1280** (escritorio). Eliminar los de 640, 1099 y 1100.

Commit: `UI fase 5: carga por partes y limpieza de estilos`.

---

## 8. Reglas para la IA implementadora

1. Trabajar en `dev`. Un commit por fase, con el mensaje indicado. Antes de empezar: `git status` limpio (salvo `theme-ato.css`, ver F5-2).
2. **No tocar** `supabase/`, `src/lib/*` de datos, ni las RPC. Los únicos `.ts` de `lib` que este plan autoriza a editar son `territorySuggestions.ts` (copy) y los `test.mjs` asociados.
3. Después de cada fase: `npm run build`, `npx tsc --noEmit`, `npm test`. Los tests de texto (`territory-suggestions`, `dashboard-pendientes`, `salida-etiquetas`, `predicacion-qa-visual`) se actualizan al copy nuevo, no se borran.
4. QA visual obligatorio: con `vite preview` abrir cada pantalla afectada a **390, 768, 1024 y 1280 px**; guardar capturas en `docs/qa/ui-fase-N/`. Comprobar: sin scroll horizontal, sin texto invisible, un solo botón primario visible, foco visible con Tab.
5. Vista del hermano: fuente ≥ 16 px, toque ≥ 56 px, contraste AA. Admin: toque ≥ 40 px. No usar `window.confirm` nuevos.
6. Si una fase requiere cambiar datos o RPC para quedar bien (por ejemplo el conteo de salidas), **detenerse y documentar** en `docs/QUE-FALTA.md` en vez de improvisar.
7. Si un elemento está en duda ("¿lo saco o lo muevo?"), la regla es: **muévelo a un menú `⋯` o a un `<details>` cerrado**; sólo se elimina lo que este plan nombra explícitamente (Herramientas de Mapas, Refrescar territorios, chips Histórica en tarjetas, install/security cards en producción, temas mapsi/ato).

---

## Anexo A — Auditoría de consultas por página

Qué se pide al montar cada página y qué hacer con eso. Todo medido en el código de `dev` HEAD `5d1bd37`.

### Salidas (`SalidasPage.tsx:656-734`, un solo `Promise.all` de 9 consultas)

| Consulta | Qué trae | Problema | Decisión |
|---|---|---|---|
| `conductores` (`:670`) | todos, 4 columnas | liviana | mantener |
| `grupos_servicio` (`:674`) | todos | liviana | mantener |
| `territorios` (`:679`) | **`polygon_geojson` de los 70** | pesado, y la lista de salidas sólo necesita `id, name` | quitar `polygon_geojson, description`; el polígono se pide al abrir la ficha/mapa |
| `puntos_encuentro` (`:683`) | todos | liviana | mantener |
| `salidas` (`:695`) | 300 más recientes, `CAMPOS_SALIDA` | las 300 se renderizan de una | ventana "desde hoy" + `Ver anteriores` de a 50 (F2-2) |
| `salidas` count (`:699`) | `head:true` | correcta | mantener |
| `territorio_personal_reservas` activas (`:701`) | todas | mediana | mantener |
| `salida_importacion_procedencia` ×2 (`:706-718`) | **2.000 filas de 16 columnas** | es lo que más tarda y sólo sirve para el chip "Histórica · Excel" y la ficha | cargar bajo demanda por `salida_id` al abrir la ficha; el chip se deriva de `salidas.origen`/campo equivalente si existe, o se omite (F2-3 lo saca de la tarjeta) |

Mientras el `Promise.all` no resuelve, la página muestra sólo "Cargando"; por eso "tarda". Con F5-1 el encabezado y la barra de acciones se pintan siempre, y la lista llega con su propio estado.

### Mapas (`SanJuanMap.tsx:1665-1710`, `loadTerritories`)

| Consulta | Qué trae | Decisión |
|---|---|---|
| `territorios` con `polygon_geojson` (`:1673`) | 70 polígonos | necesaria para el mapa; cachear en memoria del módulo (`Map<id, TerritoryRecord>`) para que volver a /mapas no re-descargue |
| `territorio_manzanas` vigentes con `geometry_geojson` (`:1680`) | **todas las manzanas de todos los territorios** con geometría | pedir sin `geometry_geojson` al entrar (sólo `id, territory_id, label, lat, lng`) y traer la geometría del territorio seleccionado al seleccionarlo (`.eq('territory_id', id)`) |
| Mapa de calor (`CoverageHeatmapPanel` / `loadCoverageHeatmap`) | resúmenes de cobertura | ya es bajo demanda al entrar en "Ver cobertura"; mantener |

`isLoading` bloquea la lista lateral entera (`:2766`). La lista debe pintarse con `id, name` apenas llegue `territorios`, aunque las manzanas sigan bajando.

### Inicio / Dashboard (`DashboardPage.tsx:115-200` + `AuthContext.loadManagedUsers`)

| Consulta | Qué trae | Decisión |
|---|---|---|
| Pendientes: `importaciones` (1), `importacion_registros` count, `salidas` count ×2, `territorio_personal_reservas` count (`:143-185`) | sólo conteos `head:true` | correctas; mantener |
| `loadDrivers` (`:379`) | todos los conductores | liviana; mantener |
| `loadManagedUsers` (AuthContext) | `profiles`, `user_module_access`, `pending_users` con `readAllRows` + `grupo_miembros` | es el panel de accesos; con < 300 personas es aceptable. Mover el panel de accesos a un `<details>` cerrado y **no disparar** `loadManagedUsers` hasta abrirlo (o hasta que haya `pending > 0`) |
| `TerritorySuggestions` | RPC de sugerencias | sólo al tocar "Actualizar cobertura" (regla actual); mantener |

### Vista del hermano (`PredicacionPage.tsx`)

Ya carga por partes (`mi_contexto`, salidas con recorte, manzanas por territorio). No forma parte de F5-1. Único ajuste: `HojaMiGrupo` y `MiCuenta` piden `conductores` y `grupo_miembros` al abrir, no al montar; verificar que siga así después de F1-1.

### Bundle

Ya está bien partido: todas las páginas entran por `React.lazy` en `App.tsx:8-44` y `MeetingPointPickerMap` (maplibre) es `lazy` dentro de `SalidasPage.tsx:30`. Lo único global son los tres CSS de mapas en `main.tsx:4-6` (aceptable). **No hay trabajo de bundle en F5-1**; el tiempo se va en las consultas de arriba y en pintar 300 tarjetas, no en descargar JS.
