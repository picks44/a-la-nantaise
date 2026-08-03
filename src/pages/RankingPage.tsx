import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../context/useSession'
import { fetchRanking, getDenseRanks } from '../lib/api'
import { toUserMessage } from '../lib/errors'
import type { Player } from '../types'

export function RankingPage() {
  const { accessCode, activePlayer } = useSession()
  const [ranking, setRanking] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessCode) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const rows = await fetchRanking(accessCode!)
        if (!cancelled) setRanking(rows)
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
  }, [accessCode])

  const ranks = useMemo(() => getDenseRanks(ranking), [ranking])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="title-display">Classement</h1>
        <p className="mt-1 text-sm text-muted">
          Dense, sans pitié amicale — ou presque.
        </p>
      </header>

      {loading ? (
        <StatusCard message="Chargement du classement…" />
      ) : error ? (
        <StatusCard message={error} tone="error" />
      ) : ranking.length === 0 ? (
        <div className="panel border-dashed p-6 text-center">
          <p className="font-bold text-ink">Classement vide</p>
          <p className="mt-1 text-sm text-muted">
            Invite des amis pour lancer la compétition.
          </p>
        </div>
      ) : (
        <section
          aria-labelledby="full-ranking-title"
          className="panel overflow-hidden"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span aria-hidden="true" className="h-5 w-1.5 bg-green" />
            <h2
              id="full-ranking-title"
              className="text-sm font-black tracking-[0.06em] uppercase"
            >
              Classement complet
            </h2>
          </div>

          <ol className="divide-y divide-border bg-surface">
            {ranking.map((player, index) => {
              const isActive = player.id === activePlayer?.id
              const rank = ranks[index]
              const isTie = ranks.filter((value) => value === rank).length > 1
              const isFirstOccurrenceOfRank =
                ranks.findIndex((value) => value === rank) === index

              return (
                <li
                  key={player.id}
                  className={[
                    'flex items-center gap-3 px-4 py-3',
                    isActive ? 'border-l-4 border-l-green bg-success-soft/70' : '',
                  ].join(' ')}
                >
                  <div className="w-12 shrink-0">
                    <span
                      className={[
                        'block text-2xl leading-none font-black tabular-nums',
                        rank === 1 && isFirstOccurrenceOfRank
                          ? 'text-ink'
                          : 'text-green-dark',
                      ].join(' ')}
                    >
                      {rank}
                    </span>
                    {rank === 1 && isFirstOccurrenceOfRank ? (
                      <span
                        aria-hidden="true"
                        className="mt-1 block h-1 w-6 rounded-sm bg-yellow"
                      />
                    ) : null}
                    {isTie ? (
                      <span className="text-[10px] font-bold tracking-wider text-ink/60 uppercase">
                        ex æquo
                      </span>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      <span className="truncate text-base">{player.pseudo}</span>
                      {isActive ? (
                        <span className="badge border-green bg-green text-white">
                          Toi
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs font-medium text-ink/65">
                      {player.exactScores} exact
                      {player.exactScores > 1 ? 's' : ''}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xl font-black tabular-nums">
                      {player.points}
                    </p>
                    <p className="text-[10px] font-bold tracking-wider uppercase opacity-60">
                      pts
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
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
