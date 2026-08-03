import { Link } from 'react-router-dom'
import type { Player } from '../types'

interface GroupRankingProps {
  players: Player[]
  ranks: number[]
  activePlayerId: string
  title?: string
  showLink?: boolean
}

/** Classement compact du groupe — tous les participants, ordre métier inchangé. */
export function GroupRanking({
  players,
  ranks,
  activePlayerId,
  title = 'Classement du groupe',
  showLink = true,
}: GroupRankingProps) {
  if (players.length === 0) {
    return (
      <section
        aria-labelledby="group-ranking-title"
        className="panel overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span aria-hidden="true" className="h-5 w-1.5 bg-green" />
          <h2
            id="group-ranking-title"
            className="text-sm font-black tracking-[0.06em] uppercase"
          >
            {title}
          </h2>
        </div>
        <p className="px-4 py-4 text-sm text-muted">
          Pas encore de joueurs pour afficher le classement.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="group-ranking-title" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="h-5 w-1.5 shrink-0 bg-green" />
          <h2
            id="group-ranking-title"
            className="truncate text-sm font-black tracking-[0.06em] uppercase"
          >
            {title}
          </h2>
        </div>
        {showLink ? (
          <Link
            to="/classement"
            className="shrink-0 text-[11px] font-bold tracking-[0.1em] text-green uppercase underline-offset-2 hover:underline"
          >
            Voir le classement
          </Link>
        ) : null}
      </div>

      <ol className="divide-y divide-border">
        {players.map((player, index) => {
          const isActive = player.id === activePlayerId
          const rank = ranks[index]
          const isFirstOccurrenceOfRank =
            ranks.findIndex((value) => value === rank) === index
          const isTie = ranks.filter((value) => value === rank).length > 1

          return (
            <li
              key={player.id}
              className={[
                'flex items-center gap-3 bg-surface px-4 py-2.5',
                isActive ? 'border-l-4 border-l-green bg-success-soft/60' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'flex w-10 shrink-0 flex-col items-start',
                  rank === 1 && isFirstOccurrenceOfRank
                    ? 'text-ink'
                    : 'text-green-dark',
                ].join(' ')}
                aria-label={`${rank}e place${isTie ? ' ex æquo' : ''}`}
              >
                <span className="text-xl font-black leading-none tabular-nums sm:text-2xl">
                  {rank}
                </span>
                {rank === 1 && isFirstOccurrenceOfRank ? (
                  <span
                    aria-hidden="true"
                    className="mt-1 h-1 w-5 rounded-sm bg-yellow"
                  />
                ) : null}
                {isTie ? (
                  <span className="mt-0.5 text-[9px] font-bold tracking-wider text-ink/55 uppercase">
                    ex æquo
                  </span>
                ) : null}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <span className="truncate">{player.pseudo}</span>
                  {isActive ? (
                    <span className="badge border-green bg-green text-white">
                      Toi
                    </span>
                  ) : null}
                </p>
                <p className="text-xs font-medium text-ink/70">
                  {player.exactScores} score
                  {player.exactScores > 1 ? 's' : ''} exact
                  {player.exactScores > 1 ? 's' : ''}
                </p>
              </div>

              <p className="shrink-0 text-right">
                <span className="block text-base font-black tabular-nums sm:text-lg">
                  {player.points}
                </span>
                <span className="text-[10px] font-bold tracking-wider uppercase opacity-70">
                  pts
                </span>
              </p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Alias historique — même composant, classement complet. */
export const RaceLeaders = GroupRanking
export const Podium = GroupRanking
