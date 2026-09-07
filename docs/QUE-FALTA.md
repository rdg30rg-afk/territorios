# Qué falta

> Actualización de coordinación, 6 de septiembre de 2026: el estado del 3/9 que
> sigue abajo es histórico, no una aceptación actual. Consultar también
> `IMPLEMENTACION-2026-09-05.md` y `QA-LUNA-BROWSER-CONDUCTOR-2026-09-05.md`.
> La cobertura del conductor pasó una prueba real offline con reapertura tras
> reconectar y replay idempotente en DEV. No prueba arranque offline en frío ni
> recuperación offline del formulario de resultados. Hay respaldo privado en
> `backups/snapshot-20260905T033510Z-mapa-por-manzanas`, pero su restauración
> completa sigue sin verificar por incompatibilidad del servidor local.
> El sistema no está terminado ni estos cambios sincronizados/publicados.

Estado del proyecto y lista de pendientes. **Leer esto al empezar una sesión**
y al volver de una compactación, antes de tocar nada.

Actualizado: 7 de septiembre de 2026 · rama `dev` (roles/grupos en curso;
rotación todavía no).

> Estado DEV del histórico (3 de septiembre de 2026): la staging de 3.346 filas
> está reconciliada (3.275 aplicadas, 71 cerradas como descartadas/auditables,
> 0 pendientes y 0 conflictos). PROD continúa fuera de alcance.

---

## 1. Lo que no se negocia

Estas reglas ya costaron un susto o una decisión discutida. No re-derivarlas.

**La base.** Todo va al clon de desarrollo `rkmioktcsgqqjshrlkmy`. La producción
`dwgvzcnarrjgqjotocdw` **no se toca nunca**. Mateo no tiene copia de seguridad.
La `service_role` se lee de un archivo (`SUPABASE_SERVICE_ROLE_KEY_FILE`), nunca
se pega en el chat ni en la línea de comandos, nunca se commitea.

**Las tres reglas duras de la vista del hermano.** Quien entra es un publicador
de 70 años, parado en una esquina, con sol de frente y el teléfono en la mano:

1. Nada por debajo de 16 px.
2. Todo lo que se toca mide 56 px de alto como mínimo.
3. El color nunca es el único portador de significado: siempre con icono y palabra.

Se transfieren enteras desde el método de Estracom (allá eran 14 px y 52 px para
"la madre de Mateo, que no sabe nada de tech" — es la misma persona). **No se
transfieren al admin**: ahí quien mira usa mouse en una PC y necesita ver
cuarenta filas, no ocho. En el admin el cuerpo es 15 px y los controles 38 px.

**La voz.** Rioplatense, voseo: "Tocá", "Fijate", "Buscá", "vos". No "Selecciona",
"Mantén", "Puedes revisar". Los nombres son los de quien usa, no los de la tabla.

**El editor de manzanas.** El algoritmo de caras/cuadras (`TOL_GRADOS = 25`,
`LARGO_MINIMO = 12`) está duplicado a propósito en tres lugares: el editor,
`scripts/cargar-geometrias-y-lados.mjs` y `PredicacionPage`. Cualquier cambio va
en los tres.

---

## 2. Decisiones ya tomadas — no volver a discutirlas

- **El menú de la barra lateral queda como está.** Propuse colapsar de diez
  destinos a cinco (al estilo del panel de Estracom) y Mateo dijo que no: el menú
  está bien, el trabajo es adentro de cada pantalla.
- **La estética que se copia es la del panel de Estracom que quedó**, no la del
  `MASTER_UI_DESIGN_SYSTEM.md` de arrivd. Mateo rechazó el dark él mismo ("me
  reventó los ojos") y el azul ("lo veo tan ai"). Del `.md` de arrivd se roba el
  método, no la estética.
- **No se arrastra la cobertura a un dibujo nuevo.** Al redibujar se retira, no
  se borra, y una persona decide. Viene del incidente de los 412 de 508 lados
  con el polígono equivocado.
- **El borrador del editor vive en la base, no en localStorage.** Pedido
  explícito: "se me va a borrar todo al coño".
- **Los mapas pasaron de OpenStreetMap a MapTiler.**
  El disparador fue que a Mateo se le cayó el fondo del editor y pareció que
  se había roto la pantalla. No se había roto: las teselas de
  openstreetmap.org están donadas y su política corta a quien pide muchas
  seguidas. El editor muestra los sesenta y pico de territorios a la vez y
  llega a ese límite sin esfuerzo; cuando pasa, quedan los polígonos flotando
  en gris.

  El MapTiler propio ("Mapa territorio", 160 capas) sigue sin poder usarse:
  sus teselas raster dan 403 y pasarlo a vector obliga a cambiar Leaflet por
  MapLibre, que es reescribir la pantalla. Lo que sí funciona con la misma
  clave son los estilos estándar, y el editor ahora usa `dataviz-light`, que
  es gris parejo: los polígonos de colores se leen encima y los nombres de
  calle atraviesan igual. Todo eso vive en `src/lib/fondoMapa.ts`.

  La vista del hermano fue detrás, por decisión de Mateo. El reparo era la
  cuota: esa pantalla la usa la congregación entera y no cinco personas, y
  agotarla dejaría sin mapa a quien está parado en la esquina. Por eso
  `ponerFondo()` vuelve solo a OpenStreetMap si MapTiler falla seis teselas
  seguidas. Nadie se queda sin calles; a lo sumo se vuelve al fondo de antes.

  Queda por ver de cerca: los nombres de calle de `dataviz-light` son gris
  medio y los de OSM eran negros. En pantalla se leen mejor que antes porque
  el fondo dejó de competir, pero al sol el que manda es el contraste, y eso
  todavía no se probó en un teléfono a la intemperie. Si pierde, el cambio es
  una línea: `streets-v2` tiene las etiquetas más oscuras.
- **No armamos un planificador de colectivos propio.** Red Tulum ya está en
  Google Maps. El botón "Cómo llegar" se partió en **En auto** y **En
  colectivo**: cada uno abre una ruta desde la ubicación del teléfono
  (`travelmode=driving|transit`), no una búsqueda de la esquina. OSM y
  MapTiler no geocodifican "Manuel Zaballa y Talcahuano" (devuelven el
  centro de la ciudad); Google sí. El motor propio queda para cuando la
  provincia publique el GTFS, si alguna vez hace falta no salir de la app.

---

## 3. Hecho

- [x] Vocabulario "cuadra" en vez de "lado"; historial que dice "se hizo completo".
- [x] Esquema de importación con procedencia (`importaciones`,
      `importacion_registros`, `salida_resultados`, `territorio_historial`,
      `conductor_alias`, `grupo_territorio`).
- [x] Redibujar sin perder historia (`vigente_desde` / `vigente_hasta`).
- [x] Pantalla de revisión del Excel (`ImportacionPage`).
- [x] Editor de manzanas dentro del admin, en el build, y andando en teléfono.
- [x] Letras de manzana que caen dentro de su propio polígono (`puntoDeRotulo`).
- [x] Inicio del admin: muestra lo que espera una decisión, no el pitch. (`31beb97`)
- [x] Tema `hermano` como tercera piel, probable con `?theme=hermano`. (`3369e66`)
- [x] Urbanist cargada de verdad — no estaba en ningún lado. (`3369e66`)
- [x] Los cinco módulos abren con lo que falta, sin bloque de venta ni cifras
      de vanidad. Mapas se quedó solo con el mapa. (`29a6f9b`)
- [x] Procedencia estructurada de las 1.790 salidas importadas y edición
      progresiva histórica, sin mover la fecha ni borrar el linaje. Ver
      `docs/PROCEDENCIA-Y-EDICION-SALIDAS-HISTORICAS.md`.

- [x] Auditoría de la vista del hermano, medida en el navegador contra DEV.
      Salidas traía las 1.000 más viejas —el mismo error que en el admin, que
      acá dejaba la pantalla diciendo "No hay salidas cargadas" con 16
      próximas en la base— y ahora pide de hoy en adelante: 17 filas y 294
      nodos donde había 1.000 y 8.444. Se lee la columna `tipo`, así que las
      telefónicas dejan de mostrarse como una salida común con un "Cómo
      llegar" a ninguna parte. La letra de la manzana en el mapa sube de 15 a
      16 px y obedece la perilla del tamaño, que además se recuerda entre
      sesiones. Los modos "Manzana entera" y "Por cuadra" pasan a estar
      adentro del mapa grande, donde se marca.

---

## 4. Pendiente

### UI del admin — es donde estábamos

- [x] Pantallas de vacío y de error. (`a929f60`)
- [x] Barrido de voz en mensajes, barra lateral y nombres de módulos. (`a929f60`)
- [x] Desplegables propios, con teclado y buscador. (`489cac7`, `b158149`)
- [x] Formulario en ventana modal en vez de al pie de la tabla. (`9fc80ec`)
- [x] Salidas traía las 1.000 más viejas y no mostraba ninguna futura. (`f298dab`)
- [x] La procedencia del Excel se muestra separada de Observaciones y guardar
      ya no puede borrarla. Ver `docs/PROCEDENCIA-Y-EDICION-SALIDAS-HISTORICAS.md`.
- [x] El mapa del modal se dibujaba con la medida vieja. (`7fd256a`)
- [ ] **Barrido de voz, lo que falta:** Queda español peninsular y sin acentos en los
      formularios y en la barra lateral: "Selecciona un territorio", "Mantén una
      base confiable", "Puedes revisar", "Gestion completa de accesos",
      "Solicitudes esperando aprobacion", "Modulo", "poligonos", "aprobacion".
- [ ] **La barra lateral.** Sigue diciendo "Base del MVP para administrar mapas,
      conductores, grupos y salidas desde web, PWA o APK" — el MVP es de Mateo,
      no de quien usa. Y las tarjetas "Acceso seguro" (Login con Supabase Auth /
      Roles por módulo / Reglas RLS) le explican la arquitectura a alguien que
      no la pidió.
- [ ] **Los resúmenes de `src/data/modules.ts`.** "Resumen del sistema y estado
      del MVP", "Mapa de San Juan, zonas y futuros poligonos".
- [ ] **Revisar Importación y el editor con el tema `hermano` puesto.** No los
      miré con esa piel; seguro hay detalles.
- [ ] **Matar los temas que sobren.** Hoy viven tres pieles (classic, mapsi,
      hermano) = ~2.100 líneas pisándose por especificidad. Cuando Mateo elija,
      borrar las otras dos.

### Vista del hermano — lo que quedó de la auditoría

- [x] **Aplicar `20260904120000_programa_visible_para_el_publicador.sql`.**
      Aplicada el 4 de septiembre de 2026, solo en el clon DEV. Conductor
      1781, barrio 1286, código 1784, priorizar 274 (91 "Todo" + 183
      indicaciones reales; el umbral ~185 era un error de cuenta).

      **El dato existía y no llegaba.** El conductor, el barrio, las manzanas
      a priorizar y el código de territorio quedaron en
      `salida_importacion_procedencia` y en `importacion_registros`. Ahora
      ese texto vive en `salidas`, que es la tabla que la pantalla lee.

      **La pantalla del hermano era, en los hechos, una pantalla de admin.**
      Cada tabla que lee pedía un módulo del panel. Un publicador con rol
      `viewer` veía todo vacío. La migración agrega lectura para cualquier
      usuario activo. Informar lo que se caminó queda para los conductores
      y para quien tiene ese territorio a su nombre.
- [ ] **La columna "priorizar" del Excel está sucia y hay que decidir qué
      hacer con ella.** Sobre 1.790 filas tiene 183 valores distintos, y no
      todos hablan de manzanas: 40 son nombres de conductores ("Ariel
      Riveros" siete veces), ocho dicen "Telefónica" y algunos son el
      resultado de la salida ("se completó", "no se predicó"). La migración
      descarta lo que puede reconocer —un nombre que ya está en la tabla de
      alias— y la pantalla pinta el mapa sólo cuando lo que queda son letras
      y nada más: 129 filas se pintan, 54 se explican con palabras ("Priorizá
      Monoblocks", "Todo menos Mza C"). Lo que no se resolvió es el origen:
      el Excel sigue teniendo una columna que se usa para tres cosas.
- [ ] **Nadie tiene territorio personal asignado.** Cero reservas activas en
      DEV: la mitad de la pantalla (marcar, historial, mapa propio) no la
      puede usar ningún hermano todavía. Antes de seguir puliendo esa mitad,
      asignar aunque sea uno de verdad.
- [ ] **Probarla en un teléfono, al sol.** Todo lo de arriba se midió en el
      navegador de escritorio a 734 px de ancho.

### Vista del hermano por rol (7 de septiembre de 2026)

Hay **cinco roles** y **una sola pantalla de teléfono** (`/predicacion`). El rol
cambia qué paneles aparecen adentro, no a qué ruta se va. El plan está en
`PLAN-ROLES-GRUPOS-Y-VISTA-HERMANO-2026-09-07.md`. Rama de trabajo: `dev`.

- [x] Lista «Mirar territorio» propia (sin `<select>` nativo).
- [x] Tarjeta oscura «Tu territorio / Te faltan» solo si el territorio está asignado.
- [x] «Cómo llegar» exige GPS; las filas `SG` no inventan destino.
- [x] Pertenencia a grupo (`grupo_miembros`), código de invitación y `mi_contexto`.
- [x] Super del grupo puede confirmar hermanos, definir el punto y aprobar el
      territorio de alguien de su grupo.
- [ ] **Aplicar la migración en DEV**
      (`20260908020000_grupos_miembros_e_invitaciones.sql`) cuando estén las
      credenciales locales. Producción no se toca.
- [ ] Recorrer en teléfono real (390 px y 320 px) con cuatro usuarios de prueba.

Quedó fuera de este corte (no hacerlo acá):

- Excepciones por fecha para la salida de grupo.
- Programa propio por grupo con rotación (va con
  `PLAN-ROTACION-Y-PROPUESTA-DE-PROGRAMA-2026-09-06.md`).
- Que el super cree conductores desde el teléfono.
- Notificaciones push o WhatsApp automático al confirmar.
- Una persona en dos grupos a la vez.
- Cuenta sin email (solo teléfono / OTP).

### Datos

- [x] **Aplicar el histórico de staging.** Se ejecutó sólo en DEV con las
      migraciones y aplicadores auditables: 3.346 filas reconciliadas, sin
      pendientes ni conflictos; los 71 casos no operativos quedaron cerrados,
      no inventados.
- [x] **Resolver los 64 conflictos del Excel** de salidas. Quedaron como
      cierres históricos auditables; no se fabricaron fecha, hora, territorio,
      resultado ni relaciones operativas.
- [ ] **Emparejar los alias de conductor con las personas reales.** La nueva
      procedencia relaciona 1.781 coincidencias exactas con `conductor_alias`,
      pero eso no asigna automáticamente `salidas.driver_id`; la identidad
      operativa sigue requiriendo evidencia y decisión explícita.
- [ ] **Llenar `puntos_encuentro` con las coordenadas de los 145 enlaces de
      Maps del Excel.** La tabla ya existe y `salidas.meeting_point_id` ya
      apunta. Hoy las salidas importadas tienen el nombre de la esquina y
      casi nunca lat/lng: OSM/MapTiler no geocodifican "calle y calle" en
      San Juan. Los enlaces del Excel sí traen el pin (`@lat,lng` o un
      goo.gl que hay que resolver). `coordsDeMapsUrl` en `src/lib/comoLlegar.ts`
      ya parsea el caso largo. Con eso el programa semanal puede asignar el
      punto solo, que es para lo que se pidió geolocalizar las intersecciones.
- [ ] `reserved_for` sigue siendo texto libre.
- [ ] Territorio 57: le faltan al menos 5 manzanas; 3 manzanas muestran 2 caras.
- [ ] Mateo tiene ~24 territorios con cambios sin publicar en el editor.

### Salió de la auditoría, resuelto

- [x] **Las 1.790 salidas importadas no se pueden editar.** El formulario exige
      territorio, conductor, punto de encuentro y horario; la importación no
      trajo ninguno. Apretar "Editar" en cualquiera es un callejón sin salida.
      Ahora se puede completar de a poco: lo ausente queda ausente y lo que ya
      estaba guardado se conserva. Fecha, hora y procedencia son de solo
      lectura; borrar historia está bloqueado.
- [x] **`salidas.notes` guarda datos que no son una observación.** La
      procedencia está en `salida_importacion_procedencia`, con el texto crudo
      y el JSON parseado, y `notes` vuelve a ser observación humana. El alias se
      relaciona sólo cuando la coincidencia exacta es única.

### Riesgo real

- [ ] **Rotar la contraseña que quedó commiteada en el README.** Sigue en el
      historial de git. Es el único pendiente que es un riesgo hoy.
- [ ] **Restringir la clave de MapTiler por dominio.** Ya está en `.env` como
      `VITE_MAPTILER_KEY` y el editor la usa, pero una clave de mapas viaja
      sí o sí al navegador: queda escrita en `dist/assets/editor-*.js` y
      cualquiera que abra la pantalla la puede copiar. La única defensa es la
      lista de dominios permitidos en el panel de MapTiler. Sin eso, la cuota
      es de quien la encuentre.
- [ ] **La clave sigue escrita a mano en `comparar-mapa.html`**, que es uno
      de los archivos sin trackear de la raíz. Si se commitea sin mirar,
      repite la historia del README. Ahora que está en `.env`, ese archivo
      debería leerla de ahí o borrarse.
- [ ] **`src/lib/mapsiMapStyle.ts` no lo usa nadie.** Son 164 líneas para
      recolorear el estilo de MapTiler, escritas y nunca conectadas. O se usa
      cuando se decida el motor del mapa, o se borra.

### Higiene

- [ ] 43 commits en `mapa-por-manzanas` sin mergear a `main`.
- [ ] ~20 archivos sin trackear en la raíz (`banco-tema.html`, `bench-manzanas.html`,
      `comparar-mapa.html`, `demo-manzanas.html`, `respaldo-simulado.json`,
      `dev-dist/`…). Decidir qué se commitea y qué se borra.
- [ ] Cambios sin commitear de Codex en `src/lib/supabase.ts`,
      `src/pages/ImportacionPage.tsx`, `src/styles/importacion.css`, `.gitignore`.
- [ ] El editor no funciona sin señal: falta cachear los tiles y encolar los
      guardados. Tampoco es instalable todavía.
- [ ] Mapa de calor de cobertura.

---

## 5. Bugs conocidos que no toqué

- **`<button>` adentro de otro `<button>`** en la tabla de conductores
  (`driver-availability-table`). HTML inválido, React lo tira por consola en cada
  render, y hace ambiguo qué se clickea. Es previo al trabajo de UI.
- **Las tablas se encimaban en pantalla angosta** (los teléfonos se montaban
  sobre la disponibilidad). Verificado que ya pasaba en el tema Mapsi, así que no
  lo introdujo el tema nuevo. A 1440 px se ve bien. Es responsive de `index.css`.

---

## 6. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Método de UI (el que pidió Mateo aplicar) | `/Users/macm1pro16toponly/Documents/Estracom Viajes/docs/METODO-UI.md` |
| Referencia arrivd (método sí, estética no) | `…/Estracom Viajes/docs/design-reference/MASTER_UI_DESIGN_SYSTEM.md` |
| Panel de Estracom, la estética que sí quiere | `…/Estracom Viajes/src/app/globals.css` y `src/app/panel/` |
| Vista del hermano | `src/pages/PredicacionPage.tsx` + `src/styles/vista-hermano.css` |
| Tema del admin | `src/styles/theme-hermano.css` (probar con `?theme=hermano`) |
| Editor de manzanas | `editor-manzanas.html` |
| Aviso "lo que falta" de cada módulo | `src/components/Falta.tsx` |
