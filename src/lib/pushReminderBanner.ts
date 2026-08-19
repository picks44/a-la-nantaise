import type { SessionPhase } from '../context/session-context'
import type { PushActivationState, PushUiState } from './push'

export const PUSH_REMINDER_BANNER_DISMISS_KEY =
  'aln-push-reminder-banner-dismissed-until'

export const PUSH_REMINDER_BANNER_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

export type PushReminderBannerInput = {
  phase: SessionPhase
  pathname: string
  dismissed: boolean
  pwaUpdateVisible: boolean
  isOnline: boolean
  activationState: PushActivationState | null
}

export function isPushReminderBannerGate(gate: PushUiState): boolean {
  return gate === 'default' || gate === 'granted_inactive'
}

export function readPushReminderBannerDismissed(now = Date.now()): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(PUSH_REMINDER_BANNER_DISMISS_KEY)
    if (!raw) return false
    const until = Date.parse(raw)
    return Number.isFinite(until) && until > now
  } catch {
    return false
  }
}

export function dismissPushReminderBanner(now = Date.now()): void {
  try {
    const until = new Date(now + PUSH_REMINDER_BANNER_DISMISS_MS).toISOString()
    globalThis.localStorage?.setItem(PUSH_REMINDER_BANNER_DISMISS_KEY, until)
  } catch {
    // Ignore quota / private mode.
  }
}

export function shouldShowPushReminderBanner(
  input: PushReminderBannerInput,
): boolean {
  if (input.phase !== 'ready') return false
  if (input.pathname === '/parametres') return false
  if (input.dismissed) return false
  if (input.pwaUpdateVisible) return false
  if (!input.isOnline) return false
  if (input.activationState !== 'activatable') return false
  return true
}
