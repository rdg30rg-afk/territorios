create table public.editor_estado(
 id text primary key,estado jsonb not null,actualizado_por uuid references profiles(id),actualizado_at timestamptz not null default now()
);
grant select,insert,update on editor_estado to authenticated;
-- Sin RLS en este fixture: comprueba la defensa del trigger por sí misma.
