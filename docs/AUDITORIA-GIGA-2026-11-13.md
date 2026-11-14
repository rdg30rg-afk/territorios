# Auditoría giga — 13 de noviembre de 2026

Rama `dev`. Nada de esto está arreglado todavía: es la lista.

**Cómo se hizo.** Cinco auditorías de código en paralelo (salidas y programa,
usuarios y acceso, vista del hermano, mapas y editor, permisos SQL), más un
recorrido mío por el panel y por `/predicacion` con la sesión de Mateo, a
1440 px y a 375 px.

**Qué no se hizo.**
- En la auditoría no se probó ninguna escritura. Después Mateo confirmó que
  la base `rkmio…` es la de producción y autorizó escribir: ver la sección
  3 bis, que sí probó guardados, con un candado sobre lo que ya existía.
- El editor de mapas se abrió una sola vez y no se tocó (ver M1).
- No se probó en un teléfono real ni sin señal de verdad.
- `npm test` pasa 724 de 724 y `tsc` no da errores: ninguno de estos bugs
  rompe un test. Tres tests fijan comportamientos que acá figuran como bug
  (A1, G2, S18).

**Marcas.** ✔ lo comprobé yo en el código o en pantalla · ○ lo confirmó la
auditoría leyendo el camino completo, yo no lo repetí · ? probable, falta
reproducir.

---

## 0. Preguntas que necesitan una decisión tuya

| # | Pregunta | Por qué importa |
|---|---|---|
| P1 | ~~¿La «base de prueba» ya es la de verdad?~~ **Respondida: sí, `rkmio…` está en producción.** | Falta sacar el cartel «Base de prueba: lo que toques acá no afecta a la base de verdad», y corregir la sección 1 de `QUE-FALTA.md`, que todavía la llama clon de desarrollo. |
| P2 | En Usuarios, ¿quedan solo Publicador y Administrador? | El servidor ya ignora los otros roles y los tildes de módulos (G4). |
| P3 | ¿«Eliminar conductor» pasa a ser «Desactivar»? | Hoy borra su historia (G5). |
| P4 | ¿Se rehace Grupos sobre los miembros reales? | La pantalla sigue en el modelo viejo y no puede nombrar un superintendente (G3). |
| P5 | ¿Qué tiene que ser «Salidas Grupo de Servicio»? | Hoy es una copia de Salidas con la grilla vieja (S11). |
| P6 | El mapa viejo (`SanJuanMap`, 4.246 líneas): ¿se borra o se rescata el plano PDF y la exportación? | No se monta nunca (M15). |
| P7 | ¿El editor tiene que poder crear y retirar territorios en la base? | Hoy solo existen en el borrador (M5). |
| P8 | El código de grupo, ¿activa la cuenta solo o espera al superintendente? | Hoy activa, y rechazar no desactiva (G9). |

---

## 1. Tanda 1 — pueden perder trabajo, datos o dejar a alguien afuera

### Acceso

- **A1 ✔ Sin red, la app te saca.** Abrirla sin señal, o volver de WhatsApp
  mientras marcás, desmonta todo con «No pudimos comprobar tu acceso». En el
  admin se pierde el formulario abierto. La revalidación de fondo trata una
  falla de red como si te hubieran sacado el permiso.
  `src/context/AuthContext.tsx:159-169, 274-284`. `tests/auth-refresh.test.mjs`
  fija este comportamiento: hay que cambiarlo junto.
- **A2 ✔ No se puede recuperar ni cambiar la contraseña.** El login dice
  «pedí un enlace de recuperación» y esa función no existe en ningún lado.
  `src/pages/LoginPage.tsx:25`.
- **A3 ✔ Quedar de responsable de grupo por llamarse igual.** El sembrado
  empareja por nombre, y el nombre lo edita cada uno en «Mi cuenta». Pasa
  también con homónimos (padre e hijo), y vuelve a sembrar a quien sacaste.
  `supabase/migrations/20260908040000_roles_unificados_y_auditoria.sql:551-581`.

### Mapas y editor

- **M1 ✔ «Cancelar» sube la copia vieja encima del borrador de todos.** Al
  abrir Mapas me salió «Hay dos versiones distintas»: esta computadora, 69
  territorios del 11/11; la base, 80 territorios de hoy. Los botones son
  «Cancelar» y «Usar el de la base». Cancelar, Esc o un clic afuera eligen la
  copia local y la suben. No lo toqué. `editor-manzanas.html:2883-2899`.
- **M2 ○ El trabajo local más nuevo se descarta sin preguntar** cuando la
  cantidad de territorios y manzanas coincide: solo se compara la cuenta.
  `editor-manzanas.html:2871`.
- **M3 ✔ «Nuevo territorio después de este» corre los números a mano.** Al
  publicar, el dibujo del viejo 12 cae en la fila 13 de la base, con la
  historia, las salidas y la asignación personal del 13. El último número no
  se puede publicar. `editor-manzanas.html:2127`. (El corrimiento lo vi; el
  cruce al publicar lo confirmó la auditoría.)
- **M4 ○ Entrar a mirar reescribe el borrador compartido.** A los 1,2 s hace
  un guardado aunque no hayas tocado nada, y al otro admin le aparece
  «Alguien más guardó…» y deja de guardar. `editor-manzanas.html:2929, 654`.
- **M6 ○ Publicar retira cobertura sin decir cuánta.** Republicar un
  territorio idéntico retira igual todas sus cuadras marcadas; la
  confirmación no muestra el conteo; y todo territorio con color o número
  pendiente viaja con su dibujo a medio hacer.
  `editor-manzanas.html:3306, 3359, 3379`.
- **M7 ○ «Guardado» se decide por cantidad de manzanas.** Mover vértices,
  cambiar letras o corregir caras figura como publicado.
  `editor-manzanas.html:1487-1500, 3616-3628`.
- **M11 ○ Salir de Mapas por el menú destruye el editor sin aviso** y pierde
  lo que no llegó a guardarse. `src/pages/MapasPage.tsx:88`.

### Vista del hermano

- **H1 ✔ Una marca que falla por mala señal queda trabada.** Pasa a «error»,
  no se reintenta sola, desaparece del mapa y bloquea esa cuadra hasta tocar
  «Reintentar». `src/lib/coverageOutbox.ts:96-106`.
- **H2 ○ Una marca rechazada para siempre no se puede descartar.** Si te
  liberaron la reserva o se republicó el dibujo, esa marca bloquea la cuadra,
  «Devolver territorio», el botón «Actualizar» y el aviso al cerrar sesión.
  `src/lib/coverageOutbox.ts:58-114`.
- **H3 ✔ El mapa grande se rearma en cada cambio.** Cada marca vuelve el zoom
  al territorio entero; a veces queda gris. El efecto depende de una función
  que se crea de nuevo en cada render.
  `src/pages/PredicacionPage.tsx:2788-2801, 1914`.
- **H4 ○ El conductor que no informó el mismo día pierde la salida.** Solo se
  piden salidas de hoy en adelante. `src/pages/PredicacionPage.tsx:872-884`.
- **H5 ○ «Informar predicación» es un callejón** para la telefónica, para una
  salida sin territorio, si no marcaste nada en el mapa, o sin señal.
  `src/components/InformePredicacionFlow.tsx:105-109`.

### Grupos y personas

- **G1 ✔ Cambiar de grupo falla siempre** con un error crudo de la base. Lo
  mismo salir del grupo. Se cierra la membresía sin ponerla en «retirado».
  `supabase/migrations/20260908020000_grupos_miembros_e_invitaciones.sql:320-322, 349-351`.
- **G2 ○ Quien no es admin no puede leer puntos de encuentro, grupos ni
  conductores.** El superintendente guarda el punto del grupo y nunca lo ve;
  «Mi cuenta» muestra el grupo en blanco; «Cómo llegar» queda sin GPS.
  `supabase/schema.sql:285-305`. El test usa una política que no existe en
  ninguna migración (`tests/sql/roles-unificados.sql:202`).
- **G5 ✔ Eliminar un conductor borra su historia**: lo saca de todas sus
  salidas, del programa semanal y desvincula su cuenta. El aviso es «Se
  eliminara el conductor». `src/pages/ConductoresPage.tsx:321-345`.
- **G7 ○ Cualquier responsable saca a cualquiera del grupo con un toque**,
  incluso al superintendente o a sí mismo, sin confirmación. Reponer el cargo
  hoy exige SQL. `src/components/HojaMiGrupo.tsx:361-369`.

### Salidas y programa

- **S1 ○ La telefónica no se puede editar ni crear a mano.** El servidor
  exige territorio a toda salida. `src/pages/SalidasPage.tsx:1732-1753`;
  `supabase/migrations/20260921020000_lugar_sin_gps_obligatorio.sql:121-127`.
- **S2 ○ Al cambiar el punto queda el GPS del punto anterior**, y un cartel
  ofrece guardarlo en el catálogo con un clic.
  `src/pages/SalidasPage.tsx:1691-1701, 3118-3131`.
- **S5 ○ El lunes abre la semana pasada.** «Proponer» y «Guardar» crean
  salidas en el pasado, que cuentan como trabajadas en la rotación.
  `src/features/programa/ProgramaSemanal.tsx:209, 320-322`.
- **S6 ○ «La semana de siempre».** Cerrar no descarta lo editado. Y si falla
  una lectura, cae a la semana escrita en el código y «Guardar la semana»
  pisa la real. `ProgramaSemanal.tsx:1960, 2111`;
  `src/features/programa/configSemana.ts:37-39`.
- **S7 ○ Errores tragados que cambian lo que se propone.** Si falla la
  rotación, todo figura «Nunca se programó»; si falla la agenda del período,
  «Proponer» rearma lo ya guardado y duplica. `ProgramaSemanal.tsx:425-429, 463-465`.

---

## 2. Tanda 2 — importantes

### Acceso y usuarios

- **A4 ○** `resolve_login_email` está abierto sin sesión y devuelve el email
  de cualquier usuario. `…20260901000000_restore_resolve_login_email.sql:15-32`.
- **G3 ○ Grupos en el modelo viejo.** Sumar un auxiliar da «Ya existe uno con
  esos datos». «Eliminar» borra el grupo entero con sus miembros y su código.
  Cambiar el responsable no le da permisos. `src/pages/GruposPage.tsx:373-398, 608`.
- **G4 ✔ Usuarios tiene controles que no hacen nada.** Los tildes de módulos
  y los roles Superintendente, Siervo y Conductor responden «Listo» y no
  cambian nada. `src/pages/DashboardPage.tsx:21-27, 709-727`.
- **G6 ○** Dar de baja borra el rol y el vínculo de conductor; al reactivar
  vuelve como publicador pelado y su territorio queda «Cuenta no disponible».
  `src/context/AuthContext.tsx:594-597`.
- **G8 ○** No se puede nombrar otro superadmin ni vincular al admin con su
  propio conductor. `src/pages/DashboardPage.tsx:581-583`.
- **G9 ○** El código de grupo activa la cuenta y rechazarla no la desactiva;
  no hay límite de intentos. `…20260908020000…:328-333`.
- **G10 ○** El responsable ve los pedidos de ingreso como «Sin nombre».
  `…20260908030000…:88-111`.
- **G11 ○** El superintendente no ve los pedidos de territorio de su grupo,
  aunque al publicador se le dice que él los confirma.
  `src/pages/PredicacionPage.tsx:1661`.
- **G12 ○** El código de grupo escrito al registrarse se pierde si hay
  confirmación por email. `src/context/AuthContext.tsx:543-558`.
- **G13 ○ Errores y éxitos que nadie ve.** En Conductores y Grupos solo se
  pintan dentro del modal. Si falla la carga sale «Todavía no hay ningún
  conductor cargado». `ConductoresPage.tsx:674`, `GruposPage.tsx:654`.
- **G14 ○** `decirElError` reemplaza mensajes buenos del servidor por
  genéricos («Esa persona ya tiene un territorio» pasa a «Ya existe uno con
  esos datos»). `src/lib/decirElError.ts:23-40`.
- **G15 ✔** Unos 26 lugares muestran el error crudo de la base, en inglés
  (`HojaMiGrupo`, `GestionSalidasGrupo`, `MiCuenta`, `SanJuanMap`).
- **G16 ○** «Administrar hermanos, punto y código» sale sin estilos en el
  admin: sus clases solo existen dentro de la vista del hermano.
  `src/pages/GruposPage.tsx:120`.
- **G17 ○** Un grupo nuevo nace sin código; la ficha dice «Se crea al aplicar
  la migración». `GruposPage.tsx:114`.
- **G18 ○** Resolver una solicitud borra las notas escritas en las demás.
  `src/pages/TerritorioPersonalPage.tsx:411-412`.

### Salidas y programa

- **S3 ○** El Programa no se entera de lo que se borra o edita en la agenda:
  el conductor queda «Ya conduce ese día» y bloquea Guardar hasta recargar.
  `ProgramaSemanal.tsx:455-469`.
- **S4 ○** «Asignar conductor» filtra por un «Slot elegido» fantasma y dice
  «No hay conductores disponibles». `SalidasPage.tsx:1387-1407`.
- **S8 ?** Crear salidas no tiene clave de idempotencia: un reintento o dos
  admins a la vez duplican. `…20260907020000…:61-318`.
- **S9 ○** Buscar y «Ver anteriores» trabajan sobre las 300 traídas, de
  1.894. Las más viejas no se pueden abrir. `SalidasPage.tsx:218, 986-1039`.
- **S10 ○** Tras «Completar» una salida del Excel, la tarjeta pasa a «Sin
  conductor / Sin territorio» hasta recargar. `SalidasPage.tsx:225, 1819`.
- **S11 ✔** `/salidas-grupo` es la misma lista de Salidas con la grilla
  vieja: tildar una fila abre un modal, «Guardar tildadas» duplica, y las
  observaciones se copian a todo el lote. `SalidasPage.tsx:1217, 2111`.
- **S12 ○** Borrar el texto «Asamblea regional» para escribir otro motivo
  desmarca el día mientras escribís. `ProgramaSemanal.tsx:1524`.
- **S13 ✔** El orden dentro del día no es por hora: vi el martes 17 con la de
  17:00 antes que la de 09:30. `src/lib/agendaPorDia.ts:67-86`.
- **S14 ✔** En un desplegable con buscador la flecha salta de a dos y Enter
  elige dos veces: el teclado está enganchado dos veces.
  `src/components/Desplegable.tsx:243, 255`.
- **S15 ✔** Seleccionar texto arrastrando y soltar fuera de la tarjeta cierra
  el modal y borra el formulario. `src/components/Modal.tsx:66-68`.
- **S16 ○** PDF: la telefónica sale con «Ver mapa» y «Todo el territorio»;
  recorta textos largos sin avisar; el nombre del archivo usa fecha UTC.
  `src/lib/salidaPdf.ts:100, 243, 416`.
- **S17 ○** Reglas disparejas: territorio repetido bloquea dentro del
  borrador y no contra la agenda; las salidas de grupo cuentan como «ya hay».
  `ProgramaSemanal.tsx:455-463, 942-944`.
- **S18 ○** Si se aplica `20260906020000`, ningún admin puede leer el
  borrador del programa (la política llama a una función revocada).
  `…20260923020000_borrador_programa_compartido.sql:18-20`.
- **S19 ○ Acciones que faltan:** crear «Salidas de Grupos», dejar una salida
  sin conductor, el campo «Priorizar», un estado «cancelada», y reemplazar un
  conductor por una vez.
- **S20 ✔ En una notebook el Programa muestra la vista de teléfono.** Por
  debajo de ~1440 px de ventana se oculta la grilla y desaparecen «Volver a
  proponer» y «Deshacer». `src/styles/programa.css:756-760`.
- **S21 ○** En escritorio, después de guardar, la grilla vuelve a mostrar las
  filas vacías. `ProgramaSemanal.tsx:1543-1806`.

### Mapas y editor

- **M5 ○** «Crear», «Dividir» y «Borrar» territorio solo existen en el
  borrador. «Dividir» además retira manzanas de la vista del hermano sin
  aviso. `editor-manzanas.html:2032, 2374-2394`.
- **M8 ○** Reintentar un intercambio de números cuya respuesta se perdió
  cruza los dibujos. `editor-manzanas.html:3343-3346`.
- **M9 ○** No hay control de «sobre qué versión estaba trabajando»: un editor
  abierto hace una hora publica encima de lo de otro. `editor-manzanas.html:3325`.
- **M10 ○** Un clic en la calle cierra el territorio: se pierde el gesto a
  medias, y con letras a medias Enter las sella en manzanas ajenas.
  `editor-manzanas.html:2788-2793`.
- **M12 ○** «Traer este territorio de la base» ignora las letras publicadas.
  `editor-manzanas.html:3866-3904`.
- **M13 ○** El editor baja turf de esm.sh y Leaflet de unpkg sin versión
  fija; si falla queda «Cargando manzanas…» para siempre.
  `editor-manzanas.html:458-468, 2838`.
- **M15 ○** `SanJuanMap.tsx` y `src/features/map-editor/**` no se montan
  nunca. Con ellos quedan inalcanzables el plano PDF, la exportación y el
  alta de territorio. `MapasPage` igual lo importa.
- **M16 ○** Cobertura: la columna «Metros» muestra porcentaje; dice «lados»;
  traga el error de carga; se reinicia al cambiar de pestaña; y el enlace
  `/mapas?territorio=` cae en el editor, que lo ignora.
  `src/components/CoverageHeatmapPanel.tsx:50, 124, 195`.

### Vista del hermano

- **H6 ○** Si dos informan la misma salida, al segundo le queda un intento
  trabado para siempre. `src/lib/resultDelivery.ts:27-31`.
- **H7 ○** El fondo del mapa cuenta 6 fallas acumuladas, no seguidas: sin
  señal cambia a OpenStreetMap y se pierden las teselas guardadas.
  `src/lib/fondoMapa.ts:91-96`.
- **H8 ○** Avisos y cargas que no se limpian: el aviso de falla queda aunque
  la recarga salga bien; «Cargando el mapa…» eterno; elegir el territorio que
  ya estaba elegido lo deja cargando. `PredicacionPage.tsx:942-946, 1600-1604`.
- **H9 ○** «No accesible» y «Para revisitar» no se pintan y cuentan como
  faltantes: un territorio con un barrio cerrado nunca llega a «Terminaste».
  `PredicacionPage.tsx:536-549, 838-850`.
- **H10 ○** Lo marcado sin señal queda fechado el día que sincronizó.
  `…20260905030000_cobertura_por_rpc_idempotente.sql:61-63`.
- **H11 ○** Al escribir el comentario del informe, el teclado se cierra solo
  a los 4 s. `InformePredicacionFlow.tsx:43-67`.
- **H13 ○** Pantallas mudas: mapa en blanco ante un error; «0 hermanos» si
  falla la carga del grupo; a un pendiente le dice «Todavía no está cargado
  el programa». `PredicacionPage.tsx:1303, 2750`; `HojaMiGrupo.tsx:59-85`.
- **H16 ○** En `/predicacion` no hay «Instalar la app» ni «dónde estoy».
- **H18 ○** La cola de marcas y el envío de resultados solo funcionan contra
  `rkmio…`, por una constante. Al pasar a la otra base, todos ven «Cola
  bloqueada». `src/lib/useCoverageOutbox.ts:40`, `src/lib/resultDelivery.ts:6`.

### Base y proceso

- **B1 ○** La migración de roles aborta si hay dos o más admins activos, y
  con cero deja el sistema sin superadmin. `…20260908040000…:10-42`.
- **B2 ○** Dos migraciones con la misma versión `20260908050000`; se aplican
  a mano y sin registro; hay tests SQL que prueban una copia de las funciones
  y no la migración (`tests/sql/grupos.sql:196`).
- **B3 ?** `borrar_salida` solo existe en `20260906020000`. Verificar que
  esté aplicada: si no, «Eliminar salida» falla.
- **B4 ○** `current_date` va en UTC: después de las 21:00 de acá ya es mañana
  para vigencias y retiros.
- **B5 ○** Dos correos con la misma parte antes de la arroba dan «Database
  error saving new user». `supabase/schema.sql:27-29`.
- **B6 ○** El responsable ve email y usuario de sus miembros, y puede aprobar
  un territorio para alguien de otro grupo o para sí mismo.
- **B7 ✔** `npm run lint` recorre `output/` y `dev-dist/` y tapa todo con
  avisos de archivos compilados. En `src` hay tres avisos reales de hooks en
  `SalidasPage.tsx:866`.
- **B8 ○** Si se aplica el retiro de territorio, la vista
  `territorios_actuales` pierde `security_invoker`.
  `…20260921010000_retiro_territorio.sql:607`.

---

## 3. Tanda 3 — menores

- **H12 ○** «Hoy es predicación telefónica» cuando hay otras con tipo; «La
  salida de hoy» para una de mañana; «Te faltan 1 manzanas»; «Sos el
  conductor» con hora y sin día. `PredicacionPage.tsx:1292, 1451, 1625`.
- **H15 ✔** «Sin información suficiente» y «51 sin dato» no dicen nada a
  quien lee. El aviso «Tu pedido del territorio 53 no fue aprobado» queda
  fijo aunque ya tengas otro. «Tu grupo sale — cuando lo carguen» se lo dice
  al propio superintendente.
- **H17 ○** La actualización se bloquea por marcas de otra cuenta en el mismo
  teléfono. `CoverageCorrectionForm` usa una clase que no existe.
- **M14 ○** Dibujando, la tecla 1 descarta el dibujo; fusionar deja la
  manzana absorbida encimada al recargar; después de tildar «imán», Enter,
  Esc y deshacer no responden hasta hacer clic en el mapa.
- **G19 ○** Cerrar o guardar «Editar» abre la ficha del mismo conductor o
  grupo; `id="modal-titulo"` duplicado. `ConductoresPage.tsx:271`, `Modal.tsx:62`.
- **D-inicio ✔** Inicio dice «0 de 1 lado» y «64.8%» (va «cuadra» y coma
  decimal). Importación tarda ~9 s en traer las cifras y mientras tanto dice
  «No hay filas pendientes de revisión».
- **PWA ✔** Los atajos de la app instalada llevan a `/mapas` y `/salidas`,
  que a un publicador lo rebotan.

**Reglas duras de la vista del hermano** (○, con selector y línea en el
informe de la auditoría):
- Menos de 16 px: `.resultado-datos dt`, `.status-pill` y `.form-feedback`
  dentro del informe.
- Menos de 56 px: los botones +/− del mapa (30 px), `details.histPie >
  summary`, y la franja para tocar una cuadra (26–28 px).
- Solo color: modos y estados de «Marcar lo que recorrí», los filtros de
  Salidas, y las leyendas del mapa.

---

## 3 bis. Simulación con usuarios (13/11, 22:30 a 23:30)

Cinco agentes Sonnet hicieron de ocho personas en el navegador, contra la
base real, con el modo simulación (`src/lib/simulacion.ts`): Rubén (publicador,
52), Daniel (conductor, 41), Hugo (superintendente, 58), Marcelo (territorios
de grupo, 44), Sergio (encargado de territorios, 47), Esteban (territorios
personales, 60), Camila (precursora, 23) y Marta (precursora, 67). No vieron
esta lista. Hubo 59 guardados reales (6 fueron de la limpieza posterior), 25
bloqueados por el candado y 5 rechazados por la base.

### Lo que confirmaron en vivo

- **A1** Camila y Daniel cayeron en «No pudimos comprobar tu acceso. La
  comprobación tardó demasiado» en medio del uso, con red.
- **B3 pasa a tanda 1: «Eliminar salida» no funciona.** La base contesta
  «Could not find the function public.borrar_salida». Hoy no se puede borrar
  ninguna salida desde el panel.
- **H2** Ocho marcas bloqueadas llenaron Hoy y Salidas con renglones «Cuadra
  043de5fc: …» que nadie puede descartar. A Marta el saludo le quedó a 1.900 px.
- **H9** Camila marcó la manzana B «No accesible»: no se pinta, la lista dice
  «te falta», y «Sin dato» sobre la manzana entera no la quita.
- **G3** Sumar un auxiliar: «Ya existe uno con esos datos.»
- **G7** «Sacarlo del grupo» actuó sin preguntar.
- **S4** Al editar una salida, el conductor aparece como «Elegir conductor» y
  la lista sale filtrada por el «Slot elegido».
- **S9** Sergio no pudo llegar a una salida de hace tres meses.
- **S13** Mañana se listaba 09:30, 17:30, 09:30, 10:00.
- `reportar_error_cliente` tampoco existe en la base: los errores del
  navegador no se están guardando.

### Lo nuevo

- **U1 La hoja «Mi grupo» no se puede desplazar.** Mide 1.330 px y al
  deslizar se mueve la pantalla de atrás: los hermanos y sus botones quedan
  fuera de alcance. «Darle un territorio» y «Programar salida» se abren abajo,
  fuera de pantalla. Pasa también en la ficha de grupo del panel.
- **U2 Un informe mal cargado no se puede corregir.** Al reabrir muestra
  «Resultado actual: Parcial» sin ningún botón, y al cerrar pregunta
  «¿Descartar lo marcado?», que es falso.
- **U3 «Continuar» guarda las cuadras antes del resultado.** Si el conductor
  se va ahí, queda el territorio informado y la salida sin resultado.
- **U4 «Realizada» viene preseleccionada** aunque el cartel dice «Sin
  resultado informado».
- **U5 Para informar solo el resultado hay que volver a marcar el mapa.**
- **U6 La tarjeta de la salida no dice si ya fue informada**, ni por quién.
- **U7 El conductor no ve cuáles salidas son suyas**: la lista es de toda la
  congregación.
- **U8 El programa propone territorios sin punto de encuentro** y después
  dice «Este territorio todavía no tiene puntos. Se agregan desde Mapas y
  Territorios», sin enlace. La salida no se puede dejar lista.
- **U9 «Guardar» del programa queda gris sin decir por qué.**
- **U10 Inicio dice «No hay nada esperándote»** con 7 salidas sin punto en
  el programa.
- **U11 El PDF de la semana trae 5 salidas cuando el programa muestra 17**:
  solo usa lo ya guardado y no lo aclara. Tampoco se ve dónde quedó el archivo.
- **U12 No hay un resumen por grupo** de qué territorio usa cada uno, ni una
  lista de territorios libres para dar.
- **U13 Territorio Personal no muestra cuánto lleva recorrido cada uno**, y
  «Devolver» no deja anotar por qué.
- **U14 El publicador no puede pedir otro territorio ni mirar otro**: el
  selector solo muestra el suyo.
- **U15 No hay cómo compartir una salida** (solo el PDF) y la tarjeta no dice
  quién conduce.
- **U16 Los avisos tapan lo que se toca.** «N marcas sin enviar» y «Marcaste
  la manzana X · Deshacer» se apilan sobre el mapa y la lista; con la letra
  de Marta ocupan un tercio de la pantalla.
- **U17 «A+» agranda poco** (de 16 a 18 px), y con esa letra «Manzanas» y
  «Recorridas» se cortan a mitad de palabra.
- **U18 Un nombre largo rompe la tarjeta**: «TERRITORIO» se parte en «TER /
  RIT / ORI / O».
- **U19 El historial muestra la hora sin a. m. / p. m.**: una marca de las
  22:25 figura «10:25:02». Dos toques en una manzana son «10 movimientos».
- **U20 Las confirmaciones del navegador a veces no se ven**: el primer clic
  en «Eliminar» parece no hacer nada.
- **U21 «Programar salida» del grupo arranca en hoy 10:00**, no en el sábado,
  y las listas ordenan 1, 10, 11, 2, 20.
- **U22 El motivo del rechazo queda a la vista del hermano tal como se
  escribió** («no fue aprobado: Por tonto») y no se puede cerrar.
- **U23 El gesto «atrás» saca de la app**: las pestañas no suman historial.
- **U24 «Recorrido» pinta la manzana naranja («Empezada»)** y no se entiende
  la diferencia. «Marcar lo que recorrí» y «Listo, terminé de marcar» son dos
  botones verdes iguales.

### Qué quedó en la base

- Tres salidas de prueba, todas en «Territorio QA DEV» con Mateo de
  conductor: una del 13/11 21:30 (con resultado «Parcial») y dos que pasé al
  12/11 09:30. No se pueden borrar hasta que exista `borrar_salida`.
- En el territorio 14: cuatro cuadras de la manzana B como «No accesible».
  Se quitan desde Historial → «Corregir esta marca».
- El historial del territorio 14 tiene unos 43 movimientos de la prueba.
- Conductor y grupo de prueba: creados y borrados.

---

## 4. Diseño del admin

Lo que vi en pantalla, de más a menos «verde»:

1. **Usuarios.** Una tarjeta gigante por persona: 11 personas son cinco
   pantallas de scroll. La píldora «Autorizado» ocupa todo el ancho. No se ve
   quién es admin ni quién conduce. El editor tiene dos «Guardar» y dice
   «Grupo 2 · Grupo 2». → Tabla compacta con ficha en modal.
2. **Conductores.** Filas de 73 px porque «Editar» y «Eliminar» van apilados:
   entran cuatro conductores en pantalla. «Eliminar» en rojo en cada fila. La
   barra de arriba está desalineada. → Fila de 44 px y acciones en un menú.
3. **Grupos.** Una tabla entera por grupo para mostrar una persona, con «1
   asignacion/es». No muestra miembros, código ni punto. → Una tarjeta por
   grupo con todo eso.
4. **Salidas.** Programa, agenda, PDF y una ayuda que describe la pantalla
   vieja, todo en una página larga. En notebook sale la vista de teléfono
   (S20). Las etiquetas «En la agenda / Lista / Falta / Grupos» no tienen
   leyenda.
5. **Territorio Personal.** Las pestañas son botones sueltos a la derecha;
   un bloque «Buscar» con título de más; «0 día/s»; «Beneficiario».
6. **Barra lateral.** Con 900 px de alto la tarjeta de sesión queda cortada.
   Muestra «Rol: admin · Módulos: acceso completo». Entre ~840 y 1024 px
   queda un hueco vacío arriba del contenido.
7. **Editor de mapas.** Otra tipografía (14 px, con textos de 11), botones
   píldora y colores propios; «Cmd+Z» 31 veces; «prototipo».
8. **Login.** El panel izquierdo no cambia al pasar a «Solicitar acceso»;
   el campo de contraseña del ingreso dice «Mínimo 6 caracteres».

Lo que lo unifica (una vez, para todas las pantallas):
- Un solo juego de botones (hoy hay dos familias) y un solo patrón de
  pestañas (hoy hay tres; en todos el ícono cae arriba del texto).
- Avisos de éxito y error en un mismo lugar visible, en vez de adentro del
  modal o arriba fuera de pantalla.
- Reemplazar los 22 `confirm()` del navegador por el modal propio.
- Un solo «cargando» (hoy hay cinco, con «...» y «…»).
- Tablas que por debajo de 1280 px no pierdan los rótulos.
- Limpiar `index.css`: 127 selectores pisados por el tema, y bloques muertos.

---

## 5. Textos

Sin acento o en peninsular, a barrer de una pasada:

- `src/lib/decirElError.ts:17-49` — «Algo fallo», «Se vencio la sesion. Volve
  a entrar», «Fijate si tenes internet», «Falta aplicar una migracion».
- `src/pages/ConductoresPage.tsx` — 116, 327, 425, 437-439, 528, 590.
- `src/pages/GruposPage.tsx` — 314, 341, 426-427, 440, 464, 518, 608.
- `src/pages/SalidasPage.tsx` — 445 («Proxima», ojo: también es clave
  lógica), 1452, 1765, 1774, 2400, 2453, 3044, 3392-3395, 3536-3545 («Tilda»,
  «Completa», «Descarga»), 1230 y 3031 («Slot elegido»).
- `src/pages/LoginPage.tsx:183, 205, 242`; `src/App.tsx:53`;
  `vite.config.ts:113, 119`.
- `src/pages/DashboardPage.tsx:552` — «¿Dás de baja…» lleva tilde de más.
- `src/context/AuthContext.tsx:572, 591` — «No tiene permisos de admin».
- `src/pages/PredicacionPage.tsx:1263` — «dejarás de poder marcarlo».
- `src/lib/pendingBeforeLogout.ts:19` — «Tenés 1 marcas y 0 resultados».
- `src/pages/TerritorioPersonalPage.tsx:620, 1304` — «reserva legacy», «Actor:».
- `editor-manzanas.html:1625-1641` — «jardin», «vinedo», «terreno baldio».
- Tres nombres para lo mismo: «caras», «cuadras», «lados».
