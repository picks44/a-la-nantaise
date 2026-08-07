import { Link } from 'react-router-dom'
import {
  formatLiveRankDeltaLabel,
  formatLiveRankingSecondaryLine,
  formatLiveRoundPointsLabel,
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
  /** Affiche deltas / provisoire (classement vivant). */
  live?: boolean
}

function RankingRow({
  player,
  rank,
  isActive,
  isTie,
  variant,
  live,
}: {
  player: Player
  rank: number
  isActive: boolean
  isTie: boolean
  variant: 'compact' | 'full'
  live: boolean
}) {
  const isLeaderMark = variant === 'full' && rank === 1
  const deltaLabel = live ? formatLiveRankDeltaLabel(player.rankDelta) : null
  const roundPointsLabel = live
    ? formatLiveRoundPointsLabel(player.roundPoints)
    : null
  const secondaryLine = live
    ? formatLiveRankingSecondaryLine({
        isNewToRanking: player.isNewToRanking,
        rankDelta: player.rankDelta,
        roundPoints: player.roundPoints,
      })
    : null
  const deltaPositive = (player.rankDelta ?? 0) > 0
  const deltaNegative = (player.rankDelta ?? 0) < 0

  const rankAria = [
    `${rank}e place`,
    isTie ? 'ex æquo' : null,
    player.isNewToRanking ? 'nouveau au classement' : null,
    deltaLabel && deltaLabel !== 'Stable' ? deltaLabel : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <li
      className={[
        'flex items-start bg-surface px-4',
        variant === 'full' ? 'gap-3 py-4' : 'gap-2.5 py-3',
        isActive ? 'border-l-2 border-l-green bg-success-soft/35' : '',
      ].join(' ')}
    >
      <span
        className={[
          'flex shrink-0',
          variant === 'full'
            ? 'w-11 flex-col items-start text-green-dark sm:w-12'
            : 'w-5 items-baseline pt-0.5 text-ink/45',
        ].join(' ')}
        aria-label={rankAria}
      >
        <span
          className={[
            'leading-none tabular-nums',
            variant === 'full'
              ? 'text-2xl font-black sm:text-3xl'
              : 'text-sm font-semibold sm:text-[0.9375rem]',
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
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={[
              'truncate',
              variant === 'full'
                ? 'text-base font-semibold sm:text-lg'
                : 'text-sm font-bold sm:text-base',
            ].join(' ')}
          >
            {player.pseudo}
          </p>
          {isActive ? (
            <span className="badge-text border-green bg-green text-white">
              {variant === 'compact' ? 'TOI' : 'Toi'}
            </span>
          ) : null}
          {variant === 'full' && !player.isActive ? (
            <span className="badge-text border-border bg-surface-muted text-muted">
              Inactif
            </span>
          ) : null}
          {live && player.isNewToRanking ? (
            <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border border-ink/10 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.06em] text-ink/45 uppercase">
              Nouveau
            </span>
          ) : null}
        </div>

        {/* Classement full+live : une seule ligne secondaire (delta · pts journée). */}
        {variant === 'full' && live ? (
          secondaryLine ? (
            player.isNewToRanking ? (
              <p className="mt-1.5 text-xs font-medium text-ink/55">
                {secondaryLine}
              </p>
            ) : (
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium text-ink/55">
                {deltaLabel ? (
                  <span
                    className={[
                      'tabular-nums',
                      deltaPositive
                        ? 'text-green-dark'
                        : deltaNegative
                          ? 'text-warning'
                          : 'text-ink/55',
                    ].join(' ')}
                  >
                    {deltaLabel}
                  </span>
                ) : null}
                {deltaLabel && roundPointsLabel ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {roundPointsLabel ? (
                  <span className="tabular-nums text-ink/55">
                    {roundPointsLabel}
                  </span>
                ) : null}
              </p>
            )
          ) : (
            <p className="mt-1.5 text-xs font-medium text-ink/55">
              Aucun résultat noté
            </p>
          )
        ) : null}

        {variant === 'compact' ? (
          <p className="mt-1 text-xs font-medium text-ink/60">
            {`${player.exactScores} exact${player.exactScores > 1 ? 's' : ''}`}
          </p>
        ) : null}
      </div>

      {variant === 'compact' ? (
        <p className="shrink-0 self-start pt-0.5 text-sm font-black tabular-nums sm:text-base">
          {player.points} pts
        </p>
      ) : (
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black tabular-nums leading-none">
            {player.points}
          </p>
          <p className="mt-0.5 text-xs font-semibold tracking-wider uppercase text-ink/55">
            pts
          </p>
        </div>
      )}
    </li>
  )
}

function RankingHeader({
  title,
  showLink,
  badge,
  context,
}: {
  title: string
  showLink: boolean
  badge?: string | null
  /** Compact Home : contexte de journée (ex. « Après J4 »). */
  context?: string | null
}) {
  return (
    <div
      className={[
        'flex justify-between gap-3 border-b border-border px-4',
        context ? 'items-start py-3.5' : 'items-center py-3',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={[
            'w-1.5 shrink-0 bg-green',
            context ? 'mt-0.5 h-8' : 'h-5',
          ].join(' ')}
        />
        <div className="min-w-0">
          <h2
            id="group-ranking-title"
            className="truncate text-sm font-black tracking-[0.06em] uppercase"
          >
            {title}
          </h2>
          {context ? (
            <p className="mt-0.5 text-xs font-medium text-muted">{context}</p>
          ) : null}
          {badge ? (
            <span className="badge-text mt-1 shrink-0 border-border bg-surface-muted text-muted">
              {badge}
            </span>
          ) : null}
        </div>
      </div>
      {showLink ? (
        <Link
          to="/classement"
          className={[
            'shrink-0 text-[11px] font-bold tracking-[0.1em] text-green uppercase underline-offset-2 hover:underline',
            context ? 'pt-0.5' : '',
          ].join(' ')}
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
  live = false,
}: GroupRankingProps) {
  // Statut provisoire/définitif : un seul contexte (récap ou chrome RankingPage), pas de badge header.
  const badge = null
  const referenceRoundNumber = players.find(
    (player) => player.referenceRoundNumber != null,
  )?.referenceRoundNumber
  const compactContext =
    variant === 'compact' && referenceRoundNumber != null
      ? `Après J${referenceRoundNumber}`
      : null

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
      <RankingHeader
        title={title}
        showLink={showLink}
        badge={badge}
        context={compactContext}
      />

      <ol className="divide-y divide-border">
        {players.map((player, index) => {
          const rank = player.rank ?? ranks[index]
          const isTie =
            players.filter((other) => (other.rank ?? 0) === rank).length > 1 ||
            ranks.filter((value) => value === rank).length > 1

          return (
            <RankingRow
              key={player.id}
              player={player}
              rank={rank}
              isActive={player.id === activePlayerId}
              isTie={isTie}
              variant={variant}
              live={live}
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
