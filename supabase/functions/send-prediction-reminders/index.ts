import { createClient } from '@supabase/supabase-js'
import { type ReminderClaim } from '../_shared/pushReminderPlanner.ts'
import {
  createWebPushSender,
  shortEndpointFingerprint,
} from '../_shared/webPush.ts'

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

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) return false
  let out = 0
  for (let i = 0; i < aa.length; i++) out |= aa[i]! ^ bb[i]!
  return out === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return publicError('METHOD_NOT_ALLOWED', 'POST requis.', 405)
  }

  const cronSecret = Deno.env.get('PUSH_CRON_SECRET') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const vapidKeysJson = Deno.env.get('VAPID_KEYS_JSON') ?? ''
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? ''

  if (!cronSecret || !supabaseUrl || !serviceRoleKey) {
    return publicError('PUSH_MISCONFIGURED', 'Secrets Edge manquants.', 500)
  }

  if (!vapidKeysJson || !vapidSubject) {
    return publicError('PUSH_MISCONFIGURED', 'Secrets VAPID manquants.', 500)
  }

  let body: { cron_secret?: string; dry_run?: boolean }
  try {
    body = (await req.json()) as { cron_secret?: string; dry_run?: boolean }
  } catch {
    return publicError('INVALID_BODY', 'JSON invalide.', 400)
  }

  const provided = typeof body.cron_secret === 'string' ? body.cron_secret : ''
  if (!provided || !timingSafeEqual(provided, cronSecret)) {
    return publicError('UNAUTHORIZED', 'Secret Cron invalide.', 401)
  }

  const dryRun = Boolean(body.dry_run)
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: enabled, error: enabledError } = await admin.rpc(
    'is_push_sending_enabled',
  )
  if (enabledError) {
    console.error('is_push_sending_enabled failed', enabledError.message)
    return publicError(
      'PUSH_JOB_FAILED',
      'Impossible de lire le flag d’envoi.',
      500,
    )
  }

  if (!enabled && !dryRun) {
    return jsonResponse({
      ok: true,
      skipped: true,
      reason: 'push_sending_enabled_false',
    })
  }

  const { data: prepared, error: prepareError } = await admin.rpc(
    'prepare_push_reminder_batch',
  )
  if (prepareError) {
    console.error('prepare_push_reminder_batch failed', prepareError.message)
    return publicError(
      'PUSH_JOB_FAILED',
      'Préparation des rappels échouée.',
      500,
    )
  }

  const prepRow = Array.isArray(prepared) ? prepared[0] : prepared

  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_push_deliveries',
    { p_limit: 50, p_lease_seconds: 120 },
  )
  if (claimError) {
    console.error('claim_push_deliveries failed', claimError.message)
    return publicError(
      'PUSH_JOB_FAILED',
      'Réservation des livraisons échouée.',
      500,
    )
  }

  const claims = (claimed ?? []) as ReminderClaim[]

  if (dryRun) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      prepared: prepRow ?? null,
      claimed: claims.length,
    })
  }

  let sender
  try {
    sender = await createWebPushSender({
      vapidKeysJson,
      subject: vapidSubject,
    })
  } catch (error) {
    console.error(
      'webpush init failed',
      error instanceof Error ? error.message : 'unknown',
    )
    return publicError(
      'PUSH_MISCONFIGURED',
      'Initialisation Web Push échouée.',
      500,
    )
  }

  const summary = {
    sent: 0,
    failed: 0,
    expired: 0,
    skipped: 0,
  }

  for (const claim of claims) {
    const fp = await shortEndpointFingerprint(claim.endpoint)

    const { data: hasPrediction, error: predError } = await admin.rpc(
      'player_has_prediction',
      {
        p_player_id: claim.player_id,
        p_match_id: claim.match_id,
      },
    )

    if (predError) {
      console.error('prediction check failed', predError.message, fp)
      await admin.rpc('complete_push_delivery', {
        p_delivery_id: claim.delivery_id,
        p_outcome: 'failed',
        p_response_status: null,
      })
      summary.failed += 1
      continue
    }

    if (hasPrediction) {
      await admin.rpc('complete_push_delivery', {
        p_delivery_id: claim.delivery_id,
        p_outcome: 'skipped',
        p_response_status: null,
      })
      summary.skipped += 1
      continue
    }

    const result = await sender.sendReminder(claim)

    if (result.ok) {
      await admin.rpc('complete_push_delivery', {
        p_delivery_id: claim.delivery_id,
        p_outcome: 'sent',
        p_response_status: result.status,
      })
      summary.sent += 1
      continue
    }

    if (result.expired) {
      await admin.rpc('complete_push_delivery', {
        p_delivery_id: claim.delivery_id,
        p_outcome: 'expired',
        p_response_status: result.status,
      })
      summary.expired += 1
      console.error('push expired', result.status, fp)
      continue
    }

    await admin.rpc('complete_push_delivery', {
      p_delivery_id: claim.delivery_id,
      p_outcome: 'failed',
      p_response_status: result.status,
    })
    summary.failed += 1
    console.error('push failed', result.status, fp)
  }

  return jsonResponse({
    ok: true,
    prepared: prepRow ?? null,
    claimed: claims.length,
    ...summary,
  })
})
