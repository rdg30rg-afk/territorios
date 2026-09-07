import test from 'node:test'
import assert from 'node:assert/strict'
import { getTerritoryDeepLinkTransition } from '../src/lib/territoryDeepLink.ts'

function transitionsFor(values) {
  let lastProcessedTerritoryId

  return values.map((requestedTerritoryId) => {
    const transition = getTerritoryDeepLinkTransition(
      requestedTerritoryId,
      lastProcessedTerritoryId,
    )

    if (transition.changed) {
      lastProcessedTerritoryId = requestedTerritoryId
    }

    return transition
  })
}

test('procesa una vez por cambio de parámetro y vuelve a procesar A tras null', () => {
  assert.deepEqual(
    transitionsFor(['A', 'B', 'B', null, 'A']),
    [
      { changed: true, shouldFocus: true },
      { changed: true, shouldFocus: true },
      { changed: false, shouldFocus: false },
      { changed: true, shouldFocus: false },
      { changed: true, shouldFocus: true },
    ],
  )
})

test('un mismo deep-link repetido no vuelve a pedir foco', () => {
  assert.deepEqual(
    transitionsFor(['A', 'A', 'A']),
    [
      { changed: true, shouldFocus: true },
      { changed: false, shouldFocus: false },
      { changed: false, shouldFocus: false },
    ],
  )
})
