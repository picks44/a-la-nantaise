import type { PlayerOption } from '../types/index.ts'
import { toUserMessage } from './errors.ts'

export function isPlayerSessionExpiry(code: string): boolean {
  return code === 'INVALID_SESSION' || code === 'SESSION_EXPIRED'
}

export type SessionRecoveryResult =
  | {
      outcome: 'needs_player'
      accessCode: string
      players: PlayerOption[]
      message: string
    }
  | {
      outcome: 'needs_player_degraded'
      accessCode: string
      message: string
    }
  | {
      outcome: 'needs_code'
      message: string
      clearAll: true
    }

/**
 * After a player session expires or becomes invalid, keep the group access
 * code when it is still valid so the user returns to player/PIN selection.
 */
export async function resolveAfterSessionInvalidation(input: {
  code: string
  accessCode: string | null
  verifyAccessCode: (accessCode: string) => Promise<boolean>
  fetchActivePlayers: (accessCode: string) => Promise<PlayerOption[]>
}): Promise<SessionRecoveryResult> {
  const sessionMessage = toUserMessage(new Error(input.code))

  if (!isPlayerSessionExpiry(input.code)) {
    return {
      outcome: 'needs_code',
      message:
        'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
      clearAll: true,
    }
  }

  if (!input.accessCode) {
    return {
      outcome: 'needs_code',
      message: sessionMessage,
      clearAll: true,
    }
  }

  try {
    const valid = await input.verifyAccessCode(input.accessCode)
    if (!valid) {
      return {
        outcome: 'needs_code',
        message:
          'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
        clearAll: true,
      }
    }
    const players = await input.fetchActivePlayers(input.accessCode)
    return {
      outcome: 'needs_player',
      accessCode: input.accessCode,
      players,
      message: sessionMessage,
    }
  } catch (error) {
    // Network / RPC failure while checking the code: keep the code, do not
    // force full group re-entry.
    return {
      outcome: 'needs_player_degraded',
      accessCode: input.accessCode,
      message: toUserMessage(error),
    }
  }
}
