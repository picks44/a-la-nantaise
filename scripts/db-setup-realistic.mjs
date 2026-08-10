#!/usr/bin/env node
/**
 * Destructive local DEV setup:
 *   guards → supabase db reset --yes → seed minimal → fixture sync → validate
 *
 * Requires --yes. Never --linked. Never remote. No predictions (S3).
 */
import {
  assertArgsHaveNoLinked,
  assertSetupYesFlag,
  prepareDevLocalTarget,
  realisticVerifyPath,
  runSqlFileInDevContainer,
  runSupabaseDev,
} from './supabase-dev-guards.mjs'
import { syncFixturesLocal } from './sync-fixtures-local.mjs'

export async function setupRealistic(argv = process.argv.slice(2)) {
  assertArgsHaveNoLinked(argv)
  assertSetupYesFlag(argv)

  const config = prepareDevLocalTarget({ requireRunning: true })

  process.stdout.write(
    `Resetting local DEV database (${config.projectId} / ${config.containerName})...\n`,
  )

  runSupabaseDev(['db', 'reset', '--yes'], {
    stdio: 'inherit',
  })

  process.stdout.write('Importing Fixture Download calendar (frozen JSON by default)...\n')
  // Forward only sync-relevant flags (not --yes).
  const syncArgv = argv.filter((arg) => arg === '--live')
  const syncResult = await syncFixturesLocal(syncArgv)

  process.stdout.write('Validating realistic setup invariants...\n')
  runSqlFileInDevContainer(config.containerName, realisticVerifyPath)

  process.stdout.write(
    [
      'DB_SETUP_REALISTIC_OK',
      `matches_fixturedownload=${syncResult.fixtureCount}`,
      `created=${syncResult.created}`,
      `updated=${syncResult.updated}`,
      `unchanged=${syncResult.unchanged}`,
      'predictions=0',
      `source=${syncResult.sourceLabel}`,
    ].join(' ') + '\n',
  )

  return { config, syncResult }
}

if (process.argv[1]?.endsWith('db-setup-realistic.mjs')) {
  setupRealistic(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
