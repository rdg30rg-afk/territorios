begin;

-- El conductor sin módulos puede informar por RPC, pero la política antigua
-- solo dejaba leer a operadores del panel. Mantener esa política y agregar
-- lectura exclusivamente para el conductor vinculado a esta salida.
drop policy if exists conductor_lee_resultado_de_su_salida on public.salida_resultados;
create policy conductor_lee_resultado_de_su_salida
on public.salida_resultados for select to authenticated
using (
  public.es_usuario_activo()
  and exists (
    select 1 from public.salidas s
    join public.profiles p on p.id = auth.uid()
    where s.id = salida_resultados.salida_id
      and s.driver_id is not null
      and s.driver_id = p.driver_id
  )
);

-- No otorgar escrituras ni eludir RLS en la vista.
alter view public.salida_resultado_actual set (security_invoker = true);
notify pgrst, 'reload schema';
commit;
