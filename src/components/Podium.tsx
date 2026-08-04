import { Link } from 'react-router-dom'
import {
  formatGapToLeader,
  formatSuccessRate,
} from '../lib/rankingDisplay'
import type { Player } from '../types'

interface GroupRankingProps {
  players: Player[]
  ranks: number[]
  activePlayerId: string
  title?: string
  showLink?: boolean
  /** compact = accueil ; full = page Classement onglet Général */
  variant?: 'compact' | 'full'
  emptyMessage?: string
  /** Accueil : aucun résultat noté encore — message compact à la place de la liste. */
  awaitingFirstResult?: boolean
  participantCount?: number
}

function RankingRow({
  player,
  rank,
  isActive,
  isTie,
  variant,
}: {
  player: Player
  rank: number
  isActive: boolean
  isTie: boolean
  variant: 'compact' | 'full'
}) {
  const isLeaderMark = rank === 1
  const hasScoredResults = player.scoredPredictions > 0

  return (
    <li
      className={[
        'flex items-start gap-3 bg-surface px-4',
        variant === 'full' ? 'py-3' : 'py-2.5',
        isActive ? 'border-l-4 border-l-green bg-success-soft/60' : '',
      ].join(' ')}
    >
      <span
        className="flex w-10 shrink-0 flex-col items-start text-green-dark sm:w-12"
        aria-label={`${rank}e place${isTie ? ' ex æquo' : ''}`}
      >
        <span
          className={[
            'font-black leading-none tabular-nums',
            variant === 'full'
              ? 'text-2xl'
              : 'text-xl sm:text-2xl',
          ].join(' ')}
        >
          {rank}
        </span>
        {isLeaderMark ? (
          <span
            aria-hidden="true"
            className="mt-1 h-1 w-5 rounded-sm bg-yellow sm:w-6"
          />
        ) : null}
        {isTie ? (
          <span className="mt-0.5 text-[9px] font-semibold tracking-wide text-ink/55">
            ex æquo
          </span>
        ) : null}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate text-sm sm:text-base">{player.pseudo}</span>
          {isActive ? (
            <span className="badge border-green bg-green text-white">Toi</span>
          ) : null}
          {variant === 'full' && !player.isActive ? (
            <span className="badge border-border bg-surface-muted text-muted">
              Inactif
            </span>
          ) : null}
        </p>

        {variant === 'compact' ? (
          <p className="text-xs font-medium text-ink/70">
            {`${player.exactScores} score${player.exactScores > 1 ? 's' : ''} exact${player.exactScores > 1 ? 's' : ''}`}
          </p>
        ) : hasScoredResults ? (
          <div className="mt-1 space-y-0.5 text-xs font-medium text-ink/70">
            <p className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span>
                {`${player.exactScores} exact${player.exactScores > 1 ? 's' : ''}`}
              </span>
              <span>
                {`${player.goodResults} bon${player.goodResults > 1 ? 's' : ''} résultat${player.goodResults > 1 ? 's' : ''}`}
              </span>
              <span>
                {`${player.scoredPredictions} noté${player.scoredPredictions > 1 ? 's' : ''}`}
              </span>
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span>Réussite {formatSuccessRate(player.successRate)}</span>
              <span>
                Écart{' '}
                {formatGapToLeader(
                  player.gapToLeader,
                  player.gapToLeader === 0,
                )}
              </span>
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs font-medium text-ink/70">
            Aucun résultat noté
          </p>
        )}
      </div>

      <div className="shrink-0 text-right">
        <p
          className={[
            'font-black tabular-nums',
            variant === 'full' ? 'text-xl' : 'text-base sm:text-lg',
          ].join(' ')}
        >
          {player.points}
        </p>
        <p className="text-[10px] font-semibold tracking-wider uppercase opacity-70">
          pts
        </p>
      </div>
    </li>
  )
}

function RankingHeader({
  title,
  showLink,
}: {
  title: string
  showLink: boolean
}) {
  return (
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
  )
}

/** Classement du groupe — ligne unique partagée (accueil compact / page complète). */
export function GroupRanking({
  players,
  ranks,
  activePlayerId,
  title = 'Classement du groupe',
  showLink = true,
  variant = 'compact',
  emptyMessage = 'Pas encore de joueurs pour afficher le classement.',
  awaitingFirstResult = false,
  participantCount = 0,
}: GroupRankingProps) {
  if (awaitingFirstResult) {
    const count = participantCount > 0 ? participantCount : players.length
    const joueurs = count > 1 ? 'participants' : 'participant'
    return (
      <section
        aria-labelledby="group-ranking-title"
        className="panel overflow-hidden"
      >
        <RankingHeader title={title} showLink={showLink} />
        <div className="space-y-1 px-4 py-4">
          <p className="text-sm font-bold text-ink">
            Le classement débutera après le premier match.
          </p>
          <p className="text-sm text-muted">
            {count} {joueurs} {count > 1 ? 'sont' : 'est'} prêt
            {count > 1 ? 's' : ''} à s’affronter.
          </p>
        </div>
      </section>
    )
  }

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
        <p className="px-4 py-4 text-sm text-muted">{emptyMessage}</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="group-ranking-title" className="panel overflow-hidden">
      <RankingHeader title={title} showLink={showLink} />

      <ol className="divide-y divide-border">
        {players.map((player, index) => {
          const rank = ranks[index]
          const isTie = ranks.filter((value) => value === rank).length > 1

          return (
            <RankingRow
              key={player.id}
              player={player}
              rank={rank}
              isActive={player.id === activePlayerId}
              isTie={isTie}
              variant={variant}
            />
          )
        })}
      </ol>
    </section>
  )
}

/** Alias historique — même composant. */
export const RaceLeaders = GroupRanking
export const Podium = GroupRanking
