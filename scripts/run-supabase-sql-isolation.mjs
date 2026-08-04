import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  EXPECTED_TEST_DB_CONTAINER,
  FORBIDDEN_DEV_DB_CONTAINER,
  isDbContainerRunning,
  rootDir,
} from './supabase-test-shared.mjs'
import { runSqlTests } from './run-supabase-sql-tests.mjs'

function dockerPsql(containerName, sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      containerName,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tA',
      '-c',
      sql,
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim()
}

/**
 * Read-only fingerprint of the development database.
 * A reset recreates tables (new OIDs) and clears rows, so it cannot match.
 * The digest itself is never printed.
 */
function fingerprintDev() {
  const snapshot = dockerPsql(
    FORBIDDEN_DEV_DB_CONTAINER,
    `
SELECT concat_ws(
  E'\\n',
  (SELECT coalesce(string_agg(c.relname || ':' || c.oid::text, ',' ORDER BY c.relname), '')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'players', 'matches', 'predictions', 'player_sessions',
        'admin_sessions', 'seasons', 'player_trophies', 'app_settings'
      )),
  (SELECT count(*)::text FROM public.players),
  (SELECT count(*)::text FROM public.matches),
  (SELECT count(*)::text FROM public.predictions),
  (SELECT coalesce(max(created_at)::text, '') FROM public.players),
  (SELECT coalesce(max(kickoff_at)::text, '') FROM public.matches),
  (SELECT coalesce(max(updated_at)::text, '') FROM public.predictions)
);
`,
  )

  return createHash('sha256').update(snapshot).digest('hex')
}

function main() {
  if (!isDbContainerRunning(FORBIDDEN_DEV_DB_CONTAINER)) {
    process.stderr.write(
      `Stack de développement (${FORBIDDEN_DEV_DB_CONTAINER}) inactive. ` +
        'Démarre-la avec `supabase start` pour exécuter la preuve d’isolation.\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    'Optional isolation proof: read-only DEV fingerprint, SQL suite on TEST only.\n',
  )

  const before = fingerprintDev()
  process.stdout.write('DEV fingerprint captured (sha256, not displayed).\n')

  const code = runSqlTests({ stop: false })
  if (code !== 0) {
    process.exit(code)
  }

  if (!isDbContainerRunning(FORBIDDEN_DEV_DB_CONTAINER)) {
    throw new Error(
      `Le conteneur de développement ${FORBIDDEN_DEV_DB_CONTAINER} a disparu pendant les tests.`,
    )
  }

  if (isDbContainerRunning(EXPECTED_TEST_DB_CONTAINER)) {
    process.stdout.write(
      `TEST container still present as expected: ${EXPECTED_TEST_DB_CONTAINER}\n`,
    )
  }

  const after = fingerprintDev()
  if (before !== after) {
    throw new Error(
      'Échec de la preuve d’isolation: l’empreinte lecture seule de la base de développement a changé.',
    )
  }

  process.stdout.write(
    'Isolation proof passed: development fingerprint unchanged after the SQL test suite.\n',
  )
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
