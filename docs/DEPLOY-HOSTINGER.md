# Desarrollo en Hostinger

## Publicaciones del 27 de octubre de 2026 (e y f) — iconografía completa

**(e)** Tag `publicacion-2026-10-27e` (commit `c8e738d`).

- El set suma siete íconos: reintentar, telefono, agregar, subir, bajar,
  priorizar y tilde. Son 46 en total.
- "rehacer" deja de usarse para "volver a intentar".
- La vista del hermano y el programa dejan de usar ☎, ★, ×, ＋, ↑, ↓ y ✓
  de texto.

**(f)** Tag `publicacion-2026-10-27f` (commit `8b37018`). El sprite de íconos
se pide con `?v=` y un resumen de su contenido, en `Icono.tsx` y en el
editor. Sin eso, un navegador con el sprite viejo guardado, que dura 7 días,
dibujaba vacíos los íconos nuevos.

**Respaldos previos:** los dos están en `/home/u800479702/backups/`.

- `congregacion-dev-20261027-publicacion-2026-10-27e-pre`
- `congregacion-dev-20261027-publicacion-2026-10-27f-pre`

**Verificación:**

- 120 de 120 archivos coinciden en las dos publicaciones.
- El editor publicado no tiene ninguna referencia al sprite sin versión.
- El sprite versionado trae los 46 símbolos.

## Publicación del 27 de octubre de 2026 (d) — favicon e íconos con versión

Publicado el tag `publicacion-2026-10-27d` (commit `0c9d30e`). Respaldo
previo: `/home/u800479702/backups/congregacion-dev-20261027-publicacion-2026-10-27d-pre`.

**El problema.** Después de la publicación (c) se seguía viendo el favicon
viejo. Dos causas:

- `favicon.svg` y los PNG de la PWA salían con caché de 7 días.
- La CDN (`hcdn`) servía su copia del ícono viejo de 180 px.

**El arreglo.** Las direcciones de los íconos llevan `?v=` con un resumen de
su contenido, que calcula `vite.config.ts`. Además:

- Se suma `favicon.ico`, porque antes esa dirección devolvía la app en HTML.
- El favicon se revalida siempre (`no-cache`).

**Verificación:**

- 113 de 113 archivos coinciden.
- La CDN entrega el ícono nuevo (`MISS`, 1.960 bytes).
- `/favicon.ico` sale como `image/x-icon`.

## Publicación del 27 de octubre de 2026 (c) — ícono y logo nuevos

Publicado el tag `publicacion-2026-10-27c` (commit `5707640`) con
`scripts/publicar-hostinger.mjs --ejecutar --sin-podar`.

**Qué cambia:** la marca nueva. Son tres manzanas tinta sobre el lima de la
app y una casa en contorno: la que falta visitar. Aparece en:

- el favicon, que reemplaza al rayo de Vite;
- los íconos de la PWA, con uno maskable nuevo;
- el menú, el login y la vista del hermano.

Sin migraciones.

**Respaldo previo:**
`/home/u800479702/backups/congregacion-dev-20261027-publicacion-2026-10-27c-pre`.

**Verificación:**

- Es la primera publicación que termina sin aviso: 112 de 112 archivos
  coinciden. Las 4 imágenes se compararon por SSH en el disco del servidor.
- `/`, `/mapas` y `/login` responden 200.
- `version.json` trae el tag.
- El login publicado muestra la marca.

## Publicación del 27 de octubre de 2026 (b) — abrir un territorio desde el mapa

Publicado el tag `publicacion-2026-10-27b` (commit `9dbf669`) con
`scripts/publicar-hostinger.mjs --ejecutar --sin-podar`.

**Qué cambia:** en el editor, con todo deseleccionado y "Solo mirar", tocar
una manzana abre su territorio, igual que elegirlo en la lista. Sin
migraciones.

**Respaldo previo:**
`/home/u800479702/backups/congregacion-dev-20261027-publicacion-2026-10-27b-pre`.

**Verificación:**

- `version.json` trae el commit y el tag.
- `/`, `/mapas` y `/login` responden 200.
- El editor publicado (`assets/editor-nfycnJIl.js`) trae el cambio.
- El script volvió a frenar solo por los íconos PNG. La CDN los recomprime
  al servirlos; en el disco del servidor coinciden con el paquete.

## Publicación del 27 de octubre de 2026 — mapas, build de producción y PWA real

Publicado el tag `publicacion-2026-10-27` (commit `455be01`) con
`scripts/publicar-hostinger.mjs --ejecutar --sin-podar`. Es la primera vez que
se publica con el script y desde un tag. La base sigue siendo el clon DEV
`rkmioktcsgqqjshrlkmy`, y no se aplicó ninguna migración. Pendientes:
`20261027151000` y `20261027151500`; mientras falten, el reporte de errores
del cliente se apaga solo.

**Qué cambió para quien usa el sitio:**

- Sale con el React de producción. Antes salía con el de desarrollo.
- Por primera vez queda un service worker activo. Antes `import.meta.env.DEV`
  era verdadero y la app lo borraba en cada carga.
- Las versiones nuevas se avisan con "Hay una versión nueva", en vez de
  recargar sola.
- El `.htaccess` sirve los assets con un año e `immutable`, y la CSP va en
  `Report-Only`.

**Qué se respaldó y verificó:**

- Respaldo previo:
  `/home/u800479702/backups/congregacion-dev-20261027-publicacion-2026-10-27-pre`.
- Rutas y archivos:
  - `/`, `/mapas`, `/login`, `/version.json` y `/sw.js` responden 200.
  - `version.json` trae el commit y el tag.
  - En el navegador: sin `jsxDEV`, service worker `activated` y sin errores
    en consola.
- SHA-256: la verificación del script marcó solo `pwa/icon-180|192|512.png`.
  En el disco del servidor coinciden con el paquete; la CDN de Hostinger
  (`hcdn`) recomprime los PNG al servirlos (512 px: 74.763 → 51.113 bytes). Por
  eso el script frenó antes de podar, aunque con `--sin-podar` no había nada
  que podar.

**Antes de la próxima publicación:**

- Que el script compare las imágenes por SSH y no por HTTPS.
- No se podaron assets ni respaldos viejos.

**Ojo con el editor:** ya corta las caras con la diferencia de ángulos
corregida. Republicar alguno de los 34 territorios de
`output/informe-caras-afectadas.json` retira las caras viejas de esas manzanas
y su cobertura. Decidir antes de publicarlos.

## Publicación del 1 de octubre de 2026 — renumeración y colores del mapa

Publicada la versión de trabajo local contra el clon DEV `rkmioktcsgqqjshrlkmy` en `congregacion.estracom.com.ar`. El editor permite intercambiar los números de dos territorios sin desplazar el resto y elegir el color con una paleta o selector personalizado. Los cambios quedan en el borrador hasta guardar el lote completo.

Aplicada `20261001010000_renumeracion_editor_atomica.sql` mediante el editor SQL de Supabase, después de un ensayo con rollback. La definición instalada coincide con la fuente local: MD5 del cuerpo sin comentarios ni espacios `f9b0e69d91a657756e80e4bf76679a71`. Ejecución habilitada para authenticated, revocada para anon; la RPC exige administrador vigente. Si el dibujo no cambió, conserva los IDs de manzanas/lados y la cobertura vigente. Una prueba real en DEV intercambió 5 y 12, cambió colores y rechazó una versión vieja; terminó en rollback, sin persistir cambios de prueba. El primer intento usó el rol histórico; se repitió correctamente seleccionando el administrador con `public.is_admin(id)` del modelo vigente.

Pasaron 386 pruebas JavaScript, el conjunto SQL local (incluida aplicación doble), TypeScript/Vite y `build:dev:seguro`. Se publicó el paquete `territorios-build-dev-yJCObw`. Respaldo remoto previo completo (30 MB): `/home/u800479702/backups/congregacion-dev-20261001-numeros-colores-pre`. Se subieron primero assets, luego ambos editores, index y finalmente service worker; se conservaron assets anteriores.

Los SHA-256 de `index.html`, `sw.js` y ambos HTML del editor coinciden entre paquete local, servidor SSH y HTTPS. `/`, `/mapas` y `/login` respondieron 200. La sesión del usuario en Chrome se recargó después de verificar el borrador guardado y muestra la paleta en la ficha del territorio 38. No se guardaron cambios de color o número del usuario. Evidencia local: `output/renumeracion-territorios/verificacion-publicacion.json`.

## Publicación del 25 de septiembre de 2026 — resultado de la salida y agenda compacta

Se publicó desde `dev` el commit `4838983` contra Supabase DEV
`rkmioktcsgqqjshrlkmy`, la misma configuración que ya tenía el sitio, sin
migraciones nuevas ni cambios en bases.

La agenda guardada quedó con filas compactas y horas en formato de 24 horas, y
el formulario de resultado pasó a tener control segmentado de estado, tarjeta
del resultado actual con su barra de color y acciones pegadas abajo en el
teléfono. Con esto salió también la entrada del 23 de septiembre, que había
quedado sin publicar por la cuota del servidor.

Pasaron 376 pruebas y `build:dev:seguro`. Respaldo remoto previo:
`/home/u800479702/backups/congregacion-dev-20260925-resultado-estado-pre`
(30 MB, 350 archivos). Se subieron primero los assets y después `index.html` y
`sw.js`, sin borrar assets anteriores; los SHA-256 remotos de ambos coinciden
con el paquete y la carpeta conservó el permiso 755. HTTPS respondió 200 en
`/`, `/index.html`, `/salidas` y `/sw.js`, y el chunk
`SalidaResultadoForm-BXkB1q-z.css` sirve las reglas nuevas del resultado.

## 23 de septiembre de 2026 — agenda compacta y horarios de 24 horas

La agenda guardada local muestra filas compactas, distingue territorio, punto y
conductor, y presenta la hora en formato de 24 horas en la lista, la ficha y
el PDF. Pasaron 376 pruebas y `build:dev:seguro`.

El despliegue a `congregacion.estracom.com.ar` quedó pendiente porque la
cuenta SSH respondió `Disk quota exceeded` al intentar crear el respaldo y
al transferir los assets. Se guardó un respaldo completo y verificado en
`/tmp/congregacion-dev-20260923-agenda-24h-pre.tar.gz` (equipo local). No se
subieron `index.html` ni `sw.js`: sus SHA-256 coinciden con el respaldo y el
sitio sigue respondiendo HTTP 200. Hay que liberar cuota de forma controlada
antes de repetir la publicación.

## Publicación del 23 de septiembre de 2026 — orden del programa en la agenda

Se publicó en DEV el orden manual también para las salidas ya guardadas: la
agenda y el PDF respetan la posición del programa dentro de cada día. Las
salidas históricas sin posición conservan el orden por horario y ocupan los
huecos anteriores a una fila agregada después. Se aplicó en
Supabase DEV `rkmioktcsgqqjshrlkmy` la migración
`20260923030000_orden_programa_en_agenda.sql`. La prueba real guardó una
salida telefónica de las 19:30 antes de una territorial de las 17:00; la base
guardó posiciones 2 y 3, y la agenda mantuvo ese orden tras recargar. Se
eliminaron exactamente esas dos salidas de prueba y se restauró el período del
borrador compartido, conservando sus filas originales.
Un PDF de prueba confirmó que una salida anterior de las 09:30 queda primera,
la telefónica de las 19:30 segunda y la territorial de las 17:00 tercera
cuando esas son las posiciones elegidas.

La prueba destapó que DEV no tenía `salidas_rpc_validar_payload` ni las dos
funciones de bloqueo requeridas por `crear_salidas_lote`. Se aplicó también
`20260921020000_lugar_sin_gps_obligatorio.sql` en DEV; el guardado del lote
volvió a funcionar. Antes de migrar otra base hay que comprobar las funciones
presentes y ejecutar las migraciones pendientes en orden. Pasaron 376 tests y
`build:dev:seguro`. Respaldo remoto previo:
`/home/u800479702/backups/congregacion-dev-20260923-orden-programa-pre`.
Se subieron primero los assets y luego `index.html` y `sw.js`, sin borrar
assets anteriores; ambos SHA-256 coinciden con el paquete y HTTPS respondió 200.

Pendiente antes de publicar contra la base de producción: comparar esquema y
datos con DEV, ensayar migraciones en una copia, validar con dos cuentas admin
distintas y probar la PWA instalada en un dispositivo real. La publicación de
esta entrada usa exclusivamente la base DEV.

## Publicación del 23 de septiembre de 2026 — borrador compartido

Se publicó en DEV el borrador del programa compartido por la congregación.
La migración `20260923020000_borrador_programa_compartido.sql` quedó aplicada
en `rkmioktcsgqqjshrlkmy`. El guardado usa una versión para detectar cambios
hechos desde otra sesión; la interfaz avisa del conflicto y ofrece recargar.
Las filas extras tienen identificadores distintos, incluso si son del mismo
día y turno. Se conservan también su orden y sus datos en el borrador.

Se verificó entre la app local y Chrome en el sitio DEV que una fila añadida
aparece en la otra sesión y que desaparece de ambas al quitarla. También se
guardaron una salida telefónica y un día de asamblea en DEV, se recargó la
página para comprobar su persistencia y se retiraron ambos datos de prueba.
El borrador previo de la semana en curso quedó intacto. Pasaron 375 pruebas y
`build:dev:seguro`. Respaldo remoto previo:
`/home/u800479702/backups/congregacion-dev-20260923-borrador-compartido-pre`.

## Ajuste del 23 de septiembre de 2026 — Nueva salida

Se habilitó la elección manual de día y horario en `Nueva salida`, sin depender
de un horario de la grilla. Al editar una salida existente, el horario se muestra
en hora local; las históricas conservan su fecha inmutable. Pasaron la build DEV
segura y 374 pruebas. Se verificó en navegador local y en el sitio DEV que el
campo acepta una fecha y hora, y que el formulario publicado ya lo muestra
habilitado. Respaldo remoto previo:
`/home/u800479702/backups/congregacion-dev-20260923-nueva-salida-pre`.
El sitio respondió HTTPS 200 y los SHA-256 de `index.html` y `sw.js`
coincidieron con el paquete publicado.

## Publicación del 23 de septiembre de 2026 — paridad funcional del programa

Se publicó desde `dev` la versión integrada de `/salidas` contra Supabase DEV
`rkmioktcsgqqjshrlkmy`. La migración
`20260923010000_programa_excepciones_y_guardado.sql` quedó aplicada y se
comprobó la existencia de sus dos tablas y su función RPC. Permite guardar
en una misma transacción las salidas comunes, las telefónicas y las excepciones
de día o turno. En la interfaz se verificaron los titulares y horarios fijos,
la configuración de teléfono y el diseño de escritorio, móvil y tablet.

La compilación `build:dev:seguro` y 374 pruebas pasaron. El sitio público
respondió HTTPS 200 en `/index.html` y `/salidas` después de subir los assets,
el HTML y el service worker. Se compararon por SHA-256 el `index.html` y el
`sw.js` locales y remotos. Respaldo remoto previo:
`/home/u800479702/backups/congregacion-dev-20260923-programa-paridad-pre`.

Al publicar desde un paquete temporal, usar `rsync --no-perms` o restablecer
el permiso 755 de la carpeta `congregacion`: el paquete temporal puede tener
permiso 700 y dejar el sitio inaccesible si rsync copia ese permiso al destino.

## Publicación del 22 de septiembre de 2026 — programa v2

Se publicó el programa v2 con `build:dev:seguro`, exclusivamente contra DEV
`rkmioktcsgqqjshrlkmy`. Antes de subir se aplicó y verificó en DEV la migración
`20260922000000_programa_semanal.sql`: 9 horarios, 2 días de teléfono, 1 salida
de grupos y 15 titulares. El guardado de la semana se probó desde la interfaz
autenticada y respondió correctamente.

La v2 quedó como pantalla predeterminada de `/salidas`. La grilla anterior se
conserva temporalmente en `/salidas?programa=anterior`. Respaldo inmediatamente
anterior a ese cambio:
`/home/u800479702/backups/congregacion-dev-20260922-v2-default-pre`.

Respaldo remoto previo:
`/home/u800479702/backups/congregacion-dev-20260922-programa-v2-pre`.
Los assets se subieron antes que `index.html` y `sw.js`; los SHA-256 remotos de
ambos archivos coinciden con el paquete local publicado.

La URL pública no pudo verificarse desde Internet porque `estracom.com.ar`
figura vencido en NIC Argentina desde el 21 de agosto de 2026 y ya no tiene
delegación en la zona `com.ar`. Hostinger conserva el subdominio y los archivos,
pero el navegador devuelve `ERR_NAME_NOT_RESOLVED` hasta renovar el dominio y
restablecer su delegación DNS.

## Estado vigente — 6 de septiembre de 2026

Publicado snapshot local `k8evXS` mediante `build:dev:seguro`, exclusivamente
contra DEV `rkmioktcsgqqjshrlkmy` (anon). Las referencias a producción de las
publicaciones anteriores más abajo son históricas, no la configuración vigente.
Sin migraciones ni cambios en bases. Respaldo previo remoto:
`/home/u800479702/backups/congregacion-dev-20260906-k8evXS`.
Se conservaron assets anteriores; se subieron assets antes del HTML/service worker.
El paquete excluyó datos y recursos de prototipos no referenciados.
Snapshot anterior a la implementación pendiente de salidas por RPC.

Destino: https://congregacion.estracom.com.ar

- Cuenta SSH: `u800479702`, servidor `77.37.127.252`, puerto `65002`.
- Alias SSH local existente: `entrenadora`.
- Directorio: `/home/u800479702/domains/estracom.com.ar/public_html/congregacion`.
- Subdominio creado en hPanel sobre `estracom.com.ar`, con carpeta personalizada `congregacion`.
- Certificado: Lifetime SSL de Hostinger.

Estado verificado: subdominio creado, SSL activo y pantalla de login visible
en el navegador sin errores de consola. `/`, `/login`, `/mapas`, el manifest,
el service worker y los assets iniciales coinciden por SHA-256 con la build
subida. Se verificó también respuesta HTTPS 200 desde el CDN de Hostinger.
Los DNS públicos de Cloudflare y Google ya resolvían el subdominio al terminar;
algunos resolutores locales aún podían conservar una respuesta negativa anterior.

## Publicación del 1 de septiembre de 2026

Se compiló una copia del estado local de `desarrollo`, incluyendo los cambios
sin commit presentes en `src` e `index.html`. TypeScript y Vite compilaron
correctamente. Se subió únicamente el contenido de `dist` mediante SSH/rsync.

La copia usada para compilar está en `/tmp/territorios-hostinger.2wTrya`.
Este directorio es temporal y no debe considerarse un respaldo permanente.

Se excluyó `public/datos` de esa copia: contiene respaldos y archivos de
experimentos que no están referenciados por la app. No se publicaron `.env`,
fuentes, documentos internos, prototipos ni archivos SQL.

`public/.htaccess` configura el fallback de React Router a `index.html` y evita
cachear indefinidamente el HTML y el registro del service worker.

## Publicación del 4 de septiembre de 2026

Se compiló el estado local (incluye cambios sin commit: vista del hermano,
MapTiler, cómo llegar en auto/colectivo, editor con mudanza de manzanas).
TypeScript y Vite compilaron. Se subió `dist` por SSH/rsync al alias
`entrenadora`, **sin** `public/datos`, **sin** `banco-ato.html` y **sin** la
carpeta `ato/` (se coló en el primer rsync y se borró del remoto).

Respaldo de lo que había: `/home/u800479702/backups/congregacion-20260904-1515`.

La build apunta a producción `dwgvzcnarrjgqjotocdw`. **No se aplicaron
migraciones en Supabase.** La migración del programa visible para el
publicador sigue solo en el clon DEV: en congregación, un hermano sin
módulos de admin va a ver la pantalla nueva pero vacía hasta que esa SQL
se aplique en producción.

El service worker ignora `datos/**` y `banco-ato.html` (`globIgnores` en
`vite.config.ts`) para que la PWA instale aunque esos archivos no se suban.

---

La app conserva el proyecto Supabase configurado localmente:
`dwgvzcnarrjgqjotocdw`. Este despliegue no crea una base de pruebas ni copia datos.
No se ejecutaron migraciones en Supabase.

Antes de actualizar, compilar una nueva copia excluyendo los archivos locales
de datos; verificar que el service worker tampoco los incluya. Respaldar la
carpeta remota actual fuera de `public_html`. Subir primero los assets y después
el HTML y service worker; conservar los assets anteriores mientras puedan
existir sesiones abiertas que los necesiten.

Comprobar HTTPS, la carga directa de `/login` y `/mapas`, los assets y el
service worker. No ejecutar rsync contra el `public_html` del dominio principal.
