# Qué falta

Estado del proyecto y lista de pendientes. **Leer esto al empezar una sesión**
y al volver de una compactación, antes de tocar nada.

Actualizado: 3 de septiembre de 2026 · rama `mapa-por-manzanas` (43 commits sin
mergear a `main`).

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

### Vistas mobile que no existen

Hay **cinco roles** (`admin`, `superintendente`, `siervo`, `conductor`, `viewer`)
y **una sola pantalla mobile** (`/predicacion`). Los demás entran al panel de
escritorio desde el teléfono.

- [ ] **Antes de diseñar: contar cuántas personas hay de cada rol en la base.**
      Si ningún conductor tiene usuario todavía, esa pantalla es la última, no la
      primera. Pendiente de consultar.
- [ ] Pantalla del conductor: a quién lleva y adónde. Acción: confirmar que va.
- [ ] Pantalla del siervo de grupo: si su grupo tiene territorio para el finde.
- [ ] Pantalla del superintendente: qué territorio está sin tocar hace meses.

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
- [ ] `grupos_servicio` tiene 11 filas para 5 grupos.
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
