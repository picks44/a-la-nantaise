import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  fetchActivePlayers,
  setAccessInvalidationHandler,
  verifyAccessCode,
} from '../lib/api'
import { toUserMessage } from '../lib/errors'
import {
  clearLocalSession,
  clearPlayerId,
  readLocalSession,
  saveAccessCode,
  savePlayerId,
} from '../lib/session'
import { isSupabaseConfigured } from '../lib/supabase'
import type { PlayerOption } from '../types'
import {
  SessionContext,
  type SessionPhase,
} from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>('loading')
  const [accessCode, setAccessCode] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [players, setPlayers] = useState<PlayerOption[]>([])
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  const invalidatePlayerSession = useCallback(() => {
    clearLocalSession()
    setAccessCode(null)
    setPlayerId(null)
    setPlayers([])
    setBootstrapError(
      'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
    )
    setPhase('needs_code')
  }, [])

  useEffect(() => {
    setAccessInvalidationHandler(invalidatePlayerSession)
    return () => setAccessInvalidationHandler(null)
  }, [invalidatePlayerSession])

  const bootstrap = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setPhase('misconfigured')
      setBootstrapError(
        'Variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY manquantes.',
      )
      return
    }

    setBootstrapError(null)
    const local = readLocalSession()

    if (!local?.accessCode) {
      setAccessCode(null)
      setPlayerId(null)
      setPlayers([])
      setPhase('needs_code')
      return
    }

    try {
      const valid = await verifyAccessCode(local.accessCode)
      if (!valid) {
        clearLocalSession()
        setAccessCode(null)
        setPlayerId(null)
        setPlayers([])
        setPhase('needs_code')
        setBootstrapError(
          'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
        )
        return
      }

      const activePlayers = await fetchActivePlayers(local.accessCode)
      setAccessCode(local.accessCode)
      setPlayers(activePlayers)

      if (local.playerId) {
        const stillActive = activePlayers.find(
          (player) => player.id === local.playerId,
        )
        if (stillActive) {
          setPlayerId(stillActive.id)
          setPhase('ready')
          return
        }
        clearPlayerId()
      }

      setPlayerId(null)
      setPhase('needs_player')
    } catch (error) {
      setBootstrapError(toUserMessage(error))
      setPhase('needs_code')
    }
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const submitAccessCode = useCallback(async (code: string) => {
    const trimmed = code.trim()
    const valid = await verifyAccessCode(trimmed)
    if (!valid) {
      throw new Error('INVALID_ACCESS_CODE')
    }

    const activePlayers = await fetchActivePlayers(trimmed)
    saveAccessCode(trimmed)
    clearPlayerId()
    setAccessCode(trimmed)
    setPlayers(activePlayers)
    setPlayerId(null)
    setBootstrapError(null)
    setPhase('needs_player')
  }, [])

  const selectPlayer = useCallback(
    async (nextPlayerId: string) => {
      if (!accessCode) {
        throw new Error('INVALID_ACCESS_CODE')
      }

      const player = players.find((item) => item.id === nextPlayerId)
      if (!player) {
        const fresh = await fetchActivePlayers(accessCode)
        setPlayers(fresh)
        const found = fresh.find((item) => item.id === nextPlayerId)
        if (!found) throw new Error('INVALID_PLAYER')
      }

      savePlayerId(nextPlayerId)
      setPlayerId(nextPlayerId)
      setPhase('ready')
    },
    [accessCode, players],
  )

  const changePlayer = useCallback(
    async (nextPlayerId: string) => {
      await selectPlayer(nextPlayerId)
    },
    [selectPlayer],
  )

  const leaveGroup = useCallback(() => {
    clearLocalSession()
    setAccessCode(null)
    setPlayerId(null)
    setPlayers([])
    setBootstrapError(null)
    setPhase('needs_code')
  }, [])

  const refreshPlayers = useCallback(async () => {
    if (!accessCode) return
    const activePlayers = await fetchActivePlayers(accessCode)
    setPlayers(activePlayers)
  }, [accessCode])

  const activePlayer = useMemo(
    () => players.find((player) => player.id === playerId) ?? null,
    [players, playerId],
  )

  const value = useMemo(
    () => ({
      phase,
      accessCode,
      playerId,
      activePlayer,
      players,
      bootstrapError,
      submitAccessCode,
      selectPlayer,
      changePlayer,
      leaveGroup,
      refreshPlayers,
    }),
    [
      phase,
      accessCode,
      playerId,
      activePlayer,
      players,
      bootstrapError,
      submitAccessCode,
      selectPlayer,
      changePlayer,
      leaveGroup,
      refreshPlayers,
    ],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
