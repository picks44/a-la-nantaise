import { useEffect, useMemo, useState } from 'react'
import { GroupRanking } from '../components/Podium'
import { useSession } from '../context/useSession'
import {
  fetchMatches,
  fetchRanking,
  fetchRoundParticipation,
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
import type { Match, Player, RoundParticipationRow } from '../types'

type RankingTab = 'general' | 'participation'

export function RankingPage() {
  const { sessionToken, activePlayer } = useSession()
  const [tab, setTab] = useState<RankingTab>('general')
  const [ranking, setRanking] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [participation, setParticipation] = useState<RoundParticipationRow[]>(
    [],
  )
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [participationLoading, setParticipationLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participationError, setParticipationError] = useState<string | null>(
    null,
  )

  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [rankingRows, matchRows] = await Promise.all([
          fetchRanking(sessionToken!),
          fetchMatches(sessionToken!),
        ])
        if (cancelled) return
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
            current === 'general' ? 'participation' : 'general',
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
      ) : (
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
