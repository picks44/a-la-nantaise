import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260804193000_remove_api_football_shadow.sql',
  ),
  'utf8',
)

describe('API-Football removal migration guards', () => {
  it('does not treat manual official results as blocking provider data', () => {
    assert.match(
      migration,
      /official_result_source IS DISTINCT FROM 'manual'/,
    )
    assert.doesNotMatch(
      migration,
      /OR m\.official_result_source IS NOT NULL\s*\n\s*OR m\.official_result_validated_at IS NOT NULL/,
    )
  })

  it('drops provider tables without CASCADE', () => {
    assert.match(migration, /DROP TABLE IF EXISTS public\.provider_fixture_events;/)
    assert.match(migration, /DROP TABLE IF EXISTS public\.provider_settings;/)
    assert.doesNotMatch(migration, /DROP TABLE IF EXISTS public\.provider_\w+ CASCADE/)
  })
})
