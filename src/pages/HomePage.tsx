import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { RaceLeaders } from '../components/Podium'
import { RoundRecapCard } from '../components/RoundRecapCard'
import { ScoreInput } from '../components/ScoreInput'
import { useSession } from '../context/useSession'
import {
  celebrationStorageKey,
  getCelebrationFlag,
  setCelebrationFlag,
} from '../lib/celebrations'
import {
  findLastFinishedMatch,
  findNextOpenMatch,
  getPredictionForMatch,
  fetchActiveSeason,
  fetchLiveSeasonRanking,
  fetchMatches,
  fetchMyPredictions,
  fetchPlayerRoundRecap,
  upsertPrediction,
  withPredictionStatus,
} from '../lib/api'
import { getCompetitionRanks, selectHomeRanking } from '../lib/ranking'
import { toUserMessage } from '../lib/errors'
import {
  createInFlightGuard,
  loadHomeBundle,
} from '../lib/pageLoad'
import { withPageLoadTimeout } from '../lib/pageLoadTimeout'
import { isBrowserOnline, OFFLINE_USER_MESSAGE } from '../lib/pwa'
import {
  formatCountdown,
  formatKickoff,
  formatMatchDate,
  formatMatchTime,
  getCountdown,
  venueSecondaryLabel,
} from '../lib/format'
import { getLastMatchPerformance } from '../lib/lastMatchDisplay'
import type {
  Match,
  Player,
  PlayerRoundRecap,
  Prediction,
  Score,
  Season,
} from '../types'

export function HomePage() {
  const { sessionToken, playerId, activePlayer, accessCode } = useSession()

  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [ranking, setRanking] = useState<Player[]>([])
  const [recap, setRecap] = useState<PlayerRoundRecap | null>(null)
  const [showRecap, setShowRecap] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Score>({ home: 0, away: 0 })
  const [saved, setSaved] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const loadGuardRef = useRef(createInFlightGuard())
  const loadGenerationRef = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 3500)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  const loadPage = useCallback(async () => {
    if (!sessionToken || !playerId) return
    await loadGuardRef.current.run(async () => {
      const generation = ++loadGenerationRef.current
      setLoading(true)
      setError(null)
      try {
        const bundle = await loadHomeBundle({
          sessionToken,
          fetchActiveSeason,
          fetchMatches,
          fetchMyPredictions,
          fetchLiveSeasonRanking,
        })
        if (generation !== loadGenerationRef.current) return

        const season = bundle.season as Season
        const matchRows = bundle.matches as Match[]
        const predictionRows = bundle.predictions as Prediction[]
        const rankingRows = bundle.ranking as Player[]
        setMatches(matchRows)
        setPredictions(predictionRows)
        setRanking(rankingRows)

        const referenceRound = rankingRows.find(
          (row) => row.referenceRoundNumber != null,
        )?.referenceRoundNumber
        if (referenceRound != null) {
          try {
            const recapPayload = await withPageLoadTimeout(
              fetchPlayerRoundRecap({
                sessionToken,
                seasonId: season.id,
                roundNumber: referenceRound,
              }),
            )
            if (generation !== loadGenerationRef.current) return
            setRecap(recapPayload)

            const groupId = accessCode ?? 'group'
            const seenKey = celebrationStorageKey({
              groupId,
              playerId,
              seasonId: season.id,
              eventType: 'day_recap',
              eventId: `${referenceRound}:${recapPayload.isDefinitive ? 'def' : 'prov'}`,
            })
            const alreadySeen = getCelebrationFlag(seenKey)
            if (recapPayload.isDefinitive && !alreadySeen) {
              setShowRecap(true)
              setCelebrationFlag(seenKey)
            } else if (!recapPayload.isDefinitive) {
              setShowRecap(true)
            }
          } catch {
            if (generation === loadGenerationRef.current) {
              setRecap(null)
              setShowRecap(false)
            }
          }
        } else if (generation === loadGenerationRef.current) {
          setRecap(null)
          setShowRecap(false)
        }
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setError(toUserMessage(err))
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setLoading(false)
        }
      }
    })
  }, [sessionToken, playerId, accessCode])

  useEffect(() => {
    const generationRef = loadGenerationRef
    const guard = loadGuardRef.current
    void loadPage()
    return () => {
      generationRef.current += 1
      guard.reset()
    }
  }, [loadPage])

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
    const ranks = ranking.every((player) => player.rank != null)
      ? ranking.map((player) => player.rank as number)
      : getCompetitionRanks(ranking)
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

  function retry() {
    void loadPage()
  }

  if (loading) {
    return <StateCard title="Accueil" message="Chargement des matchs…" />
  }

  if (error) {
    return (
      <div className="page-stack">
        <StateCard title="Accueil" message={error} tone="error" />
        <button type="button" className="btn-secondary" onClick={retry}>
          Réessayer
        </button>
      </div>
    )
  }

  if (!nextMatch) {
    return (
      <div className="page-stack">
        <StateCard
          title="Accueil"
          message="Aucun prochain match ouvert aux pronostics pour le moment."
        />
        {showRecap && recap ? (
          <RoundRecapCard
            recap={recap}
            onDismiss={() => setShowRecap(false)}
          />
        ) : null}
        <RaceLeaders
          players={homeRanking.players}
          ranks={homeRanking.ranks}
          activePlayerId={activePlayer?.id ?? ''}
          title="Classement"
          variant="compact"
          awaitingFirstResult={homeRanking.awaitingFirstResult}
          participantCount={homeRanking.participantCount}
          live
        />
        <LastMatchBlock match={lastMatch} prediction={lastPrediction} />
      </div>
    )
  }

  const isUnconfirmed = nextMatch.status === 'kickoff_unconfirmed'
  const countdown = getCountdown(nextMatch.kickoffAt, now)
  const inputsLocked =
    isUnconfirmed || countdown.locked || nextMatch.status === 'locked'
  const stadium = venueSecondaryLabel(nextMatch.venue)
  const hasExistingPrediction = Boolean(
    playerId && getPredictionForMatch(predictions, nextMatch.id, playerId),
  )

  return (
    <div className="page-stack">
      <section
        aria-labelledby="next-match-title"
        className="overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow"
      >
        <div className="flex items-start justify-between gap-2 border-b border-ink/15 px-4 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.1em] text-ink/70 uppercase">
              Journée {nextMatch.matchday} · Ligue 2
            </p>
            <p className="mt-0.5 text-sm font-bold text-ink sm:mt-1 sm:text-base">
              {isUnconfirmed ? (
                formatMatchDate(nextMatch.kickoffAt)
              ) : (
                <>
                  {formatMatchDate(nextMatch.kickoffAt)}
                  <span className="mx-2 text-ink/35">·</span>
                  <span className="tabular-nums">
                    {formatMatchTime(nextMatch.kickoffAt)}
                  </span>
                </>
              )}
            </p>
            {isUnconfirmed ? (
              <p className="mt-0.5 text-xs font-semibold text-ink/60">
                Horaire à confirmer
              </p>
            ) : null}
          </div>
          <span
            className={[
              'badge shrink-0 max-sm:px-1.5 max-sm:text-[9px] max-sm:tracking-[0.06em]',
              isUnconfirmed
                ? 'border-border bg-surface-muted text-muted'
                : inputsLocked
                  ? 'border-green-dark bg-green-dark text-yellow'
                  : 'border-green/40 bg-success-soft text-green-dark',
            ].join(' ')}
          >
            {isUnconfirmed
              ? 'Bientôt disponible'
              : inputsLocked
                ? 'Pronos fermés'
                : 'Pronos ouverts'}
          </span>
        </div>

        <div className="px-4 py-2.5 sm:px-5 sm:py-4">
          <div className="flex flex-col items-center gap-0.5 text-center sm:gap-1">
            <h1 id="next-match-title" className="sr-only">
              {nextMatch.homeTeam} contre {nextMatch.awayTeam}
            </h1>
            <p className="text-[11px] font-bold tracking-[0.12em] text-green-dark uppercase">
              {stadium}
            </p>
          </div>

          <form
            className="mt-2 flex flex-col gap-2 sm:mt-3 sm:gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <div className="mx-auto grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-end gap-2 sm:max-w-lg sm:gap-3">
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
                className="pb-2 text-lg font-black text-ink/30 sm:pb-3.5 sm:text-2xl sm:text-ink/40"
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

            <div className="flex justify-center pb-[max(0px,env(safe-area-inset-bottom))]">
              <button
                type="submit"
                disabled={inputsLocked || saving}
                className="btn-green w-[85%] max-w-none sm:w-auto sm:min-w-[14rem] sm:max-w-sm"
              >
                {saving
                  ? 'Validation…'
                  : hasExistingPrediction
                    ? 'Modifier mon prono'
                    : 'Valider mon prono'}
              </button>
            </div>
          </form>

          {saveError ? (
            <p
              role="alert"
              className="mt-1.5 border border-danger bg-danger-soft px-3 py-2 text-center text-sm font-semibold text-danger sm:mt-3"
            >
              {saveError}
            </p>
          ) : null}

          {justSaved ? (
            <p
              role="status"
              aria-live="polite"
              className="ui-success-pop mt-1.5 rounded-[var(--radius-sm)] border border-green/30 bg-success-soft px-3 py-2 text-center text-sm font-semibold text-success sm:mt-3"
            >
              <CheckCircle2
                aria-hidden="true"
                className="mr-1.5 inline size-4 align-text-bottom"
              />
              Ton prono enregistré :{' '}
              <span className="font-black tabular-nums">
                {draft.home}–{draft.away}
              </span>
            </p>
          ) : saved && !saveError ? (
            <p className="mt-1.5 text-center text-xs font-medium text-green-dark/90 sm:mt-3 sm:text-sm">
              Ton prono :{' '}
              <span className="font-black tabular-nums">
                {draft.home}–{draft.away}
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-0 bg-green-dark px-4 py-1.5 text-center text-white sm:gap-0.5 sm:px-5 sm:py-2.5">
          <p className="text-[11px] font-bold tracking-[0.1em] text-yellow/90 uppercase">
            {isUnconfirmed
              ? 'Pronostics'
              : countdown.locked
                ? 'Pronostics verrouillés'
                : 'Verrouillage dans'}
          </p>
          <p className="text-lg font-black tracking-wide text-yellow tabular-nums">
            {isUnconfirmed ? 'Bientôt disponible' : formatCountdown(countdown)}
          </p>
        </div>
      </section>

      {showRecap && recap ? (
        <RoundRecapCard
          recap={recap}
          onDismiss={() => setShowRecap(false)}
        />
      ) : null}

      <RaceLeaders
        players={homeRanking.players}
        ranks={homeRanking.ranks}
        activePlayerId={activePlayer?.id ?? ''}
        title="Classement"
        variant="compact"
        awaitingFirstResult={homeRanking.awaitingFirstResult}
        participantCount={homeRanking.participantCount}
        live
      />
      <LastMatchBlock match={lastMatch} prediction={lastPrediction} />
    </div>
  )
}

function lastMatchRewardClass(tone: 'exact' | 'good' | 'miss'): {
  verdict: string
  points: string
} {
  if (tone === 'exact') {
    return {
      verdict: 'badge border-yellow/40 text-yellow',
      points: 'text-yellow',
    }
  }
  if (tone === 'good') {
    return {
      verdict: 'text-white',
      points: 'text-white',
    }
  }
  return {
    verdict: 'text-white/80',
    points: 'text-white/85',
  }
}

function LastMatchBlock({
  match,
  prediction,
}: {
  match: Match | null
  prediction?: Prediction
}) {
  if (!match?.finalScore) return null

  const performance = getLastMatchPerformance(prediction)
  const rewardClass =
    performance.kind === 'scored'
      ? lastMatchRewardClass(performance.tone)
      : null

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
        <div className="text-center">
          <p className="text-[11px] font-bold tracking-[0.1em] text-white/55 uppercase">
            Score final
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-white/75">
            {match.homeTeam}
            <span className="mx-2 font-black tabular-nums text-white/90">
              {match.finalScore.home}
              <span className="mx-1 text-white/40">–</span>
              {match.finalScore.away}
            </span>
            {match.awayTeam}
          </p>
        </div>

        <div className="mt-5 text-center">
          <p className="text-[11px] font-bold tracking-[0.1em] text-white/55 uppercase">
            Ton prono
          </p>
          {performance.kind === 'missing' ? (
            <p className="mt-1 text-lg font-black text-white/85">
              Non pronostiqué
            </p>
          ) : (
            <p className="mt-1 font-black tracking-tight text-yellow tabular-nums text-3xl sm:text-4xl">
              {performance.homeScore}
              <span className="mx-2 text-xl text-white/35">–</span>
              {performance.awayScore}
            </p>
          )}

          {performance.kind === 'pending' ? (
            <p className="mt-3 text-sm font-semibold text-white/60">
              Résultat en attente
            </p>
          ) : null}

          {performance.kind === 'scored' && rewardClass ? (
            <div className="mt-4 flex flex-col items-center gap-0.5">
              <p
                className={[
                  'text-sm font-extrabold tracking-wide',
                  rewardClass.verdict,
                ].join(' ')}
              >
                {performance.resultLabel}
              </p>
              <p
                className={[
                  'text-2xl font-black tabular-nums',
                  rewardClass.points,
                ].join(' ')}
              >
                {performance.pointsLabel}
              </p>
            </div>
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
