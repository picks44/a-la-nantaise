#!/usr/bin/env node
/**
 * Sync Fixture Download → matches on the local DEV stack only.
 * Default source: frozen JSON (tests/fixtures/ligue-2-2026-fc-nantes.json).
 * Optional: --live to fetch FIXTURE_FEED_URL.
 *
 * No reset. No predictions. No service_role. No --linked.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  FIXTURE_FEED_URL,
  validateFixtureFeed,
} from '../supabase/functions/_shared/fixtureDownload.ts'
import {
  planFixtureSync,
  syncPlanToRpcPayload,
} from '../supabase/functions/_shared/planFixtureSync.ts'
import {
  LOCAL_SEED_ADMIN_CODE,
  assertArgsHaveNoLinked,
  frozenFixturePath,
  prepareDevLocalTarget,
  resolveLocalAnonCredentials,
  runSupabaseDev,
} from './supabase-dev-guards.mjs'

const FETCH_TIMEOUT_MS = 12_000
const MAX_BODY_BYTES = 512_000

function parseFlags(argv) {
  return {
    live: argv.includes('--live'),
  }
}

function mapMatchRow(row) {
  return {
    id: String(row.id),
    externalId:
      row.external_id == null || row.external_id === ''
        ? null
        : String(row.external_id),
    source: String(row.source ?? 'manual'),
    roundNumber: Number(row.round_number),
    homeTeam: String(row.home_team),
    awayTeam: String(row.away_team),
    kickoffAt: String(row.kickoff_at),
    status: String(row.status),
    homeScore: row.home_score == null ? null : Number(row.home_score),
    awayScore: row.away_score == null ? null : Number(row.away_score),
    manualOverride: Boolean(row.manual_override),
  }
}

async function loadFixtures({ live }) {
  if (!live) {
    const raw = JSON.parse(readFileSync(frozenFixturePath, 'utf8'))
    return {
      fixtures: validateFixtureFeed(raw),
      sourceLabel: `frozen:${frozenFixturePath}`,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(FIXTURE_FEED_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'a-la-nantaise-local-sync/1.0',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`FEED_HTTP_ERROR (${response.status})`)
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BODY_BYTES) {
      throw new Error('FEED_TOO_LARGE')
    }
    const payload = JSON.parse(new TextDecoder().decode(buffer))
    return {
      fixtures: validateFixtureFeed(payload),
      sourceLabel: `live:${FIXTURE_FEED_URL}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function syncFixturesLocal(argv = process.argv.slice(2)) {
  assertArgsHaveNoLinked(argv)
  const flags = parseFlags(argv)
  const config = prepareDevLocalTarget({ requireRunning: true })

  const statusEnv = runSupabaseDev(['status', '-o', 'env'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const { supabaseUrl, anonKey } = resolveLocalAnonCredentials(statusEnv)

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { fixtures, sourceLabel } = await loadFixtures(flags)

  const { data: loginRows, error: loginError } = await supabase.rpc(
    'login_admin',
    { p_admin_code: LOCAL_SEED_ADMIN_CODE },
  )
  if (loginError) {
    throw new Error(`login_admin failed: ${loginError.message}`)
  }
  const sessionToken = loginRows?.[0]?.session_token
  if (!sessionToken) {
    throw new Error(
      'login_admin n’a pas renvoyé de session. Vérifie le seed local (ADMIN).',
    )
  }

  try {
    const { data: matchRows, error: matchesError } = await supabase.rpc(
      'admin_get_matches',
      { p_admin_session_token: sessionToken },
    )
    if (matchesError) {
      throw new Error(`admin_get_matches failed: ${matchesError.message}`)
    }

    const existing = (matchRows ?? []).map(mapMatchRow)
    const plan = planFixtureSync(existing, fixtures)

    if (plan.conflicts.length > 0) {
      const detail = plan.conflicts
        .map((c) => `${c.reason}:${c.externalId}`)
        .join(', ')
      throw new Error(`SYNC_CONFLICT: ${detail}`)
    }

    const { data: commitResult, error: commitError } = await supabase.rpc(
      'admin_commit_fixture_sync',
      {
        p_admin_session_token: sessionToken,
        p_plan: syncPlanToRpcPayload(plan),
      },
    )
    if (commitError) {
      throw new Error(`admin_commit_fixture_sync failed: ${commitError.message}`)
    }

    const result = {
      ok: true,
      sourceLabel,
      projectId: config.projectId,
      supabaseUrl,
      fixtureCount: fixtures.length,
      created: Number(commitResult?.created ?? plan.summary.created),
      updated: Number(commitResult?.updated ?? plan.summary.updated),
      unchanged: Number(commitResult?.unchanged ?? plan.summary.unchanged),
      conflicts: 0,
      predictionsCreated: 0,
    }

    process.stdout.write(
      [
        'FIXTURE_SYNC_LOCAL_OK',
        `source=${result.sourceLabel}`,
        `fixtures=${result.fixtureCount}`,
        `created=${result.created}`,
        `updated=${result.updated}`,
        `unchanged=${result.unchanged}`,
        'predictions=0',
      ].join(' ') + '\n',
    )

    return result
  } finally {
    // supabase.rpc() returns a builder/PromiseLike without .catch(); use await + try.
    try {
      await supabase.rpc('logout_admin', {
        p_admin_session_token: sessionToken,
      })
    } catch {
      // best-effort session cleanup
    }
  }
}

if (process.argv[1]?.endsWith('sync-fixtures-local.mjs')) {
  syncFixturesLocal(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
