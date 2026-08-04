import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const INVALID_URL_LABEL = 'URL invalide'
const INVALID_HOSTNAME = 'invalide'

function parseDotenvFile(path) {
  if (!existsSync(path)) return {}

  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
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

function getEnvFileSequence(mode) {
  switch (mode) {
    case 'default':
      return ['.env']
    case 'local':
      return ['.env.local']
    case 'effective':
      return ['.env', '.env.local', '.env.development', '.env.development.local']
    default:
      throw new Error(`Mode invalide: ${mode}`)
  }
}

function getSourceLabel(mode) {
  switch (mode) {
    case 'default':
      return '.env'
    case 'local':
      return '.env.local'
    case 'effective':
      return 'process.env.VITE_SUPABASE_URL puis .env puis .env.local puis .env.development puis .env.development.local'
    default:
      throw new Error(`Mode invalide: ${mode}`)
  }
}

function loadEnvFiles(rootDir, mode) {
  const values = {}
  for (const fileName of getEnvFileSequence(mode)) {
    Object.assign(values, parseDotenvFile(join(rootDir, fileName)))
  }
  return values
}

function toSafeTarget(urlValue) {
  if (!urlValue) {
    return {
      label: 'configuration absente',
      origin: 'absent',
      hostname: 'absent',
    }
  }

  let parsed
  try {
    parsed = new URL(urlValue)
  } catch {
    return {
      label: INVALID_URL_LABEL,
      origin: INVALID_URL_LABEL,
      hostname: INVALID_HOSTNAME,
    }
  }

  const isLocalHost =
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1'

  return {
    label: isLocalHost ? 'Supabase local' : 'Supabase distant',
    origin: parsed.origin,
    hostname: parsed.hostname,
  }
}

export function diagnoseFrontendTarget(mode, options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir
  const values = loadEnvFiles(rootDir, mode)
  const processEnv = options.processEnv ?? process.env

  if (mode === 'effective' && typeof processEnv.VITE_SUPABASE_URL === 'string') {
    values.VITE_SUPABASE_URL = processEnv.VITE_SUPABASE_URL
  }

  return {
    mode,
    sourceLabel: getSourceLabel(mode),
    ...toSafeTarget(values.VITE_SUPABASE_URL ?? ''),
  }
}

function main() {
  const mode = process.argv[2] ?? 'effective'
  const rootDir = process.argv[3] ?? defaultRootDir
  const diagnostic = diagnoseFrontendTarget(mode, { rootDir })

  console.log(`Frontend ${mode}: ${diagnostic.label}`)
  console.log(`Source: ${diagnostic.sourceLabel}`)
  console.log(`URL: ${diagnostic.origin}`)
  console.log(`Hostname: ${diagnostic.hostname}`)

  if (diagnostic.origin === 'absent') {
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
