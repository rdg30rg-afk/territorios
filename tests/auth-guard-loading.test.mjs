import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import vm from 'node:vm'

const root = new URL('..', import.meta.url)
const [source, css] = await Promise.all([
  readFile(new URL('src/components/AuthGuard.tsx', root), 'utf8'),
  readFile(new URL('src/styles/theme-hermano.css', root), 'utf8'),
])

const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function harness(auth) {
  const exports = {}
  const jsx = (type, props) => ({ type, props: props ?? {} })
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'react-router-dom') {
        return {
          Navigate: 'Navigate',
          Outlet: 'Outlet',
          useLocation: () => ({ pathname: '/predicacion' }),
        }
      }
      if (name.endsWith('/useAuth')) return { useAuth: () => auth }
      if (name.endsWith('/Icono')) return { Icono: () => null }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      throw new Error(`Dependencia inesperada: ${name}`)
    },
  })
  return exports.AuthGuard()
}

test('la validación inicial bloquea rutas sin emitir un mensaje de carga', () => {
  const node = harness({
    isApproved: false,
    isConfigured: true,
    isLoading: true,
    isAuthenticated: false,
    profile: null,
    signOut: async () => {},
    authError: null,
    retryAuth: () => {},
  })

  assert.equal(node.type, 'div')
  assert.equal(node.props.className, 'auth-guard-loading')
  assert.equal(node.props['aria-busy'], 'true')
  assert.equal(node.props.children.type, 'span')
  assert.equal(node.props.children.props['aria-hidden'], 'true')
  assert.doesNotMatch(source, /Comprobando tu acceso|Cargando/)
  assert.doesNotMatch(source, /role="status"/)
})

test('el Outlet aparece únicamente después de validar y la transición respeta reduce motion', () => {
  const node = harness({
    isApproved: true,
    isConfigured: true,
    isLoading: false,
    isAuthenticated: true,
    profile: { access_status: 'active' },
    signOut: async () => {},
    authError: null,
    retryAuth: () => {},
  })

  assert.equal(node.type, 'Outlet')
  assert.match(css, /\.auth-guard-loading\s*\{[\s\S]*?min-height:\s*100dvh;[\s\S]*?background:\s*var\(--h-canvas\);/)
  assert.match(css, /@keyframes auth-guard-arrival/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?auth-guard-loading-mark \{ animation: none; \}/)
})
