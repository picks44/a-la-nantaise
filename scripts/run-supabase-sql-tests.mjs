import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const supabaseDir = join(rootDir, 'supabase')
const configPath = join(supabaseDir, 'config.toml')
const testsDir = join(supabaseDir, 'tests')

function parseTomlScalar(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?$`, 'm'))
  return match?.[1] ?? null
}

function parseLocalSupabaseConfig() {
  const toml = readFileSync(configPath, 'utf8')
  const projectId = parseTomlScalar(toml, 'project_id')
  const apiBlockMatch = toml.match(/\[api\][\s\S]*?(?=\n\[|$)/)
  const apiPortMatch = apiBlockMatch?.[0]?.match(/^port\s*=\s*(\d+)$/m)
  const apiPort = Number(apiPortMatch?.[1] ?? NaN)
  const dbBlockMatch = toml.match(/\[db\][\s\S]*?(?=\n\[|$)/)
  const dbPortMatch = dbBlockMatch?.[0]?.match(/^port\s*=\s*(\d+)$/m)
  const dbPort = Number(dbPortMatch?.[1] ?? NaN)

  return {
    projectId,
    apiHost: '127.0.0.1',
    apiPort,
    dbHost: '127.0.0.1',
    dbPort,
  }
}

export function assertLocalSupabaseTarget(config = parseLocalSupabaseConfig()) {
  if (!config.projectId) {
    throw new Error('project_id manquant dans supabase/config.toml')
  }

  if (config.apiHost !== '127.0.0.1' || config.apiPort !== 54321) {
    throw new Error(
      `Refus de lancer les tests SQL: cible API non locale (${config.apiHost}:${config.apiPort}).`,
    )
  }

  if (config.dbHost !== '127.0.0.1' || config.dbPort !== 54322) {
    throw new Error(
      `Refus de lancer les tests SQL: cible DB non locale (${config.dbHost}:${config.dbPort}).`,
    )
  }

  return config
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  })
}

function getDbContainerName(projectId) {
  return `supabase_db_${projectId}`
}

function ensureLocalDbContainer(containerName) {
  const names = run('docker', ['ps', '--format', '{{.Names}}']).split(/\r?\n/).filter(Boolean)
  if (!names.includes(containerName)) {
    throw new Error(
      `Conteneur local ${containerName} introuvable. Lance d'abord \`supabase start\`.`,
    )
  }
}

function resetLocalDatabase() {
  process.stdout.write('Reset local database with migrations...\n')
  execFileSync(
    'supabase',
    ['db', 'reset', '--local', '--no-seed', '--yes'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      encoding: 'utf8',
    },
  )
}

function listSqlTests() {
  if (!existsSync(testsDir)) {
    throw new Error('Répertoire supabase/tests introuvable.')
  }

  return readdirSync(testsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(testsDir, name))
}

function runSqlFile(containerName, filePath) {
  const sql = readFileSync(filePath, 'utf8')
  execFileSync(
    'docker',
    ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', '-'],
    {
      cwd: rootDir,
      input: sql,
      stdio: ['pipe', 'inherit', 'inherit'],
      encoding: 'utf8',
    },
  )
}

function main() {
  const config = assertLocalSupabaseTarget()
  const containerName = getDbContainerName(config.projectId)
  ensureLocalDbContainer(containerName)
  resetLocalDatabase()

  const sqlTests = listSqlTests()
  process.stdout.write(
    `Running ${sqlTests.length} SQL test files against local Supabase ${config.apiHost}:${config.apiPort} / ${config.dbHost}:${config.dbPort}...\n`,
  )

  for (const filePath of sqlTests) {
    const relative = filePath.slice(rootDir.length + 1)
    process.stdout.write(`\n==> ${relative}\n`)
    runSqlFile(containerName, filePath)
  }

  process.stdout.write('\nAll local SQL tests passed.\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
