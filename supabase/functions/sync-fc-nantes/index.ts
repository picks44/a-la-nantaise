import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0'
import {
  FIXTURE_FEED_URL,
  FixtureValidationError,
  validateFixtureFeed,
} from '../_shared/fixtureDownload.ts'
import {
  planFixtureSync,
  syncPlanToRpcPayload,
  type SyncMatchRow,
} from '../_shared/planFixtureSync.ts'

const FETCH_TIMEOUT_MS = 12_000
const MAX_BODY_BYTES = 512_000

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
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

function cleanClientError(error: unknown): { code: string; message: string } {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Erreur inconnue'

  const known = [
    'INVALID_ADMIN_CODE',
    'ADMIN_CODE_NOT_CONFIGURED',
    'INVALID_SYNC_PLAN',
    'SYNC_CONFLICT',
    'INVALID_FEED_SHAPE',
    'INVALID_FEED_COUNT',
    'DUPLICATE_ROUND',
    'MISSING_ROUND',
    'INVALID_NANTES_FIXTURE',
    'INCOMPLETE_RESULT',
    'INVALID_FIXTURE_DATE',
    'INVALID_FIXTURE_SCORE',
    'FEED_HTTP_ERROR',
    'FEED_TIMEOUT',
    'FEED_TOO_LARGE',
    'FEED_NOT_JSON',
  ]

  for (const code of known) {
    if (message.includes(code)) {
      return { code, message: frenchMessage(code) }
    }
  }

  if (error instanceof FixtureValidationError) {
    return { code: error.code, message: error.message }
  }

  return {
    code: 'SYNC_FAILED',
    message: 'La synchronisation a échoué. Réessaie plus tard.',
  }
}

function frenchMessage(code: string): string {
  switch (code) {
    case 'INVALID_ADMIN_CODE':
      return 'Code administrateur incorrect.'
    case 'ADMIN_CODE_NOT_CONFIGURED':
      return 'Le code administrateur n’est pas encore configuré.'
    case 'SYNC_CONFLICT':
      return 'Conflit de rapprochement : plusieurs matchs correspondent à la même rencontre.'
    case 'INVALID_FEED_COUNT':
      return 'Le flux ne contient pas exactement 34 matchs.'
    case 'DUPLICATE_ROUND':
      return 'Le flux contient des journées dupliquées.'
    case 'MISSING_ROUND':
      return 'Le flux ne couvre pas toutes les journées 1 à 34.'
    case 'INVALID_NANTES_FIXTURE':
      return 'Un match du flux ne contient pas exactement le FC Nantes.'
    case 'INCOMPLETE_RESULT':
      return 'Le flux contient un score incomplet.'
    case 'FEED_HTTP_ERROR':
      return 'Impossible de télécharger le calendrier Fixture Download.'
    case 'FEED_TIMEOUT':
      return 'Délai dépassé lors du téléchargement du calendrier.'
    case 'FEED_TOO_LARGE':
      return 'La réponse du calendrier est trop volumineuse.'
    case 'FEED_NOT_JSON':
      return 'La réponse du calendrier n’est pas un JSON valide.'
    default:
      return 'La synchronisation a échoué.'
  }
}

async function fetchFixtureFeed(): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(FIXTURE_FEED_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'a-la-nantaise-sync/1.0',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new FixtureValidationError(
        'FEED_HTTP_ERROR',
        `FEED_HTTP_ERROR (${response.status})`,
      )
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BODY_BYTES) {
      throw new FixtureValidationError(
        'FEED_TOO_LARGE',
        'FEED_TOO_LARGE',
      )
    }

    const text = new TextDecoder().decode(buffer)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new FixtureValidationError('FEED_NOT_JSON', 'FEED_NOT_JSON')
    }
  } catch (error) {
    if (error instanceof FixtureValidationError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FixtureValidationError('FEED_TIMEOUT', 'FEED_TIMEOUT')
    }
    throw new FixtureValidationError(
      'FEED_HTTP_ERROR',
      'FEED_HTTP_ERROR',
    )
  } finally {
    clearTimeout(timer)
  }
}

function mapMatchRow(row: Record<string, unknown>): SyncMatchRow {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return publicError('METHOD_NOT_ALLOWED', 'Méthode non autorisée.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    return publicError(
      'SERVER_MISCONFIGURED',
      'Configuration serveur incomplète.',
      500,
    )
  }

  let adminCode = ''
  try {
    const body = (await req.json()) as { admin_code?: unknown; p_admin_code?: unknown }
    const raw = body.admin_code ?? body.p_admin_code
    adminCode = typeof raw === 'string' ? raw : ''
  } catch {
    return publicError('INVALID_INPUT', 'Corps de requête invalide.')
  }

  if (!adminCode.trim()) {
    return publicError('INVALID_ADMIN_CODE', 'Code administrateur incorrect.')
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  try {
    // 1. Vérifier le code admin AVANT tout appel externe.
    const { data: adminOk, error: adminError } = await supabase.rpc(
      'verify_admin_code',
      { p_admin_code: adminCode },
    )

    if (adminError) {
      const cleaned = cleanClientError(adminError)
      return publicError(cleaned.code, cleaned.message, 401)
    }

    if (!adminOk) {
      return publicError(
        'INVALID_ADMIN_CODE',
        'Code administrateur incorrect.',
        401,
      )
    }

    // 2. Télécharger et valider le flux (tout-ou-rien).
    const payload = await fetchFixtureFeed()
    const fixtures = validateFixtureFeed(payload)

    // 3. Charger les matchs existants puis planifier.
    const { data: matchRows, error: matchesError } = await supabase.rpc(
      'admin_get_matches',
      { p_admin_code: adminCode },
    )

    if (matchesError) {
      const cleaned = cleanClientError(matchesError)
      return publicError(cleaned.code, cleaned.message)
    }

    const existing = ((matchRows as Record<string, unknown>[]) ?? []).map(
      mapMatchRow,
    )
    const plan = planFixtureSync(existing, fixtures)

    if (plan.conflicts.length > 0) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: 'SYNC_CONFLICT',
            message: frenchMessage('SYNC_CONFLICT'),
          },
          conflicts: plan.conflicts,
          summary: plan.summary,
        },
        409,
      )
    }

    // 4. Écritures atomiques côté Postgres.
    const { data: commitResult, error: commitError } = await supabase.rpc(
      'admin_commit_fixture_sync',
      {
        p_admin_code: adminCode,
        p_plan: syncPlanToRpcPayload(plan),
      },
    )

    if (commitError) {
      const cleaned = cleanClientError(commitError)
      return publicError(cleaned.code, cleaned.message)
    }

    const result = (commitResult ?? {}) as Record<string, unknown>

    return jsonResponse({
      ok: true,
      source: 'Fixture Download',
      feed_url: FIXTURE_FEED_URL,
      fixture_count: fixtures.length,
      created: Number(result.created ?? plan.summary.created),
      updated: Number(result.updated ?? plan.summary.updated),
      unchanged: Number(result.unchanged ?? plan.summary.unchanged),
      new_results: Number(result.new_results ?? plan.summary.newResults),
      points_recalculated: Number(result.points_recalculated ?? 0),
      conflicts: [],
      protected: Number(result.protected ?? plan.summary.protected),
      protected_details: plan.updates
        .filter((item) => item.protected)
        .map((item) => ({
          id: item.id,
          external_id: item.external_id,
          drift_teams: item.drift_teams,
          drift_kickoff: item.drift_kickoff,
          drift_result: item.drift_result,
        })),
      last_synced_at: result.last_synced_at ?? plan.synced_at,
    })
  } catch (error) {
    // Ne jamais journaliser le code administrateur.
    console.error('sync-fc-nantes failed', {
      name: error instanceof Error ? error.name : 'error',
      code:
        error instanceof FixtureValidationError ? error.code : 'SYNC_FAILED',
    })
    const cleaned = cleanClientError(error)
    const status =
      cleaned.code === 'INVALID_ADMIN_CODE' ||
      cleaned.code === 'ADMIN_CODE_NOT_CONFIGURED'
        ? 401
        : 400
    return publicError(cleaned.code, cleaned.message, status)
  }
})
