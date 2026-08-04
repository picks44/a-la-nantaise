import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diagnoseFrontendTarget } from '../scripts/frontend-env-diagnostic.mjs'
import { assertLocalSupabaseTarget } from '../scripts/run-supabase-sql-tests.mjs'

describe('frontend environment diagnostics', () => {
  it('reports the effective local frontend target from .env.local precedence', () => {
    const diagnostic = diagnoseFrontendTarget('effective')
    assert.equal(diagnostic.label, 'Supabase local')
    assert.equal(diagnostic.origin, 'http://127.0.0.1:54321')
    assert.equal(diagnostic.hostname, '127.0.0.1')
  })

  it('reports the default distant frontend target from .env', () => {
    const diagnostic = diagnoseFrontendTarget('default')
    assert.equal(diagnostic.label, 'Supabase distant')
    assert.equal(diagnostic.hostname.endsWith('.supabase.co'), true)
  })
})

describe('local SQL test guard', () => {
  it('accepts only the expected local Supabase ports', () => {
    const config = assertLocalSupabaseTarget({
      projectId: 'a-la-nantaise',
      apiHost: '127.0.0.1',
      apiPort: 54321,
      dbHost: '127.0.0.1',
      dbPort: 54322,
    })

    assert.equal(config.projectId, 'a-la-nantaise')
  })

  it('rejects a non-local API target before any reset or mutation', () => {
    assert.throws(
      () =>
        assertLocalSupabaseTarget({
          projectId: 'a-la-nantaise',
          apiHost: 'example.supabase.co',
          apiPort: 443,
          dbHost: '127.0.0.1',
          dbPort: 54322,
        }),
      /Refus de lancer les tests SQL: cible API non locale/,
    )
  })
})
