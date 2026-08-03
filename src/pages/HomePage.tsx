import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { RaceLeaders } from '../components/Podium'
import { ScoreInput } from '../components/ScoreInput'
import { useSession } from '../context/useSession'
import {
  findLastFinishedMatch,
  findNextOpenMatch,
  getPredictionForMatch,
  fetchMatches,
  fetchMyPredictions,
  fetchRanking,
  upsertPrediction,
  withPredictionStatus,
} from '../lib/api'
import { getCompetitionRanks, selectHomeRanking } from '../lib/ranking'
import { toUserMessage } from '../lib/errors'
import { isBrowserOnline, OFFLINE_USER_MESSAGE } from '../lib/pwa'
import {
  formatCountdown,
  formatKickoff,
  formatMatchDate,
  formatMatchTime,
  getCountdown,
  venueSecondaryLabel,
} from '../lib/format'
import { pointsResultLabel } from '../lib/status'
import type { Match, Player, Prediction, Score } from '../types'

export function HomePage() {
  const { sessionToken, playerId, activePlayer } = useSession()

  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [ranking, setRanking] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Score>({ home: 0, away: 0 })
  const [saved, setSaved] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 3500)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  useEffect(() => {
    if (!sessionToken || !playerId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [matchRows, predictionRows, rankingRows] = await Promise.all([
          fetchMatches(sessionToken!),
          fetchMyPredictions(sessionToken!),
          fetchRanking(sessionToken!),
        ])
        if (cancelled) return
        setMatches(matchRows)
        setPredictions(predictionRows)
        setRanking(rankingRows)
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

  const nextMatch = useMemo(() => {
    const base = findNextOpenMatch(matches, now)
    if (!base || !playerId) return null
    const prediction = getPredictionForMatch(predictions, base.id, playerId)
    return withPredictionStatus(base, Boolean(prediction), now)
  }, [matches, predictions, playerId, now])

  const lastMatch = useMemo(() => findLastFinishedMatch(matches), [matches])
  const lastPrediction = useMemo(() => {
    if (!lastMatch || !playerId) return undefined
    return getPredictionForMatch(predictions, lastMatch.id, playerId)
  }, [lastMatch, predictions, playerId])

  const homeRanking = useMemo(() => {
    const ranks = getCompetitionRanks(ranking)
    return selectHomeRanking(ranking, ranks, activePlayer?.id ?? '')
  }, [ranking, activePlayer?.id])
  const nextMatchId = nextMatch?.id

  useEffect(() => {
    if (!nextMatchId || !playerId) return
    const existing = getPredictionForMatch(predictions, nextMatchId, playerId)
    if (existing) {
      setDraft({ home: existing.homeScore, away: existing.awayScore })
      setSaved(true)
    } else {
      setDraft({ home: 0, away: 0 })
      setSaved(false)
    }
    setSaveError(null)
  }, [nextMatchId, playerId, predictions])

  async function handleSave() {
    if (!sessionToken || !playerId || !nextMatch) return
    if (!isBrowserOnline()) {
      setSaveError(OFFLINE_USER_MESSAGE)
      setJustSaved(false)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const savedPrediction = await upsertPrediction({
        sessionToken,
        matchId: nextMatch.id,
        homeScore: draft.home,
        awayScore: draft.away,
      })
      setPredictions((current) => {
        const without = current.filter(
          (item) =>
            !(
              item.matchId === savedPrediction.matchId &&
              item.playerId === playerId
            ),
        )
        return [...without, savedPrediction]
      })
      setSaved(true)
      setJustSaved(true)
    } catch (err) {
      setSaveError(toUserMessage(err))
      setJustSaved(false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <StateCard title="Accueil" message="Chargement des matchs…" />
  }

  if (error) {
    return <StateCard title="Accueil" message={error} tone="error" />
  }

  if (!nextMatch) {
    return (
      <div className="space-y-4">
        <StateCard
          title="Accueil"
          message="Aucun prochain match ouvert aux pronostics pour le moment."
        />
        <RaceLeaders
          players={homeRanking.players}
          ranks={homeRanking.ranks}
          activePlayerId={activePlayer?.id ?? ''}
          title="Classement du groupe"
          variant="compact"
        />
        <LastMatchBlock match={lastMatch} prediction={lastPrediction} />
      </div>
    )
  }

  const countdown = getCountdown(nextMatch.kickoffAt, now)
  const inputsLocked = countdown.locked || nextMatch.status === 'locked'
  const stadium = venueSecondaryLabel(nextMatch.venue)

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="next-match-title"
        className="overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow"
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink/15 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.1em] text-ink/70 uppercase">
              Journée {nextMatch.matchday} · Ligue 2
            </p>
            <p className="mt-1 text-sm font-bold text-ink sm:text-base">
              {formatMatchDate(nextMatch.kickoffAt)}
              <span className="mx-2 text-ink/35">·</span>
              <span className="tabular-nums">
                {formatMatchTime(nextMatch.kickoffAt)}
              </span>
            </p>
          </div>
          <span
            className={[
              'badge shrink-0',
              inputsLocked
                ? 'border-ink bg-ink text-yellow'
                : 'border-green/40 bg-success-soft text-green-dark',
            ].join(' ')}
          >
            {inputsLocked ? 'Pronos fermés' : 'Pronos ouverts'}
          </span>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 id="next-match-title" className="sr-only">
              {nextMatch.homeTeam} contre {nextMatch.awayTeam}
            </h1>
            <p className="text-[11px] font-bold tracking-[0.12em] text-green-dark uppercase">
              {stadium}
            </p>
          </div>

          <form
            className="mt-3 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:gap-4">
              <ScoreInput
                label={nextMatch.homeTeam}
                value={draft.home}
                disabled={inputsLocked || saving}
                variant="board"
                onChange={(value) => {
                  setDraft((current) => ({ ...current, home: value }))
                  setSaved(false)
                  setJustSaved(false)
                }}
              />
              <span
                aria-hidden="true"
                className="pb-3 text-xl font-black text-ink/40 sm:pb-3.5 sm:text-2xl"
              >
                –
              </span>
              <ScoreInput
                label={nextMatch.awayTeam}
                value={draft.away}
                disabled={inputsLocked || saving}
                variant="board"
                onChange={(value) => {
                  setDraft((current) => ({ ...current, away: value }))
                  setSaved(false)
                  setJustSaved(false)
                }}
              />
            </div>

            <div className="flex justify-center">
              <button
                type="submit"
                disabled={inputsLocked || saving}
                className="btn-green w-full max-w-none sm:w-auto sm:min-w-[14rem] sm:max-w-sm"
              >
                {saving ? 'Validation…' : 'Valider mon prono'}
              </button>
            </div>
          </form>

          {saveError ? (
            <p
              role="alert"
              className="mt-3 border border-danger bg-danger-soft px-3 py-2 text-center text-sm font-semibold text-danger"
            >
              {saveError}
            </p>
          ) : null}

          {justSaved ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-center text-sm font-semibold text-success"
            >
              <CheckCircle2
                aria-hidden="true"
                className="mr-1.5 inline size-4 align-text-bottom"
              />
              Pronostic enregistré.
            </p>
          ) : saved && !saveError ? (
            <p className="mt-3 text-center text-sm font-medium text-green-dark">
              Pronostic actuel :{' '}
              <span className="font-black tabular-nums">
                {draft.home} – {draft.away}
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 bg-ink px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-[11px] font-bold tracking-[0.1em] uppercase">
            {countdown.locked ? 'Pronostics verrouillés' : 'Verrouillage dans'}
          </p>
          <p className="font-black tracking-wide text-yellow tabular-nums sm:text-lg">
            {formatCountdown(countdown)}
          </p>
          <p className="text-xs text-white/60 sm:text-right">
            Jusqu’au coup d’envoi (heure serveur)
          </p>
        </div>
      </section>

      <RaceLeaders
        players={homeRanking.players}
        ranks={homeRanking.ranks}
        activePlayerId={activePlayer?.id ?? ''}
        title="Classement du groupe"
        variant="compact"
      />
      <LastMatchBlock match={lastMatch} prediction={lastPrediction} />
    </div>
  )
}

function LastMatchBlock({
  match,
  prediction,
}: {
  match: Match | null
  prediction?: Prediction
}) {
  if (!match?.finalScore) return null

  const resultLabel = pointsResultLabel(prediction?.points)

  return (
    <section
      aria-labelledby="last-match-title"
      className="overflow-hidden rounded-[var(--radius-md)] border border-ink bg-green-dark text-white"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/15 px-4 py-3">
        <h2
          id="last-match-title"
          className="text-sm font-black tracking-[0.06em] uppercase"
        >
          Dernier match
        </h2>
        <p className="text-[11px] font-bold tracking-wider text-white/60 uppercase">
          J{match.matchday} · {formatKickoff(match.kickoffAt)}
        </p>
      </div>

      <div className="px-4 py-4">
        <p className="text-center text-[11px] font-bold tracking-[0.1em] text-yellow uppercase">
          {match.homeTeam}
          <span className="mx-2 text-white/40">vs</span>
          {match.awayTeam}
        </p>
        <p className="mt-2 text-center font-black tracking-tight text-yellow tabular-nums text-4xl sm:text-5xl">
          {match.finalScore.home}
          <span className="mx-2 text-2xl text-white/35">–</span>
          {match.finalScore.away}
        </p>

        <div className="mt-4 border border-white/15 bg-ink/40 px-3 py-3">
          <p className="text-[11px] font-bold tracking-[0.1em] text-white/55 uppercase">
            Ton prono
          </p>
          <p className="mt-1 text-lg font-black tabular-nums">
            {prediction
              ? `${prediction.homeScore} – ${prediction.awayScore}`
              : 'Aucun'}
          </p>
          {resultLabel ? (
            <p className="badge mt-3 border-yellow bg-yellow text-ink">
              {resultLabel}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function StateCard({
  title,
  message,
  tone = 'neutral',
}: {
  title: string
  message: string
  tone?: 'neutral' | 'error'
}) {
  return (
    <div className="panel p-5">
      <h1 className="text-lg font-black tracking-tight uppercase">{title}</h1>
      <p
        className={[
          'mt-2 text-sm',
          tone === 'error' ? 'font-semibold text-danger' : 'text-muted',
        ].join(' ')}
      >
        {message}
      </p>
    </div>
  )
}
