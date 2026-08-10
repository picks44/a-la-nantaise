#!/usr/bin/env node
/**
 * Seed local DEV predictions on Fixture Download matches (S3).
 * Requires S2 calendar already present (34 fixturedownload matches).
 * No match mutation. No live feed. No service_role.
 */
import { execFileSync } from 'node:child_process'
import {
  EXPECTED_DEV_PREDICTION_COUNT,
  assertArgsHaveNoLinked,
  assertDevDbContainerRunning,
  devPredictionsVerifyPath,
  prepareDevLocalTarget,
  runSqlFileInDevContainer,
  seedDevPredictionsPath,
} from './supabase-dev-guards.mjs'

function countFixtureDownloadMatches(containerName) {
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      containerName,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      "SELECT COUNT(*)::TEXT FROM public.matches WHERE source = 'fixturedownload';",
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return Number.parseInt(String(output).trim(), 10)
}

export function seedDevPredictions(argv = process.argv.slice(2)) {
  assertArgsHaveNoLinked(argv)
  const config = prepareDevLocalTarget({ requireRunning: true })
  assertDevDbContainerRunning(config.containerName)

  const fdCount = countFixtureDownloadMatches(config.containerName)
  if (fdCount !== 34) {
    throw new Error(
      `Refus: ${fdCount} match(s) source=fixturedownload (attendu 34). ` +
        'Exécute d’abord: npm run db:setup:realistic -- --yes',
    )
  }

  process.stdout.write(
    `Seeding ${EXPECTED_DEV_PREDICTION_COUNT} dev predictions on Fixture Download matches...\n`,
  )
  runSqlFileInDevContainer(config.containerName, seedDevPredictionsPath)

  process.stdout.write('Validating dev predictions invariants...\n')
  runSqlFileInDevContainer(config.containerName, devPredictionsVerifyPath)

  process.stdout.write(
    [
      'DEV_PREDICTIONS_SEED_OK',
      `predictions=${EXPECTED_DEV_PREDICTION_COUNT}`,
      'matches_fixturedownload=34',
      'matches_manual=0',
      'points=deferred_until_finished',
    ].join(' ') + '\n',
  )

  return {
    predictionCount: EXPECTED_DEV_PREDICTION_COUNT,
    fixtureCount: 34,
  }
}

if (process.argv[1]?.endsWith('seed-dev-predictions.mjs')) {
  try {
    seedDevPredictions(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
