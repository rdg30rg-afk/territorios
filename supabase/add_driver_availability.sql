alter table public.conductores
  add column if not exists availability jsonb not null default '{"days": [], "turns": []}'::jsonb;
