import { useEffect, useMemo, useState } from 'react'
import { GroupRanking } from '../components/Podium'
import { useSession } from '../context/useSession'
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
  TrophyOverview,
} from '../types'

type RankingTab = 'general' | 'participation' | 'trophies'

export function RankingPage() {
  const { sessionToken, activePlayer } = useSession()
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
            getFriendlyStatsMessage(err, 'Impossible de charger les trophees.'),
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
    <div className="space-y-4">
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
          Trophees & series
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
              <label className="block space-y-1.5">
                <span className="label-caps">Journée</span>
                <select
                  className="field-input"
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
                      'Impossible de confirmer les trophees pour le moment.',
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

  return (
    <section className="panel overflow-hidden" aria-label="Participation">
      {allNotApplicable ? (
        <p className="border-b border-border px-4 py-3 text-sm text-muted">
          Aucun match pronostiquable sur cette journée (annulé, reporté, ou
          hors période pour les joueurs).
        </p>
      ) : (
        <p className="border-b border-border px-4 py-3 text-sm font-bold text-ink">
          {summary}
        </p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const isActive = row.playerId === activePlayerId
          return (
            <li
              key={row.playerId}
              className={[
                'flex items-center gap-3 px-4 py-3',
                isActive ? 'border-l-4 border-l-green bg-success-soft/60' : '',
              ].join(' ')}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">
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
        'min-h-11 flex-1 rounded-[var(--radius-sm)] px-3 text-xs font-extrabold tracking-[0.08em] uppercase transition',
        selected
          ? 'bg-ink text-yellow'
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

function TrophyPanel({
  season,
  overview,
  loading,
  error,
  acknowledging,
  onDismissCelebration,
}: {
  season: Season | null
  overview: TrophyOverview | null
  loading: boolean
  error: string | null
  acknowledging: boolean
  onDismissCelebration: () => void
}) {
  if (loading) {
    return <StatusCard message="Chargement des trophees…" />
  }

  if (error) {
    return <StatusCard message={error} tone="error" />
  }

  if (!overview) {
    return (
      <StatusCard message="Statistiques temporairement indisponibles." tone="error" />
    )
  }

  const stats = overview.stats
  const pending = overview.pendingCelebrations

  return (
    <div className="space-y-3">
      {season ? (
        <section className="panel p-4">
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
            Saison active
          </p>
          <p className="mt-1 font-black text-ink">{season.name}</p>
        </section>
      ) : null}

      {pending.length > 0 ? (
        <section className="panel border-yellow bg-yellow/20 p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black tracking-[0.08em] uppercase text-ink">
                Nouveau trophée
              </p>
              <p className="mt-1 text-sm text-ink/80">
                {pending.length > 1
                  ? `${pending.length} nouveaux trophees ont ete debloques.`
                  : `${pending[0]?.name ?? 'Un trophee'} a ete debloque.`}
              </p>
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
          <ul className="mt-3 space-y-2">
            {pending.map((item) => (
              <li
                key={item.id}
                className="rounded-[var(--radius-sm)] border border-yellow/60 bg-white/40 px-3 py-2 text-sm"
              >
                <p className="font-bold text-ink">{item.name}</p>
                <p className="mt-1 text-ink/75">{item.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-2 sm:grid-cols-2">
        <StatsCard label="Serie actuelle de participation" value={String(stats.currentPredictionStreak)} />
        <StatsCard label="Record de participation" value={String(stats.bestPredictionStreak)} />
        <StatsCard label="Serie actuelle de bonnes issues" value={String(stats.currentGoodResultStreak)} />
        <StatsCard label="Record de bonnes issues" value={String(stats.bestGoodResultStreak)} />
        <StatsCard label="Serie actuelle de scores exacts" value={String(stats.currentExactStreak)} />
        <StatsCard label="Record de scores exacts" value={String(stats.bestExactStreak)} />
        <StatsCard label="Scores exacts au total" value={String(stats.totalExactScores)} />
        <StatsCard label="Trophees obtenus" value={String(stats.trophiesCount)} />
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-black text-ink">Mes trophees</h2>
        </div>
        {overview.earnedTrophies.length === 0 ? (
          <div className="p-4 text-sm text-muted">
            Tes premiers trophees apparaitront ici des que la saison decollera.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {overview.earnedTrophies.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-ink">{item.name}</p>
                  <span className="text-xs text-muted">
                    {new Date(item.awardedAt).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{item.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-black text-ink">Encore verrouilles</h2>
        </div>
        {overview.lockedTrophies.length === 0 ? (
          <div className="p-4 text-sm text-muted">
            Tous les trophees disponibles sont deja debloques sur cette saison.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {overview.lockedTrophies.map((item) => (
              <li key={item.trophyKey} className="px-4 py-3">
                <p className="font-bold text-ink">{item.name}</p>
                <p className="mt-1 text-sm text-muted">{item.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatsCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-ink tabular-nums">{value}</p>
    </div>
  )
}

function getFriendlyStatsMessage(error: unknown, fallback: string): string {
  const message = toUserMessage(error)
  if (message === 'Une erreur est survenue. Réessaie dans quelques instants.') {
    return fallback
  }
  return message
}
