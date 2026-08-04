import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { type ReminderClaim } from '../_shared/pushReminderPlanner.ts'
import {
  assertAllowedPushEndpoint,
  createWebPushSender,
  shortEndpointFingerprint,
  SMOKE_TEST_TOPIC,
} from '../_shared/webPush.ts'

/** Default claim lease: 5 minutes (aligned with SQL default). */
const CLAIM_LEASE_SECONDS = 300
const CLAIM_LIMIT = 50

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SMOKE_TEST_PAYLOAD = {
  title: 'À la Nantaise',
  body: 'Test des rappels réussi. Les notifications sont bien activées.',
  icon: '/icons/icon-192.png',
  badge: '/icons/icon-192.png',
  tag: 'push-smoke-test',
  data: {
    url: '/parametres',
    type: 'smoke_test',
  },
} as const

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

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

type SmokeSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  content_encoding: string
  status: string
}

async function handleSmokeTest(
  admin: SupabaseClient,
  subscriptionId: string,
  vapidKeysJson: string,
  vapidSubject: string,
): Promise<Response> {
  if (!vapidKeysJson || !vapidSubject) {
    return publicError('PUSH_MISCONFIGURED', 'Secrets VAPID manquants.', 500)
  }

  const { data: row, error: loadError } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, content_encoding, status')
    .eq('id', subscriptionId)
    .maybeSingle()

  if (loadError) {
    console.error('smoke_test load failed', loadError.message)
    return publicError(
      'PUSH_JOB_FAILED',
      'Chargement de l’abonnement échoué.',
      500,
    )
  }

  const sub = row as SmokeSubscriptionRow | null
  if (!sub || sub.status !== 'active') {
    return publicError(
      'SUBSCRIPTION_NOT_FOUND',
      'Abonnement introuvable ou inactif.',
      404,
    )
  }

  if (sub.content_encoding !== 'aes128gcm') {
    return publicError(
      'UNSUPPORTED_ENCODING',
      'Seul aes128gcm est supporté.',
      400,
    )
  }

  const fp = await shortEndpointFingerprint(sub.endpoint)

  try {
    assertAllowedPushEndpoint(sub.endpoint)
  } catch {
    console.error('smoke_test endpoint rejected', fp)
    return jsonResponse(
      {
        ok: false,
        mode: 'smoke_test',
        subscription_id: subscriptionId,
        status: 'failed',
      },
      400,
    )
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

  const result = await sender.sendPayload(
    {
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      content_encoding: sub.content_encoding,
    },
    SMOKE_TEST_PAYLOAD,
    { topic: SMOKE_TEST_TOPIC },
  )

  if (result.ok) {
    console.log('smoke_test sent', fp)
    return jsonResponse({
      ok: true,
      mode: 'smoke_test',
      subscription_id: subscriptionId,
      sent: 1,
      status: result.status,
    })
  }

  if (result.expired) {
    const { error: expireError } = await admin
      .from('push_subscriptions')
      .update({
        status: 'expired',
        invalidated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)

    if (expireError) {
      console.error('smoke_test expire update failed', expireError.message, fp)
    } else {
      console.error('smoke_test expired', result.status, fp)
    }

    return jsonResponse(
      {
        ok: false,
        mode: 'smoke_test',
        subscription_id: subscriptionId,
        status: 'expired',
      },
      410,
    )
  }

  const synthetic = result.retryable ? 'retryable' : 'failed'
  console.error('smoke_test', synthetic, result.status, fp)
  return jsonResponse(
    {
      ok: false,
      mode: 'smoke_test',
      subscription_id: subscriptionId,
      status: synthetic,
    },
    result.retryable ? 503 : 502,
  )
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

  let body: {
    cron_secret?: string
    dry_run?: boolean
    smoke_test?: { subscription_id?: unknown }
  }
  try {
    body = (await req.json()) as {
      cron_secret?: string
      dry_run?: boolean
      smoke_test?: { subscription_id?: unknown }
    }
  } catch {
    return publicError('INVALID_BODY', 'JSON invalide.', 400)
  }

  const provided = typeof body.cron_secret === 'string' ? body.cron_secret : ''
  if (!provided || !timingSafeEqual(provided, cronSecret)) {
    return publicError('UNAUTHORIZED', 'Secret Cron invalide.', 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Targeted smoke test: one explicit subscription, allowed while sending is off.
  // No prepare/claim/complete; never accepts endpoint/keys in the request body.
  if (body.smoke_test !== undefined && body.smoke_test !== null) {
    if (
      typeof body.smoke_test !== 'object' ||
      Array.isArray(body.smoke_test) ||
      !isUuid(body.smoke_test.subscription_id)
    ) {
      return publicError(
        'INVALID_SUBSCRIPTION_ID',
        'subscription_id UUID requis.',
        400,
      )
    }

    return await handleSmokeTest(
      admin,
      body.smoke_test.subscription_id,
      vapidKeysJson,
      vapidSubject,
    )
  }

  const dryRun = Boolean(body.dry_run)

  // Dry-run: read-only preview. Allowed even when push_sending_enabled=false.
  // Still requires cron_secret. Does not require VAPID. No prepare/claim/send.
  if (dryRun) {
    const { data: preview, error: previewError } = await admin.rpc(
      'preview_push_reminder_batch',
    )
    if (previewError) {
      console.error('preview_push_reminder_batch failed', previewError.message)
      return publicError(
        'PUSH_JOB_FAILED',
        'Prévisualisation des rappels échouée.',
        500,
      )
    }
    const row = Array.isArray(preview) ? preview[0] : preview
    return jsonResponse({
      ok: true,
      mode: 'dry_run',
      prepared: 0,
      claimed: 0,
      sent: 0,
      candidates: row ?? {
        candidates_24h: 0,
        candidates_2h: 0,
        candidate_deliveries: 0,
      },
    })
  }

  if (!vapidKeysJson || !vapidSubject) {
    return publicError('PUSH_MISCONFIGURED', 'Secrets VAPID manquants.', 500)
  }

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

  if (!enabled) {
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
    { p_limit: CLAIM_LIMIT, p_lease_seconds: CLAIM_LEASE_SECONDS },
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
    mode: 'send',
    prepared: prepRow ?? null,
    claimed: claims.length,
    ...summary,
  })
})
