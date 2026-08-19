import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  dismissPushReminderBanner,
  isPushReminderBannerGate,
  PUSH_REMINDER_BANNER_DISMISS_KEY,
  PUSH_REMINDER_BANNER_DISMISS_MS,
  readPushReminderBannerDismissed,
  shouldShowPushReminderBanner,
} from '../src/lib/pushReminderBanner.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const baseInput = {
  phase: 'ready',
  pathname: '/',
  dismissed: false,
  pwaUpdateVisible: false,
  isOnline: true,
  activationState: 'activatable',
}

describe('pushReminderBanner helpers', () => {
  it('accepts only default and granted_inactive gates', () => {
    assert.equal(isPushReminderBannerGate('default'), true)
    assert.equal(isPushReminderBannerGate('granted_inactive'), true)
    assert.equal(isPushReminderBannerGate('ios_install_required'), false)
    assert.equal(isPushReminderBannerGate('denied'), false)
    assert.equal(isPushReminderBannerGate('active'), false)
  })

  it('shows when ready, online, activatable and not dismissed', () => {
    assert.equal(shouldShowPushReminderBanner(baseInput), true)
  })

  it('hides on settings route', () => {
    assert.equal(
      shouldShowPushReminderBanner({ ...baseInput, pathname: '/parametres' }),
      false,
    )
  })

  it('hides when dismissed', () => {
    assert.equal(
      shouldShowPushReminderBanner({ ...baseInput, dismissed: true }),
      false,
    )
  })

  it('hides when PWA update banner is visible', () => {
    assert.equal(
      shouldShowPushReminderBanner({ ...baseInput, pwaUpdateVisible: true }),
      false,
    )
  })

  it('hides when offline', () => {
    assert.equal(
      shouldShowPushReminderBanner({ ...baseInput, isOnline: false }),
      false,
    )
  })

  it('hides when push is already active', () => {
    assert.equal(
      shouldShowPushReminderBanner({ ...baseInput, activationState: 'active' }),
      false,
    )
  })

  it('persists dismiss for seven days in localStorage', () => {
    const storage = new Map()
    const now = Date.parse('2026-08-19T12:00:00.000Z')

    globalThis.localStorage = {
      getItem(key) {
        return storage.get(key) ?? null
      },
      setItem(key, value) {
        storage.set(key, value)
      },
      removeItem(key) {
        storage.delete(key)
      },
    }

    dismissPushReminderBanner(now)
    const stored = storage.get(PUSH_REMINDER_BANNER_DISMISS_KEY)
    assert.ok(stored)

    assert.equal(
      readPushReminderBannerDismissed(now + PUSH_REMINDER_BANNER_DISMISS_MS - 1),
      true,
    )
    assert.equal(
      readPushReminderBannerDismissed(now + PUSH_REMINDER_BANNER_DISMISS_MS),
      false,
    )

    delete globalThis.localStorage
  })
})

describe('push reminder banner UI wiring', () => {
  it('renders compact copy and links to settings', () => {
    const banner = read('src/components/PushReminderBanner.tsx')
    assert.match(banner, /Active les rappels match/)
    assert.match(
      banner,
      /Reçois un rappel avant le coup d’envoi et[\s\S]*disponibles\./,
    )
    assert.match(banner, /to="\/parametres"/)
    assert.match(banner, /Plus tard/)
  })

  it('refreshes on route changes with stale async guard', () => {
    const hook = read('src/hooks/usePushReminderBanner.ts')
    assert.match(hook, /pathname, refresh/)
    assert.match(hook, /requestIdRef/)
    assert.match(hook, /shouldShowPushReminderBanner/)
    assert.match(hook, /isOnline/)
  })

  it('mounts banners in priority order in App', () => {
    const app = read('src/App.tsx')
    const updateIdx = app.indexOf('<PwaUpdateBanner />')
    const offlineIdx = app.indexOf('<PwaOfflineBanner />')
    const pushIdx = app.indexOf('<PushReminderBanner />')
    assert.ok(updateIdx >= 0 && offlineIdx > updateIdx && pushIdx > offlineIdx)
  })

  it('hides offline banner while update banner is visible', () => {
    const offline = read('src/components/PwaOfflineBanner.tsx')
    assert.match(offline, /usePwaUpdate/)
    assert.match(offline, /updateVisible/)
  })

  it('shares activation resolver and updated settings copy', () => {
    const push = read('src/lib/push.ts')
    assert.match(push, /resolvePushActivationState/)
    const section = read('src/components/PushNotificationsSection.tsx')
    assert.match(section, /resolvePushActivationState/)
    assert.match(
      section,
      /juste avant le coup d’envoi et[\s\S]*lorsque les résultats sont disponibles/,
    )
  })
})
