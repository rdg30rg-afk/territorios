# Plan de mejoras de los mapas — 27 de octubre de 2026

Sigue a `ANALISIS-MAPAS-2026-10-27.md`. Hay propuestas para cada rol: producto,
experiencia del editor, experiencia del hermano, QA, entregas y técnica.
Respeta lo ya decidido en `QUE-FALTA.md`:

- sin tema oscuro;
- el menú lateral queda como está;
- MapTiler raster sobre Leaflet;
- sin planificador de colectivos;
- la cobertura no se arrastra a un dibujo nuevo.

Esfuerzo: **S** = horas, **M** = uno o dos días, **L** = una semana o más.

---

## 0. Lo que se vio en el sitio publicado

Se miró `congregacion.estracom.com.ar` sin iniciar sesión, más el código.

1. **El sitio que usa la congregación corre contra el clon "DEV"**
   (`rkmioktcsgqqjshrlkmy`). En la práctica, DEV es producción. Por eso el
   bloqueo "solo DEV" no rompe nada hoy. A la vez, las pruebas reales con
   rollback (`DEPLOY-HOSTINGER.md`, 1 de octubre) se hacen sobre la base que
   la congregación usa.
2. **El sitio usa la versión de desarrollo de React.**
   - El bundle trae `jsx-dev-runtime` y los avisos de desarrollo de React.
   - La causa: `build:dev:seguro` compila con `--mode development` y
     `NODE_ENV=development` (`scripts/build-dev-seguro.mjs:11,590`).
   - Esa versión es más lenta en cada render, y se nota en un teléfono viejo
     con un mapa de cientos de capas.
   - El modo de Vite quedó atado a "a qué base apunta". Son dos cosas
     distintas.
3. **Lo publicado está adelante de git.**
   - La renumeración y los colores salieron el 1 de octubre.
   - La migración `20261001010000_renumeracion_editor_atomica.sql` sigue sin
     versionar (`??`) y `editor-manzanas.html` tiene esos cambios sin commit.
   - Si se pierde esta carpeta, se pierde lo que está corriendo.
4. **La PWA se actualiza sola en pleno uso** (`autoUpdate` + `skipWaiting` +
   `clientsClaim`). Una publicación puede recargarle la pantalla a quien está
   marcando o editando.
5. **Lo que está bien**:
   - `respaldo-actual.json`, `manzanas-san-juan.geojson` y `salidas.json` no
     están expuestos: el build seguro los filtra.
   - El login cumple las reglas del hermano: nada por debajo de 16 px y
     controles de 56 px.
   - La carga inicial es de unos 200 KB comprimidos.
6. **Detalles menores**:
   - `manifest.webmanifest` sale como `text/plain`.
   - `manzanas-territorios.json` se puede leer sin sesión, y es un respaldo
     con 412 de 508 letras equivocadas que `SanJuanMap` todavía usa si la base
     no trae forma.

### Lo que se vio por SSH (solo lectura, mismo día)

Cuenta Hostinger `u800479702` (servidor `cuyo.news`). El sitio vive en
`domains/estracom.com.ar/public_html/congregacion`.

1. **Confirmado: el servidor corre código que no está en git.**
   - `editor-manzanas.html` publicado tiene el selector `colorTerritorio`.
   - `assets/editor-DFIWVQq_.js` llama a `publicar_editor_con_renumeracion`.
   - Las dos cosas siguen sin commit en el repo.
   - Última publicación: 1 de octubre (archivos del 2 de octubre, 00:38 UTC).
2. **Los assets viejos se acumulan.**
   - `assets/` tiene 281 archivos y 34 versiones distintas de `main-*.js`.
   - Son 28 MB de los 30 MB del sitio.
   - Cada publicación suma y ninguna limpia. Conservar los anteriores sirve
     para quien tiene la pestaña abierta, pero alcanza con las últimas dos
     o tres versiones.
3. **Los respaldos comparten cuota con `cuyo.news`.**
   - `~/backups` pesa 2,0 GB.
   - 322 MB son 14 copias completas de la congregación, de 21 a 30 MB cada
     una.
   - El resto es del sitio de noticias.
   - La cuota que frenó la publicación del 23 de septiembre la llena sobre
     todo el otro sitio. La congregación depende de una cuenta que no
     controla.
   - Si cada publicación saliera de un tag de git, alcanzaría con guardar
     las últimas dos.
4. **Configuración del servidor (`.htaccess`).**
   - Bien:
     - `-Indexes`;
     - SPA con fallback a `index.html`;
     - `nosniff`;
     - `no-cache` para `index.html`, `sw.js` y el manifest;
     - Brotli y CDN (`hcdn`);
     - `.DS_Store` responde 403.
   - Para mejorar:
     - los assets con hash salen con `max-age=604800` (7 días) y podrían ir
       a un año con `immutable`;
     - falta `AddType application/manifest+json .webmanifest`;
     - no hay `Content-Security-Policy`;
     - se sube un `.DS_Store` en cada publicación.
5. **No hay logs de acceso ni de errores a mano** en la carpeta del dominio.
   Hoy no se puede saber cuánta gente usa el sitio ni si le falla. Es otra
   razón para Q6.

---

## 1. Producto (PM)

**Para qué sirven los mapas**: que cada cuadra de la congregación se trabaje,
que se sepa cuándo fue la última vez, y que nadie quede parado en una esquina
sin mapa.

### Cómo medirlo

Una sola pantalla, sin cifras de vanidad:

- % de cuadras con dato en los últimos 4 meses, por territorio y total;
- territorios con más días sin trabajarse;
- salidas sin resultado informado;
- marcas que esperan señal hace más de 24 h. Si crece, algo anda mal en el
  campo.

### El cuello de botella no es el editor

En `QUE-FALTA.md`:

- hay unos 24 territorios con cambios sin publicar;
- nadie tiene territorio personal asignado;
- la vista del hermano nunca se probó en un teléfono al sol.

El editor ya alcanza para trabajar. Lo que falta es **cerrar el circuito**:
publicar los 72 territorios, asignar, salir a la calle y volver con datos.

### Hoja de ruta

| Etapa | Objetivo | Cuándo termina |
|---|---|---|
| 1. Estabilizar | Que lo publicado sea confiable y reproducible | Lo publicado sale de un commit con tag; build de producción; bugs del análisis corregidos |
| 2. Cerrar el circuito | Mapa usable en la calle | 72 territorios publicados, uno asignado de verdad, prueba al sol con 4 roles, el mapa abre sin señal |
| 3. Inteligencia | Que la app proponga | Sugerencia de territorio y de punto, rotación (ya hay planes escritos) |

No arrancar la etapa 3 con la 2 abierta.

### Adopción

Lo que el hermano necesita entender es poco: "tocá la cuadra cuando la
termines; si no hay señal, se guarda igual". Conviene una tarjeta de una
pantalla al primer ingreso, con eso y nada más, y una hoja imprimible para el
super de grupo.

---

## 2. Experiencia del editor (admin, PC)

| # | Mejora | Por qué | Esfuerzo |
|---|---|---|---|
| E1 | **Panel "Listo para publicar"**: lista de territorios con cambios y un semáforo por cada uno (letras completas, caras sin advertencias, sin solapes, sin manzanas de menos de 3 vértices). Botón "Publicar los que están en verde". | Hoy se publica de a uno y hay unos 24 pendientes. El chequeo ya existe en partes (`diagnosticar`, "Ver qué falta guardar"). | M |
| E2 | **Pestaña Cobertura del mapa congregacional**: manzanas candidatas sin territorio y solapes entre territorios, pintados y contados. | Es la pregunta de PM "¿queda algo sin asignar?". Hoy solo se ve mirando. | M |
| E3 | **Sugerir color distinto a los vecinos**: en la paleta, marcar los colores que ya usan los territorios que se tocan con este y proponer uno libre. | En la captura hay rojos pegados (8, 71, Bancario) y no se ve dónde termina cada uno. | S |
| E4 | **El número del territorio dentro del polígono**: usar `puntoDeRotulo` (como las letras) en vez del promedio de vértices (`editor-manzanas.html:782`). | Con formas en L el número cae en un hueco o sobre otro territorio (el 9 y el 20 de la captura). | S |
| E5 | **"Ver como el hermano"**: un interruptor que muestra las caras como las verá el teléfono, metidas hacia adentro y numeradas. | Las caras partidas (el bug de ±180°) se ven recién en la calle. | S–M |
| E6 | **Agrupar el menú de herramientas** con un separador: *Dibujo* (dibujar, dividir, fusionar, vértices, borrar) y *Territorio* (marcar, mover, letras, caras). | 10 herramientas en una lista plana. Agrupar no cambia los atajos. | S |
| E7 | **Vaciar fuera del camino**: llevarlo a un menú "Más", que pida escribir "vaciar" y que no toque el borrador compartido. | Hoy está al lado de Exportar e Importar, con el mismo peso visual, y miente sobre lo que hace. | S |
| E8 | **Bordes compartidos**: al mover un vértice que coincide con el de la manzana vecina, mover los dos. | Evita huecos y solapes al ajustar. Es la mejora de edición más grande; dejarla para después de E1 y E2. | L |

---

## 3. Experiencia del hermano (teléfono, al sol)

Reglas de siempre: nada por debajo de 16 px, controles de 56 px, nunca solo
color.

| # | Mejora | Por qué | Esfuerzo |
|---|---|---|---|
| H1 | **Mapa sin señal**: al abrir el territorio asignado, guardar sus formas, caras y teselas de los zooms 15 a 18 de su recuadro. Aviso "Listo para usar sin señal". | Hoy, sin señal el mapa queda vacío aunque las marcas se encolen. Es la falla más probable en la calle. | M |
| H2 | **"Estás acá"**: punto de GPS y botón para centrarse. Proponer la cuadra más cercana: "¿Terminaste Mitre entre Laprida y Rivadavia?" con Sí / No. | Encontrar la línea correcta en el mapa es la parte difícil para alguien de 70 años. | M |
| H3 | **Deshacer después de marcar**: aviso abajo, "Marcaste Mitre · Deshacer", 56 px, durante 8 s. | Un toque de más con el pulgar hoy obliga a buscar la línea y desmarcar. | S |
| H4 | **Marcas pendientes siempre a la vista**: "3 marcas esperando señal", con icono y palabra. Pasa a "Todo enviado" cuando se vacía la cola. | Da confianza para seguir sin señal y avisa si algo se trabó. | S |
| H5 | **Probar el contraste de calles al sol**: `dataviz-light` contra `streets-v2`, en un teléfono, afuera. | Quedó pendiente en `QUE-FALTA.md`. Si `streets-v2` gana, el cambio es una línea. | S |
| H6 | **Pantalla siempre encendida mientras se marca** (Wake Lock). | Que la pantalla se apague y haya que volver a desbloquear corta el trabajo. | S |
| H7 | **Nombre de la calle sobre la cara**, tomado de OSM al cargar las caras y guardado en `manzana_lados`. | "Mitre" se entiende mejor que una línea de color. Además lo necesita H2. | M |

---

## 4. QA

| # | Qué | Cómo | Esfuerzo |
|---|---|---|---|
| Q1 | **Paridad real del algoritmo de caras**: correr `blockGeometry.ts` y la copia del editor sobre las 605 manzanas y exigir el mismo resultado. | Un test que extrae las funciones del HTML (como ya hace `editor-renumeracion`) y compara. Termina con la "copia exacta" que nadie verifica. | S |
| Q2 | **Casos de borde de geometría**: rumbos de ±180°, anillos sin cerrar, polígonos con hueco, dividir y fusionar conservando el área. | Generar polígonos al azar con semilla fija. El bug de ±180° habría salido acá. | S–M |
| Q3 | **Pruebas SQL en CI**: hoy `tests/sql/*-assertions.sql` no corren en `npm test` ni en CI. | Servicio Postgres en `ci.yml` y aplicar las migraciones en orden. | M |
| Q4 | **Recorrido de punta a punta** contra una base de pruebas (no la de la congregación): marcar sin señal, reconectar, verlo en el admin; dividir, renumerar, publicar. | Playwright, 4 o 5 recorridos y nada más. | M |
| Q5 | **Prueba de campo con protocolo**: Android viejo y iPhone, 390 y 320 px, al sol, modo avión a mitad de camino, 4 roles. Planilla de lo que falló. | Pendiente desde septiembre. Ninguna prueba automática lo reemplaza. | S (una mañana) |
| Q6 | **Errores del cliente a una tabla**: `window.onerror` y los rechazos de promesas van por RPC a `errores_cliente`, con versión, ruta y rol, sin datos personales. | Los hermanos no reportan bugs. Si el mapa falla en un teléfono, hoy nadie se entera. | S |

---

## 5. Entregas (PR y publicación)

| # | Qué | Esfuerzo |
|---|---|---|
| P1 | **Commitear lo que ya está publicado**: la migración de renumeración y los cambios del editor. Después, que el build seguro se niegue a compilar con el árbol sucio y grabe el SHA del commit en el paquete. | S |
| P2 | **Build de producción contra la base que corresponda**: separar "modo de Vite" de "a qué base apunta". `vite build` en modo production y el guard de proyecto por variable propia (`VITE_SUPABASE_PROJECT`). | S |
| P3 | **Definir qué base es cuál.** Si el clon DEV es producción de hecho, llamarlo así y crear una copia para probar (`GUIA-CODEX-COPIAR-BD-SUPABASE.md` va en esa dirección). Las pruebas "reales con rollback" van a la copia. | M |
| P4 | **Actualización avisada**: pasar la PWA a `prompt`, con "Hay una versión nueva · Actualizar". En el editor y con marcas pendientes, esperar a que la cola esté vacía. | S |
| P5 | **Un script de publicación** que haga lo que hoy se hace a mano, siempre desde un tag. Pasos: respaldo, assets, editores, `index.html`, `sw.js` y verificación de SHA-256. También: no subir `.DS_Store`, dejar solo las últimas 3 versiones de assets y los últimos 2 respaldos. Hoy son 34 versiones de `main` y 322 MB de respaldos. | M |
| P7 | **`.htaccess`**: assets con hash a `max-age=31536000, immutable`, `AddType` para el manifest y una CSP básica (Supabase, MapTiler, OSM, esm.sh y unpkg, que usa el editor). | S |
| P8 | **Sacar la congregación de la cuenta de `cuyo.news`**, o al menos de su carpeta de respaldos y su cuota. Un problema del sitio de noticias no debería dejar sin publicar a la congregación. | M |
| P6 | **PRs chicos de `dev` a `main`**, uno por tema, con la plantilla "qué cambia / cómo se probó / migraciones". Hoy `main` no refleja lo publicado. | S, sostenido |

---

## 6. Técnico

1. **Un solo editor.** Quedarse con `editor-manzanas.html`, que es el que se usa
   y funciona, y archivar la parte de edición de la reescritura React. Lo que
   sí conviene llevarse de React:
   - **Geometría compartida**: compilar `blockGeometry.ts` y
     `polygonOperations.ts` a un `editor-lib.js` que el HTML importe. Mata
     las copias (también la de `vista-hermano.html`, o se borra ese
     prototipo).
   - **Publicación v2**: que el HTML use `publicar_territorios_atomico_v2`
     (UUID + `operation_id`, no se duplica aunque se reintente) y
     `guardar_borrador_editor` (revisión). Así la fila `editor_estado` tiene
     un solo dueño.
   - **Renumeración idempotente**: ponerle `operation_id` y auditoría, igual
     que la v2.
2. **El mapa de calor pide solo lo necesario.** Mover "último evento por cara
   hasta la fecha X" a un RPC filtrado por territorio, en vez de bajar toda
   la bitácora.
3. **Sacar el respaldo `manzanas-territorios.json` de `SanJuanMap`**: tiene
   letras equivocadas. Si la base no trae forma, decirlo, no inventarla.
4. **Origen de las manzanas versionado**: guardar la consulta a OpenStreetMap
   y el script que generó `manzanas-congregacion.geojson`, para poder sumar
   barrios nuevos cuando la ciudad crezca.
5. **Selector de punto de encuentro**: redibujar marcador y territorio en el
   evento `load` y fijar `onPick` con un ref.

---

## 7. Orden sugerido

**Semana 1, estabilizar:**

1. P1, P2 y P4.
2. Los bugs chicos del análisis: `jsonb_set`, Vaciar, el selector de punto y
   el número del territorio (E4).
3. Q1 y Q2, y con esos tests puestos, el arreglo del ángulo de ±180° en las
   tres copias. Antes de tocar `manzana_lados`, hacer un informe de cuántas
   caras cambian y cuáles tienen cobertura. Una persona decide, como manda
   la regla de no arrastrar cobertura.
4. Q6.

**Semanas 2 y 3, cerrar el circuito:**

1. E1 para publicar los 24 pendientes.
2. E2 para ver qué queda sin asignar.
3. H1, H3, H4 y H6.
4. Asignar territorio a una persona real.
5. Q5, la prueba de campo.

**Después:** P3, P5, H2, H7, E3, E5, E6, el editor único (sección 6.1) y E8.
