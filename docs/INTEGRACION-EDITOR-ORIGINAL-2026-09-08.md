# Integración directa del editor original

Por indicación del usuario se abandona la reconstrucción funcional por partes.
`MapasPage` monta el mismo `editor-manzanas.html?embedded=1` en un iframe del
mismo origen, solamente para administradores. Cobertura oculta el editor sin
desmontarlo. El cliente de sesión de la app permanece montado. No se pasan
credenciales en URL ni mensajes.

La adaptación modifica presentación (CSS acotado a modo embebido, sin cabecera
duplicada) y contenedor; no modifica algoritmos, herramientas ni RPC del HTML.
Los cambios locales del enfoque anterior se conservan, pero no son el motor
de edición que se monta para administradores.

Verificado: TypeScript y build development completan; navegador local muestra
el editor original, territorios y las herramientas Fusionar, Dividir, caras y
letras. No se ejecutaron operaciones destructivas ni publicación territorial.

Pendiente: el editor mostró «Alguien guardó el editor después que vos. Recargá
la página antes de seguir, o vas a pisarle el trabajo». Se conserva el conflicto,
sin forzar guardado. No certifica guardado real ni responsive completo. Sin
deploy a Estracom ni cambios en Supabase producción en esta tanda.
