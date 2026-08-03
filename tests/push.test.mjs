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
    assert.doesNotMatch(webPush, /@pushforge/)
    assert.doesNotMatch(webPush, /aesgcm[^1]/)
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
    const dryBlockEnd = index.indexOf('if (!vapidKeysJson')
    assert.ok(dryBlockStart > 0 && dryBlockEnd > dryBlockStart)
    const dryBlock = index.slice(dryBlockStart, dryBlockEnd)
    assert.match(dryBlock, /preview_push_reminder_batch/)
    assert.doesNotMatch(dryBlock, /prepare_push_reminder_batch/)
    assert.doesNotMatch(dryBlock, /claim_push_deliveries/)
    assert.doesNotMatch(dryBlock, /createWebPushSender/)
    // Cron auth runs before dry_run branch
    assert.ok(index.indexOf('UNAUTHORIZED') < dryBlockStart)
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
  })
})
