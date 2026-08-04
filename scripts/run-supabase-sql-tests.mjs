import {
  EXPECTED_TEST_DB_CONTAINER,
  acquireSqlTestLock,
  assertResolvedTestContainer,
  assertTestSupabaseTarget,
  listSqlTestFiles,
  prepareTestTarget,
  rootDir,
  runSqlFileInContainer,
  runSupabaseTest,
  isDbContainerRunning,
} from './supabase-test-shared.mjs'

// Backward-compatible export name used by older unit tests; now enforces the TEST stack.
export function assertLocalSupabaseTarget(config) {
  return assertTestSupabaseTarget(config)
}

export {
  assertTestSupabaseTarget,
  acquireSqlTestLock,
  prepareTestTarget,
  EXPECTED_TEST_DB_CONTAINER,
}

function parseCliFlags(argv) {
  return {
    stop: argv.includes('--stop'),
  }
}

function ensureTestStackRunning() {
  const alreadyRunning = isDbContainerRunning(EXPECTED_TEST_DB_CONTAINER)
  if (alreadyRunning) {
    assertResolvedTestContainer(EXPECTED_TEST_DB_CONTAINER)
    return { startedByUs: false }
  }

  process.stdout.write('Starting isolated Supabase test stack...\n')
  runSupabaseTest(['start'], { stdio: 'inherit' })
  assertResolvedTestContainer(EXPECTED_TEST_DB_CONTAINER)
  return { startedByUs: true }
}

function resetTestDatabase() {
  process.stdout.write('Resetting Supabase test database with migrations (no seed)...\n')
  runSupabaseTest(['db', 'reset', '--local', '--no-seed', '--yes'], {
    stdio: 'inherit',
  })
  assertResolvedTestContainer(EXPECTED_TEST_DB_CONTAINER)
}

function stopTestStack() {
  process.stdout.write('Stopping isolated Supabase test stack...\n')
  runSupabaseTest(['stop'], { stdio: 'inherit' })
}

export function runSqlTests({ stop = false } = {}) {
  const config = prepareTestTarget()
  const lock = acquireSqlTestLock()
  let startedByUs = false
  let exitCode = 0

  try {
    process.stdout.write(
      `Target: Supabase test (${config.projectId}) ` +
        `API ${config.apiHost}:${config.apiPort} / DB ${config.dbHost}:${config.dbPort} / ` +
        `container ${config.containerName}\n`,
    )

    const stack = ensureTestStackRunning()
    startedByUs = stack.startedByUs
    resetTestDatabase()

    const sqlTests = listSqlTestFiles()
    process.stdout.write(
      `Running ${sqlTests.length} SQL test files against Supabase test ` +
        `${config.containerName}...\n`,
    )

    for (const filePath of sqlTests) {
      const relative = filePath.slice(rootDir.length + 1)
      process.stdout.write(`\n==> ${relative}\n`)
      runSqlFileInContainer(config.containerName, filePath)
    }

    process.stdout.write('\nAll isolated SQL tests passed.\n')
  } catch (error) {
    exitCode = 1
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`\nSQL tests failed: ${message}\n`)
    if (error?.status != null) {
      exitCode = Number(error.status) || 1
    }
  } finally {
    try {
      if (stop || startedByUs) {
        stopTestStack()
      }
    } catch (stopError) {
      const message =
        stopError instanceof Error ? stopError.message : String(stopError)
      process.stderr.write(`Failed to stop Supabase test stack: ${message}\n`)
      exitCode = exitCode || 1
    }

    try {
      lock.release()
    } catch (lockError) {
      const message =
        lockError instanceof Error ? lockError.message : String(lockError)
      process.stderr.write(`Failed to release SQL test lock: ${message}\n`)
      exitCode = exitCode || 1
    }
  }

  return exitCode
}

function main() {
  const flags = parseCliFlags(process.argv.slice(2))
  const code = runSqlTests(flags)
  process.exit(code)
}

import { pathToFileURL } from 'node:url'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
