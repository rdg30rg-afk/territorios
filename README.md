# Territorios

Base inicial del MVP para gestionar territorios, conductores, grupos y salidas
desde una app web que tambien puede empaquetarse como APK.

## Stack elegido

- React + Vite
- React Router
- MapLibre + OpenStreetMap
- Supabase
- Capacitor

## Modulos iniciales

1. Mapas y Territorios
2. Conductores
3. Grupos para el Servicio
4. Salidas

## Ejecutar localmente

```bash
npm install
npm run dev
```

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Base de datos y acceso

1. Crear un proyecto en Supabase.
2. Ir a `SQL Editor` y ejecutar [supabase/schema.sql](./supabase/schema.sql).
3. En `Authentication > Sign In / Providers`, habilitar Email.
4. Copiar la `Project URL` y la `anon public key`.
5. Crear `.env` a partir de `.env.example`.

```bash
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
```

6. Crear la primera cuenta en `Authentication > Users`.
7. En Supabase, promover ese usuario a admin con una consulta como esta:

```sql
update profiles
set role = 'admin'
where id = 'USER_UUID_AQUI';
```

8. Dar acceso a modulos para usuarios no admin:

```sql
insert into user_module_access (user_id, module_key)
values
  ('USER_UUID_AQUI', 'mapas'),
  ('USER_UUID_AQUI', 'salidas');
```

Con eso, el frontend ya mostrara solo los modulos habilitados para cada usuario.

## Acceso inicial preparado

- Usuario visible: `Blade30$`
- La app lo vincula por ahora al correo interno `blade30@territorios.app`
- Contraseña solicitada: `Cong$ur07179`

Esto deja el acceso funcionando de inmediato mientras preparamos una
administracion de usuarios completa desde la propia app.

## Nota de migracion

Si ya habias creado la base antes de relacionar `Salidas` con `Territorios`,
vuelve a ejecutar [supabase/schema.sql](./supabase/schema.sql) o al menos esta
consulta:

```sql
alter table salidas
  add column if not exists territory_id uuid references territorios (id) on delete set null;
```

## Base de datos

El esquema inicial sugerido esta en [supabase/schema.sql](./supabase/schema.sql).

## APK Android

La configuracion base de Capacitor ya esta creada.

```bash
npm run build
npx cap add android
npx cap sync android
```

Luego se abre el proyecto Android con:

```bash
npx cap open android
```

## Siguiente etapa recomendada

- Conectar formularios reales de conductores, grupos y salidas
- Leer datos reales desde Supabase en cada modulo
- Permitir editar o eliminar territorios
- Relacionar salidas con territorios guardados
