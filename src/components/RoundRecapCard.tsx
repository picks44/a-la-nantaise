import {
  formatRecapMessage,
  formatRecapRoundPoints,
  selectRecapIndicators,
} from '../lib/recapMessages'
import { formatRankChangeHuman } from '../lib/rankingDisplay'
import { pointsResultLabel } from '../lib/status'
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

  const rankSentence = formatRankChangeHuman({
    rankBefore: recap.ranking.rankBefore,
    rankAfter: recap.ranking.rankAfter,
    rankDelta: recap.ranking.rankDelta,
    isNewToRanking: recap.ranking.isNewToRanking,
    isLeader: recap.ranking.rankAfter === 1,
  })

  const indicators = selectRecapIndicators({
    exactScoreCount: recap.summary.exactScoreCount,
    missedPredictionCount: recap.summary.missedPredictionCount,
    participantAveragePoints: recap.social.participantAveragePoints,
    correctOutcomeOnlyCount: recap.summary.correctOutcomeOnlyCount,
  })

  const statusLabel = recap.isDefinitive ? 'Définitif' : 'Provisoire'
  const pointsLabel = formatRecapRoundPoints(recap.summary.roundPoints)
  const showMatches =
    recap.summary.participated && recap.matches.length > 0

  return (
    <section
      className="panel section-stack overflow-hidden p-4 sm:p-5"
      aria-label="Récap de journée"
    >
      <header className="space-y-3">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-ink/50 uppercase">
          Journée {recap.roundNumber}
          <span className="mx-1.5 opacity-40" aria-hidden="true">
            ·
          </span>
          {statusLabel}
        </p>

        <h2 className="text-xl font-black leading-snug text-ink sm:text-2xl">
          {message}
        </h2>

        <p className="pt-1 pb-1 text-5xl font-black tabular-nums leading-none text-green-dark sm:text-6xl">
          {recap.summary.roundPoints}
          <span className="ml-2 align-baseline text-sm font-semibold tracking-wide text-ink/45">
            {recap.summary.roundPoints <= 1 ? 'pt' : 'pts'}
          </span>
          <span className="sr-only"> ({pointsLabel})</span>
        </p>

        <p className="text-base font-semibold text-ink sm:text-lg">
          {rankSentence}
        </p>

        {indicators.length > 0 ? (
          <p className="text-sm font-medium leading-relaxed text-ink/65">
            {indicators.join(' · ')}
          </p>
        ) : null}
      </header>

      {showMatches ? (
        <ul className="space-y-3 border-t border-border/70 pt-4">
          {recap.matches.map((match) => (
            <li
              key={match.matchId}
              className="flex items-start justify-between gap-3 py-0.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{match.label}</p>
                <p className="mt-0.5 text-xs font-medium text-ink/60">
                  {match.finalScore
                    ? `Score ${match.finalScore.home}–${match.finalScore.away}`
                    : match.status}
                  {match.prediction
                    ? ` · Prono ${match.prediction.home}–${match.prediction.away}`
                    : ' · Non pronostiqué'}
                </p>
              </div>
              <span className="shrink-0 pt-0.5 text-xs font-extrabold text-ink">
                {match.predicted
                  ? (pointsResultLabel(match.points ?? 0) ?? '—')
                  : '—'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {recap.trophies.length > 0 ? (
        <ul className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
          {recap.trophies.map((trophy) => (
            <li
              key={`${trophy.trophyKey}-${trophy.sourceMatchId ?? 'x'}`}
              className="badge-text border-green/30 bg-success-soft text-green-dark"
            >
              {trophy.name}
            </li>
          ))}
        </ul>
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
