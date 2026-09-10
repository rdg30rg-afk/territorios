import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dashboardUrl = new URL('../src/pages/DashboardPage.tsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260909010000_admin_asigna_grupo_usuario.sql', import.meta.url)

test('el panel permite asignar o quitar el grupo aun cuando la cuenta es administradora', async () => {
  const source = await readFile(dashboardUrl, 'utf8')

  assert.match(source, /Grupo al que pertenece/)
  assert.match(source, /administrar_grupo_usuario/)
  assert.match(source, /p_group_id: groupId \|\| null/)
  assert.doesNotMatch(source, /draftRole !== 'admin'.*Guardar grupo/s)
})

test('la RPC restringe la operación a administradores y mantiene una sola membresía vigente', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /public\.es_admin_territorios\(auth\.uid\(\)\)/)
  assert.match(sql, /where profile_id = p_profile_id and hasta is null/)
  assert.match(sql, /set estado = 'retirado', hasta = current_date/)
  assert.match(sql, /'publicador', 'confirmado'/)
  assert.match(sql, /p_group_id is null/)
  assert.match(sql, /grant execute on function public\.administrar_grupo_usuario\(uuid, uuid\) to authenticated/)
})
