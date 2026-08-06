import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MatchListItem } from '../components/MatchListItem'
import { useSession } from '../context/useSession'
import {
  fetchActiveSeason,
  fetchMatchGroupReveal,
  fetchMatches,
  fetchMyPredictions,
  findLastFinishedMatch,
  findNextOpenMatch,
  getPredictionForMatch,
  withPredictionStatus,
} from '../lib/api'
import { shouldShowJumpToNextMatch } from '../lib/matchOrder'
import { toUserMessage } from '../lib/errors'
import {
  REVEAL_TIMEOUT_MESSAGE,
  createRevealLoader,
  getRevealState,
  revealReducer,
  selectIdleRevealIds,
  type RevealAction,
  type RevealStateByMatchId,
} from '../lib/matchGroupRevealState'
import type { Match, Prediction, Season } from '../types'

const MATCH_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function CalendarPage() {
  const { sessionToken, playerId } = useSession()
  const [searchParams] = useSearchParams()
  const highlightMatchId = useMemo(() => {
    const raw = searchParams.get('match')
    return raw && MATCH_ID_RE.test(raw) ? raw : null
  }, [searchParams])

  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [season, setSeason] = useState<Season | null>(null)
  const [revealStates, dispatchRevealState] = useReducer(
    revealReducer,
    {} as RevealStateByMatchId,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  /** Ouverture des détails indexée par matchId (survit aux refresh). */
  const [detailsOpenById, setDetailsOpenById] = useState<Record<string, boolean>>(
    {},
  )

  const nextRevealRequestIdRef = useRef(0)
  /** Miroir synchrone de revealStates pour loadReveal sans dep React. */
  const revealStatesRef = useRef(revealStates)
  const sessionTokenRef = useRef(sessionToken)
  const seasonIdRef = useRef(season?.id)
  const revealableMatchIdsRef = useRef<string[]>([])

  useEffect(() => {
    revealStatesRef.current = revealStates
  }, [revealStates])

  useEffect(() => {
    sessionTokenRef.current = sessionToken
  }, [sessionToken])

  useEffect(() => {
    seasonIdRef.current = season?.id
  }, [season?.id])

  const revealLoaderRef = useRef<ReturnType<typeof createRevealLoader> | null>(
    null,
  )
  if (revealLoaderRef.current == null) {
    revealLoaderRef.current = createRevealLoader({
      getStates: () => revealStatesRef.current,
      commit: (action: RevealAction) => {
        revealStatesRef.current = revealReducer(revealStatesRef.current, action)
        dispatchRevealState(action)
      },
      nextRequestId: () => ++nextRevealRequestIdRef.current,
      fetchReveal: (matchId) => {
        const token = sessionTokenRef.current
        const seasonId = seasonIdRef.current
        if (!token || !seasonId) {
          return Promise.reject(new Error(REVEAL_TIMEOUT_MESSAGE))
        }
        return fetchMatchGroupReveal({
          sessionToken: token,
          seasonId,
          matchId,
        })
      },
      toErrorMessage: getRevealErrorMessage,
    })
  }
  const revealLoader = revealLoaderRef.current

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!sessionToken || !playerId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [seasonRow, matchRows, predictionRows] = await Promise.all([
          fetchActiveSeason(sessionToken!),
          fetchMatches(sessionToken!),
          fetchMyPredictions(sessionToken!),
        ])
        if (cancelled) return
        setSeason(seasonRow)
        setMatches(matchRows)
        setPredictions(predictionRows)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [sessionToken, playerId])

  const revealableMatchIds = useMemo(
    () =>
      matches
        .filter((match) => {
          const withStatus = withPredictionStatus(
            match,
            Boolean(getPredictionForMatch(predictions, match.id, playerId ?? '')),
            now,
          )
          return withStatus.status === 'locked' || withStatus.status === 'finished'
        })
        .map((match) => match.id),
    [matches, now, playerId, predictions],
  )

  useEffect(() => {
    revealableMatchIdsRef.current = revealableMatchIds
  }, [revealableMatchIds])

  // Charge uniquement les ids encore idle — ne cancel pas les loading en cours.
  useEffect(() => {
    if (!sessionToken || !season?.id || revealableMatchIds.length === 0) return
    const idleIds = selectIdleRevealIds(
      revealStatesRef.current,
      revealableMatchIds,
    )
    for (const matchId of idleIds) {
      void revealLoader.loadReveal(matchId)
    }
  }, [revealLoader, revealableMatchIds, season?.id, sessionToken])

  useEffect(() => {
    if (!sessionToken || !playerId) return
    const stableSessionToken = sessionToken

    function refresh() {
      // Reset global hérité (focus/pageshow/online) — pourra être affiné plus tard
      // (invalider seulement si score/statut change, ou pageshow + persisted).
      revealStatesRef.current = revealReducer(revealStatesRef.current, {
        type: 'reset',
      })
      dispatchRevealState({ type: 'reset' })
      revealLoader.resetInFlight()
      setLoading(true)
      setError(null)
      void Promise.all([
        fetchActiveSeason(stableSessionToken),
        fetchMatches(stableSessionToken),
        fetchMyPredictions(stableSessionToken),
      ])
        .then(([seasonRow, matchRows, predictionRows]) => {
          setSeason(seasonRow)
          setMatches(matchRows)
          setPredictions(predictionRows)
        })
        .catch((err) => setError(toUserMessage(err)))
        .finally(() => {
          setLoading(false)
          for (const matchId of revealableMatchIdsRef.current) {
            void revealLoader.loadReveal(matchId)
          }
        })
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [playerId, revealLoader, sessionToken])

  const items = useMemo(() => {
    if (!playerId) return []
    return matches.map((match) => {
      const prediction = getPredictionForMatch(predictions, match.id, playerId)
      return {
        match: withPredictionStatus(match, Boolean(prediction), now),
        prediction,
      }
    })
  }, [matches, predictions, playerId, now])

  const nextOpenId = useMemo(() => {
    const next = findNextOpenMatch(matches, now)
    return next?.id ?? null
  }, [matches, now])

  const lastFinishedId = useMemo(
    () => findLastFinishedMatch(matches)?.id ?? null,
    [matches],
  )

  function isDetailsOpen(matchId: string): boolean {
    if (Object.prototype.hasOwnProperty.call(detailsOpenById, matchId)) {
      return detailsOpenById[matchId]
    }
    return matchId === lastFinishedId
  }

  // Ouvre automatiquement une carte en erreur de reveal.
  useEffect(() => {
    const errorIds = Object.entries(revealStates)
      .filter(([, state]) => state.status === 'error')
      .map(([id]) => id)
    if (errorIds.length === 0) return
    setDetailsOpenById((current) => {
      let changed = false
      const next = { ...current }
      for (const id of errorIds) {
        if (next[id] !== true) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [revealStates])

  const showJumpToNext = useMemo(
    () =>
      shouldShowJumpToNextMatch(
        items.map((item) => item.match.id),
        nextOpenId,
      ),
    [items, nextOpenId],
  )

  useEffect(() => {
    if (loading || !highlightMatchId) return
    const el = document.getElementById(`match-${highlightMatchId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loading, highlightMatchId, items])

  return (
    <div className="page-stack">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="title-display">Calendrier</h1>
          <p className="mt-1 text-sm text-muted">
            Les matchs du FC Nantes à pronostiquer avec le groupe.
          </p>
        </div>
        {showJumpToNext ? (
          <a
            href="#prochain-match"
            className="btn-ghost min-h-11 text-xs text-green-dark"
          >
            Aller au prochain match
          </a>
        ) : null}
      </header>

      {loading ? (
        <EmptyCard message="Chargement du calendrier…" />
      ) : error ? (
        <EmptyCard message={error} tone="error" />
      ) : items.length === 0 ? (
        <div className="panel border-dashed p-6 text-center">
          <p className="font-bold text-ink">Aucun match pour l’instant</p>
          <p className="mt-1 text-sm text-muted">
            Le calendrier se remplira dès la prochaine journée.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map(({ match, prediction }) => {
            const revealState = getRevealState(revealStates, match.id)
            return (
              <li key={match.id}>
                <MatchListItem
                  match={match}
                  prediction={prediction}
                  reveal={
                    revealState.status === 'success'
                      ? revealState.data
                      : undefined
                  }
                  revealLoading={revealState.status === 'loading'}
                  revealError={
                    revealState.status === 'error' ? revealState.error : null
                  }
                  isNext={match.id === nextOpenId}
                  isPredictionTarget={match.id === nextOpenId}
                  highlighted={match.id === highlightMatchId}
                  detailsOpen={isDetailsOpen(match.id)}
                  onDetailsOpenChange={(open) => {
                    setDetailsOpenById((current) => ({
                      ...current,
                      [match.id]: open,
                    }))
                  }}
                  onRetryReveal={() => {
                    revealLoader.retryReveal(match.id)
                  }}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function getRevealErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === REVEAL_TIMEOUT_MESSAGE) {
    return REVEAL_TIMEOUT_MESSAGE
  }
  const message = toUserMessage(error)
  if (message === 'Une erreur est survenue. Réessaie dans quelques instants.') {
    return 'Pronostics collectifs temporairement indisponibles.'
  }
  return message
}

function EmptyCard({
  message,
  tone = 'neutral',
}: {
  message: string
  tone?: 'neutral' | 'error'
}) {
  return (
    <div className="panel p-5">
      <p
        className={[
          'text-sm',
          tone === 'error' ? 'font-semibold text-danger' : 'text-muted',
        ].join(' ')}
      >
        {message}
      </p>
    </div>
  )
}
