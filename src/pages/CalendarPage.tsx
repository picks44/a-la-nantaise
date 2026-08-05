import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MatchListItem } from '../components/MatchListItem'
import { useSession } from '../context/useSession'
import {
  fetchActiveSeason,
  fetchMatchGroupReveal,
  fetchMatches,
  fetchMyPredictions,
  findNextOpenMatch,
  getPredictionForMatch,
  withPredictionStatus,
} from '../lib/api'
import { shouldShowJumpToNextMatch } from '../lib/matchOrder'
import { toUserMessage } from '../lib/errors'
import type { Match, MatchGroupReveal, Prediction, Season } from '../types'

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
  const [reveals, setReveals] = useState<Record<string, MatchGroupReveal>>({})
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({})
  const [revealLoadingIds, setRevealLoadingIds] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

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
    if (!sessionToken || !season?.id || revealableMatchIds.length === 0) return
    let cancelled = false
    const missingIds = revealableMatchIds.filter((matchId) => !reveals[matchId])
    if (missingIds.length === 0) return

    setRevealLoadingIds((current) => {
      const next = { ...current }
      for (const matchId of missingIds) next[matchId] = true
      return next
    })

    void Promise.all(
      missingIds.map(async (matchId) => {
        try {
          const reveal = await fetchMatchGroupReveal({
            sessionToken,
            seasonId: season.id,
            matchId,
          })
          if (cancelled) return
          setReveals((current) => ({ ...current, [matchId]: reveal }))
          setRevealErrors((current) => {
            const next = { ...current }
            delete next[matchId]
            return next
          })
        } catch (err) {
          if (cancelled) return
          setRevealErrors((current) => ({
            ...current,
            [matchId]: getRevealErrorMessage(err),
          }))
        } finally {
          if (!cancelled) {
            setRevealLoadingIds((current) => {
              const next = { ...current }
              delete next[matchId]
              return next
            })
          }
        }
      }),
    )

    return () => {
      cancelled = true
    }
  }, [revealableMatchIds, reveals, season?.id, sessionToken])

  useEffect(() => {
    if (!sessionToken || !playerId) return
    const stableSessionToken = sessionToken

    function refresh() {
      setReveals({})
      setRevealErrors({})
      setRevealLoadingIds({})
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
        .finally(() => setLoading(false))
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
  }, [playerId, sessionToken])

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
          {items.map(({ match, prediction }) => (
            <li key={match.id}>
              <MatchListItem
                match={match}
                prediction={prediction}
                reveal={reveals[match.id]}
                revealLoading={Boolean(revealLoadingIds[match.id])}
                revealError={revealErrors[match.id] ?? null}
                isNext={match.id === nextOpenId}
                isPredictionTarget={match.id === nextOpenId}
                highlighted={match.id === highlightMatchId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function getRevealErrorMessage(error: unknown): string {
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
