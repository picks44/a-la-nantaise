import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { diagnoseFrontendTarget } from '../scripts/frontend-env-diagnostic.mjs'
import { assertLocalSupabaseTarget } from '../scripts/run-supabase-sql-tests.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const diagnosticScript = join(rootDir, 'scripts/frontend-env-diagnostic.mjs')

function withTempEnvFiles(files, run) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'aln-env-test-'))
  try {
    for (const [fileName, contents] of Object.entries(files)) {
      writeFileSync(join(tempRoot, fileName), contents)
    }
    return run(tempRoot)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

describe('frontend environment diagnostics', () => {
  it('reports the local target from .env.local only', () => {
    withTempEnvFiles(
      {
        '.env.local': 'VITE_SUPABASE_URL=http://127.0.0.1:54321\n',
      },
      (tempRoot) => {
        const diagnostic = diagnoseFrontendTarget('local', { rootDir: tempRoot })
        assert.equal(diagnostic.label, 'Supabase local')
        assert.equal(diagnostic.origin, 'http://127.0.0.1:54321')
        assert.equal(diagnostic.hostname, '127.0.0.1')
      },
    )
  })

  it('reports the distant target from .env only', () => {
    withTempEnvFiles(
      {
        '.env': 'VITE_SUPABASE_URL=https://preview.example.supabase.co\n',
      },
      (tempRoot) => {
        const diagnostic = diagnoseFrontendTarget('default', { rootDir: tempRoot })
        assert.equal(diagnostic.label, 'Supabase distant')
        assert.equal(diagnostic.origin, 'https://preview.example.supabase.co')
        assert.equal(diagnostic.hostname, 'preview.example.supabase.co')
      },
    )
  })

  it('matches Vite development priority in effective mode', () => {
    withTempEnvFiles(
      {
        '.env': 'VITE_SUPABASE_URL=https://base.example.supabase.co\n',
        '.env.local': 'VITE_SUPABASE_URL=http://127.0.0.1:54321\n',
        '.env.development': 'VITE_SUPABASE_URL=https://dev.example.supabase.co\n',
        '.env.development.local':
          'VITE_SUPABASE_URL=https://dev-local.example.supabase.co\n',
      },
      (tempRoot) => {
        const diagnostic = diagnoseFrontendTarget('effective', { rootDir: tempRoot })
        assert.equal(diagnostic.label, 'Supabase distant')
        assert.equal(diagnostic.origin, 'https://dev-local.example.supabase.co')
        assert.equal(diagnostic.hostname, 'dev-local.example.supabase.co')
      },
    )
  })

  it('reports missing configuration without depending on local .env files', () => {
    withTempEnvFiles({}, (tempRoot) => {
      const diagnostic = diagnoseFrontendTarget('effective', { rootDir: tempRoot })
      assert.equal(diagnostic.label, 'configuration absente')
      assert.equal(diagnostic.origin, 'absent')
      assert.equal(diagnostic.hostname, 'absent')
    })
  })

  it('masks invalid URLs instead of echoing the raw value', () => {
    const fakeSensitiveValue = 'sb_publishable_secret_should_not_leak'

    withTempEnvFiles(
      {
        '.env': `VITE_SUPABASE_URL=${fakeSensitiveValue}\n`,
      },
      (tempRoot) => {
        const diagnostic = diagnoseFrontendTarget('default', { rootDir: tempRoot })
        assert.equal(diagnostic.label, 'URL invalide')
        assert.equal(diagnostic.origin, 'URL invalide')
        assert.equal(diagnostic.hostname, 'invalide')

        const result = spawnSync(
          process.execPath,
          [diagnosticScript, 'default', tempRoot],
          { encoding: 'utf8' },
        )

        assert.equal(result.status, 0)
        assert.match(result.stdout, /Frontend default: URL invalide/)
        assert.match(result.stdout, /URL: URL invalide/)
        assert.match(result.stdout, /Hostname: invalide/)
        assert.doesNotMatch(result.stdout, new RegExp(fakeSensitiveValue))
        assert.doesNotMatch(result.stderr, new RegExp(fakeSensitiveValue))
      },
    )
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
