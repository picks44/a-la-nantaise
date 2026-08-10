import { Link } from 'react-router-dom'
import {
  formatRecapMatchDetail,
  formatRecapMatchHeadline,
  formatRecapMessage,
  formatRecapRoundPoints,
  selectRecapIndicators,
} from '../lib/recapMessages'
import { formatRankChangeHuman } from '../lib/rankingDisplay'
import type { PlayerRoundRecap } from '../types'

export function RoundRecapCard({
  recap,
  onDismiss,
}: {
  recap: PlayerRoundRecap
  onDismiss?: () => void
}) {
  const messageParams = {
    ...recap.messageParams,
    rank: recap.messageParams.rank ?? recap.ranking.rankAfter ?? 0,
    places:
      recap.messageParams.places ??
      (recap.ranking.rankDelta != null
        ? Math.abs(recap.ranking.rankDelta)
        : 0),
    rankDelta: recap.ranking.rankDelta ?? '',
    exactScoreCount:
      recap.messageParams.exactScoreCount ?? recap.summary.exactScoreCount,
  }

  const message = formatRecapMessage(
    recap.messageKey,
    messageParams,
    recap.isDefinitive,
  )

  const isTied = recap.ranking.isTied
  const rankSentence = formatRankChangeHuman({
    rankBefore: recap.ranking.rankBefore,
    rankAfter: recap.ranking.rankAfter,
    rankDelta: recap.ranking.rankDelta,
    isNewToRanking: recap.ranking.isNewToRanking,
    isTied,
    isLeader: recap.ranking.rankAfter === 1 && !isTied,
  })

  const indicators = selectRecapIndicators({
    exactScoreCount: recap.summary.exactScoreCount,
    missedPredictionCount: recap.summary.missedPredictionCount,
    correctOutcomeOnlyCount: recap.summary.correctOutcomeOnlyCount,
  })

  const statusLabel = recap.isDefinitive ? 'Définitif' : 'Provisoire'
  const pointsLabel = formatRecapRoundPoints(recap.summary.roundPoints)
  const showMatches =
    recap.summary.participated && recap.matches.length > 0
  const trophyCount = recap.trophies.length

  return (
    <section
      id="recap"
      className="panel section-stack overflow-hidden p-4 sm:p-5 scroll-mt-24"
      aria-label="Récap de journée"
    >
      <header className="space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-ink/50 uppercase">
          Journée {recap.roundNumber}
          <span className="mx-1.5 opacity-40" aria-hidden="true">
            ·
          </span>
          {statusLabel}
        </p>

        <h2 className="pt-1 text-xl font-black leading-snug text-ink sm:text-2xl">
          {message}
        </h2>

        <p className="text-3xl font-black tabular-nums leading-none text-green-dark sm:text-4xl">
          {recap.summary.roundPoints}
          <span className="ml-2 align-baseline text-sm font-semibold tracking-wide text-ink/45">
            {recap.summary.roundPoints <= 1 ? 'pt' : 'pts'}
          </span>
          <span className="sr-only"> ({pointsLabel})</span>
        </p>

        <p className="text-base font-bold text-ink sm:text-lg">{rankSentence}</p>

        {indicators.length > 0 ? (
          <p className="text-sm font-medium text-ink/60">
            {indicators.join(' · ')}
          </p>
        ) : null}
      </header>

      {showMatches ? (
        <ul className="space-y-3 border-t border-border/70 pt-4">
          {recap.matches.map((match) => (
            <li key={match.matchId} className="min-w-0 text-sm">
              <p className="truncate font-bold text-ink">
                {formatRecapMatchHeadline(match)}
              </p>
              <p className="mt-0.5 text-xs font-medium text-ink/60">
                {formatRecapMatchDetail(match)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {trophyCount > 0 ? (
        <p className="border-t border-border/70 pt-3 text-xs font-medium text-ink/55">
          <Link
            to="/classement"
            className="font-semibold text-green-dark underline-offset-2 hover:underline"
          >
            {trophyCount === 1
              ? 'Nouveau trophée débloqué'
              : `${trophyCount} nouveaux trophées débloqués`}
          </Link>
        </p>
      ) : null}

      {onDismiss ? (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={onDismiss}
        >
          Fermer
        </button>
      ) : null}
    </section>
  )
}
