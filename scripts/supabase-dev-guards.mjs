import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
export const devConfigPath = join(rootDir, 'supabase', 'config.toml')
export const frozenFixturePath = join(
  rootDir,
  'tests',
  'fixtures',
  'ligue-2-2026-fc-nantes.json',
)
export const realisticVerifyPath = join(
  rootDir,
  'supabase',
  'maintenance',
  'verify_realistic_setup.sql',
)
export const seedDevPredictionsPath = join(
  rootDir,
  'supabase',
  'seed-dev-predictions.sql',
)
export const devPredictionsVerifyPath = join(
  rootDir,
  'supabase',
  'maintenance',
  'verify_dev_predictions.sql',
)

/** Expected prediction rows created by seed-dev-predictions.sql (J1+J2+J3). */
export const EXPECTED_DEV_PREDICTION_COUNT = 10

export const DEV_PREDICTION_EXTERNAL_IDS = [
  'fixturedownload:ligue-2-2026:6',
  'fixturedownload:ligue-2-2026:14',
  'fixturedownload:ligue-2-2026:25',
]

export const EXPECTED_DEV_PROJECT_ID = 'a-la-nantaise'
export const FORBIDDEN_TEST_PROJECT_ID = 'a-la-nantaise-test'
export const EXPECTED_DEV_API_PORT = 54321
export const EXPECTED_DEV_DB_PORT = 54322
export const FORBIDDEN_TEST_API_PORT = 55321
export const FORBIDDEN_TEST_DB_PORT = 55322
export const EXPECTED_DEV_DB_CONTAINER = `supabase_db_${EXPECTED_DEV_PROJECT_ID}`
export const FORBIDDEN_TEST_DB_CONTAINER = `supabase_db_${FORBIDDEN_TEST_PROJECT_ID}`

/** Local-only admin code from supabase/seed.sql — never use prod codes. */
export const LOCAL_SEED_ADMIN_CODE = 'ADMIN'

/** Env vars that can redirect the Supabase CLI or DB connection away from local. */
export const CLI_INFLUENCING_ENV_VARS = [
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGSERVICE',
  'PGSERVICEFILE',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]

function parseTomlScalar(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?$`, 'm'))
  return match?.[1] ?? null
}

function parseSectionPort(toml, sectionName) {
  const blockMatch = toml.match(
    new RegExp(`\\[${sectionName}\\][\\s\\S]*?(?=\\n\\[|$)`),
  )
  const portMatch = blockMatch?.[0]?.match(/^port\s*=\s*(\d+)$/m)
  return Number(portMatch?.[1] ?? NaN)
}

export function parseDevSupabaseConfig(configPath = devConfigPath) {
  if (!existsSync(configPath)) {
    throw new Error(
      `Configuration dev absente: ${configPath}. Impossible de cibler la stack locale.`,
    )
  }

  const toml = readFileSync(configPath, 'utf8')
  const projectId = parseTomlScalar(toml, 'project_id')
  const apiPort = parseSectionPort(toml, 'api')
  const dbPort = parseSectionPort(toml, 'db')

  if (!projectId || !Number.isFinite(apiPort) || !Number.isFinite(dbPort)) {
    throw new Error(
      'Configuration dev ambiguë: project_id, [api].port ou [db].port manquant.',
    )
  }

  return {
    projectId,
    apiHost: '127.0.0.1',
    apiPort,
    dbHost: '127.0.0.1',
    dbPort,
    configPath,
  }
}

export function getDbContainerName(projectId) {
  return `supabase_db_${projectId}`
}

export function assertArgsHaveNoLinked(args) {
  if (
    args.some(
      (arg) => arg === '--linked' || String(arg).startsWith('--linked='),
    )
  ) {
    throw new Error(
      'Refus: --linked est interdit pour les commandes de setup/sync locales.',
    )
  }
}

export function assertSafeCliEnvironment(env = process.env) {
  for (const key of CLI_INFLUENCING_ENV_VARS) {
    const value = env[key]
    if (value == null || String(value).trim() === '') {
      continue
    }

    throw new Error(
      `Refus: la variable d'environnement ${key} est définie et pourrait rediriger ` +
        'hors de la stack dev locale. Retire-la avant db:setup:realistic / db:sync:fixtures:local.',
    )
  }
}

export function assertLocalApiUrl(urlValue) {
  if (!urlValue || String(urlValue).trim() === '') {
    throw new Error('Refus: URL Supabase API manquante.')
  }

  let parsed
  try {
    parsed = new URL(String(urlValue).trim())
  } catch {
    throw new Error(`Refus: URL Supabase API invalide (${urlValue}).`)
  }

  const hostOk =
    parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (!hostOk) {
    throw new Error(
      `Refus: URL Supabase non locale (${parsed.hostname}). ` +
        'Seuls 127.0.0.1 et localhost sont autorisés.',
    )
  }

  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === 'https:'
      ? 443
      : 80

  if (port === FORBIDDEN_TEST_API_PORT) {
    throw new Error(
      `Refus: port API de la stack test (${FORBIDDEN_TEST_API_PORT}) interdit pour le setup réaliste.`,
    )
  }

  if (port !== EXPECTED_DEV_API_PORT) {
    throw new Error(
      `Refus: port API attendu ${EXPECTED_DEV_API_PORT}, reçu ${port}.`,
    )
  }

  return {
    origin: `${parsed.protocol}//${parsed.hostname}:${EXPECTED_DEV_API_PORT}`,
    hostname: parsed.hostname,
    port: EXPECTED_DEV_API_PORT,
  }
}

export function assertDevSupabaseTarget(config = parseDevSupabaseConfig()) {
  if (!config?.projectId) {
    throw new Error('project_id manquant dans la configuration Supabase dev.')
  }

  if (config.projectId === FORBIDDEN_TEST_PROJECT_ID) {
    throw new Error(
      `Refus: project_id de test (${FORBIDDEN_TEST_PROJECT_ID}) interdit pour le setup réaliste.`,
    )
  }

  if (config.projectId !== EXPECTED_DEV_PROJECT_ID) {
    throw new Error(
      `Refus: project_id attendu "${EXPECTED_DEV_PROJECT_ID}", reçu "${config.projectId}".`,
    )
  }

  if (config.apiHost !== '127.0.0.1') {
    throw new Error(
      `Refus: cible API non locale (${config.apiHost}:${config.apiPort}).`,
    )
  }

  if (config.apiPort === FORBIDDEN_TEST_API_PORT) {
    throw new Error(
      `Refus: port API de test (${FORBIDDEN_TEST_API_PORT}) interdit.`,
    )
  }

  if (config.apiPort !== EXPECTED_DEV_API_PORT) {
    throw new Error(
      `Refus: port API attendu ${EXPECTED_DEV_API_PORT}, reçu ${config.apiPort}.`,
    )
  }

  if (config.dbHost !== '127.0.0.1') {
    throw new Error(
      `Refus: cible DB non locale (${config.dbHost}:${config.dbPort}).`,
    )
  }

  if (config.dbPort === FORBIDDEN_TEST_DB_PORT) {
    throw new Error(
      `Refus: port DB de test (${FORBIDDEN_TEST_DB_PORT}) interdit.`,
    )
  }

  if (config.dbPort !== EXPECTED_DEV_DB_PORT) {
    throw new Error(
      `Refus: port DB attendu ${EXPECTED_DEV_DB_PORT}, reçu ${config.dbPort}.`,
    )
  }

  const containerName = getDbContainerName(config.projectId)
  if (containerName === FORBIDDEN_TEST_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur de test (${FORBIDDEN_TEST_DB_CONTAINER}) interdit.`,
    )
  }

  if (containerName !== EXPECTED_DEV_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur attendu "${EXPECTED_DEV_DB_CONTAINER}", reçu "${containerName}".`,
    )
  }

  return { ...config, containerName }
}

export function listRunningDockerNames() {
  const output = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return output.split(/\r?\n/).filter(Boolean)
}

export function isDbContainerRunning(containerName) {
  return listRunningDockerNames().includes(containerName)
}

export function assertDevDbContainerRunning(
  containerName = EXPECTED_DEV_DB_CONTAINER,
) {
  if (containerName === FORBIDDEN_TEST_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur de test (${FORBIDDEN_TEST_DB_CONTAINER}) interdit.`,
    )
  }

  if (containerName !== EXPECTED_DEV_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur résolu "${containerName}" n'est pas "${EXPECTED_DEV_DB_CONTAINER}".`,
    )
  }

  if (!isDbContainerRunning(containerName)) {
    throw new Error(
      `Conteneur dev ${containerName} introuvable. Lance d'abord: supabase start`,
    )
  }

  return containerName
}

export function assertSetupYesFlag(argv) {
  if (!argv.includes('--yes')) {
    throw new Error(
      'Refus: db:setup:realistic est destructif. Relance avec --yes :\n' +
        '  npm run db:setup:realistic -- --yes',
    )
  }
}

export function prepareDevLocalTarget(options = {}) {
  const { requireRunning = true } = options
  assertSafeCliEnvironment()
  const config = assertDevSupabaseTarget()
  if (requireRunning) {
    assertDevDbContainerRunning(config.containerName)
  }
  return config
}

/**
 * Parse `supabase status -o env` output into a key/value map.
 */
export function parseSupabaseStatusEnv(envText) {
  const values = {}
  for (const line of String(envText).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    values[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
  return values
}

export function resolveLocalAnonCredentials(statusEnvText) {
  const values = parseSupabaseStatusEnv(statusEnvText)
  const apiUrl = values.API_URL || values.SUPABASE_URL
  const anonKey = values.ANON_KEY || values.SUPABASE_ANON_KEY

  if (!anonKey || String(anonKey).trim() === '') {
    throw new Error(
      'Refus: ANON_KEY locale introuvable via supabase status. Vérifie que la stack dev tourne.',
    )
  }

  const localApi = assertLocalApiUrl(apiUrl)
  return {
    supabaseUrl: localApi.origin,
    anonKey: String(anonKey).trim(),
  }
}

export function runSqlFileInDevContainer(containerName, filePath) {
  assertDevDbContainerRunning(containerName)
  const sql = readFileSync(filePath, 'utf8')
  execFileSync(
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
      '-f',
      '-',
    ],
    {
      cwd: rootDir,
      input: sql,
      stdio: ['pipe', 'inherit', 'inherit'],
      encoding: 'utf8',
    },
  )
}

export function runSupabaseDev(args, options = {}) {
  assertArgsHaveNoLinked(args)

  if (args.includes('push') || (args.includes('db') && args.includes('push'))) {
    throw new Error(
      'Refus: supabase db push est interdit dans les scripts locaux réalistes.',
    )
  }

  return execFileSync('supabase', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  })
}
