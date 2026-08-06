import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  changePlayerPin,
  deactivatePushSubscription,
  fetchActivePlayers,
  fetchSessionPlayer,
  loginPlayer,
  logoutPlayer,
  setAccessInvalidationHandler,
  verifyAccessCode,
} from '../lib/api'
import { toUserMessage } from '../lib/errors'
import {
  bestEffortDeactivateRemotePush,
  unsubscribeLocalPush,
} from '../lib/push'
import {
  clearLocalSession,
  clearPlayerClientState,
  clearSessionToken,
  readLocalSession,
  saveAccessCode,
  saveSessionToken,
} from '../lib/session'
import { resolveAfterSessionInvalidation } from '../lib/sessionRecovery'
import { isSupabaseConfigured } from '../lib/supabase'
import type { PlayerOption } from '../types'
import { SessionContext, type SessionPhase } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>('loading')
  const [accessCode, setAccessCode] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null)
  const [forcedChangeOldPin, setForcedChangeOldPin] = useState<string | null>(
    null,
  )
  const [players, setPlayers] = useState<PlayerOption[]>([])
  const [activePseudo, setActivePseudo] = useState<string | null>(null)
  const [mustChangePin, setMustChangePin] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  const clearAuthState = useCallback(() => {
    clearLocalSession()
    setAccessCode(null)
    setSessionToken(null)
    setPlayerId(null)
    setPendingPlayerId(null)
    setForcedChangeOldPin(null)
    setPlayers([])
    setActivePseudo(null)
    setMustChangePin(false)
  }, [])

  const clearPlayerSessionOnly = useCallback(() => {
    clearSessionToken()
    setSessionToken(null)
    setPlayerId(null)
    setPendingPlayerId(null)
    setForcedChangeOldPin(null)
    setActivePseudo(null)
    setMustChangePin(false)
  }, [])

  const invalidatePlayerSession = useCallback(
    (code: string) => {
      const previousToken = sessionToken
      const preservedCode = accessCode
      void bestEffortDeactivateRemotePush(
        previousToken,
        deactivatePushSubscription,
      )

      clearPlayerSessionOnly()

      void resolveAfterSessionInvalidation({
        code,
        accessCode: preservedCode,
        verifyAccessCode,
        fetchActivePlayers,
      }).then((recovery) => {
        if (recovery.outcome === 'needs_player') {
          setAccessCode(recovery.accessCode)
          setPlayers(recovery.players)
          setBootstrapError(recovery.message)
          setPhase('needs_player')
          return
        }
        if (recovery.outcome === 'needs_player_degraded') {
          setAccessCode(recovery.accessCode)
          setBootstrapError(recovery.message)
          setPhase('needs_player')
          return
        }
        clearAuthState()
        setBootstrapError(recovery.message)
        setPhase('needs_code')
      })
    },
    [accessCode, clearAuthState, clearPlayerSessionOnly, sessionToken],
  )

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

    if (local.sessionToken) {
      try {
        const sessionPlayer = await fetchSessionPlayer(local.sessionToken)
        if (!sessionPlayer) {
          clearSessionToken()
          if (local.accessCode) {
            try {
              const valid = await verifyAccessCode(local.accessCode)
              if (valid) {
                const activePlayers = await fetchActivePlayers(local.accessCode)
                setAccessCode(local.accessCode)
                setPlayers(activePlayers)
                setSessionToken(null)
                setPlayerId(null)
                setPhase('needs_player')
                return
              }
            } catch (error) {
              // Keep the access code on transient failures.
              setAccessCode(local.accessCode)
              setSessionToken(null)
              setPlayerId(null)
              setBootstrapError(toUserMessage(error))
              setPhase('needs_player')
              return
            }
          }
          clearAuthState()
          setPhase('needs_code')
          return
        }

        setSessionToken(local.sessionToken)
        setPlayerId(sessionPlayer.playerId)
        setActivePseudo(sessionPlayer.pseudo)
        setMustChangePin(sessionPlayer.mustChangePin)
        if (local.accessCode) {
          setAccessCode(local.accessCode)
          try {
            setPlayers(await fetchActivePlayers(local.accessCode))
          } catch {
            setPlayers([
              {
                id: sessionPlayer.playerId,
                pseudo: sessionPlayer.pseudo,
                isActive: true,
              },
            ])
          }
        } else {
          setPlayers([
            {
              id: sessionPlayer.playerId,
              pseudo: sessionPlayer.pseudo,
              isActive: true,
            },
          ])
        }
        setPhase(
          sessionPlayer.mustChangePin ? 'needs_pin_change' : 'ready',
        )
        return
      } catch (error) {
        clearSessionToken()
        if (local.accessCode) {
          setAccessCode(local.accessCode)
          setSessionToken(null)
          setPlayerId(null)
          setBootstrapError(toUserMessage(error))
          setPhase('needs_player')
          return
        }
        setBootstrapError(toUserMessage(error))
        clearAuthState()
        setPhase('needs_code')
        return
      }
    }

    if (!local.accessCode) {
      clearAuthState()
      setPhase('needs_code')
      return
    }

    try {
      const valid = await verifyAccessCode(local.accessCode)
      if (!valid) {
        clearAuthState()
        setPhase('needs_code')
        setBootstrapError(
          'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
        )
        return
      }

      const activePlayers = await fetchActivePlayers(local.accessCode)
      setAccessCode(local.accessCode)
      setPlayers(activePlayers)
      setSessionToken(null)
      setPlayerId(null)
      setPhase('needs_player')
    } catch (error) {
      // Keep the stored access code; show a recoverable error.
      setAccessCode(local.accessCode)
      setBootstrapError(toUserMessage(error))
      setPhase('needs_code')
    }
  }, [clearAuthState])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const submitAccessCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      // Snapshot before any await — avoids races with invalidate/logout.
      const previousToken = sessionToken

      // Fully validate the new group access before touching the old session.
      const valid = await verifyAccessCode(trimmed)
      if (!valid) {
        throw new Error('INVALID_ACCESS_CODE')
      }
      const activePlayers = await fetchActivePlayers(trimmed)

      // Valid switch: best-effort tear-down of the previous player session only.
      // No local Push unsubscribe — the browser subscription can be re-registered.
      if (previousToken) {
        await bestEffortDeactivateRemotePush(
          previousToken,
          deactivatePushSubscription,
        )
        try {
          await logoutPlayer(previousToken)
        } catch {
          // Expected when the session is already invalid server-side.
        }
      }

      saveAccessCode(trimmed)
      clearSessionToken()
      setAccessCode(trimmed)
      setPlayers(activePlayers)
      setSessionToken(null)
      setPlayerId(null)
      setPendingPlayerId(null)
      setActivePseudo(null)
      setMustChangePin(false)
      setForcedChangeOldPin(null)
      setBootstrapError(null)
      setPhase('needs_player')
    },
    [sessionToken],
  )

  const selectPlayerForLogin = useCallback((nextPlayerId: string) => {
    setPendingPlayerId(nextPlayerId)
    setForcedChangeOldPin(null)
    setBootstrapError(null)
    setPhase('needs_pin')
  }, [])

  const loginWithPin = useCallback(
    async (pin: string) => {
      if (!accessCode || !pendingPlayerId) {
        throw new Error('INVALID_ACCESS_CODE')
      }

      const result = await loginPlayer(accessCode, pendingPlayerId, pin)
      saveSessionToken(result.sessionToken)
      setSessionToken(result.sessionToken)
      setPlayerId(result.playerId)
      setActivePseudo(result.pseudo)
      setMustChangePin(result.mustChangePin)
      setForcedChangeOldPin(result.mustChangePin ? pin : null)
      setPendingPlayerId(null)
      setBootstrapError(null)
      setPhase(result.mustChangePin ? 'needs_pin_change' : 'ready')
    },
    [accessCode, pendingPlayerId],
  )

  const changePin = useCallback(
    async (oldPin: string, newPin: string) => {
      if (!sessionToken) {
        throw new Error('INVALID_SESSION')
      }
      await changePlayerPin(sessionToken, oldPin, newPin)
      setForcedChangeOldPin(null)
      setMustChangePin(false)
      setPhase('ready')
    },
    [sessionToken],
  )

  const completeForcedPinChange = useCallback(
    async (newPin: string) => {
      if (!sessionToken) {
        throw new Error('INVALID_SESSION')
      }
      if (!forcedChangeOldPin) {
        throw new Error('PIN_CHANGE_REQUIRED')
      }
      await changePlayerPin(sessionToken, forcedChangeOldPin, newPin)
      setForcedChangeOldPin(null)
      setMustChangePin(false)
      setPhase('ready')
    },
    [forcedChangeOldPin, sessionToken],
  )

  const logout = useCallback(async () => {
    const token = sessionToken
    try {
      if (token) {
        const remoteDeactivated = await bestEffortDeactivateRemotePush(
          token,
          deactivatePushSubscription,
        )
        await logoutPlayer(token)
        // Only drop the browser subscription after a successful remote disable.
        // Otherwise the next subscribe() creates a new endpoint while the old
        // row may remain active and consume a device slot.
        if (remoteDeactivated) {
          await unsubscribeLocalPush()
        }
      }
    } catch {
      // Ne bloque pas la déconnexion locale.
    }

    clearSessionToken()
    await clearPlayerClientState()
    setSessionToken(null)
    setPlayerId(null)
    setPendingPlayerId(null)
    setForcedChangeOldPin(null)
    setActivePseudo(null)
    setMustChangePin(false)
    setBootstrapError(null)
    setPhase(accessCode ? 'needs_player' : 'needs_code')
  }, [accessCode, sessionToken])

  const leaveGroup = useCallback(async () => {
    const token = sessionToken
    try {
      if (token) {
        const remoteDeactivated = await bestEffortDeactivateRemotePush(
          token,
          deactivatePushSubscription,
        )
        await logoutPlayer(token)
        if (remoteDeactivated) {
          await unsubscribeLocalPush()
        }
      }
    } catch {
      // Ne bloque pas la sortie de groupe.
    }

    clearAuthState()
    await clearPlayerClientState()
    setBootstrapError(null)
    setPhase('needs_code')
  }, [clearAuthState, sessionToken])

  const refreshPlayers = useCallback(async () => {
    if (!accessCode) return
    const activePlayers = await fetchActivePlayers(accessCode)
    setPlayers(activePlayers)
  }, [accessCode])

  const activePlayer = useMemo(() => {
    if (!playerId) return null
    const fromList = players.find((player) => player.id === playerId)
    if (fromList) return fromList
    if (activePseudo) {
      return { id: playerId, pseudo: activePseudo, isActive: true }
    }
    return null
  }, [activePseudo, playerId, players])

  const value = useMemo(
    () => ({
      phase,
      accessCode,
      sessionToken,
      playerId,
      activePlayer,
      players,
      pendingPlayerId,
      mustChangePin,
      canCompleteForcedPinChange: Boolean(forcedChangeOldPin),
      bootstrapError,
      submitAccessCode,
      selectPlayerForLogin,
      loginWithPin,
      completeForcedPinChange,
      changePin,
      logout,
      leaveGroup,
      refreshPlayers,
    }),
    [
      phase,
      accessCode,
      sessionToken,
      playerId,
      activePlayer,
      players,
      pendingPlayerId,
      mustChangePin,
      forcedChangeOldPin,
      bootstrapError,
      submitAccessCode,
      selectPlayerForLogin,
      loginWithPin,
      completeForcedPinChange,
      changePin,
      logout,
      leaveGroup,
      refreshPlayers,
    ],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
