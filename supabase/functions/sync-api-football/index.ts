import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0'
import {
  apiFootballGet,
  ApiFootballError,
  fixtureToShadowPayload,
  normalizeCompetitionsForTeam,
  normalizeFixtureItem,
  normalizeTeamSearchResults,
  type FetchLike,
  type NormalizedFixtureDetail,
} from '../_shared/apiFootballClient.ts'
import {
  decideSyncTick,
  planFixtureMatchLink,
  type LocalMatchRow,
  type LocalProviderFixtureRow,
} from '../_shared/apiFootballSyncPlan.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-api-football-cron-secret',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function publicError(code: string, message: string, status = 400): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status)
}

function frenchMessage(code: string): string {
  switch (code) {
    case 'PROVIDER_DISABLED':
      return 'L’intégration API-Football est désactivée.'
    case 'PROVIDER_KEY_MISSING':
      return 'La clé API-Football n’est pas configurée.'
    case 'PROVIDER_QUOTA_EXHAUSTED':
      return 'Quota API-Football insuffisant pour aujourd’hui.'
    case 'PROVIDER_RATE_LIMITED':
      return 'Limite de débit API-Football atteinte. Réessaie plus tard.'
    case 'PROVIDER_TIMEOUT':
      return 'Délai dépassé lors de l’appel API-Football.'
    case 'PROVIDER_SYNC_COOLDOWN':
      return 'Synchronisation manuelle trop fréquente.'
    case 'INVALID_ADMIN_SESSION':
      return 'Session administrateur invalide ou expirée.'
    case 'TEAM_NOT_CONFIGURED':
      return 'Équipe suivie non configurée. Vérifie-la d’abord.'
    case 'NO_COMPETITIONS':
      return 'Aucune compétition suivie n’est configurée.'
    default:
      return 'La synchronisation API-Football a échoué.'
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) return false
  let out = 0
  for (let i = 0; i < aa.length; i++) out |= aa[i]! ^ bb[i]!
  return out === 0
}

function cleanError(error: unknown): { code: string; message: string } {
  if (error instanceof ApiFootballError) {
    return { code: error.code, message: frenchMessage(error.code) }
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Erreur inconnue'
  for (const code of [
    'PROVIDER_DISABLED',
    'PROVIDER_QUOTA_EXHAUSTED',
    'PROVIDER_SYNC_COOLDOWN',
    'INVALID_ADMIN_SESSION',
    'TEAM_NOT_CONFIGURED',
    'NO_COMPETITIONS',
  ]) {
    if (message.includes(code)) {
      return { code, message: frenchMessage(code) }
    }
  }
  return { code: 'SYNC_FAILED', message: frenchMessage('SYNC_FAILED') }
}

async function reserveCall(
  admin: SupabaseClient,
  endpoint: string,
  origin: string,
): Promise<string> {
  const { data, error } = await admin.rpc('provider_reserve_api_call', {
    p_endpoint: endpoint,
    p_origin: origin,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const callId = row?.out_call_id ?? row?.call_id
  if (!callId) throw new Error('PROVIDER_QUOTA_EXHAUSTED')
  return String(callId)
}

async function finalizeCall(
  admin: SupabaseClient,
  callId: string,
  status: 'consumed' | 'released' | 'failed',
  meta: {
    httpStatus?: number | null
    remaining?: number | null
    limit?: number | null
    durationMs?: number | null
    errorCode?: string | null
    errorMessage?: string | null
    reportedCurrent?: number | null
    reportedLimit?: number | null
  } = {},
): Promise<void> {
  await admin.rpc('provider_finalize_api_call', {
    p_call_id: callId,
    p_status: status,
    p_http_status: meta.httpStatus ?? null,
    p_rate_limit_remaining: meta.remaining ?? null,
    p_rate_limit_limit: meta.limit ?? null,
    p_duration_ms: meta.durationMs ?? null,
    p_error_code: meta.errorCode ?? null,
    p_error_message: meta.errorMessage ?? null,
    p_provider_reported_current: meta.reportedCurrent ?? null,
    p_provider_reported_limit: meta.reportedLimit ?? null,
  })
}

async function guardedApiGet<T>(
  admin: SupabaseClient,
  apiKey: string,
  origin: string,
  path: string,
  query: Record<string, string | number | undefined | null>,
  fetchImpl?: FetchLike,
): Promise<T> {
  const endpoint = `${path}?${JSON.stringify(query)}`
  const callId = await reserveCall(admin, endpoint.slice(0, 200), origin)
  try {
    const result = await apiFootballGet<T>({
      apiKey,
      path,
      query,
      fetchImpl,
    })
    await finalizeCall(admin, callId, 'consumed', {
      httpStatus: result.httpStatus,
      remaining: result.rateLimits.remaining,
      limit: result.rateLimits.limit,
      durationMs: result.durationMs,
      reportedCurrent: result.rateLimits.reportedCurrent,
      reportedLimit: result.rateLimits.reportedLimit,
    })
    return result.data
  } catch (error) {
    const code = error instanceof ApiFootballError ? error.code : 'SYNC_FAILED'
    const httpStatus =
      error instanceof ApiFootballError ? error.httpStatus : null
    // Si l’appel n’a pas atteint le fournisseur (ex. quota local déjà OK mais abort), release.
    const status =
      code === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_KEY_MISSING'
        ? 'released'
        : httpStatus
          ? 'failed'
          : 'released'
    await finalizeCall(admin, callId, status, {
      httpStatus,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function upsertShadowFixtures(
  admin: SupabaseClient,
  fixtures: NormalizedFixtureDetail[],
  context: {
    matches: LocalMatchRow[]
    providerFixtures: LocalProviderFixtureRow[]
    seasonId: string | null
  },
): Promise<{ upserted: number; conflicts: number }> {
  let upserted = 0
  let conflicts = 0

  for (const fixture of fixtures) {
    const link = planFixtureMatchLink(
      fixture,
      context.matches,
      context.providerFixtures,
    )

    if (link.conflict) {
      conflicts += 1
      await admin.rpc('provider_record_sync_conflict', {
        p_external_fixture_id: link.conflict.externalId,
        p_reason: link.conflict.reason,
        p_candidate_match_ids: link.conflict.candidateIds,
        p_payload: fixtureToShadowPayload(fixture),
      })
    }

    await admin.rpc('provider_upsert_fixture_shadow', {
      p_fixture: fixtureToShadowPayload(fixture, {
        season_id: context.seasonId,
        match_id: link.matchId,
        sync_state: link.conflict ? 'conflict' : 'synced',
      }),
    })
    upserted += 1
  }

  return { upserted, conflicts }
}

async function syncCalendar(
  admin: SupabaseClient,
  apiKey: string,
  origin: string,
  context: Record<string, unknown>,
  fetchImpl?: FetchLike,
) {
  const settings = context.settings as Record<string, unknown>
  const teamId = settings.tracked_team_external_id as number | null
  const seasonYear = settings.active_season_year as number | null
  const competitions = (context.competitions as Array<Record<string, unknown>>) ?? []
  const matches = (context.matches as LocalMatchRow[]) ?? []
  const providerFixtures =
    (context.provider_fixtures as LocalProviderFixtureRow[]) ?? []
  const seasonId = (context.active_season_id as string | null) ?? null

  if (!teamId) throw new Error('TEAM_NOT_CONFIGURED')
  const enabled = competitions.filter((c) => c.enabled !== false)
  if (enabled.length === 0) throw new Error('NO_COMPETITIONS')

  const all: NormalizedFixtureDetail[] = []
  for (const competition of enabled) {
    const leagueId = Number(competition.external_league_id)
    const year = Number(competition.external_season_year ?? seasonYear)
    const raw = await guardedApiGet<unknown>(
      admin,
      apiKey,
      origin,
      '/fixtures',
      { team: teamId, league: leagueId, season: year },
      fetchImpl,
    )
    for (const item of Array.isArray(raw) ? raw : []) {
      try {
        all.push(normalizeFixtureItem(item, { includeEvents: false, includeLineups: false }))
      } catch {
        // Ignore fixtures partielles dans le calendrier.
      }
    }
  }

  return upsertShadowFixtures(admin, all, {
    matches,
    providerFixtures,
    seasonId,
  })
}

async function syncSingleFixture(
  admin: SupabaseClient,
  apiKey: string,
  origin: string,
  externalFixtureId: string,
  context: Record<string, unknown>,
  fetchImpl?: FetchLike,
) {
  const raw = await guardedApiGet<unknown>(
    admin,
    apiKey,
    origin,
    '/fixtures',
    { id: externalFixtureId },
    fetchImpl,
  )
  const item = Array.isArray(raw) ? raw[0] : null
  if (!item) {
    return { upserted: 0, conflicts: 0 }
  }
  const fixture = normalizeFixtureItem(item, {
    includeEvents: true,
    includeLineups: true,
    includeStatistics: true,
    includePlayers: true,
  })
  return upsertShadowFixtures(admin, [fixture], {
    matches: (context.matches as LocalMatchRow[]) ?? [],
    providerFixtures:
      (context.provider_fixtures as LocalProviderFixtureRow[]) ?? [],
    seasonId: (context.active_season_id as string | null) ?? null,
  })
}

async function discoverTeamAndCompetitions(
  admin: SupabaseClient,
  apiKey: string,
  origin: string,
  searchName: string,
  fetchImpl?: FetchLike,
) {
  const teamsRaw = await guardedApiGet<unknown>(
    admin,
    apiKey,
    origin,
    '/teams',
    { search: searchName },
    fetchImpl,
  )
  const teams = normalizeTeamSearchResults(teamsRaw)
  const exact =
    teams.find((t) => t.name.toLowerCase() === searchName.toLowerCase()) ??
    teams[0]
  if (!exact) {
    return { teams, competitions: [] as ReturnType<typeof normalizeCompetitionsForTeam> }
  }

  const leaguesRaw = await guardedApiGet<unknown>(
    admin,
    apiKey,
    origin,
    '/leagues',
    { team: exact.externalId },
    fetchImpl,
  )
  const competitions = normalizeCompetitionsForTeam(leaguesRaw)

  await admin.rpc('provider_set_tracked_team', {
    p_external_id: exact.externalId,
    p_name: exact.name,
    p_season_year:
      competitions.sort((a, b) => b.seasonYear - a.seasonYear)[0]?.seasonYear ??
      null,
  })

  for (const competition of competitions) {
    await admin.rpc('provider_update_coverage', {
      p_external_league_id: competition.externalLeagueId,
      p_external_season_year: competition.seasonYear,
      p_name: competition.name,
      p_country: competition.country,
      p_competition_type: competition.type,
      p_coverage_events: competition.coverage.events,
      p_coverage_lineups: competition.coverage.lineups,
      p_coverage_statistics_fixtures: competition.coverage.statisticsFixtures,
      p_coverage_statistics_players: competition.coverage.statisticsPlayers,
      p_coverage_accessible: true,
    })
  }

  return { teams, selected: exact, competitions }
}

async function refreshCoverage(
  admin: SupabaseClient,
  apiKey: string,
  origin: string,
  context: Record<string, unknown>,
  fetchImpl?: FetchLike,
) {
  const settings = context.settings as Record<string, unknown>
  const teamId = settings.tracked_team_external_id as number | null
  if (!teamId) throw new Error('TEAM_NOT_CONFIGURED')

  const leaguesRaw = await guardedApiGet<unknown>(
    admin,
    apiKey,
    origin,
    '/leagues',
    { team: teamId },
    fetchImpl,
  )
  const competitions = normalizeCompetitionsForTeam(leaguesRaw)
  let updated = 0
  for (const competition of competitions) {
    await admin.rpc('provider_update_coverage', {
      p_external_league_id: competition.externalLeagueId,
      p_external_season_year: competition.seasonYear,
      p_name: competition.name,
      p_country: competition.country,
      p_competition_type: competition.type,
      p_coverage_events: competition.coverage.events,
      p_coverage_lineups: competition.coverage.lineups,
      p_coverage_statistics_fixtures: competition.coverage.statisticsFixtures,
      p_coverage_statistics_players: competition.coverage.statisticsPlayers,
      p_coverage_accessible: true,
    })
    updated += 1
  }
  return { updated, competitions }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return publicError('METHOD_NOT_ALLOWED', 'Méthode non autorisée.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const apiKey = Deno.env.get('API_FOOTBALL_KEY') ?? ''
  const cronSecret = Deno.env.get('API_FOOTBALL_CRON_SECRET') ?? ''

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return publicError('SERVER_MISCONFIGURED', 'Configuration serveur incomplète.', 500)
  }

  let body: {
    mode?: string
    admin_session_token?: string
    team_search?: string
    fixture_id?: string
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return publicError('INVALID_INPUT', 'Corps de requête invalide.')
  }

  const mode = (body.mode ?? 'tick').trim()
  const cronHeader = req.headers.get('x-api-football-cron-secret') ?? ''
  const isCron =
    Boolean(cronSecret) &&
    Boolean(cronHeader) &&
    timingSafeEqual(cronHeader, cronSecret)
  const adminToken =
    typeof body.admin_session_token === 'string'
      ? body.admin_session_token.trim()
      : ''

  if (!isCron && !adminToken) {
    return publicError('INVALID_ADMIN_SESSION', frenchMessage('INVALID_ADMIN_SESSION'), 401)
  }

  if (!isCron && mode === 'tick') {
    // tick réservé au cron authentifié
    return publicError('INVALID_INPUT', 'Mode tick réservé aux tâches planifiées.', 403)
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (!isCron) {
      const { data: ok, error } = await anon.rpc('verify_admin_code', {
        p_admin_session_token: adminToken,
      })
      if (error || !ok) {
        return publicError(
          'INVALID_ADMIN_SESSION',
          frenchMessage('INVALID_ADMIN_SESSION'),
          401,
        )
      }
      if (mode === 'manual' || mode === 'discover' || mode === 'coverage') {
        const { error: cooldownError } = await anon.rpc(
          'admin_begin_provider_manual_sync',
          {
            p_admin_session_token: adminToken,
            p_cooldown_seconds: 30,
          },
        )
        if (cooldownError) {
          const cleaned = cleanError(cooldownError)
          return publicError(cleaned.code, cleaned.message, 429)
        }
      }
    }

    if (!apiKey.trim()) {
      return publicError('PROVIDER_KEY_MISSING', frenchMessage('PROVIDER_KEY_MISSING'), 503)
    }

    const { data: context, error: contextError } = await admin.rpc(
      'provider_get_sync_context',
    )
    if (contextError) throw contextError
    const ctx = (context ?? {}) as Record<string, unknown>
    const settings = (ctx.settings ?? {}) as Record<string, unknown>

    if (settings.integration_enabled === false) {
      return publicError('PROVIDER_DISABLED', frenchMessage('PROVIDER_DISABLED'))
    }

    // Shadow branch: never apply public cutover even if misconfigured.
    if (settings.public_provider_enabled === true) {
      console.error('public_provider_enabled unexpectedly true; forcing shadow behavior')
    }

    const origin = isCron ? 'cron' : mode === 'discover' ? 'discover' : mode === 'coverage' ? 'coverage_check' : 'admin_manual'
    const quota = (ctx.quota ?? {}) as Record<string, unknown>
    const remainingUsable = Number(quota.remaining_usable ?? 0)

    if (mode === 'discover') {
      const search =
        typeof body.team_search === 'string' && body.team_search.trim()
          ? body.team_search.trim()
          : 'Nantes'
      const result = await discoverTeamAndCompetitions(
        admin,
        apiKey,
        origin,
        search,
      )
      return jsonResponse({
        ok: true,
        mode,
        shadow: true,
        public_provider_enabled: false,
        ...result,
      })
    }

    if (mode === 'coverage') {
      const result = await refreshCoverage(admin, apiKey, origin, ctx)
      return jsonResponse({
        ok: true,
        mode,
        shadow: true,
        ...result,
      })
    }

    if (mode === 'manual' || mode === 'calendar') {
      if (remainingUsable < 1) {
        return publicError(
          'PROVIDER_QUOTA_EXHAUSTED',
          frenchMessage('PROVIDER_QUOTA_EXHAUSTED'),
          429,
        )
      }
      const result = await syncCalendar(admin, apiKey, origin, ctx)
      await admin.rpc('provider_set_next_scheduled_call', {
        p_next_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
      console.log('api-football sync calendar', {
        upserted: result.upserted,
        conflicts: result.conflicts,
        remainingUsable,
      })
      return jsonResponse({
        ok: true,
        mode,
        shadow: true,
        public_provider_enabled: false,
        applied_to_matches: false,
        ...result,
      })
    }

    if (mode === 'fixture' && body.fixture_id) {
      const result = await syncSingleFixture(
        admin,
        apiKey,
        origin,
        String(body.fixture_id),
        ctx,
      )
      return jsonResponse({
        ok: true,
        mode,
        shadow: true,
        applied_to_matches: false,
        ...result,
      })
    }

    // mode === 'tick'
    const providerFixtures =
      (ctx.provider_fixtures as LocalProviderFixtureRow[]) ?? []
    const decision = decideSyncTick({
      remainingUsable,
      lastCoverageCheckAt: (settings.last_coverage_check_at as string | null) ?? null,
      providerFixtures,
      calendarSyncedToday: providerFixtures.some((f) => {
        if (!f.last_synced_at) return false
        return (
          f.last_synced_at.slice(0, 10) ===
          new Date().toISOString().slice(0, 10)
        )
      }),
    })

    await admin.rpc('provider_set_next_scheduled_call', {
      p_next_at: decision.nextScheduledCallAt,
    })

    if (!decision.shouldCallExternal) {
      return jsonResponse({
        ok: true,
        mode: 'tick',
        skipped: true,
        decision,
        shadow: true,
      })
    }

    let result: { upserted: number; conflicts: number } | { updated: number } = {
      upserted: 0,
      conflicts: 0,
    }

    if (decision.phase === 'daily_calendar') {
      result = await syncCalendar(admin, apiKey, 'cron', ctx)
    } else if (decision.phase === 'coverage') {
      result = await refreshCoverage(admin, apiKey, 'cron', ctx)
    } else if (decision.targetExternalFixtureId) {
      result = await syncSingleFixture(
        admin,
        apiKey,
        'cron',
        decision.targetExternalFixtureId,
        ctx,
      )
    }

    console.log('api-football tick', {
      phase: decision.phase,
      reason: decision.reason,
      result,
    })

    return jsonResponse({
      ok: true,
      mode: 'tick',
      skipped: false,
      decision,
      shadow: true,
      public_provider_enabled: false,
      applied_to_matches: false,
      result,
    })
  } catch (error) {
    console.error('sync-api-football failed', {
      name: error instanceof Error ? error.name : 'error',
      code: error instanceof ApiFootballError ? error.code : 'SYNC_FAILED',
    })
    const cleaned = cleanError(error)
    const status =
      cleaned.code === 'INVALID_ADMIN_SESSION'
        ? 401
        : cleaned.code === 'PROVIDER_QUOTA_EXHAUSTED' ||
            cleaned.code === 'PROVIDER_RATE_LIMITED' ||
            cleaned.code === 'PROVIDER_SYNC_COOLDOWN'
          ? 429
          : cleaned.code === 'PROVIDER_KEY_MISSING'
            ? 503
            : 400
    return publicError(cleaned.code, cleaned.message, status)
  }
})
