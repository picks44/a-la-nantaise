import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('push frontend helpers', () => {
  it('exposes feature detection and never requests permission at module load', () => {
    const source = read('src/lib/push.ts')
    assert.match(source, /isWebPushSupported/)
    assert.match(source, /Notification\.requestPermission/)
    assert.match(source, /userVisibleOnly:\s*true/)
    assert.match(source, /VITE_VAPID_PUBLIC_KEY/)
    assert.match(source, /export async function subscribeToPush/)
    assert.ok(
      source.indexOf('requestPermission') >
        source.indexOf('export async function subscribeToPush'),
    )
  })

  it('detects push via ServiceWorkerRegistration.prototype (Safari-safe)', () => {
    const source = read('src/lib/push.ts')
    assert.match(source, /typeof ServiceWorkerRegistration === 'undefined'/)
    assert.match(
      source,
      /'pushManager' in ServiceWorkerRegistration\.prototype/,
    )
    assert.match(source, /isSecureContext/)
    assert.doesNotMatch(source, /'PushManager' in window/)
    assert.match(source, /misconfigured/)
    assert.match(source, /insecure_context/)
  })

  it('does not hang on serviceWorker.ready when no worker is registered', () => {
    const push = read('src/lib/push.ts')
    const section = read('src/components/PushNotificationsSection.tsx')
    assert.match(push, /getReadyPushRegistration/)
    assert.match(push, /serviceWorker\.getRegistration\(\)/)
    assert.match(push, /isViteDevWithoutServiceWorker/)
    assert.match(push, /import\.meta\.env\.DEV/)
    assert.match(push, /service_worker_unavailable/)
    assert.match(section, /service_worker_unavailable/)
    assert.match(section, /npm run preview/)
    assert.match(section, /localhost:4173/)
    // Direct ready awaits must go through the registration guard.
    assert.match(push, /if \(!existing\) return null/)
  })

  it('keeps Settings opt-in behind an explicit button', () => {
    const section = read('src/components/PushNotificationsSection.tsx')
    assert.match(section, /Activer les rappels/)
    assert.match(section, /Désactiver les rappels/)
    assert.match(section, /ios_install_required/)
    assert.match(section, /misconfigured/)
    assert.match(section, /insecure_context/)
    assert.doesNotMatch(section, /useEffect\([^)]*requestPermission/)
  })

  it('deep-links notifications to the calendar match query', () => {
    const calendar = read('src/pages/CalendarPage.tsx')
    assert.match(calendar, /useSearchParams/)
    assert.match(calendar, /match-/)
    assert.match(calendar, /highlighted/)

    const pushSw = read('public/push-events.js')
    assert.match(pushSw, /\/calendrier\?match=/)
  })

  it('documents iOS install gate vs standalone activation path', () => {
    const push = read('src/lib/push.ts')
    const section = read('src/components/PushNotificationsSection.tsx')
    assert.match(push, /shouldShowIosInstallHelp/)
    assert.match(push, /isIosLikeDevice/)
    assert.match(push, /isStandaloneDisplay/)
    assert.match(section, /ios_install_required/)
    assert.match(section, /Sur iPhone ou iPad/)
    assert.match(section, /d['\u2019]accueil/)
  })

  it('reuses an existing browser PushSubscription before subscribe()', () => {
    const source = read('src/lib/push.ts')
    const subscribeStart = source.indexOf('export async function subscribeToPush')
    const subscribeBody = source.slice(
      subscribeStart,
      source.indexOf('export function serializationFromSubscription'),
    )
    assert.match(subscribeBody, /pushManager\.getSubscription\(\)/)
    assert.match(subscribeBody, /if \(existing\) return existing/)
    assert.ok(
      subscribeBody.indexOf('getSubscription()') <
        subscribeBody.indexOf('pushManager.subscribe'),
    )
  })

  it('only unsubscribes locally after a successful remote deactivate on logout', () => {
    const session = read('src/context/SessionProvider.tsx')
    const push = read('src/lib/push.ts')
    assert.match(push, /Promise<boolean>/)
    assert.match(push, /return true/)
    assert.match(push, /return false/)

    for (const fnName of ['const logout = useCallback', 'const leaveGroup = useCallback']) {
      const start = session.indexOf(fnName)
      assert.ok(start > 0, fnName)
      const end = session.indexOf('}, [', start)
      const body = session.slice(start, end)
      assert.match(body, /remoteDeactivated/)
      assert.match(body, /if \(remoteDeactivated\)/)
      assert.match(body, /unsubscribeLocalPush/)
      assert.ok(
        body.indexOf('remoteDeactivated') < body.indexOf('unsubscribeLocalPush'),
      )
    }
  })

  it('best-effort deactivates remote push on session end without blocking', () => {
    const session = read('src/context/SessionProvider.tsx')
    const push = read('src/lib/push.ts')
    assert.match(push, /bestEffortDeactivateRemotePush/)
    assert.match(session, /bestEffortDeactivateRemotePush/)
    assert.match(session, /invalidatePlayerSession/)
    assert.match(session, /submitAccessCode/)
    assert.match(session, /logout/)
    assert.match(session, /leaveGroup/)
    assert.doesNotMatch(session, /\bchangePlayer\b/)
  })

  it('keeps old session intact when the new access code is invalid', () => {
    const session = read('src/context/SessionProvider.tsx')
    const fnStart = session.indexOf('const submitAccessCode = useCallback')
    const fnEnd = session.indexOf('const selectPlayerForLogin')
    assert.ok(fnStart > 0 && fnEnd > fnStart)
    const body = session.slice(fnStart, fnEnd)

    assert.match(body, /verifyAccessCode\(trimmed\)/)
    assert.match(body, /INVALID_ACCESS_CODE/)
    // Invalid path must throw before any tear-down of the previous session.
    const throwIdx = body.indexOf("throw new Error('INVALID_ACCESS_CODE')")
    const deactivateIdx = body.indexOf('bestEffortDeactivateRemotePush')
    const logoutIdx = body.indexOf('logoutPlayer(previousToken)')
    assert.ok(throwIdx > 0)
    assert.ok(deactivateIdx > throwIdx)
    assert.ok(logoutIdx > deactivateIdx)
    assert.doesNotMatch(body, /unsubscribeLocalPush/)
  })

  it('deactivates push and logs out the old session only after a valid group switch', () => {
    const session = read('src/context/SessionProvider.tsx')
    const fnStart = session.indexOf('const submitAccessCode = useCallback')
    const fnEnd = session.indexOf('const selectPlayerForLogin')
    const body = session.slice(fnStart, fnEnd)

    const verifyIdx = body.indexOf('verifyAccessCode(trimmed)')
    const playersIdx = body.indexOf('fetchActivePlayers(trimmed)')
    const deactivateIdx = body.indexOf('bestEffortDeactivateRemotePush')
    const logoutIdx = body.indexOf('logoutPlayer(previousToken)')
    const saveIdx = body.indexOf('saveAccessCode(trimmed)')

    assert.ok(verifyIdx > 0)
    assert.ok(playersIdx > verifyIdx)
    assert.ok(deactivateIdx > playersIdx)
    assert.ok(logoutIdx > deactivateIdx)
    assert.ok(saveIdx > logoutIdx)
    assert.match(body, /const previousToken = sessionToken/)
    assert.match(body, /if \(previousToken\)/)
    assert.doesNotMatch(body, /unsubscribeLocalPush/)
  })
})

describe('push edge function', () => {
  it('locks @negrel/webpush and uses aes128gcm path', () => {
    const deno = read('supabase/functions/send-prediction-reminders/deno.json')
    assert.match(deno, /jsr:@negrel\/webpush@0\.5\.0/)

    const webPush = read('supabase/functions/_shared/webPush.ts')
    assert.match(webPush, /aes128gcm/)
    assert.match(webPush, /assertAllowedPushEndpoint/)
    assert.match(webPush, /push\.apple\.com/)
    assert.match(webPush, /sendPayload/)
    assert.match(webPush, /SMOKE_TEST_TOPIC\s*=\s*'push-smoke-test'/)
    assert.doesNotMatch(webPush, /@pushforge/)
    assert.doesNotMatch(webPush, /aesgcm[^1]/)
  })

  it('keeps sendReminder on top of sendPayload without duplicating push logic', () => {
    const webPush = read('supabase/functions/_shared/webPush.ts')
    assert.match(webPush, /async function sendPayload\(/)
    assert.match(webPush, /async sendReminder\(claim: ReminderClaim\)/)
    assert.match(webPush, /return sendPayload\(/)
    assert.match(webPush, /ttl:\s*60 \* 60 \* 12/)
    assert.match(webPush, /Urgency\.Normal/)
    assert.match(webPush, /status === 404 \|\| status === 410/)
    assert.match(webPush, /status === 429 \|\| status >= 500/)
  })

  it('keeps dry_run read-only, authenticated, and allowed when sending is off', () => {
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    assert.match(index, /PUSH_CRON_SECRET/)
    assert.match(index, /preview_push_reminder_batch/)
    assert.match(index, /mode:\s*'dry_run'/)
    assert.match(index, /CLAIM_LEASE_SECONDS\s*=\s*300/)
    assert.match(index, /p_lease_seconds:\s*CLAIM_LEASE_SECONDS/)
    assert.match(index, /prepared:\s*0/)
    assert.match(index, /claimed:\s*0/)
    assert.match(index, /sent:\s*0/)
    // dry_run path must not call prepare/claim
    const dryBlockStart = index.indexOf('if (dryRun)')
    assert.ok(dryBlockStart > 0)
    const dryBlockEnd = index.indexOf('if (!vapidKeysJson', dryBlockStart)
    assert.ok(dryBlockEnd > dryBlockStart)
    const dryBlock = index.slice(dryBlockStart, dryBlockEnd)
    assert.match(dryBlock, /preview_push_reminder_batch/)
    assert.doesNotMatch(dryBlock, /prepare_push_reminder_batch/)
    assert.doesNotMatch(dryBlock, /claim_push_deliveries/)
    assert.doesNotMatch(dryBlock, /createWebPushSender/)
    assert.doesNotMatch(dryBlock, /smoke_test/)
    // Cron auth runs before dry_run branch
    assert.ok(index.indexOf('UNAUTHORIZED') < dryBlockStart)
  })

  it('supports targeted smoke_test without enabling sending or touching batches', () => {
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    const webPush = read('supabase/functions/_shared/webPush.ts')

    assert.match(index, /smoke_test/)
    assert.match(index, /INVALID_SUBSCRIPTION_ID/)
    assert.match(index, /SUBSCRIPTION_NOT_FOUND/)
    assert.match(index, /UNSUPPORTED_ENCODING/)
    assert.match(index, /mode:\s*'smoke_test'/)
    assert.match(index, /SMOKE_TEST_TOPIC/)
    assert.match(index, /Test des rappels réussi/)
    assert.match(index, /type:\s*'smoke_test'/)
    assert.match(index, /url:\s*'\/parametres'/)
    assert.match(index, /status:\s*'expired'/)
    assert.match(index, /result\.retryable \? 'retryable' : 'failed'/)
    assert.match(index, /status:\s*'failed'/)
    assert.match(index, /status:\s*synthetic/)
    assert.match(index, /invalidated_at/)
    assert.match(index, /shortEndpointFingerprint/)
    assert.match(index, /assertAllowedPushEndpoint/)
    assert.match(index, /timingSafeEqual/)
    assert.match(webPush, /sendPayload/)

    // Auth before smoke; smoke before push_sending_enabled / prepare / claim.
    const unauthorizedIdx = index.indexOf('UNAUTHORIZED')
    const smokeIdx = index.indexOf('body.smoke_test')
    const enabledIdx = index.indexOf('is_push_sending_enabled')
    const prepareIdx = index.indexOf('prepare_push_reminder_batch')
    const claimIdx = index.indexOf("claim_push_deliveries")
    assert.ok(unauthorizedIdx > 0)
    assert.ok(smokeIdx > unauthorizedIdx)
    assert.ok(enabledIdx > smokeIdx)
    assert.ok(prepareIdx > enabledIdx)
    assert.ok(claimIdx > prepareIdx)

    const smokeFnStart = index.indexOf('async function handleSmokeTest')
    const smokeFnEnd = index.indexOf('Deno.serve')
    assert.ok(smokeFnStart > 0 && smokeFnEnd > smokeFnStart)
    const smokeFn = index.slice(smokeFnStart, smokeFnEnd)

    assert.match(smokeFn, /\.from\('push_subscriptions'\)/)
    assert.match(smokeFn, /\.eq\('id', subscriptionId\)/)
    assert.match(smokeFn, /status !== 'active'/)
    assert.match(smokeFn, /content_encoding !== 'aes128gcm'/)
    assert.match(smokeFn, /sendPayload/)
    assert.match(smokeFn, /status:\s*'expired'/)
    assert.match(smokeFn, /invalidated_at/)
    assert.doesNotMatch(smokeFn, /prepare_push_reminder_batch/)
    assert.doesNotMatch(smokeFn, /claim_push_deliveries/)
    assert.doesNotMatch(smokeFn, /player_has_prediction/)
    assert.doesNotMatch(smokeFn, /complete_push_delivery/)
    assert.doesNotMatch(smokeFn, /push_reminders/)
    assert.doesNotMatch(smokeFn, /push_deliveries/)
    // Never accept raw endpoint/keys from the request — only subscription_id.
    assert.doesNotMatch(smokeFn, /body\.endpoint/)
    assert.doesNotMatch(smokeFn, /body\.p256dh/)
    assert.doesNotMatch(smokeFn, /body\.auth/)
    assert.doesNotMatch(smokeFn, /smoke_test\.endpoint/)
    assert.doesNotMatch(smokeFn, /console\.(?:log|error)\([^)]*sub\.endpoint/)
    assert.doesNotMatch(smokeFn, /console\.(?:log|error)\([^)]*,\s*endpoint\b/)
  })

  it('ships an inactive cron example', () => {
    const schedule = read('supabase/schedule_push_reminders.example.sql')
    assert.match(schedule, /a-la-nantaise-push-reminders/)
    assert.match(schedule, /push_reminders_cron_secret/)
    assert.match(schedule, /-- SELECT cron\.schedule/)
    assert.ok(
      existsSync(join(root, 'supabase/migrations/20260803170000_web_push.sql')),
    )
    assert.ok(
      existsSync(
        join(
          root,
          'supabase/migrations/20260803171000_harden_web_push_before_smoke_tests.sql',
        ),
      ),
    )
  })
})

describe('push migration security', () => {
  it('revokes direct table access and grants subscription RPCs to anon', () => {
    const migration = read('supabase/migrations/20260803170000_web_push.sql')
    assert.match(migration, /push_subscriptions/)
    assert.match(migration, /push_reminders/)
    assert.match(migration, /push_deliveries/)
    assert.match(migration, /push_sending_enabled/)
    assert.match(migration, /REVOKE ALL ON TABLE public\.push_subscriptions/)
    assert.match(migration, /register_push_subscription/)
    assert.match(migration, /deactivate_push_subscription/)
    assert.match(migration, /get_push_subscription_status/)
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.register_push_subscription/,
    )
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.claim_push_deliveries/,
    )
    assert.match(migration, /UNIQUE \(reminder_id, subscription_id\)/)
    assert.match(migration, /UNIQUE \(match_id, player_id, reminder_type\)/)
  })

  it('hardens claim/preview/privileges in follow-up migration', () => {
    const harden = read(
      'supabase/migrations/20260803171000_harden_web_push_before_smoke_tests.sql',
    )
    assert.match(harden, /preview_push_reminder_batch/)
    assert.match(harden, /push_reminder_eligibility/)
    assert.match(harden, /attempt_count < 3/)
    assert.match(harden, /DEFAULT 300/)
    assert.match(harden, /status = 'processing'/)
    assert.match(harden, /lease_until < p_now/)
    assert.match(harden, /NOT EXISTS/)
    assert.match(harden, /new_reminders/)
    assert.match(harden, /delivery_sources/)
    assert.match(
      harden,
      /REVOKE ALL ON FUNCTION public\.register_push_subscription/,
    )
    assert.match(harden, /FROM PUBLIC/)
    assert.match(
      harden,
      /GRANT EXECUTE ON FUNCTION public\.preview_push_reminder_batch/,
    )
    assert.match(harden, /TO service_role/)
    assert.match(harden, /NOT compatible with the current PIN frontend/)
    assert.doesNotMatch(harden, /push_sending_enabled.*true/)
    assert.doesNotMatch(harden, /cron\.schedule/)
  })

  it('keeps 170000→71000→180000 privilege chain with final session signatures', () => {
    const harden = read(
      'supabase/migrations/20260803171000_harden_web_push_before_smoke_tests.sql',
    )
    const pin = read(
      'supabase/migrations/20260803180000_player_pin_sessions.sql',
    )

    // 71000 hardens the access-code-era signature from 170000
    assert.match(
      harden,
      /register_push_subscription\(\s*TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT\s*\)/,
    )

    // 180000 drops legacy + grants session-token signature
    assert.match(
      pin,
      /DROP FUNCTION IF EXISTS public\.register_push_subscription\(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT\)/,
    )
    assert.match(
      pin,
      /REVOKE ALL ON FUNCTION public\.register_push_subscription\(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT\) FROM PUBLIC/,
    )
    assert.match(
      pin,
      /GRANT EXECUTE ON FUNCTION public\.register_push_subscription\(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT\)/,
    )
  })
})

describe('push SQL regression scripts', () => {
  it('covers dry-run preview, reclaim, and three-attempt cap', () => {
    const reminders = read('supabase/tests/push_reminders.sql')
    assert.match(reminders, /preview_push_reminder_batch/)
    assert.match(reminders, /preview must not mutate/)
    assert.match(reminders, /preview must exclude existing reminders/)
    assert.match(reminders, /preview should count 2 missing deliveries/)
    assert.match(reminders, /expired processing lease should be reclaimed/)
    assert.match(reminders, /valid lease must not be reclaimed/)
    assert.match(reminders, /attempt_count >= 3 must not be claimable/)
    assert.match(reminders, /claim_push_deliveries\(50, 300/)

    const subscriptions = read('supabase/tests/push_subscriptions.sql')
    assert.match(subscriptions, /PUBLIC must not execute register_push_subscription/)
    assert.match(subscriptions, /anon must execute register_push_subscription/)
    assert.match(subscriptions, /legacy access-code register_push_subscription must be dropped/)
    assert.match(subscriptions, /authenticated must execute register_push_subscription/)
    assert.match(subscriptions, /PUSH_DEVICE_LIMIT/)
    assert.match(subscriptions, /test-limit-6/)
    assert.match(subscriptions, /inactive endpoint should reactivate/)
  })

  it('keeps register limit after endpoint lookup in dedicated migration', () => {
    const migration = read(
      'supabase/migrations/20260806100000_push_register_limit_after_endpoint_lookup.sql',
    )
    assert.match(migration, /register_push_subscription/)
    assert.match(migration, /v_existing_id/)
    assert.match(migration, /PUSH_DEVICE_LIMIT/)
    assert.match(migration, /IF v_existing_id IS NULL THEN/)
    assert.ok(
      migration.indexOf('INTO v_existing_id') <
        migration.indexOf('IF v_existing_id IS NULL THEN'),
    )
    assert.ok(
      migration.indexOf('IF v_existing_id IS NULL THEN') <
        migration.indexOf('INSERT INTO public.push_subscriptions'),
    )
  })
})
