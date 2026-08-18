import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
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
  createGenerationToken,
  runSoftPageLoad,
} from '../lib/calendarRefresh'
import {
  createInFlightGuard,
  loadHomeBundle,
} from '../lib/pageLoad'
import { withPageLoadTimeout } from '../lib/pageLoadTimeout'
import { isBrowserOnline, OFFLINE_USER_MESSAGE } from '../lib/pwa'
import {
  attachSoftPageRefresh,
  shouldPollForOfficialResult,
} from '../lib/softPageRefresh'
import {
  findHomePendingResultMatch,
  findLastFinishedMatch,
  findNextOpenMatch,
  selectHomePrimaryMatch,
} from '../lib/matchOrder'
import {
  classifyMatchPhase,
  matchPhaseHeadline,
} from '../lib/matchLifecycle'
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
  const dataGenerationRef = useRef(createGenerationToken())
  const hasExistingDataRef = useRef(false)
  const accessCodeRef = useRef(accessCode)
  const playerIdRef = useRef(playerId)

  useEffect(() => {
    hasExistingDataRef.current =
      matches.length > 0 || ranking.length > 0 || predictions.length > 0
  }, [matches.length, ranking.length, predictions.length])

  useEffect(() => {
    accessCodeRef.current = accessCode
  }, [accessCode])

  useEffect(() => {
    playerIdRef.current = playerId
  }, [playerId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 3500)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  const applyHomeBundle = useCallback(
    async (input: {
      season: Season
      matches: Match[]
      predictions: Prediction[]
      ranking: Player[]
      sessionToken: string
      generation: number
    }) => {
      setMatches(input.matches)
      setPredictions(input.predictions)
      setRanking(input.ranking)
      setError(null)

      const activePlayerId = playerIdRef.current
      if (!activePlayerId) return

      const referenceRound = input.ranking.find(
        (row) => row.referenceRoundNumber != null,
      )?.referenceRoundNumber
      if (referenceRound != null) {
        try {
          const recapPayload = await withPageLoadTimeout(
            fetchPlayerRoundRecap({
              sessionToken: input.sessionToken,
              seasonId: input.season.id,
              roundNumber: referenceRound,
            }),
          )
          if (!dataGenerationRef.current.isCurrent(input.generation)) return
          setRecap(recapPayload)

          const groupId = accessCodeRef.current ?? 'group'
          const seenKey = celebrationStorageKey({
            groupId,
            playerId: activePlayerId,
            seasonId: input.season.id,
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
          if (dataGenerationRef.current.isCurrent(input.generation)) {
            setRecap(null)
            setShowRecap(false)
          }
        }
      } else if (dataGenerationRef.current.isCurrent(input.generation)) {
        setRecap(null)
        setShowRecap(false)
      }
    },
    [],
  )

  const loadPage = useCallback(
    async (mode: 'initial' | 'soft') => {
      if (!sessionToken || !playerId) return
      await loadGuardRef.current.run(async () => {
        const generation = dataGenerationRef.current.next()
        const token = sessionToken

        await runSoftPageLoad({
          mode,
          hasExistingData: hasExistingDataRef.current,
          generation,
          isCurrent: (gen) => dataGenerationRef.current.isCurrent(gen),
          load: async () => {
            const bundle = await loadHomeBundle({
              sessionToken: token,
              fetchActiveSeason,
              fetchMatches,
              fetchMyPredictions,
              fetchLiveSeasonRanking,
            })
            return {
              season: bundle.season as Season,
              matches: bundle.matches as Match[],
              predictions: bundle.predictions as Prediction[],
              ranking: bundle.ranking as Player[],
            }
          },
          onFullLoading: () => {
            setLoading(true)
            setError(null)
          },
          onSoftStart: () => {
            setError(null)
          },
          onSuccess: (bundle) => {
            void applyHomeBundle({
              ...bundle,
              sessionToken: token,
              generation,
            })
          },
          onError: (err) => {
            if (!hasExistingDataRef.current) {
              setError(toUserMessage(err))
            }
          },
          onSettled: () => {
            setLoading(false)
          },
        })
      })
    },
    [applyHomeBundle, playerId, sessionToken],
  )

  useEffect(() => {
    const generation = dataGenerationRef.current
    const guard = loadGuardRef.current
    void loadPage('initial')
    return () => {
      generation.bump()
      guard.reset()
    }
  }, [loadPage])

  const shouldPollOfficialResult = useMemo(
    () => shouldPollForOfficialResult(matches, now),
    [matches, now],
  )

  useEffect(() => {
    if (!sessionToken || !playerId) return

    const attachment = attachSoftPageRefresh({
      onRefresh: () => {
        void loadPage('soft')
      },
      shouldPoll: shouldPollOfficialResult,
    })

    return () => attachment.dispose()
  }, [shouldPollOfficialResult, loadPage, playerId, sessionToken])

  const nextOpenMatch = useMemo(() => {
    const base = findNextOpenMatch(matches, now)
    if (!base || !playerId) return null
    const prediction = getPredictionForMatch(predictions, base.id, playerId)
    return withPredictionStatus(base, Boolean(prediction), now)
  }, [matches, predictions, playerId, now])

  const primaryMatch = useMemo(() => {
    if (!playerId) return null
    const selected = selectHomePrimaryMatch(matches, now)
    if (!selected) return null
    const prediction = getPredictionForMatch(predictions, selected.id, playerId)
    return withPredictionStatus(selected, Boolean(prediction), now)
  }, [matches, predictions, playerId, now])

  const primaryPhase = primaryMatch
    ? classifyMatchPhase(primaryMatch, now)
    : null
  const isAwaitingPrimary =
    primaryPhase === 'live' || primaryPhase === 'awaiting_result'

  const pendingResultMatch = useMemo(
    () =>
      findHomePendingResultMatch(matches, primaryMatch?.id ?? null, now),
    [matches, primaryMatch?.id, now],
  )

  const lastMatch = useMemo(() => findLastFinishedMatch(matches), [matches])
  const lastPrediction = useMemo(() => {
    if (!lastMatch || !playerId) return undefined
    return getPredictionForMatch(predictions, lastMatch.id, playerId)
  }, [lastMatch, predictions, playerId])

  const primaryPrediction = useMemo(() => {
    if (!primaryMatch || !playerId) return undefined
    return getPredictionForMatch(predictions, primaryMatch.id, playerId)
  }, [primaryMatch, predictions, playerId])

  const homeRanking = useMemo(() => {
    const ranks = ranking.every((player) => player.rank != null)
      ? ranking.map((player) => player.rank as number)
      : getCompetitionRanks(ranking)
    return selectHomeRanking(ranking, ranks, activePlayer?.id ?? '')
  }, [ranking, activePlayer?.id])

  const nextOpenMatchId = nextOpenMatch?.id

  useEffect(() => {
    if (!nextOpenMatchId || !playerId) return
    const existing = getPredictionForMatch(
      predictions,
      nextOpenMatchId,
      playerId,
    )
    if (existing) {
      setDraft({ home: existing.homeScore, away: existing.awayScore })
      setSaved(true)
    } else {
      setDraft({ home: 0, away: 0 })
      setSaved(false)
    }
    setSaveError(null)
  }, [nextOpenMatchId, playerId, predictions])

  async function handleSave() {
    if (!sessionToken || !playerId || !nextOpenMatch || isAwaitingPrimary) {
      return
    }
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
        matchId: nextOpenMatch.id,
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
    void loadPage('initial')
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

  if (!primaryMatch) {
    return (
      <div className="page-stack">
        <StateCard
          title="Accueil"
          message="Aucun prochain match ouvert aux pronostics pour le moment."
        />
        {pendingResultMatch ? (
          <PendingResultBlock match={pendingResultMatch} now={now} />
        ) : null}
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

  return (
    <div className="page-stack">
      {isAwaitingPrimary ? (
        <AwaitingPrimaryCard
          match={primaryMatch}
          prediction={primaryPrediction}
          now={now}
        />
      ) : (
        <OpenPrimaryCard
          match={primaryMatch}
          now={now}
          draft={draft}
          saved={saved}
          justSaved={justSaved}
          saving={saving}
          saveError={saveError}
          hasExistingPrediction={Boolean(primaryPrediction)}
          onDraftHome={(value) => {
            setDraft((current) => ({ ...current, home: value }))
            setSaved(false)
            setJustSaved(false)
          }}
          onDraftAway={(value) => {
            setDraft((current) => ({ ...current, away: value }))
            setSaved(false)
            setJustSaved(false)
          }}
          onSave={() => {
            void handleSave()
          }}
        />
      )}

      {pendingResultMatch ? (
        <PendingResultBlock match={pendingResultMatch} now={now} />
      ) : null}

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

function AwaitingPrimaryCard({
  match,
  prediction,
  now,
}: {
  match: Match
  prediction?: Prediction
  now: Date
}) {
  const stadium = venueSecondaryLabel(match.venue)
  const phaseHeadline = matchPhaseHeadline(classifyMatchPhase(match, now))

  return (
    <section
      aria-labelledby="primary-match-title"
      className="overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow"
    >
      <div className="flex items-start justify-between gap-2 border-b border-ink/15 px-4 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.1em] text-ink/70 uppercase">
            Journée {match.matchday} · Ligue 2
          </p>
          <p className="mt-0.5 text-sm font-bold text-ink sm:mt-1 sm:text-base">
            {formatMatchDate(match.kickoffAt)}
            <span className="mx-2 text-ink/35">·</span>
            <span className="tabular-nums">
              {formatMatchTime(match.kickoffAt)}
            </span>
          </p>
        </div>
        <span className="badge shrink-0 border-green-dark bg-green-dark text-yellow max-sm:px-1.5 max-sm:text-[9px] max-sm:tracking-[0.06em]">
          Pronos fermés
        </span>
      </div>

      <div className="px-4 py-2.5 sm:px-5 sm:py-4">
        <div className="flex flex-col items-center gap-0.5 text-center sm:gap-1">
          <h1 id="primary-match-title" className="sr-only">
            {match.homeTeam} contre {match.awayTeam}
          </h1>
          <p className="text-[11px] font-bold tracking-[0.12em] text-green-dark uppercase">
            {stadium}
          </p>
        </div>

        <div className="mt-3 text-center sm:mt-4">
          <p className="text-base font-black leading-snug text-ink sm:text-lg">
            {match.homeTeam}
            <span className="mx-2 text-ink/35">–</span>
            {match.awayTeam}
          </p>
        </div>

        <div className="mt-4 text-center sm:mt-5">
          <p className="text-[11px] font-bold tracking-[0.1em] text-ink/55 uppercase">
            Ton prono
          </p>
          {prediction ? (
            <p className="mt-1 font-black tracking-tight text-ink tabular-nums text-3xl sm:text-4xl">
              {prediction.homeScore}
              <span className="mx-2 text-xl text-ink/35">–</span>
              {prediction.awayScore}
            </p>
          ) : (
            <p className="mt-1 text-lg font-black text-ink/70">
              Non pronostiqué
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-center sm:mt-5">
          <Link
            to={`/calendrier?match=${match.id}`}
            className="btn-ink w-auto min-w-[14rem]"
          >
            Voir les pronos du groupe
          </Link>
        </div>
      </div>

      <div className="flex flex-col items-center gap-0 bg-green-dark px-4 py-1.5 text-center text-white sm:gap-0.5 sm:px-5 sm:py-2.5">
        <p className="text-[11px] font-bold tracking-[0.1em] text-yellow/90 uppercase">
          Pronostics verrouillés
        </p>
        <p className="text-lg font-black tracking-wide text-yellow">
          {phaseHeadline}
        </p>
      </div>
    </section>
  )
}

function OpenPrimaryCard({
  match,
  now,
  draft,
  saved,
  justSaved,
  saving,
  saveError,
  hasExistingPrediction,
  onDraftHome,
  onDraftAway,
  onSave,
}: {
  match: Match
  now: Date
  draft: Score
  saved: boolean
  justSaved: boolean
  saving: boolean
  saveError: string | null
  hasExistingPrediction: boolean
  onDraftHome: (value: number) => void
  onDraftAway: (value: number) => void
  onSave: () => void
}) {
  const isUnconfirmed = match.status === 'kickoff_unconfirmed'
  const countdown = getCountdown(match.kickoffAt, now)
  const inputsLocked =
    isUnconfirmed || countdown.locked || match.status === 'locked'
  const stadium = venueSecondaryLabel(match.venue)

  return (
    <section
      aria-labelledby="primary-match-title"
      className="overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow"
    >
      <div className="flex items-start justify-between gap-2 border-b border-ink/15 px-4 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.1em] text-ink/70 uppercase">
            Journée {match.matchday} · Ligue 2
          </p>
          <p className="mt-0.5 text-sm font-bold text-ink sm:mt-1 sm:text-base">
            {isUnconfirmed ? (
              formatMatchDate(match.kickoffAt)
            ) : (
              <>
                {formatMatchDate(match.kickoffAt)}
                <span className="mx-2 text-ink/35">·</span>
                <span className="tabular-nums">
                  {formatMatchTime(match.kickoffAt)}
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
          <h1 id="primary-match-title" className="sr-only">
            {match.homeTeam} contre {match.awayTeam}
          </h1>
          <p className="text-[11px] font-bold tracking-[0.12em] text-green-dark uppercase">
            {stadium}
          </p>
        </div>

        <form
          className="mt-2 flex flex-col gap-2 sm:mt-3 sm:gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSave()
          }}
        >
          <div className="mx-auto grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-end gap-2 sm:max-w-lg sm:gap-3">
            <ScoreInput
              label={match.homeTeam}
              value={draft.home}
              disabled={inputsLocked || saving}
              variant="board"
              onChange={onDraftHome}
            />
            <span
              aria-hidden="true"
              className="pb-2 text-lg font-black text-ink/30 sm:pb-3.5 sm:text-2xl sm:text-ink/40"
            >
              –
            </span>
            <ScoreInput
              label={match.awayTeam}
              value={draft.away}
              disabled={inputsLocked || saving}
              variant="board"
              onChange={onDraftAway}
            />
          </div>

          <div className="flex justify-center">
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
  )
}

function PendingResultBlock({
  match,
  now,
}: {
  match: Match
  now: Date
}) {
  const phase = classifyMatchPhase(match, now)
  const headline = matchPhaseHeadline(phase)

  return (
    <section
      aria-labelledby="pending-result-title"
      className="overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink/15 px-4 py-3">
        <h2
          id="pending-result-title"
          className="text-sm font-black tracking-[0.06em] uppercase"
        >
          {headline}
        </h2>
        <p className="text-[11px] font-bold tracking-wider text-ink/60 uppercase">
          J{match.matchday} · {formatKickoff(match.kickoffAt)}
        </p>
      </div>
      <div className="px-4 py-4 text-center">
        <p className="text-sm font-semibold leading-snug text-ink">
          {match.homeTeam}
          <span className="mx-2 text-ink/35">–</span>
          {match.awayTeam}
        </p>
        <div className="mt-4 flex justify-center">
          <Link
            to={`/calendrier?match=${match.id}`}
            className="btn-ink w-auto min-w-[14rem]"
          >
            Voir les pronos du groupe
          </Link>
        </div>
      </div>
    </section>
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

        <div className="mt-4 flex flex-col items-center gap-1">
          <Link
            to={`/calendrier?match=${match.id}`}
            className="btn-ghost min-h-10 text-yellow hover:bg-white/10"
          >
            Voir le résumé complet
          </Link>
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
