import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('match center public gating', () => {
  it('keeps the public match center route masked in shadow', () => {
    const page = readFileSync(
      join(root, 'src/pages/MatchCenterPage.tsx'),
      'utf8',
    )
    assert.match(page, /get_public_match_center_enabled/)
    assert.match(page, /n’est pas encore disponible publiquement/)
  })

  it('exposes admin-only provider preview without public toggle', () => {
    const admin = readFileSync(
      join(root, 'src/components/ProviderAdmin.tsx'),
      'utf8',
    )
    assert.match(admin, /publicActivationMessage/)
    assert.match(admin, /feature\/api-football-cutover/)
    assert.doesNotMatch(admin, /setPublicProvider|p_public_provider_enabled/)
    assert.match(admin, /MatchCenterPanel/)
  })
})
