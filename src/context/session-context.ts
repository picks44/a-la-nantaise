import { createContext } from 'react'
import type { PlayerOption } from '../types'

export type SessionPhase =
  | 'loading'
  | 'needs_code'
  | 'needs_player'
  | 'needs_pin'
  | 'needs_pin_change'
  | 'ready'
  | 'misconfigured'

export interface SessionContextValue {
  phase: SessionPhase
  accessCode: string | null
  sessionToken: string | null
  playerId: string | null
  activePlayer: PlayerOption | null
  players: PlayerOption[]
  pendingPlayerId: string | null
  mustChangePin: boolean
  /** True si le PIN temporaire vient d’être saisi (pas besoin de le redemander). */
  canCompleteForcedPinChange: boolean
  bootstrapError: string | null
  submitAccessCode: (code: string) => Promise<void>
  selectPlayerForLogin: (playerId: string) => void
  loginWithPin: (pin: string) => Promise<void>
  /** Première connexion : remplace le PIN temporaire déjà saisi. */
  completeForcedPinChange: (newPin: string) => Promise<void>
  changePin: (oldPin: string, newPin: string) => Promise<void>
  logout: () => Promise<void>
  leaveGroup: () => void | Promise<void>
  refreshPlayers: () => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)
