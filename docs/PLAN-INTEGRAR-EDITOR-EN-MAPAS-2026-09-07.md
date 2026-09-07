# Plan para integrar el Editor de manzanas en Mapas y territorios

Fecha: 7 de septiembre de 2026. Rama: `dev`. Destino de pruebas: Supabase
DEV `rkmioktcsgqqjshrlkmy`. Producción no se toca.

## 1. Resultado buscado

`/mapas`, pestaña **Territorios**, pasa a ser el único taller territorial:

- mapa grande al entrar;
- buscador y selección de territorio;
- ficha del territorio;
- edición explícita del contorno territorial;
- administración completa de manzanas, letras y caras;
- publicación atómica con control de versión;
- exportaciones y cobertura en la misma sección;
- una sola sesión, un solo lenguaje visual y una sola fuente de estado.

El enlace independiente **Editor de manzanas** desaparece del menú cuando la
integración alcance paridad y quede verificada. `editor-manzanas.html` se
conserva temporalmente como rollback, no como segunda herramienta activa.

## 2. Estado actual comprobado

| Tema | `/mapas` / `SanJuanMap` | `editor-manzanas.html` |
|---|---|---|
| Tecnología | React + TypeScript + Leaflet Draw | HTML, CSS y unas 2.900 líneas de JavaScript inline |
| Sesión | `AuthContext` y cliente Supabase | lee manualmente el JWT de `localStorage` |
| Territorios | listado, búsqueda, contorno, ficha, retiro y exportaciones | crea, renumera, divide, deriva y redibuja |
| Manzanas | alta por punto y retiro individual | geometría completa, asignación, mover, dividir, fusionar, borrar, depurar y reletrar |
| Caras/lados | visualización limitada | cálculo y corrección manual completa |
| Historial local | estado React | deshacer/rehacer y copia local |
| Borrador remoto | no | `editor_estado`, guardado agrupado y conflicto optimista |
| Publicación | RPC puntuales | revisión y publicación atómica por lote |
| Responsive | integrado al panel actual | diseño independiente y hoja propia |
| Dependencias | paquetes instalados y versionados | Leaflet y Turf parcialmente desde CDN |

No se debe reemplazar uno por el otro. Cada implementación tiene capacidades
que la otra no posee y hay lógica duplicada con modelos distintos.

### Hallazgo de despliegue

El editor separado arranca desde cuatro archivos bajo `/datos`, entre ellos
`manzanas-congregacion.geojson`. El build seguro los excluye deliberadamente;
en Estracom siguen respondiendo sólo porque publicaciones anteriores dejaron
copias remotas y el despliegue conserva assets viejos. No es reproducible ni
seguro depender de esos restos. La integración debe eliminar esa dependencia.

## 3. Decisiones de producto

1. **Modo consulta por defecto.** Abrir Mapas nunca modifica geometrías.
2. **Edición deliberada.** Sólo un botón claro, `Editar mapa`, entra al taller.
3. **Sólo administradores.** `admin_territorios` y `superadmin` editan; los
   demás perfiles consultan sus vistas permitidas en `/predicacion`.
4. **Conductor no es editor.** Informar lados recorridos no habilita a cambiar
   manzanas, territorios ni caras.
5. **Un territorio activo por vez.** Las operaciones que muevan manzanas a
   otro territorio incluyen ambos territorios en la publicación atómica.
6. **UUID, no nombre, como identidad.** El número puede cambiar; las RPC nuevas
   deben recibir `territory_id`.
7. **Nada de iframe.** Tampoco se copia el JavaScript inline dentro de un
   `useEffect`. Se extrae y prueba como dominio TypeScript.
8. **Mobile consulta, no cirugía geométrica.** En 320/390 px se puede buscar,
   seleccionar, ver ficha, cobertura y manzanas. Dibujar vértices, dividir o
   fusionar requiere al menos tablet horizontal; se explica sin dejar botones
   rotos o acciones a medias.
9. **Sin publicación automática.** El borrador se guarda solo, pero publicar
   geometrías siempre requiere revisión y confirmación explícita.

## 4. Modelo de interacción

Estados principales:

```text
consulta general
  └─ seleccionar territorio → consulta del territorio
       ├─ abrir ficha → ficha / historial / exportar
       └─ Editar mapa → taller del territorio
            ├─ editar contorno
            ├─ administrar manzanas
            │    ├─ asignar / mover
            │    ├─ dividir / fusionar / vértices
            │    ├─ letras
            │    └─ caras
            ├─ deshacer / rehacer
            └─ revisar cambios → publicar lote atómico
```

Salir del taller con cambios sin guardar abre una decisión concreta:
`Seguir editando`, `Guardar borrador y salir` o `Descartar cambios locales`.
Descartar nunca toca lo publicado.

## 5. Composición visual

### Escritorio, desde 1280 px

```text
┌ Mapas y territorios             [Territorios | Cobertura] ┐
├───────────────┬─────────────────────────────────────────────┤
│ 70  [Buscar]  │ [Solo mirar]  Territorio 57     [Editar] ⋯ │
│               │                                             │
│ ● 1      0%   │                  MAPA                       │
│ ● 2     34%   │                                             │
│ ● 57    38%   │                                herramientas │
│ ...           │                                             │
├───────────────┴─────────────────────────────────────────────┤
│ estado del borrador · cambios · deshacer/rehacer · publicar │
└─────────────────────────────────────────────────────────────┘
```

- La lista conserva 280–320 px y scroll propio.
- El mapa ocupa todo el alto útil restante.
- La ficha y las herramientas son un drawer contextual, no una tercera
  columna permanente.
- La barra inferior aparece únicamente durante edición.

### Tablet y notebook angosta

- mapa completo;
- listado en panel deslizable;
- herramientas en rail horizontal o drawer derecho;
- ficha como modal amplio;
- edición habilitada únicamente si hay espacio y puntero adecuados.

### Teléfono, 320/390 px

- mapa primero;
- barra superior compacta con `Buscar territorio` y estado;
- ficha y listado como bottom sheet;
- objetivos táctiles mínimos de 56 px y texto mínimo de 16 px;
- sin tooltips que dependan de hover;
- si se intenta abrir una edición geométrica: “Para ajustar el dibujo usá una
  tablet horizontal o una computadora”.

## 6. Funciones que deben conservarse

### Territorios

- buscar, filtrar, seleccionar y enfocar;
- crear, renumerar, dividir, derivar y retirar;
- editar contorno y color;
- mostrar vecinos y todos;
- detectar solapamientos antes de guardar;
- ficha, fechas, cantidad de manzanas y cobertura;
- GeoJSON, CSV y PDF.

### Manzanas

- ver candidatas libres y asignadas;
- asignar una o varias al territorio activo;
- mover entre territorios sin duplicarlas;
- dibujar, redibujar, editar vértices, dividir, fusionar y retirar;
- diagnóstico de geometría importada;
- marcar revisadas y volver a mostrarlas;
- ordenar y reletrar por marcado, proximidad o manualmente;
- importar/exportar una copia JSON sólo como recuperación deliberada.

### Caras y lados

- mantener un único algoritmo compartido para cálculo de caras;
- mostrar cantidad y anomalías antes de publicar;
- unir, partir y volver a cálculo automático;
- conservar la versión geométrica que usan los eventos de cobertura;
- advertir cuando una publicación retire lados que ya tienen cobertura.

### Seguridad y durabilidad

- AuthContext como única fuente de sesión;
- `AdminGuard` más autorización SQL real;
- borrador remoto con sello de versión;
- copia local de contingencia aislada por proyecto y usuario;
- deshacer/rehacer por comandos;
- bloqueo de doble clic y doble publicación;
- snapshot inmutable antes de confirmar;
- error de respuesta desconocida sin reintento automático;
- historial con actor, fecha, territorio y versión.

## 7. Arquitectura propuesta

```text
MapasPage
├─ MapasTabs
├─ TerritoryDirectory
├─ TerritoryMapWorkspace
│  ├─ TerritoryLayers
│  ├─ BlockCandidateLayers
│  ├─ GeometryHandles
│  └─ MapToolRail
├─ TerritoryInspector
├─ BlockInspector
├─ EditorStatusBar
└─ PublishChangeSetDialog

features/map-editor/
├─ model/          tipos, reducer, comandos, invariantes
├─ geometry/       snap, dividir, fusionar, caras y etiquetas
├─ data/           carga paginada, borrador, publicación y exportación
├─ hooks/          sesión del taller, teclado, viewport y conflictos
└─ components/     paneles contextuales
```

Reglas técnicas:

- funciones geométricas puras fuera de React;
- `useReducer` para el documento editable y comandos reversibles;
- Leaflet como adaptador visual, nunca como fuente canónica del estado;
- imports de Turf/Leaflet desde `package.json`, sin CDN;
- consultas con paginación y cancelación; una respuesta vieja no pisa una
  selección nueva;
- la geometría de un territorio se carga al elegirlo, no toda al entrar;
- el heatmap sigue siendo una vista aparte y de sólo lectura.

## 8. Cambios de datos y RPC

### Fuente de manzanas candidatas

Crear una fuente autenticada, versionada y paginable, por ejemplo
`manzana_candidatas`, con:

- `source_key` estable;
- geometría GeoJSON;
- bbox/centro para consulta por viewport;
- versión del dataset y estado activo;
- metadatos mínimos de diagnóstico, sin respaldos de congregación completos.

Sólo administradores pueden leerla. El build deja de depender de `/datos` y
los cuatro archivos residuales pueden retirarse de Estracom después del corte.

### Borrador

Conservar conceptualmente `editor_estado`, pero encapsular el compare-and-swap
en RPC:

- `leer_borrador_editor()`;
- `guardar_borrador_editor(p_revision, p_estado)`;
- `descartar_borrador_editor(p_revision)`.

La revisión debe ser monotónica; el cliente no actualiza directamente la tabla.
El estado registra autor y fecha en servidor. Un conflicto nunca se resuelve
con “último guardado gana”.

### Publicación

Agregar versiones v2 basadas en UUID:

- `revisar_publicacion_editor_v2(p_territory_ids uuid[])`;
- `publicar_territorios_atomico_v2(p_cambios jsonb)`.

La RPC debe:

1. validar admin activo;
2. validar esquema, tamaños, UUID y geometrías;
3. bloquear territorios en orden estable;
4. comprobar todas las revisiones antes de escribir;
5. publicar todos los territorios afectados o ninguno;
6. retirar versiones anteriores sin borrarlas;
7. guardar actor y resumen del cambio;
8. devolver revisiones y conteos confirmados.

Las RPC actuales se mantienen hasta finalizar el corte.

## 9. Estados de interfaz obligatorios

- carga inicial y carga del territorio;
- sin territorios;
- territorio sin manzanas;
- candidato base no disponible;
- offline con copia local segura;
- sesión vencida o rol revocado;
- guardando, guardado y cambios pendientes;
- conflicto de borrador;
- conflicto de revisión al publicar;
- geometría inválida o solapada;
- respuesta de publicación desconocida;
- publicación confirmada con versión y conteos.

Los errores no deben vaciar el mapa ni presentar una lista parcial como válida.

## 10. Fases y commits

### Fase 0 — Respaldo y contrato

- rama y backup del árbol;
- dump de tablas del editor en DEV;
- congelar este plan y fixtures;
- cero cambios en producción.

### Fase 1 — Extraer el dominio sin cambiar la UI

- convertir geometría, letras, caras, selección y comandos a TypeScript puro;
- pruebas de equivalencia contra casos reales;
- mantener funcionando el editor HTML.

### Fase 2 — Fuente reproducible y RPC v2

- cargar candidatas saneadas en DEV;
- borrador por RPC y revisión monotónica;
- publicación UUID con auditoría;
- pruebas SQL reales, concurrencia e idempotencia.

### Fase 3 — Taller integrado en modo consulta

- montar capas del editor dentro de `SanJuanMap`/workspace nuevo;
- unificar buscador, selección, ficha y cámara;
- no habilitar escritura todavía.

### Fase 4 — Edición de manzanas

- herramientas, teclado, snap, selección múltiple, mover, dividir, fusionar,
  vértices, letras y caras;
- deshacer/rehacer y salida segura.

### Fase 5 — Borrador y publicación

- estados de guardado visibles;
- comparación con publicado;
- revisión del lote, advertencias y publicación atómica;
- recuperación de error desconocido sin duplicar.

### Fase 6 — CSS y responsive

- adaptar al lenguaje visual actual;
- 1366×768 y 1440: mapa visible completo;
- 1024/768: drawers sin aplastar el mapa;
- 390/320: consulta usable y edición geométrica bloqueada con explicación;
- teclado, foco, lector y `prefers-reduced-motion`.

### Fase 7 — Paridad, corte y limpieza

- ejecutar checklist comparativo;
- quitar el enlace Editor de manzanas del menú;
- conservar la URL antigua como redirección temporal a `/mapas?modo=editar`;
- sacar el segundo entrypoint de Vite y del service worker;
- retirar `/datos` remoto sólo después de verificar la fuente nueva;
- build y publicación exclusivamente DEV.

## 11. Pruebas mínimas

### Unidad

- snap a vértice/lado;
- cerrar, dividir y fusionar polígonos;
- mover una manzana toca origen y destino;
- letras por los tres modos;
- caras automáticas y manuales;
- undo/redo no comparte referencias mutables;
- geometrías inválidas y solapamientos.

### SQL/integración

- miembro/conductor/responsable no publica;
- admin sí publica;
- dos borradores con la misma revisión: uno confirma y otro entra en conflicto;
- dos publicaciones simultáneas: una confirma;
- mover entre territorios es atómico;
- un fallo intermedio deja cero cambios;
- historia y cobertura anterior permanecen consultables;
- actor y revisión quedan auditados.

### Navegador

- buscar, seleccionar y mantener ficha/geometría;
- editar y cancelar sin cambios;
- recargar y recuperar borrador;
- sesión vencida y rol revocado;
- offline/online;
- 320, 390, 768, 1024, 1366 y 1440 px;
- teclado completo y foco visible;
- PWA actualiza sin mezclar bundles viejos.

## 12. Aceptación final

- [ ] `/mapas` abre mostrando el mapa, no una pantalla de formularios.
- [ ] Consulta y edición son modos inequívocos.
- [ ] Todo lo que hoy hace el editor separado tiene destino probado.
- [ ] No quedan dos motores ni dos estados de mapa.
- [ ] No se lee el JWT manualmente desde `localStorage`.
- [ ] No se cargan dependencias de CDN para editar.
- [ ] El build es autosuficiente y no depende de `/datos` residual.
- [ ] Publicar usa UUID, revisión, locks y lote atómico.
- [ ] Ningún usuario no administrativo puede modificar geometría.
- [ ] Cambios de manzana entre territorios nunca generan duplicados.
- [ ] Se conserva historia y autoría.
- [ ] Mobile no desborda ni ofrece gestos geométricos inviables.
- [ ] `tsc`, lint, suite completa, SQL y navegador quedan verdes.
- [ ] Producción no se toca.

## 13. Rollback

Mientras no termine Fase 7, el editor HTML sigue disponible por URL directa.
Cada migración es aditiva y la UI integrada se activa sólo en DEV. Si una fase
falla, se desactiva el taller React y se vuelve al entrypoint anterior sin
revertir datos publicados. La eliminación del editor viejo y de `/datos` es el
último paso, después de backup y aceptación explícita.

## 14. Fuera de alcance

- rotación y propuesta automática de programa;
- permisos para conductores sobre geometría;
- cambios en producción;
- reemplazar Leaflet por otra biblioteca;
- edición geométrica compleja en teléfono;
- borrar historia para “simplificar” el modelo.
