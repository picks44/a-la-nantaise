import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
export const testWorkdir = join(rootDir, 'supabase-test')
export const testSupabaseDir = join(testWorkdir, 'supabase')
export const testConfigPath = join(testSupabaseDir, 'config.toml')
export const sqlTestsDir = join(rootDir, 'supabase', 'tests')

export const EXPECTED_TEST_PROJECT_ID = 'a-la-nantaise-test'
export const FORBIDDEN_DEV_PROJECT_ID = 'a-la-nantaise'
export const EXPECTED_TEST_API_PORT = 55321
export const EXPECTED_TEST_DB_PORT = 55322
export const FORBIDDEN_DEV_API_PORT = 54321
export const FORBIDDEN_DEV_DB_PORT = 54322
export const EXPECTED_TEST_DB_CONTAINER = `supabase_db_${EXPECTED_TEST_PROJECT_ID}`
export const FORBIDDEN_DEV_DB_CONTAINER = `supabase_db_${FORBIDDEN_DEV_PROJECT_ID}`

/** Files that indicate a remote Supabase project link — refuse if present in the test workdir. */
export const REMOTE_LINK_TEMP_FILES = [
  'project-ref',
  'linked-project.json',
  'pooler-url',
]

/** Env vars that can redirect the Supabase CLI or DB connection away from the local test stack. */
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

const LOCK_DIR_NAME = 'a-la-nantaise-sql-test'
const LOCK_FILE_NAME = 'test-sql-local.lock'

export function parseTomlScalar(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?$`, 'm'))
  return match?.[1] ?? null
}

export function parseSectionPort(toml, sectionName) {
  const blockMatch = toml.match(new RegExp(`\\[${sectionName}\\][\\s\\S]*?(?=\\n\\[|$)`))
  const portMatch = blockMatch?.[0]?.match(/^port\s*=\s*(\d+)$/m)
  return Number(portMatch?.[1] ?? NaN)
}

export function parseTestSupabaseConfig(configPath = testConfigPath) {
  if (!existsSync(configPath)) {
    throw new Error(
      `Configuration de test absente: ${configPath}. La stack SQL de test est mal initialisée.`,
    )
  }

  const toml = readFileSync(configPath, 'utf8')
  const projectId = parseTomlScalar(toml, 'project_id')
  const apiPort = parseSectionPort(toml, 'api')
  const dbPort = parseSectionPort(toml, 'db')

  if (!projectId || !Number.isFinite(apiPort) || !Number.isFinite(dbPort)) {
    throw new Error(
      'Configuration de test ambiguë: project_id, [api].port ou [db].port manquant.',
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

export function assertTestSupabaseTarget(config = parseTestSupabaseConfig()) {
  if (!config?.projectId) {
    throw new Error('project_id manquant dans la configuration de test Supabase.')
  }

  if (config.projectId === FORBIDDEN_DEV_PROJECT_ID) {
    throw new Error(
      `Refus: project_id de développement (${FORBIDDEN_DEV_PROJECT_ID}) interdit pour les tests SQL.`,
    )
  }

  if (config.projectId !== EXPECTED_TEST_PROJECT_ID) {
    throw new Error(
      `Refus: project_id de test attendu "${EXPECTED_TEST_PROJECT_ID}", reçu "${config.projectId}".`,
    )
  }

  if (config.apiHost !== '127.0.0.1') {
    throw new Error(
      `Refus: cible API non locale (${config.apiHost}:${config.apiPort}).`,
    )
  }

  if (config.apiPort === FORBIDDEN_DEV_API_PORT) {
    throw new Error(
      `Refus: port API de développement (${FORBIDDEN_DEV_API_PORT}) interdit pour les tests SQL.`,
    )
  }

  if (config.apiPort !== EXPECTED_TEST_API_PORT) {
    throw new Error(
      `Refus: port API de test attendu ${EXPECTED_TEST_API_PORT}, reçu ${config.apiPort}.`,
    )
  }

  if (config.dbHost !== '127.0.0.1') {
    throw new Error(
      `Refus: cible DB non locale (${config.dbHost}:${config.dbPort}).`,
    )
  }

  if (config.dbPort === FORBIDDEN_DEV_DB_PORT) {
    throw new Error(
      `Refus: port DB de développement (${FORBIDDEN_DEV_DB_PORT}) interdit pour les tests SQL.`,
    )
  }

  if (config.dbPort !== EXPECTED_TEST_DB_PORT) {
    throw new Error(
      `Refus: port DB de test attendu ${EXPECTED_TEST_DB_PORT}, reçu ${config.dbPort}.`,
    )
  }

  const containerName = getDbContainerName(config.projectId)
  if (containerName === FORBIDDEN_DEV_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur de développement (${FORBIDDEN_DEV_DB_CONTAINER}) interdit.`,
    )
  }

  if (containerName !== EXPECTED_TEST_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur de test attendu "${EXPECTED_TEST_DB_CONTAINER}", reçu "${containerName}".`,
    )
  }

  return { ...config, containerName }
}

export function assertNoRemoteLinkInTestTemp(tempDir = join(testSupabaseDir, '.temp')) {
  if (!existsSync(tempDir)) {
    return
  }

  const present = REMOTE_LINK_TEMP_FILES.filter((name) =>
    existsSync(join(tempDir, name)),
  )

  if (present.length > 0) {
    throw new Error(
      `Refus: fichiers de liaison distante détectés dans la stack de test (${present.join(', ')}). ` +
        'Ne jamais copier supabase/.temp vers supabase-test.',
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
      `Refus: la variable d'environnement ${key} est définie et pourrait rediriger la CLI/connexion ` +
        'hors de la stack de test locale. Retire-la avant npm run test:sql:local.',
    )
  }
}

export function assertArgsHaveNoLinked(args) {
  if (args.some((arg) => arg === '--linked' || String(arg).startsWith('--linked='))) {
    throw new Error('Refus: --linked est interdit pour les commandes de la stack de test.')
  }
}

export function defaultLockPath() {
  return join(tmpdir(), LOCK_DIR_NAME, LOCK_FILE_NAME)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && error.code === 'EPERM'
  }
}

export function acquireSqlTestLock(lockPath = defaultLockPath()) {
  mkdirSync(dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(fd, `${process.pid}\n`)
      } finally {
        closeSync(fd)
      }

      return {
        lockPath,
        release() {
          try {
            const current = readFileSync(lockPath, 'utf8').trim()
            if (current === String(process.pid)) {
              unlinkSync(lockPath)
            }
          } catch (error) {
            if (error?.code !== 'ENOENT') {
              throw error
            }
          }
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      let ownerPid = NaN
      try {
        ownerPid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
      } catch {
        ownerPid = NaN
      }

      if (!isProcessAlive(ownerPid)) {
        try {
          unlinkSync(lockPath)
          continue
        } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') {
            throw unlinkError
          }
          continue
        }
      }

      throw new Error(
        `Une autre exécution de npm run test:sql:local est déjà en cours ` +
          `(pid ${ownerPid}, verrou ${lockPath}).`,
      )
    }
  }

  throw new Error(
    `Impossible d'acquérir le verrou SQL local (${lockPath}). Réessaie dans un instant.`,
  )
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

export function assertResolvedTestContainer(containerName = EXPECTED_TEST_DB_CONTAINER) {
  if (containerName === FORBIDDEN_DEV_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur de développement (${FORBIDDEN_DEV_DB_CONTAINER}) interdit.`,
    )
  }

  if (containerName !== EXPECTED_TEST_DB_CONTAINER) {
    throw new Error(
      `Refus: conteneur résolu "${containerName}" n'est pas "${EXPECTED_TEST_DB_CONTAINER}".`,
    )
  }

  if (!isDbContainerRunning(containerName)) {
    throw new Error(
      `Conteneur de test ${containerName} introuvable après démarrage. ` +
        'Vérifie Docker et npm run supabase:test:status.',
    )
  }

  return containerName
}

export function runSupabaseTest(args, options = {}) {
  assertArgsHaveNoLinked(args)

  if (args.includes('push') || (args.includes('db') && args.includes('push'))) {
    throw new Error('Refus: supabase db push est interdit dans les scripts de test.')
  }

  const fullArgs = ['--workdir', testWorkdir, ...args]
  assertArgsHaveNoLinked(fullArgs)

  return execFileSync('supabase', fullArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Keep telemetry from failing the run in restricted environments.
      SUPABASE_INTERNAL_NO_TELEMETRY: '1',
    },
    ...options,
  })
}

export function listSqlTestFiles(testsDir = sqlTestsDir) {
  if (!existsSync(testsDir)) {
    throw new Error(`Répertoire ${testsDir} introuvable.`)
  }

  return readdirSync(testsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(testsDir, name))
}

export function runSqlFileInContainer(containerName, filePath) {
  assertResolvedTestContainer(containerName)
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

export function prepareTestTarget() {
  assertSafeCliEnvironment()
  assertNoRemoteLinkInTestTemp()
  const config = assertTestSupabaseTarget()
  return config
}
