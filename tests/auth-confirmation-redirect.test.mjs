import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { confirmationRedirectUrl } from '../src/lib/authRedirect.ts'

const root = new URL('..', import.meta.url)
const [authContext, loginPage] = await Promise.all([
  readFile(new URL('src/context/AuthContext.tsx', root), 'utf8'),
  readFile(new URL('src/pages/LoginPage.tsx', root), 'utf8'),
])

test('la confirmación vuelve al login del mismo origen', () => {
  assert.equal(
    confirmationRedirectUrl('https://congregacion.estracom.com.ar/mapas'),
    'https://congregacion.estracom.com.ar/login?confirmado=1',
  )
  assert.equal(
    confirmationRedirectUrl('http://127.0.0.1:5173/'),
    'http://127.0.0.1:5173/login?confirmado=1',
  )
  assert.match(authContext, /emailRedirectTo: confirmationRedirectUrl\(window\.location\.origin\)/)
})

test('el registro y el retorno explican el paso de confirmación', () => {
  assert.match(loginPage, /Te enviamos un email para confirmar la cuenta/)
  assert.match(loginPage, /Email confirmado\. Ya podés ingresar/)
})
