import { createContext } from 'react'
import type { PlayerOption } from '../types'

export type SessionPhase =
  | 'loading'
  | 'needs_code'
  | 'needs_player'
  | 'ready'
  | 'misconfigured'

export interface SessionContextValue {
  phase: SessionPhase
  accessCode: string | null
  playerId: string | null
  activePlayer: PlayerOption | null
  players: PlayerOption[]
  bootstrapError: string | null
  submitAccessCode: (code: string) => Promise<void>
  selectPlayer: (playerId: string) => Promise<void>
  changePlayer: (playerId: string) => Promise<void>
  leaveGroup: () => void
  refreshPlayers: () => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)
