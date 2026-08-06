import assert from 'node:assert/strict'
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { diagnoseFrontendTarget } from '../scripts/frontend-env-diagnostic.mjs'
import {
  assertLocalSupabaseTarget,
  assertTestSupabaseTarget,
} from '../scripts/run-supabase-sql-tests.mjs'
import {
  EXPECTED_TEST_API_PORT,
  EXPECTED_TEST_DB_CONTAINER,
  EXPECTED_TEST_DB_PORT,
  EXPECTED_TEST_PROJECT_ID,
  FORBIDDEN_DEV_API_PORT,
  FORBIDDEN_DEV_DB_CONTAINER,
  FORBIDDEN_DEV_DB_PORT,
  FORBIDDEN_DEV_PROJECT_ID,
  acquireSqlTestLock,
  assertArgsHaveNoLinked,
  assertNoRemoteLinkInTestTemp,
  assertSafeCliEnvironment,
  getDbContainerName,
  parseTestSupabaseConfig,
  testConfigPath,
} from '../scripts/supabase-test-shared.mjs'

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

  it('lets process.env override every env file in effective mode', () => {
    withTempEnvFiles(
      {
        '.env': 'VITE_SUPABASE_URL=https://base.example.supabase.co\n',
        '.env.local': 'VITE_SUPABASE_URL=http://127.0.0.1:54321\n',
        '.env.development': 'VITE_SUPABASE_URL=https://dev.example.supabase.co\n',
        '.env.development.local':
          'VITE_SUPABASE_URL=https://dev-local.example.supabase.co\n',
      },
      (tempRoot) => {
        const diagnostic = diagnoseFrontendTarget('effective', {
          rootDir: tempRoot,
          processEnv: {
            VITE_SUPABASE_URL: 'https://process.example.supabase.co',
          },
        })

        assert.equal(diagnostic.label, 'Supabase distant')
        assert.equal(diagnostic.origin, 'https://process.example.supabase.co')
        assert.equal(diagnostic.hostname, 'process.example.supabase.co')
        assert.match(
          diagnostic.sourceLabel,
          /process\.env\.VITE_SUPABASE_URL/,
        )
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

describe('isolated SQL test guards', () => {
  const validTestConfig = {
    projectId: EXPECTED_TEST_PROJECT_ID,
    apiHost: '127.0.0.1',
    apiPort: EXPECTED_TEST_API_PORT,
    dbHost: '127.0.0.1',
    dbPort: EXPECTED_TEST_DB_PORT,
  }

  it('accepts only the dedicated Supabase test stack', () => {
    const config = assertTestSupabaseTarget(validTestConfig)
    assert.equal(config.projectId, EXPECTED_TEST_PROJECT_ID)
    assert.equal(config.containerName, EXPECTED_TEST_DB_CONTAINER)
    assert.equal(
      getDbContainerName(config.projectId),
      EXPECTED_TEST_DB_CONTAINER,
    )
  })

  it('keeps assertLocalSupabaseTarget as an alias of the test guard', () => {
    const config = assertLocalSupabaseTarget(validTestConfig)
    assert.equal(config.containerName, EXPECTED_TEST_DB_CONTAINER)
  })

  it('rejects development API and DB ports', () => {
    assert.throws(
      () =>
        assertTestSupabaseTarget({
          ...validTestConfig,
          apiPort: FORBIDDEN_DEV_API_PORT,
        }),
      /port API de développement/,
    )

    assert.throws(
      () =>
        assertTestSupabaseTarget({
          ...validTestConfig,
          dbPort: FORBIDDEN_DEV_DB_PORT,
        }),
      /port DB de développement/,
    )
  })

  it('rejects the development project_id', () => {
    assert.throws(
      () =>
        assertTestSupabaseTarget({
          ...validTestConfig,
          projectId: FORBIDDEN_DEV_PROJECT_ID,
        }),
      /project_id de développement/,
    )
  })

  it('rejects a non-local / remote API host', () => {
    assert.throws(
      () =>
        assertTestSupabaseTarget({
          ...validTestConfig,
          apiHost: 'example.supabase.co',
          apiPort: 443,
        }),
      /cible API non locale/,
    )
  })

  it('rejects a missing test configuration file', () => {
    assert.throws(
      () => parseTestSupabaseConfig(join(tmpdir(), 'missing-aln-test-config.toml')),
      /Configuration de test absente/,
    )
  })

  it('parses the committed test config with the expected ports and project_id', () => {
    const config = parseTestSupabaseConfig(testConfigPath)
    assert.equal(config.projectId, EXPECTED_TEST_PROJECT_ID)
    assert.equal(config.apiPort, EXPECTED_TEST_API_PORT)
    assert.equal(config.dbPort, EXPECTED_TEST_DB_PORT)
    const guarded = assertTestSupabaseTarget(config)
    assert.equal(guarded.containerName, EXPECTED_TEST_DB_CONTAINER)
    assert.notEqual(guarded.containerName, FORBIDDEN_DEV_DB_CONTAINER)
  })

  it('resolves the test container name and refuses the development container name', () => {
    assert.equal(
      getDbContainerName(EXPECTED_TEST_PROJECT_ID),
      EXPECTED_TEST_DB_CONTAINER,
    )
    assert.equal(
      getDbContainerName(FORBIDDEN_DEV_PROJECT_ID),
      FORBIDDEN_DEV_DB_CONTAINER,
    )
    assert.throws(
      () =>
        assertTestSupabaseTarget({
          ...validTestConfig,
          projectId: FORBIDDEN_DEV_PROJECT_ID,
        }),
      /développement/,
    )
  })

  it('refuses remote link files in the test .temp directory', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'aln-temp-link-'))
    try {
      writeFileSync(join(tempRoot, 'project-ref'), 'fake-remote-project-ref\n')
      assert.throws(
        () => assertNoRemoteLinkInTestTemp(tempRoot),
        /fichiers de liaison distante/,
      )

      rmSync(join(tempRoot, 'project-ref'))
      writeFileSync(join(tempRoot, 'cli-latest'), 'v2.111.0\n')
      assert.doesNotThrow(() => assertNoRemoteLinkInTestTemp(tempRoot))
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('refuses CLI-influencing env vars but ignores VITE_SUPABASE_URL', () => {
    assert.throws(
      () =>
        assertSafeCliEnvironment({
          SUPABASE_DB_URL: 'postgresql://remote.example/postgres',
        }),
      /SUPABASE_DB_URL/,
    )

    assert.doesNotThrow(() =>
      assertSafeCliEnvironment({
        VITE_SUPABASE_URL: 'https://preview.example.supabase.co',
      }),
    )

    assert.doesNotThrow(() =>
      assertSafeCliEnvironment({
        SUPABASE_ACCESS_TOKEN: 'sbp_local_cli_token_does_not_select_target',
      }),
    )
  })

  it('refuses --linked arguments', () => {
    assert.throws(
      () => assertArgsHaveNoLinked(['db', 'reset', '--linked']),
      /--linked/,
    )
  })

  it('keeps the isolation script free of mutating SQL against the development database', () => {
    const source = readFileSync(
      join(rootDir, 'scripts/run-supabase-sql-isolation.mjs'),
      'utf8',
    )

    assert.doesNotMatch(source, /_aln_sql_isolation_probe/)
    assert.doesNotMatch(source, /LEGACY_PROBE_TABLE/)
    assert.doesNotMatch(source, /\bDROP\s+TABLE\b/i)
    assert.doesNotMatch(source, /\bCREATE\s+TABLE\b/i)
    assert.doesNotMatch(source, /\bINSERT\s+INTO\b/i)
    assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i)
    assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i)
    assert.doesNotMatch(source, /\bTRUNCATE\b/i)

    const devSqlCalls = [
      ...source.matchAll(
        /dockerPsql\(\s*FORBIDDEN_DEV_DB_CONTAINER\s*,\s*`([\s\S]*?)`/g,
      ),
    ]
    assert.ok(
      devSqlCalls.length >= 1,
      'expected at least one dockerPsql call against the development container',
    )

    for (const [, sql] of devSqlCalls) {
      assert.match(sql, /^\s*SELECT\b/i)
      for (const keyword of [
        'DROP',
        'CREATE',
        'INSERT',
        'UPDATE',
        'DELETE',
        'ALTER',
        'TRUNCATE',
      ]) {
        assert.doesNotMatch(
          sql,
          new RegExp(`\\b${keyword}\\b`, 'i'),
          `DEV dockerPsql SQL must not contain mutating keyword ${keyword}`,
        )
      }
    }
  })

  it('acquires a lock, blocks concurrent acquisition, and releases after success', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'aln-sql-lock-'))
    const lockPath = join(lockDir, 'test.lock')
    const first = acquireSqlTestLock(lockPath)
    try {
      assert.throws(() => acquireSqlTestLock(lockPath), /déjà en cours/)
      first.release()
      const second = acquireSqlTestLock(lockPath)
      second.release()
      assert.equal(
        (() => {
          try {
            readFileSync(lockPath, 'utf8')
            return true
          } catch (error) {
            return error?.code === 'ENOENT' ? false : true
          }
        })(),
        false,
      )
    } finally {
      try {
        first.release()
      } catch {
        // already released
      }
      rmSync(lockDir, { recursive: true, force: true })
    }
  })

  it('releases the lock after a simulated failure path', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'aln-sql-lock-fail-'))
    const lockPath = join(lockDir, 'test.lock')
    const lock = acquireSqlTestLock(lockPath)
    try {
      throw new Error('simulated failure')
    } catch {
      lock.release()
    }

    const again = acquireSqlTestLock(lockPath)
    again.release()
    rmSync(lockDir, { recursive: true, force: true })
  })

  it('recovers a stale lock left by a dead process', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'aln-sql-lock-stale-'))
    const lockPath = join(lockDir, 'test.lock')
    mkdirSync(dirname(lockPath), { recursive: true })
    const fd = openSync(lockPath, 'wx')
    try {
      writeFileSync(fd, '999999999\n')
    } finally {
      closeSync(fd)
    }

    const lock = acquireSqlTestLock(lockPath)
    lock.release()
    rmSync(lockDir, { recursive: true, force: true })
  })
})

describe('SQL regression suites remain a local gate (A5)', () => {
  it('keeps npm test on Node source suites and SQL behind test:sql:local', () => {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
    assert.match(pkg.scripts.test, /tests\/\*\*\/\*\.test\.mjs/)
    assert.doesNotMatch(pkg.scripts.test, /supabase\/tests/)
    assert.equal(pkg.scripts['test:sql:local'], 'node scripts/run-supabase-sql-tests.mjs')
    assert.equal(
      pkg.scripts['test:sql:isolation'],
      'node scripts/run-supabase-sql-isolation.mjs',
    )
  })
})
