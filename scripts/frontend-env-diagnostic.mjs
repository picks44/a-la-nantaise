import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

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
      label: 'URL invalide',
      origin: urlValue,
      hostname: 'invalide',
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

export function diagnoseFrontendTarget(mode) {
  const envPath = join(rootDir, '.env')
  const envLocalPath = join(rootDir, '.env.local')
  const envDefault = parseDotenvFile(envPath)
  const envLocal = parseDotenvFile(envLocalPath)

  let sourceLabel
  let values

  switch (mode) {
    case 'default':
      sourceLabel = '.env'
      values = envDefault
      break
    case 'local':
      sourceLabel = '.env.local'
      values = envLocal
      break
    case 'effective':
      sourceLabel = '.env puis .env.local (prioritaire)'
      values = { ...envDefault, ...envLocal }
      break
    default:
      throw new Error(`Mode invalide: ${mode}`)
  }

  return {
    mode,
    sourceLabel,
    url: values.VITE_SUPABASE_URL ?? '',
    ...toSafeTarget(values.VITE_SUPABASE_URL ?? ''),
  }
}

function main() {
  const mode = process.argv[2] ?? 'effective'
  const diagnostic = diagnoseFrontendTarget(mode)

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
