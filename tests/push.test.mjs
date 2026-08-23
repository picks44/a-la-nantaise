import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractPushServiceReason,
  isAppleSafeWebPushTopic,
  pushProviderFromEndpoint,
} from '../supabase/functions/_shared/pushServiceError.ts'
import { webPushTopic } from '../supabase/functions/_shared/pushReminderPlanner.ts'
import {
  isSmokeTestVariant,
  resolveSmokeTestSend,
  SMOKE_TEST_PAYLOAD,
  SYNTHETIC_KICKOFF_CLAIM,
} from '../supabase/functions/_shared/pushSmokeTest.ts'

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

  it('logs Apple push error reason without endpoint or keys', () => {
    const webPush = read('supabase/functions/_shared/webPush.ts')
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    const helper = read('supabase/functions/_shared/pushServiceError.ts')

    assert.match(webPush, /readPushServiceReason/)
    assert.match(webPush, /logPushServiceError/)
    assert.match(webPush, /pushProviderFromEndpoint/)
    assert.match(helper, /msg: 'push_service_error'/)
    assert.match(helper, /provider: entry\.provider/)
    assert.match(helper, /\.reason/)
    assert.doesNotMatch(
      helper,
      /console\.(?:log|error)\([^)]*(?:endpoint|p256dh|\bauth\b)/,
    )
    assert.match(index, /result\.reason/)
    assert.match(index, /console\.error\('smoke_test', variant, synthetic, result\.status, result\.reason, fp\)/)
    assert.match(index, /console\.error\('push failed', result\.status, result\.reason, fp\)/)
    assert.doesNotMatch(index, /console\.(?:log|error)\([^)]*claim\.endpoint/)
    assert.doesNotMatch(webPush, /console\.(?:log|error)\([^)]*subscription\.endpoint/)
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
    assert.match(dryBlock, /candidates_kickoff_5m/)
    assert.match(dryBlock, /candidates_results_available/)
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
    assert.match(index, /INVALID_SMOKE_VARIANT/)
    assert.match(index, /resolveSmokeTestSend/)
    const smokeHelper = read('supabase/functions/_shared/pushSmokeTest.ts')
    assert.match(smokeHelper, /Test des rappels réussi/)
    assert.match(smokeHelper, /type:\s*'smoke_test'/)
    assert.match(smokeHelper, /url:\s*'\/parametres'/)
    assert.match(smokeHelper, /SMOKE_TEST_TOPIC|push-smoke-test/)
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

  it('skips prediction check only for pre-match reminder types', () => {
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    assert.match(
      index,
      /claim\.reminder_type === '24h' \|\| claim\.reminder_type === '2h'/,
    )
    assert.match(index, /player_has_prediction/)
  })

  it('builds results_available payload with calendar deep link', () => {
    const planner = read('supabase/functions/_shared/pushReminderPlanner.ts')
    assert.match(planner, /'results_available'/)
    assert.match(planner, /Résultats disponibles/)
    assert.match(
      planner,
      /est terminé\. Le classement et les pronos du groupe sont à jour\./,
    )
    assert.match(planner, /aln-results-\$\{claim\.match_id\}/)
    assert.match(planner, /\/calendrier\?match=\$\{claim\.match_id\}/)
  })

  it('builds kickoff_5m payload with calendar deep link', () => {
    const planner = read('supabase/functions/_shared/pushReminderPlanner.ts')
    assert.match(planner, /'kickoff_5m'/)
    assert.match(planner, /Coup d'envoi dans 5 min/)
    assert.match(
      planner,
      /va commencer\. À l'ouverture du match, découvre les pronos du groupe\./,
    )
    assert.match(planner, /aln-kickoff-5m-\$\{claim\.match_id\}/)
    assert.match(planner, /kickoff5-\$\{claim\.match_id\.replace/)
  })

  it('ships an inactive cron example', () => {
    const schedule = read('supabase/schedule_push_reminders.example.sql')
    assert.match(schedule, /a-la-nantaise-push-reminders/)
    assert.match(schedule, /push_reminders_cron_secret/)
    assert.match(schedule, /-- SELECT cron\.schedule/)
    assert.match(schedule, /'\*\/5 \* \* \* \*'/)
    assert.match(schedule, /24h, 2h, kickoff_5m, results_available/)
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

    const resultsAvailable = read('supabase/tests/push_results_available.sql')
    assert.match(resultsAvailable, /preview should count 2 results_available reminders/)
    assert.match(resultsAvailable, /prepare should create 3 results deliveries/)
    assert.match(resultsAvailable, /expected 3 claimed results deliveries/)
    assert.match(resultsAvailable, /must not claim results for non-finished match/)
    assert.match(resultsAvailable, /503 should set next_attempt_at/)
    assert.match(resultsAvailable, /410 should expire subscription/)

    const kickoff5m = read('supabase/tests/push_kickoff_5m.sql')
    assert.match(kickoff5m, /kickoff_5m/)
    assert.match(kickoff5m, /due_at must be kickoff - 5 min/)
    assert.match(kickoff5m, /stale delivery must be skipped after kickoff change/)
    assert.match(kickoff5m, /T\+1 must not claim kickoff_5m/)
    assert.match(kickoff5m, /503 should set next_attempt_at for kickoff_5m/)

    const sendMigration = read(
      'supabase/migrations/20260819120000_push_results_available_send.sql',
    )
    assert.match(sendMigration, /results_available/)
    assert.match(sendMigration, /reminder_type IN \('24h', '2h'\)/)
    assert.match(sendMigration, /kickoff_snapshot > p_now/)

    const kickoffMigration = read(
      'supabase/migrations/20260819140000_push_kickoff_5m_send.sql',
    )
    assert.match(kickoffMigration, /kickoff_5m/)
    assert.match(kickoffMigration, /status = 'skipped'/)
    assert.match(kickoffMigration, /DROP FUNCTION IF EXISTS public\.preview_push_reminder_batch/)
    assert.match(kickoffMigration, /ON CONFLICT \(match_id, player_id, reminder_type\) DO UPDATE/)
    assert.match(kickoffMigration, /ON CONFLICT \(reminder_id, subscription_id\) DO UPDATE/)
    assert.match(kickoffMigration, /candidates_kickoff_5m/)

    const previewMigration = read(
      'supabase/migrations/20260819150000_push_preview_results_available.sql',
    )
    assert.match(previewMigration, /candidates_results_available/)
    assert.match(
      previewMigration,
      /DROP FUNCTION IF EXISTS public\.preview_push_reminder_batch/,
    )
    assert.match(kickoffMigration, /r\.kickoff_snapshot = m\.kickoff_at/)

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

describe('push service error parsing', () => {
  it('extracts Apple reason and maps hosts without storing secrets', () => {
    assert.equal(
      extractPushServiceReason('{"reason":"BadWebPushRequest"}'),
      'BadWebPushRequest',
    )
    assert.equal(
      extractPushServiceReason('{"reason":"BadWebPushTopic"}'),
      'BadWebPushTopic',
    )
    assert.equal(extractPushServiceReason('{"reason":"BadTtl"}'), 'BadTtl')
    assert.equal(extractPushServiceReason('{"reason":"not a reason!!"}'), null)
    assert.equal(
      extractPushServiceReason('{"reason":"https://web.push.apple.com/token"}'),
      null,
    )
    assert.equal(extractPushServiceReason('<html>nope</html>'), null)
    assert.equal(
      pushProviderFromEndpoint('https://web.push.apple.com/abc'),
      'apple',
    )
    assert.equal(
      pushProviderFromEndpoint('https://fcm.googleapis.com/fcm/send/xyz'),
      'fcm',
    )
    assert.equal(isAppleSafeWebPushTopic('push-smoke-test'), true)
    assert.equal(isAppleSafeWebPushTopic('bad topic'), false)
    assert.equal(isAppleSafeWebPushTopic('a'.repeat(33)), false)
  })

  it('keeps reminder topics within Apple Topic charset and length', () => {
    const matchId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const base = {
      delivery_id: 'd1',
      reminder_id: 'r1',
      subscription_id: 's1',
      match_id: matchId,
      player_id: 'p1',
      home_team: 'Nantes',
      away_team: 'Rennes',
      kickoff_at: '2026-08-23T18:00:00Z',
      endpoint: 'https://web.push.apple.com/opaque',
      p256dh: 'p',
      auth: 'a',
      content_encoding: 'aes128gcm',
    }

    for (const reminder_type of [
      '24h',
      '2h',
      'kickoff_5m',
      'results_available',
    ]) {
      const topic = webPushTopic({ ...base, reminder_type })
      assert.equal(isAppleSafeWebPushTopic(topic), true, topic)
      assert.ok(topic.length <= 32, topic)
    }
  })
})

describe('smoke test variants', () => {
  it('rejects an unknown variant in the edge function', () => {
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    assert.match(index, /INVALID_SMOKE_VARIANT/)
    assert.match(index, /isSmokeTestVariant\(rawVariant\)/)
    assert.equal(isSmokeTestVariant('nope'), false)
    assert.equal(isSmokeTestVariant('default'), true)
    assert.equal(isSmokeTestVariant('kickoff_full'), true)
    assert.equal(isSmokeTestVariant('kickoff_no_topic'), true)
    assert.equal(isSmokeTestVariant('smoke_kickoff_topic'), true)
  })

  it('uses the smoke payload and smoke topic for default', () => {
    const send = resolveSmokeTestSend('default')
    assert.equal(send.payload, SMOKE_TEST_PAYLOAD)
    assert.equal(send.topic, 'push-smoke-test')
    const webPush = read('supabase/functions/_shared/webPush.ts')
    assert.match(webPush, /SMOKE_TEST_TOPIC\s*=\s*'push-smoke-test'/)
  })

  it('uses kickoff payload and kickoff topic for kickoff_full', () => {
    const send = resolveSmokeTestSend('kickoff_full')
    assert.deepEqual(send.payload, expectedKickoffPayload())
    assert.equal(send.topic, webPushTopic(SYNTHETIC_KICKOFF_CLAIM))
    assert.equal(send.topic, 'kickoff5-74e86cb8d62f480a')
  })

  it('uses kickoff payload without a topic for kickoff_no_topic', () => {
    const send = resolveSmokeTestSend('kickoff_no_topic')
    assert.deepEqual(send.payload, expectedKickoffPayload())
    assert.equal(send.topic, undefined)
  })

  it('uses smoke payload with kickoff topic for smoke_kickoff_topic', () => {
    const send = resolveSmokeTestSend('smoke_kickoff_topic')
    assert.equal(send.payload, SMOKE_TEST_PAYLOAD)
    assert.equal(send.topic, webPushTopic(SYNTHETIC_KICKOFF_CLAIM))
  })

  it('does not log secrets in the smoke variant path', () => {
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    const helper = read('supabase/functions/_shared/pushSmokeTest.ts')
    assert.doesNotMatch(index, /console\.(?:log|error)\([^)]*sub\.endpoint/)
    assert.doesNotMatch(index, /console\.(?:log|error)\([^)]*sub\.p256dh/)
    assert.doesNotMatch(index, /console\.(?:log|error)\([^)]*sub\.auth/)
    assert.doesNotMatch(helper, /console\.(?:log|error)/)
    assert.match(helper, /p256dh: 'synthetic'/)
  })

  it('keeps sendReminder on the real claim payload and topic', () => {
    const webPush = read('supabase/functions/_shared/webPush.ts')
    assert.match(webPush, /async sendReminder\(claim: ReminderClaim\)/)
    assert.match(webPush, /buildNotificationPayload\(claim\)/)
    assert.match(webPush, /webPushTopic\(claim\)/)
    assert.doesNotMatch(webPush, /resolveSmokeTestSend/)
    assert.doesNotMatch(webPush, /SYNTHETIC_KICKOFF_CLAIM/)
  })
})

function expectedKickoffPayload() {
  return {
    title: "Coup d'envoi dans 5 min",
    body: 'FC Nantes - AS Nancy Lorraine va commencer. À l\'ouverture du match, découvre les pronos du groupe.',
    matchId: SYNTHETIC_KICKOFF_CLAIM.match_id,
    reminderType: 'kickoff_5m',
    url: `/calendrier?match=${SYNTHETIC_KICKOFF_CLAIM.match_id}`,
    tag: `aln-kickoff-5m-${SYNTHETIC_KICKOFF_CLAIM.match_id}`,
  }
}
