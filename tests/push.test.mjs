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

  it('keeps Settings opt-in behind an explicit button', () => {
    const section = read('src/components/PushNotificationsSection.tsx')
    assert.match(section, /Activer les rappels/)
    assert.match(section, /Désactiver les rappels/)
    assert.match(section, /ios_install_required/)
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

  it('requires cron secret and respects push_sending_enabled', () => {
    const index = read(
      'supabase/functions/send-prediction-reminders/index.ts',
    )
    assert.match(index, /PUSH_CRON_SECRET/)
    assert.match(index, /is_push_sending_enabled/)
    assert.match(index, /SUPABASE_SERVICE_ROLE_KEY/)
    assert.match(index, /VAPID_KEYS_JSON/)
    assert.doesNotMatch(index, /aln_access_code|access_code_hash/)
  })

  it('ships an inactive cron example', () => {
    const schedule = read('supabase/schedule_push_reminders.example.sql')
    assert.match(schedule, /a-la-nantaise-push-reminders/)
    assert.match(schedule, /push_reminders_cron_secret/)
    assert.match(schedule, /-- SELECT cron\.schedule/)
    assert.ok(
      existsSync(join(root, 'supabase/migrations/20260803170000_web_push.sql')),
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
})
