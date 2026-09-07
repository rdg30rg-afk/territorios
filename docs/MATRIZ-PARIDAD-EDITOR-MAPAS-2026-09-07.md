# Matriz de paridad entre el editor de manzanas y Mapas

Fecha: 2026-09-07

## Criterio

- **Existente:** conserva la función.
- **Parcial:** cubre sólo parte o actúa sobre otra entidad.
- **Falta:** no tiene equivalente localizado en `SanJuanMap.tsx`.

La diferencia central es que `editor-manzanas.html` opera polígonos completos de manzana, mientras `SanJuanMap.tsx` edita principalmente el polígono del territorio y registra muchas manzanas como puntos, aunque también las dibuja cuando ya existe `geometry_geojson`.

Referencias del modelo React: `src/components/SanJuanMap.tsx:1806` (carga de manzanas), `src/components/SanJuanMap.tsx:1997` (marcado por punto) y `src/components/SanJuanMap.tsx:1426` (geometrías no interactivas).

## Territorios y archivos

| Herramienta del HTML | Estado | Correspondencia encontrada |
|---|---|---|
| Crear y empezar a marcar (`editor-manzanas.html:259`, manejador en `editor-manzanas.html:1788`) | Parcial | React permite preparar, dibujar y guardar un territorio (`src/components/SanJuanMap.tsx:2240`, `src/components/SanJuanMap.tsx:2813`), pero no tiene sector y no crea el territorio vacío para asignarle polígonos de manzana. |
| Renumerar (`editor-manzanas.html:1972`) | Existente | “Editar datos” carga el nombre/número y `handleSaveTerritory` lo actualiza (`src/components/SanJuanMap.tsx:2357`, `src/components/SanJuanMap.tsx:2873`). |
| Dividir territorio (`editor-manzanas.html:1983`) | Falta | No hay operación que cree otro territorio repartiendo sus manzanas. |
| Borrar territorio (`editor-manzanas.html:1801`) | Parcial | Existe el control, pero el manejador sólo informa que el retiro no está habilitado (`src/components/SanJuanMap.tsx:2382`, `src/components/SanJuanMap.tsx:3256`). |
| Letras “como marco / proximidad / a mano” (`editor-manzanas.html:277`, manejadores en `editor-manzanas.html:1892`) | Falta | React únicamente calcula la próxima etiqueta libre (`src/components/SanJuanMap.tsx:258`). |
| Traer este territorio de la base (`editor-manzanas.html:3089`) | Parcial | React carga territorios y manzanas automáticamente (`src/components/SanJuanMap.tsx:1796`), pero no ofrece reemplazar explícitamente un borrador local de un territorio. |
| Ver y depurar manzanas (`editor-manzanas.html:284`, implementación en `editor-manzanas.html:1177`) | Parcial | Hay listado y retiro individual (`src/components/SanJuanMap.tsx:3266`); faltan diagnóstico geométrico, filtros y acciones colectivas. |
| Nuevo territorio después de este (`editor-manzanas.html:1850`) | Falta | “Nuevo” crea uno independiente; no inserta ni corre numeración (`src/components/SanJuanMap.tsx:2240`). |
| Redibujar desde cero (`editor-manzanas.html:1816`) | Parcial | React permite editar o eliminar el contorno editable (`src/components/SanJuanMap.tsx:1751`, `src/components/SanJuanMap.tsx:1769`), pero no suelta manzanas ni restaura sus geometrías originales. |
| Revisión, dar por buena y limpiar “sin viviendas” (`editor-manzanas.html:1079`) | Falta | No hay diagnóstico equivalente. |
| Seleccionar todas, sólo marcadas, quitar/borrar en grupo (`editor-manzanas.html:304`, manejadores en `editor-manzanas.html:1936`) | Falta | React sólo ofrece retiro individual (`src/components/SanJuanMap.tsx:3292`). |
| Filtrar por sector (`editor-manzanas.html:315`, manejador en `editor-manzanas.html:2058`) | Falta | React tiene búsqueda textual, pero no sector (`src/components/SanJuanMap.tsx:2940`). |
| Copia vinculada en disco (`editor-manzanas.html:327`, manejador en `editor-manzanas.html:2073`) | Falta | No aparece uso equivalente del File System Access API. |
| Guardar este territorio (`editor-manzanas.html:2633`) | Parcial | React guarda el contorno y los metadatos del territorio (`src/components/SanJuanMap.tsx:2813`); las manzanas se agregan aparte y no hay publicación conjunta de polígonos y caras. |
| Ver qué falta guardar (`editor-manzanas.html:2927`) | Falta | No hay comparación visible entre estado de edición y estado publicado. |
| Exportar (`editor-manzanas.html:2083`) | Existente | Hay exportación JSON, además de CSV y PDF (`src/components/SanJuanMap.tsx:2396`, `src/components/SanJuanMap.tsx:3050`). |
| Importar (`editor-manzanas.html:2097`) | Falta | No hay selector ni lector de archivo en React. |
| Vaciar todo (`editor-manzanas.html:2113`) | Falta | `resetEditor` sólo cancela la sesión de edición; no elimina territorios ni manzanas (`src/components/SanJuanMap.tsx:2214`). |

## Barra de edición de manzanas

| Herramienta del HTML | Estado | Correspondencia encontrada |
|---|---|---|
| Solo mirar (`editor-manzanas.html:349`, comportamiento en `editor-manzanas.html:911`) | Existente | El estado normal permite enfocar un territorio y abrir su ficha sin modificarlo (`src/components/SanJuanMap.tsx:2300`). |
| Dibujar manzana (`editor-manzanas.html:350`, implementación en `editor-manzanas.html:1522`) | Falta | El dibujo React crea el polígono del territorio, no una manzana (`src/components/SanJuanMap.tsx:2245`). |
| Dividir manzana (`editor-manzanas.html:351`, implementación en `editor-manzanas.html:974`) | Falta | No hay corte de geometría de manzana. |
| Fusionar manzanas (`editor-manzanas.html:352`, implementación en `editor-manzanas.html:951`) | Falta | No hay unión de geometrías de manzana. |
| Mover a territorio (`editor-manzanas.html:353`, implementación en `editor-manzanas.html:926`) | Falta | No se encontró reasignación de una manzana entre territorios. |
| Editar vértices de manzana (`editor-manzanas.html:354`, implementación en `editor-manzanas.html:1447`) | Falta | Leaflet Draw edita el contorno del territorio; las geometrías de manzana se renderizan con `interactive: false` (`src/components/SanJuanMap.tsx:1431`, `src/components/SanJuanMap.tsx:1662`). |
| Marcar manzanas (`editor-manzanas.html:355`) | Parcial | Existe el botón y el modo de marcado (`src/components/SanJuanMap.tsx:2742`, `src/components/SanJuanMap.tsx:3277`), pero registra un punto; no asigna un polígono preexistente. |
| Borrar manzana (`editor-manzanas.html:356`, implementación en `editor-manzanas.html:914`) | Parcial | React retira una manzana conservando historial (`src/components/SanJuanMap.tsx:2768`); no elimina una geometría candidata global. |
| Arreglar caras (`editor-manzanas.html:357`, implementación en `editor-manzanas.html:2479`) | Falta | No hay cálculo ni edición visible de caras/lados. |
| Poner letras manualmente (`editor-manzanas.html:358`, implementación en `editor-manzanas.html:2793`) | Falta | Las etiquetas se asignan automáticamente al agregar puntos (`src/components/SanJuanMap.tsx:2014`). |
| Ver datos de una manzana (`editor-manzanas.html:841`, implementación en `editor-manzanas.html:898`) | Parcial | React lista letra y coordenadas (`src/components/SanJuanMap.tsx:3294`); no muestra superficie, vértices ni diagnóstico. |
| Quitar del territorio dejándola libre (`editor-manzanas.html:840`, implementación en `editor-manzanas.html:869`) | Parcial | “Quitar” retira la manzana del mapa vigente (`src/components/SanJuanMap.tsx:3301`); no la conserva como candidata libre. |

## Contexto y controles móviles

| Herramienta del HTML | Estado | Correspondencia encontrada |
|---|---|---|
| Dónde estoy (`editor-manzanas.html:362`, implementación en `editor-manzanas.html:3283`) | Falta | No se encontró geolocalización en `SanJuanMap.tsx`. |
| Abrir/cerrar panel de territorios (`editor-manzanas.html:363`, manejador en `editor-manzanas.html:3200`) | Existente | El registro usa un `details` colapsable (`src/components/SanJuanMap.tsx:2930`). |
| Deshacer (`editor-manzanas.html:364`, historial en `editor-manzanas.html:602`) | Parcial | React deshace solamente el último punto del dibujo (`src/components/SanJuanMap.tsx:2271`); no tiene historial general ni rehacer. |
| Cancelar gesto (`editor-manzanas.html:365`, manejador en `editor-manzanas.html:3205`) | Parcial | `resetEditor` cancela toda la edición y el marcado tiene cancelación propia (`src/components/SanJuanMap.tsx:2214`, `src/components/SanJuanMap.tsx:2762`); no cubre los distintos gestos del HTML. |
| Listo/cerrar gesto (`editor-manzanas.html:366`, manejador en `editor-manzanas.html:3215`) | Parcial | El polígono se cierra tocando el primer punto y luego se guarda por separado (`src/components/SanJuanMap.tsx:2080`, `src/components/SanJuanMap.tsx:3129`). |
| Contexto “Solo este / +2 / +4 / Todos” (`editor-manzanas.html:369`, manejador en `editor-manzanas.html:2051`) | Parcial | React decide automáticamente qué territorios/manzanas dibujar según selección, zoom y encuadre (`src/components/SanJuanMap.tsx:1300`); no hay selector de cantidad. |
| Mostrar/ocultar letras (`editor-manzanas.html:376`, manejador en `editor-manzanas.html:2066`) | Parcial | Las letras se muestran automáticamente por selección o zoom (`src/components/SanJuanMap.tsx:1449`), sin interruptor. |
| Revisar dibujo (`editor-manzanas.html:380`, manejador en `editor-manzanas.html:2067`) | Falta | No hay modo de diagnóstico geométrico. |
| Imán (`editor-manzanas.html:384`, manejador en `editor-manzanas.html:2065`) | Parcial | React ajusta siempre a vértices de otros territorios (`src/components/SanJuanMap.tsx:1571`, `src/components/SanJuanMap.tsx:1604`); no hay interruptor y no ajusta a lados de manzana. |

## Cuenta final

| Estado | Cantidad |
|---|---:|
| Existente | 4 |
| Parcial | 16 |
| Falta | 19 |
| **Total** | **39** |
