import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarCheck,
  Crown,
  Eye,
  Flame,
  Lock,
  Medal,
  Shield,
  Sparkles,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react'
import { GroupRanking } from '../components/Podium'
import { ConfettiBurst } from '../components/ConfettiBurst'
import { useSession } from '../context/useSession'
import {
  celebrationStorageKey,
  getCelebrationNumber,
  getCelebrationFlag,
  setCelebrationNumber,
  setCelebrationFlag,
} from '../lib/celebrations'
import {
  acknowledgeTrophyCelebrations,
  fetchActiveSeason,
  fetchMatches,
  fetchRanking,
  fetchRoundParticipation,
  fetchTrophyOverview,
} from '../lib/api'
import {
  formatParticipationSummary,
  getCompetitionRanks,
  listRoundNumbers,
  selectDefaultRoundNumber,
  summarizeParticipation,
} from '../lib/ranking'
import { toUserMessage } from '../lib/errors'
import {
  participationClassName,
  participationLabel,
} from '../lib/rankingDisplay'
import type {
  Match,
  Player,
  RoundParticipationRow,
  Season,
  TrophyAward,
  TrophyOverview,
} from '../types'

type RankingTab = 'general' | 'participation' | 'trophies'

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
  const [loading, setLoading] = useState(true)
  const [participationLoading, setParticipationLoading] = useState(false)
  const [trophyLoading, setTrophyLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participationError, setParticipationError] = useState<string | null>(
    null,
  )
  const [trophyError, setTrophyError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)

  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [seasonRow, rankingRows, matchRows] = await Promise.all([
          fetchActiveSeason(sessionToken!),
          fetchRanking(sessionToken!),
          fetchMatches(sessionToken!),
        ])
        if (cancelled) return
        setSeason(seasonRow)
        setRanking(rankingRows)
        setMatches(matchRows)
        setSelectedRound((current) =>
          current ?? selectDefaultRoundNumber(matchRows),
        )
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
  }, [sessionToken])

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

  const ranks = useMemo(() => getCompetitionRanks(ranking), [ranking])
  const roundNumbers = useMemo(() => listRoundNumbers(matches), [matches])

  function retry() {
    if (!sessionToken) return
    setLoading(true)
    setError(null)
    void Promise.all([
      fetchRanking(sessionToken),
      fetchMatches(sessionToken),
    ])
      .then(([rankingRows, matchRows]) => {
        setRanking(rankingRows)
        setMatches(matchRows)
        setSelectedRound((current) =>
          current ?? selectDefaultRoundNumber(matchRows),
        )
      })
      .catch((err) => setError(toUserMessage(err)))
      .finally(() => setLoading(false))
  }

  return (
    <div className="page-stack">
      <header>
        <h1 className="title-display">Classement</h1>
        <p className="mt-1 text-sm text-muted">
          Vue générale et suivi des pronostics par journée.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Vues du classement"
        className="flex rounded-[var(--radius-sm)] border border-ink bg-surface p-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
          event.preventDefault()
          setTab((current) =>
            current === 'general'
              ? 'participation'
              : current === 'participation'
                ? 'trophies'
                : 'general',
          )
        }}
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
        >
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
      ) : (
        <div
          role="tabpanel"
          id="panel-trophies"
          aria-labelledby="tab-trophies"
          className="space-y-3"
        >
          <TrophyPanel
            season={season}
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
  const progressRatio =
    applicableCount > 0 ? predictedCount / applicableCount : 0

  return (
    <section className="panel overflow-hidden" aria-label="Participation">
      {allNotApplicable ? (
        <p className="border-b border-border px-4 py-3 text-sm text-muted">
          Aucun match pronostiquable sur cette journée (annulé, reporté, ou
          hors période pour les joueurs).
        </p>
      ) : (
        <div className="space-y-2 border-b border-border px-4 py-3">
          <p className="text-sm font-bold text-ink">{summary}</p>
          <div
            className="h-2 overflow-hidden rounded-full border border-ink/15 bg-canvas"
            role="progressbar"
            aria-valuenow={predictedCount}
            aria-valuemin={0}
            aria-valuemax={applicableCount}
            aria-label="Progression des pronostics"
          >
            <div
              className="h-full bg-green transition-[width]"
              style={{ width: `${Math.round(progressRatio * 100)}%` }}
            />
          </div>
        </div>
      )}
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const isActive = row.playerId === activePlayerId
          return (
            <li
              key={row.playerId}
              className={[
                'flex items-center gap-3 px-4 py-2.5 sm:py-3',
                isActive ? 'border-l-4 border-l-green bg-success-soft/60' : '',
              ].join(' ')}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="truncate">{row.pseudo}</span>
                  {isActive ? (
                    <span className="badge border-green bg-green text-white">
                      Toi
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs font-medium text-ink/65">
                  {row.predictedCount}/{row.expectedCount} prono
                  {row.expectedCount > 1 ? 's' : ''}
                </p>
              </div>
              <span
                className={[
                  'badge',
                  participationClassName(row.status),
                ].join(' ')}
              >
                {participationLabel(row.status)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TabButton({
  selected,
  onSelect,
  id,
  controls,
  children,
}: {
  selected: boolean
  onSelect: () => void
  id: string
  controls: string
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      className={[
        'min-h-10 flex-1 rounded-[var(--radius-sm)] px-3 text-xs font-extrabold tracking-[0.08em] uppercase transition-[color,background-color] duration-150 ease-out',
        selected
          ? 'bg-green-dark text-yellow'
          : 'text-ink/65 hover:bg-canvas hover:text-ink',
      ].join(' ')}
      onClick={onSelect}
    >
      {children}
    </button>
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

const SIGNIFICANT_CONFETTI_TROPHY_KEYS = new Set<string>([
  'first_participation',
  'first_exact_score',
] )

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function TrophyPanel({
  season,
  overview,
  loading,
  error,
  acknowledging,
  groupId,
  playerId,
  onDismissCelebration,
}: {
  season: Season | null
  overview: TrophyOverview | null
  loading: boolean
  error: string | null
  acknowledging: boolean
  groupId: string
  playerId: string
  onDismissCelebration: () => void
}) {
  const stats = overview?.stats ?? {
    currentPredictionStreak: 0,
    bestPredictionStreak: 0,
    currentGoodResultStreak: 0,
    bestGoodResultStreak: 0,
    currentExactStreak: 0,
    bestExactStreak: 0,
    totalExactScores: 0,
    trophiesCount: 0,
  }
  const pending = overview?.pendingCelebrations ?? []
  const seasonId = overview?.seasonId ?? ''

  const isColdStart =
    stats.trophiesCount === 0 &&
    stats.totalExactScores === 0 &&
    stats.currentPredictionStreak === 0 &&
    stats.bestPredictionStreak === 0

  const pendingIdsSignature = pending.map((p) => p.id).slice().sort().join('|')
  const confettiIdsSignature = pending
    .filter((p) => SIGNIFICANT_CONFETTI_TROPHY_KEYS.has(p.trophyKey))
    .map((p) => p.id)
    .slice()
    .sort()
    .join('|')

  const [panelAnimatedSignature, setPanelAnimatedSignature] = useState<string | null>(
    null,
  )
  const [confettiActive, setConfettiActive] = useState(false)

  const lastPanelSignatureRef = useRef<string | null>(null)
  const lastConfettiSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!groupId || !playerId || !seasonId) return

    if (
      pendingIdsSignature &&
      lastPanelSignatureRef.current !== pendingIdsSignature
    ) {
      lastPanelSignatureRef.current = pendingIdsSignature
      const panelKey = celebrationStorageKey({
        groupId,
        playerId,
        seasonId,
        eventType: 'trophy_pending_panel',
        eventId: pendingIdsSignature,
      })

      const shouldAnimatePanel = !getCelebrationFlag(panelKey)
      if (shouldAnimatePanel) {
        setPanelAnimatedSignature(pendingIdsSignature)
        setCelebrationFlag(panelKey)
      } else {
        setPanelAnimatedSignature(null)
      }
    }

    const reduced = prefersReducedMotion()
    if (
      !confettiActive &&
      confettiIdsSignature &&
      lastConfettiSignatureRef.current !== confettiIdsSignature
    ) {
      lastConfettiSignatureRef.current = confettiIdsSignature
      const confettiKey = celebrationStorageKey({
        groupId,
        playerId,
        seasonId,
        eventType: 'trophy_confetti',
        eventId: confettiIdsSignature,
      })

      if (!getCelebrationFlag(confettiKey)) {
        setCelebrationFlag(confettiKey)
        // Even when animations are neutralized (prefers-reduced-motion),
        // we still consider the celebration as "seen" to prevent a later replay.
        if (!reduced) {
          setConfettiActive(true)
        }
      }
    }
  }, [
    groupId,
    playerId,
    seasonId,
    pendingIdsSignature,
    confettiIdsSignature,
    confettiActive,
  ])

  const championPendingIdsSignature = pending
    .filter((p) => p.trophyKey === 'champion_de_la_journee')
    .map((p) => p.id)
    .slice()
    .sort()
    .join('|')

  const [championAnimatedSignature, setChampionAnimatedSignature] = useState<
    string | null
  >(null)
  const lastChampionSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!groupId || !playerId || !seasonId) return
    if (!championPendingIdsSignature) return

    if (lastChampionSignatureRef.current === championPendingIdsSignature)
      return
    lastChampionSignatureRef.current = championPendingIdsSignature

    const key = celebrationStorageKey({
      groupId,
      playerId,
      seasonId,
      eventType: 'trophy_champion_day_highlight',
      eventId: championPendingIdsSignature,
    })

    const shouldAnimate = !getCelebrationFlag(key)
    if (shouldAnimate) {
      setChampionAnimatedSignature(championPendingIdsSignature)
      setCelebrationFlag(key)
    } else {
      setChampionAnimatedSignature(null)
    }
  }, [groupId, playerId, seasonId, championPendingIdsSignature])

  const recordValueKey = useMemo(() => {
    return groupId && playerId && seasonId
      ? celebrationStorageKey({
          groupId,
          playerId,
          seasonId,
          eventType: 'record_personal_best_prediction_streak',
          eventId: 'bestPredictionStreak',
        })
      : ''
  }, [groupId, playerId, seasonId])

  const recordBaselineRef = useRef<number | null>(null)
  const recordPulseTimerRef = useRef<number | null>(null)

  const [recordPulseNonce, setRecordPulseNonce] = useState(0)
  const [recordPulseActive, setRecordPulseActive] = useState(false)

  useEffect(() => {
    if (!groupId || !playerId || !seasonId) return
    if (!recordValueKey) return

    const current = stats.bestPredictionStreak

    if (recordBaselineRef.current == null) {
      const stored = getCelebrationNumber(recordValueKey)
      if (stored == null) {
        setCelebrationNumber(recordValueKey, current)
        recordBaselineRef.current = current
        return
      }
      recordBaselineRef.current = stored
    }

    const baseline = recordBaselineRef.current
    if (current > baseline) {
      recordBaselineRef.current = current
      setCelebrationNumber(recordValueKey, current)

      setRecordPulseNonce((n) => n + 1)
      setRecordPulseActive(true)

      if (recordPulseTimerRef.current != null) {
        globalThis.clearTimeout(recordPulseTimerRef.current)
      }
      recordPulseTimerRef.current = globalThis.setTimeout(
        () => setRecordPulseActive(false),
        420,
      )
    }
  }, [groupId, playerId, seasonId, recordValueKey, stats.bestPredictionStreak])

  useEffect(() => {
    return () => {
      if (recordPulseTimerRef.current != null) {
        globalThis.clearTimeout(recordPulseTimerRef.current)
        recordPulseTimerRef.current = null
      }
    }
  }, [])

  if (loading) {
    return <StatusCard message="Chargement des trophées…" />
  }

  if (error) {
    return <StatusCard message={error} tone="error" />
  }

  if (!overview) {
    return (
      <StatusCard
        message="Statistiques temporairement indisponibles."
        tone="error"
      />
    )
  }

  return (
    <div className="page-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-black text-ink">Trophées & séries</h2>
        {season ? (
          <span className="badge border-ink bg-yellow text-ink">
            {season.name}
          </span>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <section
          className={[
            'relative overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow',
            panelAnimatedSignature === pendingIdsSignature
              ? 'ui-trophy-panel-reveal'
              : '',
          ].join(' ')}
          aria-live="polite"
        >
          {confettiActive ? (
            <ConfettiBurst
              reducedMotion={prefersReducedMotion()}
              onDone={() => setConfettiActive(false)}
            />
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-11 items-center justify-center rounded-[var(--radius-sm)] border border-ink bg-green-dark text-yellow">
                <Trophy className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-black tracking-[0.08em] uppercase text-ink">
                  Nouveau trophée
                </p>
                <p className="mt-1 text-sm text-ink/80">
                  {pending.length > 1
                    ? `${pending.length} nouveaux trophées ont été débloqués.`
                    : `${pending[0]?.name ?? 'Un trophée'} a été débloqué.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-ink min-h-11 sm:w-auto"
              onClick={onDismissCelebration}
              disabled={acknowledging}
            >
              {acknowledging ? 'Validation…' : 'Fermer'}
            </button>
          </div>
          <ul className="divide-y divide-ink/15 border-t border-ink/20">
            {pending.map((item, index) => {
              const panelShouldAnimate = panelAnimatedSignature === pendingIdsSignature
              const stagger = panelShouldAnimate && index < 3
              const championHighlight =
                !stagger &&
                championAnimatedSignature === championPendingIdsSignature &&
                item.trophyKey === 'champion_de_la_journee'
              return (
                <li
                  key={item.id}
                  className={[
                    'flex items-start gap-3 px-4 py-3',
                    stagger ? 'ui-trophy-item-reveal' : '',
                    championHighlight ? 'ui-champion-trophy-highlight' : '',
                  ].join(' ')}
                  style={stagger ? { animationDelay: `${index * 120}ms` } : undefined}
                >
                <TrophyIcon name={item.icon} unlocked />
                <div>
                  <p className="font-bold text-ink">{item.name}</p>
                  <p className="mt-0.5 text-sm text-ink/75">{item.description}</p>
                </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[var(--radius-md)] border border-green-dark bg-green-dark text-yellow">
        <div className="grid gap-0 sm:grid-cols-3">
          <HeroStat
            icon={Flame}
            label="Série actuelle"
            value={String(stats.currentPredictionStreak)}
            hint="participations d’affilée"
          />
          <div
            key={recordPulseNonce}
            className={recordPulseActive ? 'ui-record-highlight' : undefined}
          >
            <HeroStat
              icon={Crown}
              label="Record"
              value={String(stats.bestPredictionStreak)}
              hint="meilleure série"
              bordered
            />
          </div>
          <HeroStat
            icon={Trophy}
            label="Trophées obtenus"
            value={String(stats.trophiesCount)}
            hint={
              stats.totalExactScores > 0
                ? `${stats.totalExactScores} score${stats.totalExactScores > 1 ? 's' : ''} exact${stats.totalExactScores > 1 ? 's' : ''}`
                : 'cette saison'
            }
            bordered
          />
        </div>
      </section>

      {isColdStart ? (
        <section className="panel border-dashed p-6 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-ink bg-yellow text-ink">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <p className="mt-4 font-black text-ink">La chasse commence ici</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Pronostique ton prochain match pour débloquer « Première
            participation » et lancer tes séries.
          </p>
        </section>
      ) : null}

      {overview.earnedTrophies.length > 0 ? (
        <section className="space-y-2">
          <h3 className="label-caps">Débloqués</h3>
          <ul className="space-y-2">
            {overview.earnedTrophies.map((item) => (
              <li key={item.id}>
                <EarnedTrophyCard trophy={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview.lockedTrophies.length > 0 ? (
        <section className="space-y-2">
          <h3 className="label-caps">
            {overview.earnedTrophies.length > 0 ? 'Encore à débloquer' : 'Objectifs'}
          </h3>
          <ul className="space-y-2">
            {overview.lockedTrophies.map((item) => (
              <li key={item.trophyKey}>
                <LockedTrophyCard trophy={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function HeroStat({
  icon: Icon,
  label,
  value,
  hint,
  bordered = false,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
  bordered?: boolean
}) {
  return (
    <div
      className={[
        'px-4 py-4',
        bordered ? 'border-t border-yellow/25 sm:border-t-0 sm:border-l' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 text-yellow/80">
        <Icon className="size-4" aria-hidden />
        <p className="text-[11px] font-bold tracking-[0.08em] uppercase">
          {label}
        </p>
      </div>
      <p className="mt-2 text-3xl font-black tabular-nums text-yellow">{value}</p>
      <p className="mt-1 text-xs text-yellow/70">{hint}</p>
    </div>
  )
}

function EarnedTrophyCard({ trophy }: { trophy: TrophyAward }) {
  return (
    <article className="panel overflow-hidden border-green-dark/40 bg-green-dark/5">
      <div className="flex items-start gap-3 p-4">
        <TrophyIcon name={trophy.icon} unlocked />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-ink">{trophy.name}</p>
            <span className="badge border-green-dark bg-green-dark text-white">
              Débloqué
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{trophy.description}</p>
          <p className="mt-2 text-xs font-semibold text-ink/70">
            {new Date(trophy.awardedAt).toLocaleDateString('fr-FR')}
            {trophy.sourceRoundNumber != null
              ? ` · Journée ${trophy.sourceRoundNumber}`
              : ''}
            {trophy.sourceMatchLabel ? ` · ${trophy.sourceMatchLabel}` : ''}
          </p>
        </div>
      </div>
    </article>
  )
}

function LockedTrophyCard({
  trophy,
}: {
  trophy: TrophyOverview['lockedTrophies'][number]
}) {
  const hasProgress =
    trophy.progressCurrent != null &&
    trophy.progressTarget != null &&
    trophy.progressTarget > 0
  const ratio = hasProgress
    ? Math.min(1, trophy.progressCurrent! / trophy.progressTarget!)
    : 0
  const nearComplete = hasProgress && ratio >= 0.5

  return (
    <article
      className={[
        'panel overflow-hidden',
        nearComplete ? 'border-yellow bg-yellow/10' : 'opacity-90',
      ].join(' ')}
    >
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <TrophyIcon name={trophy.icon} unlocked={false} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{trophy.name}</p>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-[0.08em] uppercase text-muted">
              <Lock className="size-3" aria-hidden />
              Verrouillé
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{trophy.description}</p>
          {hasProgress ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs font-bold text-ink">
                <span>Progression</span>
                <span className="tabular-nums">
                  {trophy.progressCurrent}/{trophy.progressTarget}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full border border-ink/20 bg-canvas"
                role="progressbar"
                aria-valuenow={trophy.progressCurrent!}
                aria-valuemin={0}
                aria-valuemax={trophy.progressTarget!}
              >
                <div
                  className="h-full bg-yellow transition-[width]"
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs font-semibold text-muted">
              Se débloque en match — à surveiller
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

const TROPHY_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  target: Target,
  medal: Medal,
  eye: Eye,
  'calendar-check': CalendarCheck,
  crown: Crown,
  trophy: Trophy,
  shield: Shield,
}

function TrophyIcon({
  name,
  unlocked,
}: {
  name: string
  unlocked: boolean
}) {
  const Icon = TROPHY_ICONS[name] ?? Trophy
  return (
    <span
      className={[
        'flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border',
        unlocked
          ? 'border-ink bg-yellow text-ink'
          : 'border-border bg-surface-muted text-muted',
      ].join(' ')}
      aria-hidden
    >
      <Icon className="size-5" />
    </span>
  )
}

function getFriendlyStatsMessage(error: unknown, fallback: string): string {
  const message = toUserMessage(error)
  if (message === 'Une erreur est survenue. Réessaie dans quelques instants.') {
    return fallback
  }
  return message
}
