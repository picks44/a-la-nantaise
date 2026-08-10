import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GroupRanking } from '../components/Podium'
import { PageHeader } from '../components/PageHeader'
import { RoundRecapCard } from '../components/RoundRecapCard'
import { SeasonTimelinePanel } from '../components/SeasonTimelinePanel'
import { TabButton, TabList } from '../components/TabList'
import { TrophyPanel } from '../components/TrophyPanel'
import { useSession } from '../context/useSession'
import {
  acknowledgeTrophyCelebrations,
  fetchActiveSeason,
  fetchLiveSeasonRanking,
  fetchMatches,
  fetchPlayerRoundRecap,
  fetchPlayerSeasonTimeline,
  fetchRoundParticipation,
  fetchTrophyOverview,
} from '../lib/api'
import {
  formatParticipationSummary,
  getCompetitionRanks,
  groupParticipationRows,
  listRoundNumbers,
  selectDefaultRoundNumber,
  shouldShowParticipationFraction,
  formatParticipationFraction,
  summarizeParticipation,
} from '../lib/ranking'
import { toUserMessage, UNKNOWN_USER_MESSAGE } from '../lib/errors'
import {
  createGenerationToken,
  runSoftPageLoad,
} from '../lib/calendarRefresh'
import {
  createInFlightGuard,
  loadRankingBundle,
  resolveRecapViewState,
} from '../lib/pageLoad'
import { withPageLoadTimeout } from '../lib/pageLoadTimeout'
import { formatProvisionalBadge } from '../lib/rankingDisplay'
import {
  attachSoftPageRefresh,
  hasMatchAwaitingOfficialResult,
} from '../lib/softPageRefresh'
import type {
  Match,
  Player,
  PlayerRoundRecap,
  RoundParticipationRow,
  Season,
  SeasonTimeline,
  TrophyOverview,
} from '../types'

type RankingTab = 'general' | 'participation' | 'trophies' | 'parcours'

const RANKING_TAB_ORDER: readonly RankingTab[] = [
  'general',
  'participation',
  'trophies',
  'parcours',
]

export function RankingPage() {
  const { sessionToken, activePlayer, accessCode, playerId } = useSession()
  const [tab, setTab] = useState<RankingTab>('general')
  const [ranking, setRanking] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [participation, setParticipation] = useState<RoundParticipationRow[]>(
    [],
  )
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [season, setSeason] = useState<Season | null>(null)
  const [trophyOverview, setTrophyOverview] = useState<TrophyOverview | null>(null)
  const [recap, setRecap] = useState<PlayerRoundRecap | null>(null)
  const [timeline, setTimeline] = useState<SeasonTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [participationLoading, setParticipationLoading] = useState(false)
  const [trophyLoading, setTrophyLoading] = useState(false)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [recapLoading, setRecapLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recapError, setRecapError] = useState<string | null>(null)
  const [participationError, setParticipationError] = useState<string | null>(
    null,
  )
  const [trophyError, setTrophyError] = useState<string | null>(null)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const loadGuardRef = useRef(createInFlightGuard())
  const dataGenerationRef = useRef(createGenerationToken())
  const hasExistingDataRef = useRef(false)
  const scrolledToRecapRef = useRef(false)

  useEffect(() => {
    hasExistingDataRef.current = ranking.length > 0 || matches.length > 0
  }, [ranking.length, matches.length])

  // Horloge légère pour détecter un résultat attendu (pas de polling réseau ici).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const loadPage = useCallback(
    async (mode: 'initial' | 'soft') => {
      if (!sessionToken) return
      await loadGuardRef.current.run(async () => {
        const generation = dataGenerationRef.current.next()
        const token = sessionToken

        await runSoftPageLoad({
          mode,
          hasExistingData: hasExistingDataRef.current,
          generation,
          isCurrent: (gen) => dataGenerationRef.current.isCurrent(gen),
          load: async () => {
            const bundle = await loadRankingBundle({
              sessionToken: token,
              fetchActiveSeason,
              fetchLiveSeasonRanking,
              fetchMatches,
            })
            return {
              season: bundle.season as Season,
              ranking: bundle.ranking as Player[],
              matches: bundle.matches as Match[],
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
            setSeason(bundle.season)
            setRanking(bundle.ranking)
            setMatches(bundle.matches)
            setSelectedRound((current) =>
              current ?? selectDefaultRoundNumber(bundle.matches),
            )
            setError(null)
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
    [sessionToken],
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

  const awaitingOfficialResult = useMemo(
    () => hasMatchAwaitingOfficialResult(matches, now),
    [matches, now],
  )

  useEffect(() => {
    if (!sessionToken) return

    const attachment = attachSoftPageRefresh({
      onRefresh: () => {
        void loadPage('soft')
      },
      shouldPoll: awaitingOfficialResult,
    })

    return () => attachment.dispose()
  }, [awaitingOfficialResult, loadPage, sessionToken])

  const referenceRoundNumber =
    ranking.find((row) => row.referenceRoundNumber != null)
      ?.referenceRoundNumber ?? null
  const [recapRetryKey, setRecapRetryKey] = useState(0)

  useEffect(() => {
    if (!sessionToken || !season?.id || referenceRoundNumber == null) {
      setRecap(null)
      setRecapError(null)
      setRecapLoading(false)
      return
    }
    const stableSessionToken = sessionToken
    const stableSeasonId = season.id
    const stableRound = referenceRoundNumber
    let cancelled = false

    async function loadRecap() {
      setRecapLoading(true)
      setRecapError(null)
      try {
        const payload = await withPageLoadTimeout(
          fetchPlayerRoundRecap({
            sessionToken: stableSessionToken,
            seasonId: stableSeasonId,
            roundNumber: stableRound,
          }),
        )
        if (!cancelled) {
          setRecap(payload)
          setRecapError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setRecap(null)
          setRecapError(toUserMessage(err))
        }
      } finally {
        if (!cancelled) setRecapLoading(false)
      }
    }

    void loadRecap()
    return () => {
      cancelled = true
    }
  }, [sessionToken, season?.id, referenceRoundNumber, recapRetryKey])

  useEffect(() => {
    if (!sessionToken || !season?.id || tab !== 'trophies') {
      return
    }
    const stableSessionToken = sessionToken
    const stableSeasonId = season.id
    let cancelled = false

    async function loadTrophies() {
      setTrophyLoading(true)
      setTrophyError(null)
      try {
        const overview = await fetchTrophyOverview({
          sessionToken: stableSessionToken,
          seasonId: stableSeasonId,
        })
        if (!cancelled) setTrophyOverview(overview)
      } catch (err) {
        if (!cancelled) {
          setTrophyError(
            getFriendlyStatsMessage(err, 'Impossible de charger les trophées.'),
          )
        }
      } finally {
        if (!cancelled) setTrophyLoading(false)
      }
    }

    void loadTrophies()
    return () => {
      cancelled = true
    }
  }, [sessionToken, season?.id, tab])

  useEffect(() => {
    if (!sessionToken || selectedRound == null || tab !== 'participation') {
      return
    }
    let cancelled = false

    async function loadParticipation() {
      setParticipationLoading(true)
      setParticipationError(null)
      try {
        const rows = await fetchRoundParticipation(
          sessionToken!,
          selectedRound!,
        )
        if (!cancelled) setParticipation(rows)
      } catch (err) {
        if (!cancelled) setParticipationError(toUserMessage(err))
      } finally {
        if (!cancelled) setParticipationLoading(false)
      }
    }

    void loadParticipation()
    return () => {
      cancelled = true
    }
  }, [sessionToken, selectedRound, tab])

  useEffect(() => {
    document
      .getElementById(`tab-${tab}`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  useEffect(() => {
    if (!sessionToken || !season?.id || tab !== 'parcours') return
    const stableSessionToken = sessionToken
    const stableSeasonId = season.id
    let cancelled = false

    async function loadTimeline() {
      setTimelineLoading(true)
      setTimelineError(null)
      try {
        const payload = await fetchPlayerSeasonTimeline({
          sessionToken: stableSessionToken,
          seasonId: stableSeasonId,
        })
        if (!cancelled) setTimeline(payload)
      } catch (err) {
        if (!cancelled) setTimelineError(toUserMessage(err))
      } finally {
        if (!cancelled) setTimelineLoading(false)
      }
    }

    void loadTimeline()
    return () => {
      cancelled = true
    }
  }, [sessionToken, season?.id, tab])

  const ranks = useMemo(
    () =>
      ranking.every((player) => player.rank != null)
        ? ranking.map((player) => player.rank as number)
        : getCompetitionRanks(ranking),
    [ranking],
  )
  const roundNumbers = useMemo(() => listRoundNumbers(matches), [matches])
  const isProvisional = ranking.some((player) => player.isRankingProvisional)
  const referenceRound = referenceRoundNumber
  const recapView = resolveRecapViewState({
    loading: recapLoading,
    error: recapError,
    recap,
    hasReferenceRound: referenceRound != null,
  })

  useEffect(() => {
    if (scrolledToRecapRef.current) return
    if (recapView.status !== 'success') return
    if (window.location.hash !== '#recap') return
    const el = document.getElementById('recap')
    if (!el) return
    scrolledToRecapRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [recapView.status])

  function retry() {
    void loadPage('initial')
  }

  function retryRecap() {
    setRecapRetryKey((key) => key + 1)
  }

  return (
    <div className="page-stack min-w-0">
      <div className="space-y-3">
        <PageHeader
          title="Classement"
          description="La course du groupe, journée après journée."
        />

        <TabList
          label="Vues du classement"
          value={tab}
          onChange={setTab}
          order={RANKING_TAB_ORDER}
        >
          <TabButton
            selected={tab === 'general'}
            onSelect={() => setTab('general')}
            id="tab-general"
            controls="panel-general"
          >
            Général
          </TabButton>
          <TabButton
            selected={tab === 'participation'}
            onSelect={() => setTab('participation')}
            id="tab-participation"
            controls="panel-participation"
          >
            Participation
          </TabButton>
          <TabButton
            selected={tab === 'trophies'}
            onSelect={() => setTab('trophies')}
            id="tab-trophies"
            controls="panel-trophies"
          >
            Trophées & séries
          </TabButton>
          <TabButton
            selected={tab === 'parcours'}
            onSelect={() => setTab('parcours')}
            id="tab-parcours"
            controls="panel-parcours"
          >
            Parcours
          </TabButton>
        </TabList>
      </div>

      {loading ? (
        <StatusCard message="Chargement du classement…" />
      ) : error ? (
        <div className="space-y-3">
          <StatusCard message={error} tone="error" />
          <button type="button" className="btn-secondary" onClick={retry}>
            Réessayer
          </button>
        </div>
      ) : tab === 'general' ? (
        <div
          role="tabpanel"
          id="panel-general"
          aria-labelledby="tab-general"
          className="space-y-4"
        >
          {referenceRound != null && recapView.status !== 'success' ? (
            <p className="text-[11px] font-medium tracking-wide text-ink/50">
              Journée {referenceRound} · {formatProvisionalBadge(isProvisional)}
            </p>
          ) : null}
          {recapView.status === 'loading' ? (
            <StatusCard message="Chargement du récap…" />
          ) : recapView.status === 'error' ? (
            <div className="space-y-2">
              <StatusCard message={recapView.message} tone="error" />
              <button
                type="button"
                className="btn-secondary"
                onClick={retryRecap}
              >
                Réessayer le récap
              </button>
            </div>
          ) : recapView.status === 'success' ? (
            <RoundRecapCard recap={recapView.recap as PlayerRoundRecap} />
          ) : null}
          {ranking.length === 0 ? (
            <div className="panel border-dashed p-6 text-center">
              <p className="font-bold text-ink">Classement vide</p>
              <p className="mt-1 text-sm text-muted">
                Invite des amis pour lancer la compétition.
              </p>
            </div>
          ) : (
            <GroupRanking
              players={ranking}
              ranks={ranks}
              activePlayerId={activePlayer?.id ?? ''}
              title="Classement complet"
              showLink={false}
              variant="full"
              live
            />
          )}
        </div>
      ) : tab === 'participation' ? (
        <div
          role="tabpanel"
          id="panel-participation"
          aria-labelledby="tab-participation"
          className="space-y-3"
        >
          {roundNumbers.length === 0 ? (
            <div className="panel border-dashed p-6 text-center">
              <p className="font-bold text-ink">Aucune journée</p>
              <p className="mt-1 text-sm text-muted">
                Les journées apparaîtront dès que le calendrier sera chargé.
              </p>
            </div>
          ) : (
            <>
              <label className="panel flex flex-col gap-1.5 p-3 sm:flex-row sm:items-center sm:gap-3">
                <span className="label-caps shrink-0">Journée</span>
                <select
                  className="field-input min-h-11 flex-1 border-2 border-ink bg-surface font-semibold"
                  value={selectedRound ?? ''}
                  onChange={(event) =>
                    setSelectedRound(Number(event.target.value))
                  }
                >
                  {roundNumbers.map((round) => (
                    <option key={round} value={round}>
                      Journée {round}
                    </option>
                  ))}
                </select>
              </label>

              {participationLoading ? (
                <StatusCard message="Chargement de la participation…" />
              ) : participationError ? (
                <StatusCard message={participationError} tone="error" />
              ) : participation.length === 0 ? (
                <div className="panel border-dashed p-6 text-center">
                  <p className="font-bold text-ink">Aucun participant</p>
                  <p className="mt-1 text-sm text-muted">
                    Aucun joueur actif pour cette journée.
                  </p>
                </div>
              ) : (
                <ParticipationList
                  rows={participation}
                  activePlayerId={activePlayer?.id ?? ''}
                />
              )}
            </>
          )}
        </div>
      ) : tab === 'trophies' ? (
        <div
          role="tabpanel"
          id="panel-trophies"
          aria-labelledby="tab-trophies"
          className="space-y-3"
        >
          <TrophyPanel
            overview={trophyOverview}
            loading={trophyLoading}
            error={trophyError}
            acknowledging={acknowledging}
            groupId={accessCode ?? ''}
            playerId={playerId ?? activePlayer?.id ?? ''}
            onDismissCelebration={() => {
              if (!sessionToken || !season?.id || acknowledging) return
              setAcknowledging(true)
              void acknowledgeTrophyCelebrations({
                sessionToken,
                seasonId: season.id,
              })
                .then(() => {
                  setTrophyOverview((current) =>
                    current
                      ? { ...current, pendingCelebrations: [] }
                      : current,
                  )
                })
                .catch((err) => {
                  setTrophyError(
                    getFriendlyStatsMessage(
                      err,
                      'Impossible de confirmer les trophées pour le moment.',
                    ),
                  )
                })
                .finally(() => setAcknowledging(false))
            }}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="panel-parcours"
          aria-labelledby="tab-parcours"
          className="space-y-3"
        >
          {timelineLoading ? (
            <StatusCard message="Chargement du parcours…" />
          ) : timelineError ? (
            <StatusCard message={timelineError} tone="error" />
          ) : !timeline || timeline.rounds.length === 0 ? (
            <div className="panel border-dashed p-6 text-center">
              <p className="font-bold text-ink">Parcours en construction</p>
              <p className="mt-1 text-sm text-muted">
                Ton parcours commencera après la première journée terminée.
              </p>
            </div>
          ) : (
            <SeasonTimelinePanel timeline={timeline} />
          )}
        </div>
      )}
    </div>
  )
}

function ParticipationList({
  rows,
  activePlayerId,
}: {
  rows: RoundParticipationRow[]
  activePlayerId: string
}) {
  const allNotApplicable = rows.every(
    (row) => row.status === 'not_applicable',
  )
  const { predictedCount, applicableCount } = summarizeParticipation(rows)
  const summary = formatParticipationSummary(predictedCount, applicableCount)
  const { complete, partial, missing } = groupParticipationRows(rows)
  const roundNumber = rows[0]?.roundNumber

  return (
    <section className="panel overflow-hidden" aria-label="Participation">
      <div className="space-y-1.5 border-b border-border px-4 py-3">
        {roundNumber != null ? (
          <h3 className="text-base font-extrabold text-ink">
            Journée {roundNumber}
          </h3>
        ) : null}
        {allNotApplicable ? (
          <p className="text-sm text-muted">
            Aucun match pronostiquable sur cette journée (annulé, reporté, ou
            hors période pour les joueurs).
          </p>
        ) : (
          <p className="text-sm font-bold text-ink">{summary}</p>
        )}
      </div>

      {!allNotApplicable ? (
        <div className="space-y-4 px-4 py-3.5">
          <ParticipationGroup
            title="Pronostics enregistrés"
            rows={complete}
            activePlayerId={activePlayerId}
            emptyLabel="Personne n’a encore validé tous ses pronos."
            showCheck
          />
          {partial.length > 0 ? (
            <ParticipationGroup
              title="En cours"
              rows={partial}
              activePlayerId={activePlayerId}
              showFraction
            />
          ) : null}
          <ParticipationGroup
            title="En attente"
            rows={missing}
            activePlayerId={activePlayerId}
            emptyLabel="Tout le monde a pronostiqué."
          />
        </div>
      ) : null}
    </section>
  )
}

function ParticipationGroup({
  title,
  rows,
  activePlayerId,
  emptyLabel,
  showCheck = false,
  showFraction = false,
}: {
  title: string
  rows: RoundParticipationRow[]
  activePlayerId: string
  emptyLabel?: string
  showCheck?: boolean
  showFraction?: boolean
}) {
  const heading = `${title} · ${rows.length}`

  return (
    <section className="space-y-1.5" aria-label={heading}>
      <h4 className="text-[11px] font-bold tracking-[0.12em] text-ink/55 uppercase">
        {heading}
      </h4>
      {rows.length === 0 ? (
        emptyLabel ? (
          <p className="text-sm text-muted">{emptyLabel}</p>
        ) : null
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((row) => {
            const isActive = row.playerId === activePlayerId
            const fractionVisible =
              showFraction || shouldShowParticipationFraction(row)
            return (
              <li
                key={row.playerId}
                className={[
                  'flex items-baseline gap-2 px-0.5 py-1',
                  isActive ? 'rounded-[var(--radius-sm)] bg-success-soft/70' : '',
                ].join(' ')}
              >
                {showCheck ? (
                  <span
                    className="w-3.5 shrink-0 text-center font-bold text-green-dark"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                  {row.pseudo}
                </span>
                {isActive ? (
                  <span className="badge-text shrink-0 border-green bg-green text-white">
                    Toi
                  </span>
                ) : null}
                {fractionVisible ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink/65">
                    {formatParticipationFraction(row)}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function StatusCard({
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


function getFriendlyStatsMessage(error: unknown, fallback: string): string {
  const message = toUserMessage(error)
  if (message === UNKNOWN_USER_MESSAGE) {
    return fallback
  }
  return message
}
