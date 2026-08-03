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
  clearSessionToken,
  readLocalSession,
  saveAccessCode,
  saveSessionToken,
} from '../lib/session'
import { isSupabaseConfigured } from '../lib/supabase'
import type { PlayerOption } from '../types'
import { SessionContext, type SessionPhase } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>('loading')
  const [accessCode, setAccessCode] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null)
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
    setPlayers([])
    setActivePseudo(null)
    setMustChangePin(false)
  }, [])

  const invalidatePlayerSession = useCallback(
    (code: string) => {
      const previousToken = sessionToken
      void bestEffortDeactivateRemotePush(
        previousToken,
        deactivatePushSubscription,
      )
      clearAuthState()
      setBootstrapError(
        code === 'INVALID_SESSION'
          ? 'Ta session a expiré. Reconnecte-toi avec ton PIN.'
          : 'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
      )
      setPhase('needs_code')
    },
    [clearAuthState, sessionToken],
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
      setBootstrapError(toUserMessage(error))
      setPhase('needs_code')
    }
  }, [clearAuthState])

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
    clearSessionToken()
    setAccessCode(trimmed)
    setPlayers(activePlayers)
    setSessionToken(null)
    setPlayerId(null)
    setPendingPlayerId(null)
    setActivePseudo(null)
    setMustChangePin(false)
    setBootstrapError(null)
    setPhase('needs_player')
  }, [])

  const selectPlayerForLogin = useCallback((nextPlayerId: string) => {
    setPendingPlayerId(nextPlayerId)
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
      setMustChangePin(false)
      setPhase('ready')
    },
    [sessionToken],
  )

  const logout = useCallback(async () => {
    const token = sessionToken
    try {
      if (token) {
        await bestEffortDeactivateRemotePush(token, deactivatePushSubscription)
        await logoutPlayer(token)
        await unsubscribeLocalPush()
      }
    } catch {
      // Ne bloque pas la déconnexion locale.
    }

    clearSessionToken()
    setSessionToken(null)
    setPlayerId(null)
    setPendingPlayerId(null)
    setActivePseudo(null)
    setMustChangePin(false)
    setBootstrapError(null)
    setPhase(accessCode ? 'needs_player' : 'needs_code')
  }, [accessCode, sessionToken])

  const leaveGroup = useCallback(async () => {
    const token = sessionToken
    try {
      if (token) {
        await bestEffortDeactivateRemotePush(token, deactivatePushSubscription)
        await logoutPlayer(token)
        await unsubscribeLocalPush()
      }
    } catch {
      // Ne bloque pas la sortie de groupe.
    }

    clearAuthState()
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
      bootstrapError,
      submitAccessCode,
      selectPlayerForLogin,
      loginWithPin,
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
      bootstrapError,
      submitAccessCode,
      selectPlayerForLogin,
      loginWithPin,
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
