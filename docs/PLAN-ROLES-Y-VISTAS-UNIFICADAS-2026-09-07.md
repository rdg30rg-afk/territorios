# Plan de roles, permisos y vistas unificadas

Fecha: 7 de septiembre de 2026. Destino de implementación: Supabase DEV
`rkmioktcsgqqjshrlkmy`. Producción `dwgvzcnarrjgqjotocdw` no se toca.

Este documento continúa el plan de roles y grupos del 7/9. Conserva lo ya
implementado (membresías, códigos, punto de grupo, `mi_contexto` y Vista del
hermano) y reemplaza la decisión anterior que permitía abrir el panel
administrativo a responsables de grupo.

## 1. Decisiones aprobadas

- El panel administrativo es exclusivo de administradores de Territorios y
  superadmins.
- Publicadores, conductores y responsables de grupo trabajan desde
  `/predicacion`, con funciones progresivas según su contexto.
- Ser conductor es una capacidad; no reemplaza el cargo dentro del grupo.
- Los cargos del grupo son: publicador, auxiliar, siervo y superintendente.
- Auxiliar, siervo y superintendente administran únicamente su grupo.
- Cualquier conductor vinculado o responsable confirmado puede informar una
  salida que realmente condujo, aunque no fuera el asignado original.
- El conductor asignado, el conductor real, quien guardó el resultado y quien
  marcó cada lado deben quedar diferenciados.
- Un publicador sólo marca cobertura de su territorio personal activo.
- El Editor de manzanas es exclusivo de administradores y superadmins.
- Los invitados quedan fuera de la primera implementación: se comparte PDF o
  enlace de sólo lectura. No habrá contraseña común.
- Sólo un administrador puede corregir un resultado o una marca ya registrados.
- Administradores y superadmins pueden pertenecer a un grupo; la pertenencia no
  aumenta ni reduce su nivel administrativo.

## 2. Tres dimensiones, no una jerarquía rígida

### 2.0 Hallazgo de DEV: grupo lógico y responsable están mezclados

La inspección de DEV del 7/9 encontró 11 filas en `grupos_servicio`, pero sólo
5 números de grupo. Cada responsable importado creó otra fila con el mismo
`group_number` y `group_name`: grupos 1 a 4 tienen dos filas y grupo 5 tiene
tres. No hay todavía salidas, puntos, membresías ni territorios que referencien
esas filas; sí existe una invitación diferente para cada una.

Antes de habilitar membresías reales se debe normalizar esta procedencia:

- conservar una fila canónica de `grupos_servicio` por número de grupo;
- preservar los 11 responsables importados en una relación separada, con
  nombre, cargo y vínculo de catálogo, sin convertirlos automáticamente en
  conductores de la aplicación;
- conservar un solo código de invitación por grupo lógico;
- sembrar `grupo_miembros` sólo cuando haya una coincidencia inequívoca con un
  perfil existente;
- agregar unicidad de `group_number` para impedir que el problema reaparezca;
- abortar la normalización si una fila duplicada adquiere referencias nuevas
  antes de aplicar la migración.

En el estado inspeccionado, el único perfil real que coincide inequívocamente
con un responsable importado es Mateo Luna, como superintendente del Grupo 1.
Su pertenencia al grupo no debe otorgarle capacidad de conductor: esa capacidad
sigue dependiendo exclusivamente de `profiles.driver_id`.

### 2.1 Nivel del sistema

`profiles.system_role`:

- `miembro`: no entra al panel.
- `admin_territorios`: administra la operación completa.
- `superadmin`: además puede nombrar o quitar administradores.

`profiles.access_status` sigue siendo la barrera global:
`pending | active | inactive`.

La columna histórica `profiles.role` no se elimina en la primera migración. Se
mantiene durante la transición y deja de decidir permisos cuando frontend, RPC
y RLS ya usen `system_role`.

### 2.2 Cargo dentro del grupo

`grupo_miembros.rol_en_grupo`:

- `publicador`
- `auxiliar`
- `siervo`
- `superintendente`

Una persona tiene como máximo una membresía vigente. Un grupo puede tener varios
responsables. Los campos `driver_id`, `manager_name` y `manager_role` de
`grupos_servicio` quedan como procedencia/compatibilidad y dejan de autorizar.

### 2.3 Capacidad de conducir

La vinculación `profiles.driver_id -> conductores.id` identifica a un conductor
habilitado. Debe ser única entre perfiles activos. Un responsable confirmado
también puede informar salidas aunque no tenga `driver_id`, pero la interfaz le
pide confirmar que efectivamente condujo esa salida.

## 3. Contexto efectivo

`mi_contexto` debe devolver exactamente una fila por cuenta e incluir:

- identidad, `access_status`, `system_role` y rol histórico durante transición;
- `driver_id` y `es_conductor`;
- grupo vigente, cargo, estado de membresía y punto del grupo;
- `puede_administrar_grupo`;
- `puede_informar_salidas`;
- `puede_abrir_panel`;
- `puede_administrar_admins`.

Las capacidades se calculan en SQL y se reflejan en TypeScript. El frontend no
es una frontera de seguridad.

## 4. Relaciones y auditoría

### 4.1 Accesos

Agregar `acceso_movimientos`:

- perfil afectado;
- actor;
- estado anterior/nuevo;
- nivel anterior/nuevo;
- conductor anterior/nuevo;
- fecha y motivo opcional.

Sólo `superadmin` cambia `system_role` hacia o desde un nivel administrativo.
Un `admin_territorios` puede activar, desactivar y vincular conductores de
cuentas `miembro`.

### 4.2 Cargos de grupo

Agregar `grupo_miembro_movimientos` para confirmación, rechazo, cambio de cargo,
cambio de grupo y retiro. `confirmado_por` se conserva como resumen de la fila.

### 4.3 Salidas

`salidas.driver_id` conserva al conductor planificado.

Agregar a `salida_resultados`:

- `conducida_por_profile_id`: quién declara haber conducido;
- `informado_por`: ya existe; quién guardó el resultado;
- `informado_at`: ya existe.

`cobertura_eventos.informado_por` ya identifica quién marcó cada lado. Toda
marca originada en cierre de salida conserva `salida_id`, territorio, manzana,
lado y versión geométrica.

Reglas:

- sólo cuenta activa y con capacidad puede crear el primer resultado;
- si no era el conductor asignado, debe enviar confirmación explícita de
  reemplazo;
- el conductor real es la cuenta autenticada, nunca un nombre libre;
- una segunda versión es corrección y requiere administrador;
- eventos y resultados son inmutables; corregir agrega otra fila.

## 5. Autorización SQL

Helpers canónicos:

- `es_superadmin(p_profile_id)`
- `es_admin_territorios(p_profile_id)`; incluye superadmin
- `es_responsable_de_grupo(p_group_id, p_profile_id)`
- `puede_informar_salidas(p_profile_id)`
- `puede_abrir_panel(p_profile_id)`

Revisar todas las funciones `SECURITY DEFINER`: `search_path` fijo, permisos de
ejecución mínimos y pruebas de RLS recursiva. Los helpers que consultan tablas
con políticas que vuelven a invocar al helper deben ejecutarse con owner seguro
o reestructurarse para no depender de recursión accidental.

`user_module_access` se conserva durante la transición, pero deja de habilitar
el panel para miembros. Al estabilizar la migración se decide si se archiva o se
usa solamente para preferencias internas de administradores.

## 6. Vistas

### 6.1 Publicador

Navegación: `Hoy | Salidas | Territorio`.

- programa y salida de su grupo;
- lectura de territorios de su grupo;
- solicitud, devolución y cobertura de su territorio personal;
- sin acceso al panel ni al editor.

### 6.2 Conductor

La misma navegación. En Salidas se agrega `Para informar`:

- salidas asignadas a él;
- posibilidad de buscar otra salida y declarar reemplazo;
- resultado general y cobertura;
- historial visible, sin permiso de corregir.

### 6.3 Responsable de grupo

Navegación: `Hoy | Salidas | Mi grupo | Territorio`.

`Mi grupo` contiene:

- pendientes de confirmación;
- miembros y cargos;
- punto de encuentro y código;
- reservas y territorios del grupo;
- salidas del grupo.

No se muestra enlace al panel administrativo.

### 6.4 Administrador y superadmin

Usan el `AppShell` administrativo. Todos los módulos operativos son visibles.
El superadmin obtiene además la gestión de administradores. `Vista del hermano`
permanece como acceso de comprobación.

## 7. Rutas y guards

- `/predicacion`: toda cuenta admitida; contenido por contexto.
- rutas dentro de `AppShell`: sólo `admin_territorios | superadmin` activos.
- `/editor-manzanas.html`: validación propia más RPC/RLS administrativa.
- una URL administrativa guardada por un miembro redirige a `/predicacion`.
- revocar una cuenta o un rol invalida el acceso en la siguiente revalidación,
  sin depender de recargar manualmente.

## 8. Orden de implementación

### Fase 0 — Contrato y respaldo

- respaldo del árbol y rama;
- inventario de permisos actuales;
- este documento como contrato;
- cero cambios en Supabase.

### Fase 1 — Modelo aditivo

- normalizar los 11 registros de responsables en 5 grupos lógicos, con
  precondición que impida perder referencias y una tabla de procedencia;
- `system_role`, constraints e índices;
- cargo `siervo` en `grupo_miembros`;
- tablas de movimientos;
- columnas de conductor real;
- helpers y `mi_contexto`;
- migración idempotente y transaccional;
- pruebas SQL antes de aplicar en DEV.

### Fase 2 — Acceso y shell

- tipos de frontend;
- landing por nivel efectivo;
- `AdminGuard` alrededor del shell completo;
- panel y editor exclusivos de administradores;
- gestión de usuarios sin módulos para miembros.

### Fase 3 — Experiencia base del hermano

- navegación de tres vistas;
- estados sin grupo, pendiente, confirmado e inactivo;
- territorio personal separado de territorio consultado;
- lectura del grupo y estados offline/error/vacío.

### Fase 4 — Conductores y reemplazos

- selector de salida para informar;
- confirmación de reemplazo;
- resultado y cobertura con actor auditable;
- prevención de doble envío e idempotencia.

### Fase 5 — Mi grupo

- cuarta vista sólo para responsables;
- miembros, cargos, punto, invitación, reservas, territorios y salidas;
- ninguna dependencia del panel administrativo.

### Fase 6 — Administración

- administrar niveles y capacidades;
- sólo superadmin administra administradores;
- ficha de usuario con grupo, conductor e historial;
- editor y operaciones globales protegidos.

### Fase 7 — Invitados

- decidir PDF o enlace firmado temporal;
- alcance, expiración y revocación;
- sin cuenta compartida.

### Fase 8 — QA y publicación DEV

- pruebas unitarias y SQL;
- `tsc` y build seguro;
- usuarios de prueba por combinación;
- 320, 390, 768, 1366 y 1440 px;
- teclado, lector de pantalla, offline, carga, error y vacío;
- publicar sólo después de aprobación explícita.

## 9. Checklist de aceptación

- [ ] Un miembro nunca renderiza ni abre una ruta del panel.
- [ ] Un módulo histórico no concede acceso administrativo.
- [ ] Un admin territorial no puede crear ni quitar superadmins/admins.
- [ ] Nunca puede quedar el sistema sin al menos un superadmin activo.
- [ ] Un responsable sólo administra su grupo.
- [ ] Auxiliar, siervo y superintendente tienen la misma autoridad acordada.
- [ ] Ser responsable y ser conductor pueden coexistir.
- [ ] Un conductor puede informar un reemplazo y queda identificado.
- [ ] Se distinguen asignado, conductor real, autor del resultado y autores de lados.
- [ ] Un publicador no marca salidas ni territorios ajenos.
- [ ] Un publicador sólo marca su territorio personal activo.
- [ ] Una membresía pendiente no obtiene permisos de escritura.
- [ ] Corregir agrega historia y no reescribe hechos.
- [ ] El editor rechaza a miembros aunque conozcan la URL.
- [ ] `mi_contexto` devuelve una única fila en todas las combinaciones.
- [ ] Ninguna política RLS entra en recursión.
- [ ] Todos los controles móviles tienen texto legible y objetivo táctil adecuado.
- [ ] Build contiene únicamente el ref DEV.

## 10. Límites de esta iniciativa

- No incluye rotación ni propuesta automática del programa.
- No modifica producción.
- No incorpora autenticación por teléfono/SMS.
- No envía WhatsApp ni notificaciones automáticamente.
- No habilita varias membresías de grupo simultáneas.
- No se elimina estructura histórica hasta completar y verificar la transición.
